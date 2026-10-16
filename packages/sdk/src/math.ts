import type BN from 'bn.js';
import { BPS, XP_LEVEL_DIVISOR } from './constants';

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
export function mulBps(amount: IntLike, bps: number): bigint {
  return (toBigInt(amount) * BigInt(bps)) / BigInt(BPS);
}

const U64_MAX = (1n << 64n) - 1n;

/** How a stake payout is split (base units of the game token). */
export interface PayoutSplit {
  /** Fee on profit, paid in full to the fee wallet's token account. */
  fee: bigint;
  /** What the player receives: `payout - fee`. */
  player: bigint;
}

/**
 * Mirrors `settle_session` exactly: `profit = max(0, payout − entryFee)`,
 * `fee = floor(profit × feeBps / 10 000)`, `player = payout − fee`.
 *
 * For a settlement pass the session's own `feeBps` (fixed at join), not the config's current
 * rate; for a preview of a ticket not bought yet pass `Config.feeBps`. Throws `RangeError`
 * where the program could not run (a value outside u64, `feeBps` not a u16).
 */
export function splitPayout(payout: IntLike, entryFee: IntLike, feeBps: number): PayoutSplit {
  const p = toBigInt(payout);
  const e = toBigInt(entryFee);
  if (p < 0n || e < 0n || p > U64_MAX || e > U64_MAX) throw new RangeError('payout and entry fee must be u64 values');
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 0xffff) throw new RangeError(`feeBps must be a u16, got ${feeBps}`);
  const profit = p > e ? p - e : 0n;
  const fee = mulBps(profit, feeBps);
  return { fee, player: p - fee };
}
