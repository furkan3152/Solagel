import type BN from 'bn.js';
import { BPS, PRIZE_SHARES_BPS, XP_LEVEL_DIVISOR } from './constants';

/** Anything that holds an integer: a JS number, a bigint or an Anchor `BN`. */
export type IntLike = number | bigint | BN;

/** Converts a `BN`/bigint/number to a JS number (`Number(bn.toString())`; exact below 2^53). */
export function toNumber(value: IntLike): number {
  if (typeof value === 'number') return value;
  return Number(value.toString());
}

/** Converts a `BN`/bigint/number to a bigint (numbers must be integers). */
export function toBigInt(value: IntLike): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new RangeError(`expected an integer, got ${value}`);
    return BigInt(value);
  }
  return BigInt(value.toString());
}

/** Integer square root (floor) of a non-negative bigint. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError('isqrt of a negative number');
  if (n < 2n) return n;
  // Newton's method starting above the root.
  let x = BigInt(Math.floor(Math.sqrt(Number(n)))) + 1n;
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) break;
    x = y;
  }
  while (x * x > n) x--;
  while ((x + 1n) * (x + 1n) <= n) x++;
  return x;
}

/** Player level, integer-exact like the program: `1 + floor(sqrt(xp / 50))`. */
export function levelFromXp(xp: IntLike): number {
  const v = toBigInt(xp);
  if (v <= 0n) return 1;
  return Number(isqrt(v / BigInt(XP_LEVEL_DIVISOR)) + 1n);
}

/** `amount * bps / 10_000`, rounded down (exact). */
export function mulBps(amount: IntLike, bps: number): number {
  return Number((toBigInt(amount) * BigInt(bps)) / BigInt(BPS));
}

export interface SettlementSplit {
  /** Fee charged on profit only. */
  fee: number;
  /** Part of the fee that goes to the season prize pool. */
  seasonCut: number;
  /** Part of the fee that goes to the treasury. */
  treasuryCut: number;
  /** What the player receives: `payout - fee`. */
  playerAmount: number;
}

/** Mirrors `logic::compute_settlement`: how a stake payout is split. */
export function computeSettlement(payout: IntLike, buyIn: IntLike, feeBps: number, seasonShareBps: number): SettlementSplit {
  const p = toBigInt(payout);
  const b = toBigInt(buyIn);
  const profit = p > b ? p - b : 0n;
  const fee = (profit * BigInt(feeBps)) / BigInt(BPS);
  const seasonCut = (fee * BigInt(seasonShareBps)) / BigInt(BPS);
  return {
    fee: Number(fee),
    seasonCut: Number(seasonCut),
    treasuryCut: Number(fee - seasonCut),
    playerAmount: Number(p - fee),
  };
}

/** Prize of leaderboard `rank` (0-based) for a frozen prize pool; 0 outside the prize ranks. */
export function prizeAmount(prizePool: IntLike, rank: number): number {
  const share = PRIZE_SHARES_BPS[rank];
  return share === undefined ? 0 : mulBps(prizePool, share);
}
