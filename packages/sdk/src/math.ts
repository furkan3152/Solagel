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
export function mulBps(amount: IntLike, bps: number): bigint {
  return (toBigInt(amount) * BigInt(bps)) / BigInt(BPS);
}

const U64_MAX = (1n << 64n) - 1n;

/** How a stake payout is split (base units of the game token). */
export interface PayoutSplit {
  /** Total fee, charged on profit only: `treasury + season + burn`. */
  fee: bigint;
  /** Fee share sent to the treasury vault. */
  treasury: bigint;
  /** Fee share sent to the season vault (gets the rounding remainder). */
  season: bigint;
  /** Fee share burned. */
  burn: bigint;
  /** What the player receives: `payout - fee`. */
  player: bigint;
}

/** The config fields `splitPayout` needs (a `ConfigView` fits). */
export interface SplitConfig {
  feeBps: number;
  passFeeBps: number;
  treasuryBps: number;
  burnBps: number;
}

/**
 * Mirrors `logic::split_payout` exactly: `fee = (payout - entryFee)⁺ × bps / 10 000` where
 * `bps` is `passFeeBps` for a Pass session and `feeBps` otherwise; treasury and burn are
 * rounded down and the season gets the remainder. Throws `RangeError` where the program
 * fails with `MathOverflow` (shares above 100 %, or a value outside u64).
 */
export function splitPayout(payout: IntLike, entryFee: IntLike, hasPass: boolean, cfg: SplitConfig): PayoutSplit {
  return splitWithFeeBps(payout, entryFee, hasPass ? cfg.passFeeBps : cfg.feeBps, cfg);
}

/**
 * What `settle_session` actually charges an open session: the fee in `session.feeBps` was
 * fixed at join (a `SessionView` fits), only the treasury/burn shares come from the config.
 * Use this for settlements; `splitPayout` is for previews of a ticket not bought yet.
 */
export function splitSessionPayout(
  payout: IntLike,
  session: { entryFee: IntLike; feeBps: number },
  cfg: Pick<SplitConfig, 'treasuryBps' | 'burnBps'>,
): PayoutSplit {
  return splitWithFeeBps(payout, session.entryFee, session.feeBps, cfg);
}

function splitWithFeeBps(payout: IntLike, entryFee: IntLike, feeBps: number, cfg: Pick<SplitConfig, 'treasuryBps' | 'burnBps'>): PayoutSplit {
  const p = toBigInt(payout);
  const e = toBigInt(entryFee);
  if (p < 0n || e < 0n || p > U64_MAX || e > U64_MAX) throw new RangeError('payout and entry fee must be u64 values');
  const profit = p > e ? p - e : 0n;
  const fee = mulBps(profit, feeBps);
  const treasury = mulBps(fee, cfg.treasuryBps);
  const burn = mulBps(fee, cfg.burnBps);
  const season = fee - treasury - burn;
  if (season < 0n) throw new RangeError('fee split above 100 % (MathOverflow)');
  return { fee, treasury, season, burn, player: p - fee };
}

/** Prize of leaderboard `rank` (0-based) for a frozen prize pool; 0 outside the prize ranks. */
export function prizeAmount(prizePool: IntLike, rank: number): bigint {
  const share = PRIZE_SHARES_BPS[rank];
  return share === undefined ? 0n : mulBps(prizePool, share);
}
