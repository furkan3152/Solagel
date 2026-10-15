/**
 * Arena tickets: what the lobby lists, what a ticket button does, and the one
 * transaction that buys a ticket. Pure functions (no React, no network) so the
 * money path is unit-tested (test/ticket.test.ts).
 */
import { RULES, type ChainStatus, type PassPower, type RoomInfo } from '@slana/shared';
import { ACCOUNT_BYTES as SDK_ACCOUNT_BYTES, SESSION_REFUND_TIMEOUT_SECS, createAtaIdempotentIx, type Address, type SlanaInstructions, type TokenAccounts } from '@slana/sdk';
import type { TransactionInstruction } from '@solana/web3.js';

/* ── the ticket transaction ─────────────────────────────────────────────── */

export type TicketStep = 'ata' | 'register' | 'join' | 'joinWithPass';

export interface TicketTxInput {
  player: Address;
  arenaId: number;
  /** The game token (`Config.tokenMint` / `Config.tokenProgram`). */
  token: TokenAccounts;
  /** Does the player's token account exist? `null` (unknown) creates it idempotently. */
  ataExists: boolean | null;
  /** Profile to register in the same transaction; `null` when the player already has one. */
  register: { name: string; skin: number } | null;
  /** Slana Pass asset backing the ticket (`joinArenaWithPass`); `null` for a plain ticket. */
  passAsset: string | null;
  /** The fee rate (bps) shown on the frozen review: the program refuses a higher one (`FeeAboveLimit`). */
  maxFeeBps: number;
  /** The entry fee shown on the frozen review (raw units): the program refuses a higher one (`EntryFeeAboveLimit`). */
  maxEntryFee: bigint;
  /** The settle deposit shown on the frozen review (lamports): the program refuses a higher one (`SettleFeeAboveLimit`). */
  maxSettleFee: number;
}

/** The instructions a ticket transaction carries, in order. */
export function ticketSteps(input: Pick<TicketTxInput, 'ataExists' | 'register' | 'passAsset'>): TicketStep[] {
  const steps: TicketStep[] = [];
  if (input.ataExists !== true) steps.push('ata');
  if (input.register) steps.push('register');
  steps.push(input.passAsset ? 'joinWithPass' : 'join');
  return steps;
}

/**
 * One transaction: `[createAtaIdempotent?] + [registerPlayer?] + joinArena | joinArenaWithPass`.
 * The player pays every rent in it (the server never pays a player's token account).
 */
export async function buildTicketTx(ix: SlanaInstructions, input: TicketTxInput): Promise<{ steps: TicketStep[]; ixs: TransactionInstruction[] }> {
  const steps = ticketSteps(input);
  const ixs: TransactionInstruction[] = [];
  for (const step of steps) {
    if (step === 'ata') ixs.push(createAtaIdempotentIx(input.player, input.player, input.token.tokenMint, input.token.tokenProgram));
    else if (step === 'register') ixs.push(await ix.registerPlayer(input.player, input.register!.name, input.register!.skin));
    else {
      const limits = { maxFeeBps: input.maxFeeBps, maxEntryFee: input.maxEntryFee, maxSettleFee: input.maxSettleFee };
      if (step === 'joinWithPass') ixs.push(await ix.joinArenaWithPass(input.player, { arenaId: input.arenaId, ...input.token, passAsset: input.passAsset!, ...limits }));
      else ixs.push(await ix.joinArena(input.player, { arenaId: input.arenaId, ...input.token, ...limits }));
    }
  }
  return { steps, ixs };
}

/** A transaction with only the player's token account (idempotent, player-paid). */
export function buildAtaTx(player: Address, token: TokenAccounts): TransactionInstruction[] {
  return [createAtaIdempotentIx(player, player, token.tokenMint, token.tokenProgram)];
}

export type CloseStep = 'ata' | 'collect' | 'refund';

/**
 * Closing a ticket yourself, one transaction: `[createAtaIdempotent] + refundSession`. The
 * token account is always created idempotently first (player-paid, a no-op when it exists),
 * so a payout can land even if the account was closed. `collect` pays a finalized session's
 * `owed` payout at once (R24); `refund` returns an unsettled ticket's entry fee after
 * 24 h. A finalized session's Pass lock is already closed, so none is passed.
 */
export async function buildCloseTx(
  ix: SlanaInstructions,
  input: { player: Address; arenaId: number; token: TokenAccounts; finalized: boolean; passAsset: string | null },
): Promise<{ steps: CloseStep[]; ixs: TransactionInstruction[] }> {
  const ixs = [
    createAtaIdempotentIx(input.player, input.player, input.token.tokenMint, input.token.tokenProgram),
    await ix.refundSession(input.player, {
      arenaId: input.arenaId,
      ...input.token,
      finalized: input.finalized,
      passAsset: input.finalized ? null : input.passAsset,
    }),
  ];
  return { steps: ['ata', input.finalized ? 'collect' : 'refund'], ixs };
}

/* ── the ticket list ────────────────────────────────────────────────────── */

export type TicketKey = 'practice' | `arena:${number}`;

/** On-chain arena fields the lobby needs (an `ArenaView` fits). */
export interface ArenaLike {
  id: number;
  entryFee: bigint;
  requiresPass: boolean;
  enabled: boolean;
}

export interface TicketModel {
  key: TicketKey;
  arenaId: number | null;
  /** Raw token units (0 for practice). */
  entryFee: bigint;
  requiresPass: boolean;
  /** Summed over every instance of the arena. */
  humans: number;
  bots: number;
  /** Loot on the floor, raw token units. */
  loot: number;
  /** The arena exists on chain and is open (practice: always). */
  open: boolean;
  /** The server keeps this arena closed (R20: its vault cannot cover the journal): "under maintenance", no sales. */
  blocked?: boolean;
}

/**
 * Practice plus one ticket per arena. Arena rooms are sharded into instances,
 * so live counts and loot are summed per `arenaId`. The on-chain arena wins for
 * the price (it is what the player signs); rooms fill in when the chain is not
 * readable yet. Sorted by price.
 */
export function buildTickets(rooms: readonly RoomInfo[], arenas: readonly ArenaLike[], blocked: readonly number[] = []): TicketModel[] {
  const practice: TicketModel = { key: 'practice', arenaId: null, entryFee: 0n, requiresPass: false, humans: 0, bots: 0, loot: 0, open: true };
  const byId = new Map<number, TicketModel>();
  for (const a of arenas) {
    byId.set(a.id, { key: `arena:${a.id}`, arenaId: a.id, entryFee: a.entryFee, requiresPass: a.requiresPass, humans: 0, bots: 0, loot: 0, open: a.enabled });
  }
  const chainKnown = arenas.length > 0;
  for (const r of rooms) {
    if (r.mode === 'practice') {
      practice.humans += r.players;
      practice.bots += r.bots;
      continue;
    }
    if (r.mode !== 'arena' || r.arenaId === undefined) continue;
    let t = byId.get(r.arenaId);
    if (!t) {
      // only list arenas the chain does not know about when the chain is not readable
      if (chainKnown) continue;
      t = {
        key: `arena:${r.arenaId}`,
        arenaId: r.arenaId,
        entryFee: BigInt(r.entryFee ?? 0),
        requiresPass: r.requiresPass === true,
        humans: 0,
        bots: 0,
        loot: 0,
        open: true,
      };
      byId.set(r.arenaId, t);
    }
    t.humans += r.players;
    t.bots += r.bots;
    t.loot += r.loot ?? 0;
  }
  for (const id of blocked) {
    const t = byId.get(id);
    if (t) t.blocked = true;
  }
  const list = [...byId.values()].sort((a, b) => (a.entryFee < b.entryFee ? -1 : a.entryFee > b.entryFee ? 1 : (a.arenaId ?? 0) - (b.arenaId ?? 0)));
  return [practice, ...list];
}

/* ── quick play ─────────────────────────────────────────────────────────── */

export interface QuickPlayInput {
  walletConnected: boolean;
  /** Game-token balance, raw units (`null` = unknown). */
  balance: bigint | null;
  tickets: readonly TicketModel[];
  /** The wallet owns a Pass that is not locked in another session. */
  hasFreePass: boolean;
  lastArena: number | null;
  /** Arenas where the wallet already has an open ticket (playing them costs nothing). */
  openSessions?: readonly number[];
}

/**
 * Where "Hızlı oyna" goes: no wallet or no tokens → practice; otherwise an open
 * ticket, then the last arena if still affordable, else the cheapest affordable
 * arena, else practice.
 */
export function quickPlayTarget(input: QuickPlayInput): TicketKey {
  if (!input.walletConnected || input.balance === null || input.balance <= 0n) {
    const resumable = input.walletConnected ? input.tickets.find((t) => t.arenaId !== null && input.openSessions?.includes(t.arenaId)) : undefined;
    return resumable ? resumable.key : 'practice';
  }
  const arenas = input.tickets.filter((t) => t.arenaId !== null && t.open && !t.blocked);
  const open = arenas.find((t) => input.openSessions?.includes(t.arenaId!));
  if (open) return open.key;
  const balance = input.balance;
  const affordable = (t: TicketModel) => t.entryFee > 0n && t.entryFee <= balance && (!t.requiresPass || input.hasFreePass);
  const last = arenas.find((t) => t.arenaId === input.lastArena);
  if (last && affordable(last)) return last.key;
  const cheapest = arenas.filter(affordable).sort((a, b) => (a.entryFee < b.entryFee ? -1 : a.entryFee > b.entryFee ? 1 : 0))[0];
  return cheapest ? cheapest.key : 'practice';
}

/* ── what a ticket button does ──────────────────────────────────────────── */

export interface PendingPayout {
  /** Journal key (the session address). */
  key: string;
  arenaId: number | null;
  /** Raw token units the server is still settling. */
  payout: number;
}

export interface OpenSession {
  address: string;
  openedAt: number;
  hasPass: boolean;
  passAsset: string | null;
  /** R24: settled without a token account; `owed` waits for the player to collect it. */
  finalized?: boolean;
  /** Raw token units to collect (finalized sessions). */
  owed?: bigint;
}

export type TicketGate =
  | { kind: 'practice' }
  | { kind: 'offline' }
  /** R20: the server keeps this arena closed (its vault cannot cover the journal); nothing is sold. */
  | { kind: 'maintenance' }
  | { kind: 'connect' }
  /** R24: the last game here is settled and its payout waits for the player: "Collect payout". */
  | { kind: 'collect'; owed: bigint }
  /** The previous game in this arena is being paid out (no new ticket yet). */
  | { kind: 'settling'; payout: number }
  /** The open ticket is older than 24 h: the player may refund it themselves. */
  | { kind: 'refund' }
  | { kind: 'verify' }
  /** "Devam et": an open ticket, no transaction. */
  | { kind: 'resume' }
  | { kind: 'needPass' }
  | { kind: 'insufficient'; missing: bigint }
  | { kind: 'buy' };

export interface GateInput {
  ticket: TicketModel;
  arenasEnabled: boolean;
  walletConnected: boolean;
  verified: boolean;
  balance: bigint | null;
  session: OpenSession | null;
  pending: readonly PendingPayout[];
  /** Owned Passes that are not locked in another session. */
  freePasses: number;
  nowS: number;
}

export function ticketGate(g: GateInput): TicketGate {
  const t = g.ticket;
  if (t.arenaId === null) return { kind: 'practice' };
  // R24: a payout waiting to be collected comes first, even while arenas are offline or blocked
  if (g.walletConnected && g.session?.finalized) return { kind: 'collect', owed: g.session.owed ?? 0n };
  if (!g.arenasEnabled) return { kind: 'offline' };
  if (!t.blocked && !t.open) return { kind: 'offline' };
  if (!g.walletConnected) return t.blocked ? { kind: 'maintenance' } : { kind: 'connect' };
  // a payout the server is still settling comes next, even in a blocked arena
  const owed = g.pending.filter((p) => (g.session && p.key === g.session.address) || p.arenaId === t.arenaId);
  if (owed.length > 0) return { kind: 'settling', payout: owed.reduce((s, p) => s + p.payout, 0) };
  // an open ticket keeps its paths (resume, or the 24 h self-refund) even in a blocked arena
  if (g.session) {
    if (g.nowS - g.session.openedAt >= SESSION_REFUND_TIMEOUT_SECS) return { kind: 'refund' };
    return g.verified ? { kind: 'resume' } : { kind: 'verify' };
  }
  // R20: the server keeps this arena closed; nothing new is sold
  if (t.blocked) return { kind: 'maintenance' };
  if (!g.verified) return { kind: 'verify' };
  if (t.requiresPass && g.freePasses === 0) return { kind: 'needPass' };
  if (g.balance !== null && g.balance < t.entryFee) return { kind: 'insufficient', missing: t.entryFee - g.balance };
  return { kind: 'buy' };
}

/* ── fee policy ─────────────────────────────────────────────────────────── */

/** Program defaults (5 % of profit, 2 % with a Pass) when the config is not loaded. */
export const DEFAULT_FEE_BPS = 500;
export const DEFAULT_PASS_FEE_BPS = 200;

export function feeBps(config: { feeBps: number; passFeeBps: number } | null, withPass: boolean): number {
  if (!config) return withPass ? DEFAULT_PASS_FEE_BPS : DEFAULT_FEE_BPS;
  return withPass ? config.passFeeBps : config.feeBps;
}

/** `500` → `5`, `250` → `2,5` / `2.5`. */
export function bpsPercent(bps: number, lang: 'tr' | 'en'): string {
  const s = (bps / 100).toFixed(2).replace(/\.?0+$/, '');
  return lang === 'tr' ? s.replace('.', ',') : s;
}

/** Pass power numbers for the perk line ("+%15 başlangıç · 2 sn cash-out"). */
export interface PassPowerText {
  startPct: number;
  cashoutS: number;
}

/**
 * I3: the Pass power the server actually applies (`ChainStatus.passPower`, from its env),
 * with `RULES` as the fallback for older servers.
 */
export function passPowerOf(power: PassPower | null | undefined): PassPowerText {
  const p = power ?? { startMassMul: RULES.passStartMassMul, cashoutMs: RULES.passCashoutMs };
  return { startPct: Math.round((p.startMassMul - 1) * 100), cashoutS: p.cashoutMs / 1000 };
}

/** `RULES` defaults (use `passPowerOf(chain.passPower)` / `usePassPower()` for what the server applies). */
export const PASS_POWER: PassPowerText = passPowerOf(null);

/** The cash-out channel length of a ticket on this server (Pass tickets use the server's Pass power). */
export function cashoutMsOf(chain: Pick<ChainStatus, 'passPower'> | null | undefined, hasPass: boolean): number {
  return hasPass ? (chain?.passPower?.cashoutMs ?? RULES.passCashoutMs) : RULES.cashoutMs;
}

/** R24: arenas whose last game is settled with a payout waiting to be collected. */
export function sessionsToCollect(sessions: Readonly<Record<number, OpenSession | null>>): { arenaId: number; owed: bigint }[] {
  return Object.entries(sessions)
    .filter(([, s]) => s?.finalized)
    .map(([id, s]) => ({ arenaId: Number(id), owed: s!.owed ?? 0n }));
}

/* ── SOL the ticket transaction moves ───────────────────────────────────── */

/**
 * Account sizes: the program accounts come from the SDK (`ACCOUNT_BYTES`, checked against
 * the IDL layouts by an SDK test, so the session size follows the program); the SPL token
 * account is 165 bytes (170 for a Token-2022 ATA, which carries the immutable-owner extension).
 */
export const ACCOUNT_BYTES = {
  profile: SDK_ACCOUNT_BYTES.playerProfile,
  session: SDK_ACCOUNT_BYTES.session,
  passLock: SDK_ACCOUNT_BYTES.passLock,
  ata: 165,
  ata2022: 170,
} as const;

/**
 * Compute-unit limit of the ticket transaction (bounds the priority fee). The localnet e2e
 * measured 25k (register + join) to 34k (ATA idempotent + register + join with a Pass) on
 * Token-2022 with the deployed lean program (49k–66k on the Anchor reference); 150k keeps more
 * than 2× headroom for longer names and bump searches.
 */
export const TICKET_COMPUTE_UNITS = 150_000;
/** Priority fee the web client attaches, micro-lamports per compute unit. */
export const PRIORITY_MICRO_LAMPORTS = 20_000;
/** Base fee per signature. */
export const BASE_FEE_LAMPORTS = 5_000;

/** Rent-exempt minimum the default cluster rent would charge (fallback when the RPC cannot be asked). */
export const defaultRent = (bytes: number): number => (bytes + 128) * 6_960;

export interface SolCost {
  /** Everything that leaves the wallet in SOL: rents, deposit, network fees. */
  total: number;
  /** Comes back when the ticket closes (session and Pass-lock rent). */
  refundable: number;
}

/**
 * SOL a ticket transaction moves. Session and Pass-lock rent return when the
 * ticket closes; profile and token-account rent stay with the player's own
 * accounts; the settle deposit pays the server's payout transaction.
 */
export function ticketSolCost(steps: readonly TicketStep[], opts: { settleFeeLamports: number; token2022: boolean; rent: (bytes: number) => number }): SolCost {
  let refundable = opts.rent(ACCOUNT_BYTES.session);
  if (steps.includes('joinWithPass')) refundable += opts.rent(ACCOUNT_BYTES.passLock);
  let kept = 0;
  if (steps.includes('register')) kept += opts.rent(ACCOUNT_BYTES.profile);
  if (steps.includes('ata')) kept += opts.rent(opts.token2022 ? ACCOUNT_BYTES.ata2022 : ACCOUNT_BYTES.ata);
  const fees = BASE_FEE_LAMPORTS + Math.ceil((TICKET_COMPUTE_UNITS * PRIORITY_MICRO_LAMPORTS) / 1_000_000);
  return { total: refundable + kept + opts.settleFeeLamports + fees, refundable };
}

/**
 * Compute-unit limit of the close transaction (`createAtaIdempotent` + `refundSession`);
 * bounds the priority fee. The token account creation is the larger part (~25k on Token-2022); the
 * localnet e2e measured 28k in total on the deployed lean program (39k on the Anchor reference).
 */
export const CLOSE_COMPUTE_UNITS = 100_000;

/**
 * SOL a close transaction (collect payout / refund) moves: the token-account rent when the
 * account does not exist yet (it stays the player's) and the network fee. `back` is what
 * returns: the session rent, plus the unused settle deposit of an unsettled ticket.
 */
export function closeSolCost(opts: {
  ataExists: boolean | null;
  token2022: boolean;
  finalized: boolean;
  settleFeeLamports: number;
  rent: (bytes: number) => number;
}): { total: number; back: number } {
  const kept = opts.ataExists === true ? 0 : opts.rent(opts.token2022 ? ACCOUNT_BYTES.ata2022 : ACCOUNT_BYTES.ata);
  const fees = BASE_FEE_LAMPORTS + Math.ceil((CLOSE_COMPUTE_UNITS * PRIORITY_MICRO_LAMPORTS) / 1_000_000);
  const back = opts.rent(ACCOUNT_BYTES.session) + (opts.finalized ? 0 : opts.settleFeeLamports);
  return { total: kept + fees, back };
}
