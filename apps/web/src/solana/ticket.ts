/**
 * Arena tickets: what the lobby lists, what a ticket button does, and the one
 * transaction that buys a ticket. Pure functions (no React, no network) so the
 * money path is unit-tested (test/ticket.test.ts).
 */
import { RULES, type RoomInfo } from '@slana/shared';
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
 * The player pays every rent in it (ruling R10: the server never pays a player's token account).
 */
export async function buildTicketTx(ix: SlanaInstructions, input: TicketTxInput): Promise<{ steps: TicketStep[]; ixs: TransactionInstruction[] }> {
  const steps = ticketSteps(input);
  const ixs: TransactionInstruction[] = [];
  for (const step of steps) {
    if (step === 'ata') ixs.push(createAtaIdempotentIx(input.player, input.player, input.token.tokenMint, input.token.tokenProgram));
    else if (step === 'register') ixs.push(await ix.registerPlayer(input.player, input.register!.name, input.register!.skin));
    else if (step === 'joinWithPass')
      ixs.push(await ix.joinArenaWithPass(input.player, { arenaId: input.arenaId, ...input.token, passAsset: input.passAsset!, maxFeeBps: input.maxFeeBps }));
    else ixs.push(await ix.joinArena(input.player, { arenaId: input.arenaId, ...input.token, maxFeeBps: input.maxFeeBps }));
  }
  return { steps, ixs };
}

/** R10: a transaction with only the player's token account (so a queued payout can land). */
export function buildAtaTx(player: Address, token: TokenAccounts): TransactionInstruction[] {
  return [createAtaIdempotentIx(player, player, token.tokenMint, token.tokenProgram)];
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
  /** Raw token units owed. */
  payout: number;
  /** R10: the payout waits for the player's token account. */
  needsTokenAccount: boolean;
}

export interface OpenSession {
  address: string;
  openedAt: number;
  hasPass: boolean;
  passAsset: string | null;
}

export type TicketGate =
  | { kind: 'practice' }
  | { kind: 'offline' }
  /** R20: the server keeps this arena closed (its vault cannot cover the journal); nothing is sold. */
  | { kind: 'maintenance' }
  | { kind: 'connect' }
  /** The previous game in this arena is being paid out (no new ticket yet). */
  | { kind: 'settling'; payout: number }
  /** R10: the payout is queued until the player creates their token account. */
  | { kind: 'needAta'; payout: number }
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
  /** Does the wallet's token account exist? Once it does, a `needsTokenAccount` payout is just settling. */
  ataExists?: boolean | null;
  nowS: number;
}

export function ticketGate(g: GateInput): TicketGate {
  const t = g.ticket;
  if (t.arenaId === null) return { kind: 'practice' };
  if (!g.arenasEnabled) return { kind: 'offline' };
  if (!t.blocked && !t.open) return { kind: 'offline' };
  if (!g.walletConnected) return t.blocked ? { kind: 'maintenance' } : { kind: 'connect' };
  // a payout owed to this wallet comes first, even in a blocked arena (R10 CTA included)
  const owed = g.pending.filter((p) => (g.session && p.key === g.session.address) || p.arenaId === t.arenaId);
  if (owed.length > 0) {
    const payout = owed.reduce((s, p) => s + p.payout, 0);
    return owed.some((p) => p.needsTokenAccount) && g.ataExists !== true ? { kind: 'needAta', payout } : { kind: 'settling', payout };
  }
  // R20: the server keeps this arena closed; nothing is sold
  if (t.blocked) return { kind: 'maintenance' };
  if (g.session) {
    if (g.nowS - g.session.openedAt >= SESSION_REFUND_TIMEOUT_SECS) return { kind: 'refund' };
    return g.verified ? { kind: 'resume' } : { kind: 'verify' };
  }
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
export const PASS_POWER = {
  startPct: Math.round((RULES.passStartMassMul - 1) * 100),
  cashoutS: RULES.passCashoutMs / 1000,
};

/** R10: payouts still waiting for the player's token account (none once it exists). */
export function payoutsNeedingAta(pending: readonly PendingPayout[], ataExists: boolean | null): PendingPayout[] {
  return ataExists === true ? [] : pending.filter((p) => p.needsTokenAccount);
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

/** Compute-unit limit of the ticket transaction (bounds the priority fee). */
export const TICKET_COMPUTE_UNITS = 300_000;
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
