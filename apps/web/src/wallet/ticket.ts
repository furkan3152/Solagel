/**
 * Arena tickets: what the lobby lists, what a ticket button does, and the calls that buy one.
 * Pure functions (no React, no network) so the money path is unit-tested (test/ticket.test.ts).
 *
 * Units: amounts read from the chain (entry fees, balances, `owed`) are bigint **base units** of
 * the ERC-20 game token. Amounts on the game server's wire (room entry fees, loot, payouts) are
 * **ledger units** (at most 6 decimals, see `fromLedger` / `ledgerDecimals` in the SDK); they
 * are converted with `fromLedger` before they meet a chain amount.
 */
import { DEFAULT_ARENAS, type RoomInfo } from '@elymum/shared';
import { DEFAULT_FEE_BPS, REFUND_DELAY_SECS, fromLedger } from '@elymum/sdk';

/* ── the ticket calls ───────────────────────────────────────────────── */

/** `approve` (only when the allowance is short; exact amount) then `join`: two wallet prompts at most. */
export type TicketStep = 'approve' | 'join';

/** The calls a ticket needs, in order. `allowance` null (unknown) asks for the approval to be safe. */
export function ticketSteps(allowance: bigint | null, entryFee: bigint): TicketStep[] {
  return allowance !== null && allowance >= entryFee ? ['join'] : ['approve', 'join'];
}

/** `planJoin` refusals (its RangeError text) → the ticket sheet's error names (`tf.err.*`). */
export function planErrorName(message: string): string {
  if (/is full/.test(message)) return 'ArenaFull';
  if (/is closed/.test(message)) return 'ArenaDisabled';
  if (/balance too low/.test(message)) return 'InsufficientBalance';
  if (/no game token/.test(message)) return 'TokenNotSet';
  if (/does not exist/.test(message)) return 'PriceChanged';
  return 'NetworkError';
}

/** The journal key of a session: `<arenaId>:<player lowercase>:<sessionId>` (= `joined.session` / `settled.session`). */
export function sessionKey(arenaId: number, player: string, sessionId: bigint | number): string {
  return `${arenaId}:${player.toLowerCase()}:${sessionId.toString()}`;
}

/* ── the ticket list ────────────────────────────────────────────────────── */

export type TicketKey = 'practice' | `arena:${number}`;

/** On-chain arena fields the lobby needs (an SDK `ArenaInfo` fits). */
export interface ArenaLike {
  id: number;
  /** Base units. */
  entryFee: bigint;
  enabled: boolean;
  exists?: boolean;
}

export interface TicketModel {
  key: TicketKey;
  arenaId: number | null;
  /** Base units of the game token (0 for practice). */
  entryFee: bigint;
  /** Summed over every instance of the arena. */
  humans: number;
  bots: number;
  /** Loot on the floor, ledger units (from the server). */
  loot: number;
  /** The arena exists on chain and is open (practice: always). */
  open: boolean;
  /** The server keeps this arena closed (its vault cannot cover the journal): "under maintenance", no sales. */
  blocked?: boolean;
  /**
   * The game token is not set on chain yet: a default arena shown as "Opening soon" (its
   * price from `DEFAULT_ARENAS`), not for sale. Practice still plays.
   */
  soon?: boolean;
}

/** What the lobby knows about the game token (`ChainStatus`). */
export interface TokenState {
  /** The chain is on (an arena contract is configured). */
  enabled: boolean;
  /** The token is set on the arena contract (`ChainStatus.tokenReady`). */
  tokenReady: boolean;
  /** The token's decimals (18 when unknown, like the contract's default). */
  decimals: number;
}

/** The default arenas, "Opening soon", while the token is not set (whole tokens × 10^decimals). */
export function soonTickets(decimals: number): TicketModel[] {
  const unit = 10n ** BigInt(decimals);
  return DEFAULT_ARENAS.map((a) => ({
    key: `arena:${a.id}` as TicketKey,
    arenaId: a.id,
    entryFee: BigInt(a.entryTokens) * unit,
    humans: 0,
    bots: 0,
    loot: 0,
    open: false,
    soon: true,
  }));
}

/** A ledger amount from the wire in base units (0 when it is not a safe whole number). */
export function ledgerToBase(ledger: number | undefined, decimals: number): bigint {
  try {
    return fromLedger(Math.max(0, Math.round(ledger ?? 0)), decimals);
  } catch {
    return 0n;
  }
}

/**
 * Practice plus one ticket per arena. Arena rooms are sharded into instances, so live counts
 * and loot are summed per `arenaId`. The on-chain arena wins for the price (it is what the player
 * signs); rooms fill in when the chain is not readable yet. Sorted by price. While the chain is on
 * but the game token is not set the default arenas are listed as "Opening soon".
 */
export function buildTickets(
  rooms: readonly RoomInfo[],
  arenas: readonly ArenaLike[],
  blocked: readonly number[] = [],
  token: TokenState = { enabled: true, tokenReady: true, decimals: 18 },
): TicketModel[] {
  const practice: TicketModel = { key: 'practice', arenaId: null, entryFee: 0n, humans: 0, bots: 0, loot: 0, open: true };
  for (const r of rooms) {
    if (r.mode !== 'practice') continue;
    practice.humans += r.players;
    practice.bots += r.bots;
  }
  if (token.enabled && !token.tokenReady) return [practice, ...soonTickets(token.decimals)];
  const byId = new Map<number, TicketModel>();
  for (const a of arenas) {
    if (a.exists === false) continue;
    byId.set(a.id, { key: `arena:${a.id}`, arenaId: a.id, entryFee: a.entryFee, humans: 0, bots: 0, loot: 0, open: a.enabled });
  }
  const chainKnown = byId.size > 0;
  for (const r of rooms) {
    if (r.mode !== 'arena' || r.arenaId === undefined) continue;
    let t = byId.get(r.arenaId);
    if (!t) {
      // only list arenas the chain does not know about when the chain is not readable
      if (chainKnown) continue;
      t = {
        key: `arena:${r.arenaId}`,
        arenaId: r.arenaId,
        entryFee: ledgerToBase(r.entryFee, token.decimals),
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
  /** Game-token balance, base units (`null` = unknown). */
  balance: bigint | null;
  tickets: readonly TicketModel[];
  lastArena: number | null;
  /** Arenas where the wallet already has an open ticket (playing them costs nothing). */
  openSessions?: readonly number[];
}

/**
 * Where "Quick play" goes: no wallet or no tokens → practice; otherwise an open ticket, then
 * the last arena if still affordable, else the cheapest affordable arena, else practice.
 */
export function quickPlayTarget(input: QuickPlayInput): TicketKey {
  if (!input.walletConnected || input.balance === null || input.balance <= 0n) {
    const resumable = input.walletConnected ? input.tickets.find((t) => t.arenaId !== null && input.openSessions?.includes(t.arenaId)) : undefined;
    return resumable ? resumable.key : 'practice';
  }
  const arenas = input.tickets.filter((t) => t.arenaId !== null && t.open && !t.blocked && !t.soon);
  const open = arenas.find((t) => input.openSessions?.includes(t.arenaId!));
  if (open) return open.key;
  const balance = input.balance;
  const affordable = (t: TicketModel) => t.entryFee > 0n && t.entryFee <= balance;
  const last = arenas.find((t) => t.arenaId === input.lastArena);
  if (last && affordable(last)) return last.key;
  const cheapest = arenas.filter(affordable).sort((a, b) => (a.entryFee < b.entryFee ? -1 : a.entryFee > b.entryFee ? 1 : 0))[0];
  return cheapest ? cheapest.key : 'practice';
}

/* ── what a ticket button does ──────────────────────────────────────────── */

/** `GET /api/pending?wallet=0x…`: payouts the server is still settling. */
export interface PendingPayout {
  /** Journal key `<arenaId>:<player lowercase>:<sessionId>`. */
  key: string;
  arenaId: number | null;
  /** Ledger units the server is still settling. */
  payout: number;
}

export interface OpenSession {
  /** Journal key (see `sessionKey`). */
  key: string;
  /** On-chain session id (> 0). */
  id: bigint;
  /** Unix seconds. */
  openedAt: number;
  /** Base units paid at join. */
  entryFee?: bigint;
  /** Settled with the player transfer failing: `owed` waits for the player to collect it (`refund`). */
  finalized?: boolean;
  /** Base units to collect (finalized sessions). */
  owed?: bigint;
}

export type TicketGate =
  | { kind: 'practice' }
  /** The game token is not set on chain yet: the arena opens soon (nothing is sold; practice plays). */
  | { kind: 'soon' }
  | { kind: 'offline' }
  /** The server keeps this arena closed (its vault cannot cover the journal); nothing is sold. */
  | { kind: 'maintenance' }
  | { kind: 'connect' }
  /** The last game here is settled and its payout waits for the player: "Collect payout" (base units). */
  | { kind: 'collect'; owed: bigint }
  /** The previous game in this arena is being paid out (ledger units; no new ticket yet). */
  | { kind: 'settling'; payout: number }
  /** The open ticket is older than 24 h: the player may refund it themselves. */
  | { kind: 'refund' }
  | { kind: 'verify' }
  /** An open ticket, no transaction. */
  | { kind: 'resume' }
  /** Base units missing. */
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
  nowS: number;
}

export function ticketGate(g: GateInput): TicketGate {
  const t = g.ticket;
  if (t.arenaId === null) return { kind: 'practice' };
  if (t.soon) return { kind: 'soon' };
  // a payout waiting to be collected comes first, even while arenas are offline or blocked
  if (g.walletConnected && g.session?.finalized) return { kind: 'collect', owed: g.session.owed ?? 0n };
  if (!g.arenasEnabled) return { kind: 'offline' };
  if (!t.blocked && !t.open) return { kind: 'offline' };
  if (!g.walletConnected) return t.blocked ? { kind: 'maintenance' } : { kind: 'connect' };
  // a payout the server is still settling comes next, even in a blocked arena
  const owed = g.pending.filter((p) => (g.session && p.key === g.session.key) || p.arenaId === t.arenaId);
  if (owed.length > 0) return { kind: 'settling', payout: owed.reduce((s, p) => s + p.payout, 0) };
  // an open ticket keeps its paths (resume, or the 24 h self-refund) even in a blocked arena
  if (g.session) {
    if (g.nowS - g.session.openedAt >= REFUND_DELAY_SECS) return { kind: 'refund' };
    return g.verified ? { kind: 'resume' } : { kind: 'verify' };
  }
  // the server keeps this arena closed; nothing new is sold
  if (t.blocked) return { kind: 'maintenance' };
  if (!g.verified) return { kind: 'verify' };
  if (g.balance !== null && g.balance < t.entryFee) return { kind: 'insufficient', missing: t.entryFee - g.balance };
  return { kind: 'buy' };
}

/* ── fee policy ─────────────────────────────────────────────────────────── */

export { DEFAULT_FEE_BPS };

/**
 * The fee on profit for a new ticket, basis points: the server's `ChainStatus.feeBps` (the
 * arena's `config().feeBps` it reads), else the loaded config, else the contract default (5 %).
 * The ticket sheet re-reads the config before signing and refuses a change.
 */
export function feeBps(server: number | null | undefined, config: { feeBps: number } | null = null): number {
  return server ?? config?.feeBps ?? DEFAULT_FEE_BPS;
}

/** `500` → `5`, `250` → `2.5`. */
export function bpsPercent(bps: number): string {
  return (bps / 100).toFixed(2).replace(/\.?0+$/, '');
}

/** Arenas whose last game is settled with a payout waiting to be collected (base units). */
export function sessionsToCollect(sessions: Readonly<Record<number, OpenSession | null>>): { arenaId: number; owed: bigint }[] {
  return Object.entries(sessions)
    .filter(([, s]) => s?.finalized)
    .map(([id, s]) => ({ arenaId: Number(id), owed: s!.owed ?? 0n }));
}
