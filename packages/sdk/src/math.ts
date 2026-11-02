import { BPS, MAX_UINT128 } from './constants';

/** Anything that holds an integer: a JS number or a bigint. */
export type IntLike = number | bigint;

/** Converts a bigint/number to a bigint (numbers must be integers). */
export function toBigInt(value: IntLike): bigint {
  if (typeof value === 'bigint') return value;
  if (!Number.isInteger(value)) throw new RangeError(`expected an integer, got ${value}`);
  return BigInt(value);
}

/** `amount * bps / 10_000`, rounded down (exact). */
export function mulBps(amount: IntLike, bps: number): bigint {
  return (toBigInt(amount) * BigInt(bps)) / BigInt(BPS);
}

/**
 * The arena contract's fee rule. `2` (the bundled ElymumArena): the fee is `feeBps` of the ENTRY FEE of every
 * played ticket, whatever the result; the ticket plays `entryFee − fee` and a payout is paid in full. `1`
 * (legacy, still live on the testnet until it is redeployed): the fee is `feeBps` of the profit at `settle`.
 */
export type ArenaFeeVersion = 1 | 2;

/** How a settled ticket's money is split (base units of the game token). */
export interface PayoutSplit {
  /** The fee, paid in full to the fee wallet (v2: the entry fee's cut; v1: the cut of the profit). */
  fee: bigint;
  /** What the player receives (v2: the whole payout; v1: `payout - fee`). */
  player: bigint;
}

function checkU128(name: string, v: bigint): void {
  if (v < 0n || v > MAX_UINT128) throw new RangeError(`${name} must be a uint128, got ${v}`);
}

function checkFeeBps(feeBps: number): void {
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 0xffff) throw new RangeError(`feeBps must be a uint16, got ${feeBps}`);
}

/**
 * `ElymumArena.computeFee` (v2) exactly: the fee of a ticket, `floor(entryFee × feeBps / 10 000)`.
 * Throws `RangeError` where the contract could not run (a value outside uint128, `feeBps` not a uint16).
 */
export function computeEntryFee(entryFee: IntLike, feeBps: number): bigint {
  const e = toBigInt(entryFee);
  checkU128('entryFee', e);
  checkFeeBps(feeBps);
  return (e * BigInt(feeBps)) / BigInt(BPS);
}

/**
 * What a ticket plays with (base units): `entryFee − computeEntryFee(entryFee, feeBps)` on a v2 arena, the
 * whole entry fee on a v1 arena (which took its fee from the profit instead).
 */
export function ticketValue(entryFee: IntLike, feeBps: number, version: ArenaFeeVersion = 2): bigint {
  const e = toBigInt(entryFee);
  return version === 1 ? e : e - computeEntryFee(e, feeBps);
}

/**
 * Legacy v1 arena (`computeFee(payout, entryFee, feeBps)` there): `floor((payout − entryFee)⁺ × feeBps / 10 000)`.
 * Throws `RangeError` where the contract could not run.
 */
export function computeProfitFee(payout: IntLike, entryFee: IntLike, feeBps: number): bigint {
  const p = toBigInt(payout);
  const e = toBigInt(entryFee);
  checkU128('payout', p);
  checkU128('entryFee', e);
  checkFeeBps(feeBps);
  if (p <= e) return 0n;
  return ((p - e) * BigInt(feeBps)) / BigInt(BPS);
}

/**
 * Mirrors `settle` exactly. v2 (default): `fee = computeEntryFee(entryFee, feeBps)` (reserved at join),
 * `player = payout`. v1: `fee = computeProfitFee(payout, entryFee, feeBps)`, `player = payout − fee`.
 *
 * For a settlement pass the session's own `feeBps` (fixed at join), not the config's current
 * rate; for a preview of a ticket not bought yet pass the config's `feeBps`.
 */
export function splitPayout(payout: IntLike, entryFee: IntLike, feeBps: number, version: ArenaFeeVersion = 2): PayoutSplit {
  const p = toBigInt(payout);
  checkU128('payout', p);
  if (version === 1) {
    const fee = computeProfitFee(p, entryFee, feeBps);
    return { fee, player: p - fee };
  }
  return { fee: computeEntryFee(entryFee, feeBps), player: p };
}

/* -------------------------------------------------------------------- */
/* Ledger units                                                          */
/* -------------------------------------------------------------------- */

/**
 * Ledger units.
 *
 * The game server's ledger and the wire protocol carry token amounts as JS numbers, but an
 * 18-decimal token makes base units exceed 2^53 (1,000 tokens = 1e21 base units). So the server
 * keeps its ledger in **ledger units**: the token amount with at most 6 decimals. One ledger unit
 * is `ledgerUnitScale(decimals)` base units (`10^(decimals − 6)`, or 1 for a token with ≤ 6
 * decimals). Amounts are converted only at the chain boundary: `toLedger` when reading the chain
 * (entry fees, vaults, owed), `fromLedger` when writing it (settle payouts, sweepLoot amounts).
 * 2^53 ledger units are ~9 billion tokens, far above any arena's volume.
 */
export const LEDGER_MAX_DECIMALS = 6;

/** Base units per ledger unit: `10n ** BigInt(max(0, decimals − 6))`. */
export function ledgerUnitScale(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new RangeError(`token decimals must be an integer in 0..255, got ${decimals}`);
  return 10n ** BigInt(Math.max(0, decimals - LEDGER_MAX_DECIMALS));
}

/** Decimals of a ledger amount for display (`formatToken(ledger, ledgerDecimals(decimals))`). */
export function ledgerDecimals(decimals: number): number {
  ledgerUnitScale(decimals);
  return Math.min(decimals, LEDGER_MAX_DECIMALS);
}

/** How `toLedger` treats base units below one ledger unit. */
export type LedgerRounding = 'exact' | 'floor' | 'ceil';

/**
 * Base units (bigint, from the chain) → ledger units (a safe JS integer).
 * `round` (default `'exact'`) throws `RangeError` when `base` is not a whole number of ledger
 * units; `'floor'` / `'ceil'` round instead (use `'floor'` for balances you may spend: it never
 * overstates them). Throws `RangeError` for negative values or results above 2^53 − 1.
 */
export function toLedger(base: bigint, decimals: number, round: LedgerRounding = 'exact'): number {
  if (typeof base !== 'bigint') throw new TypeError('toLedger expects a bigint amount of base units');
  if (base < 0n) throw new RangeError(`token amount ${base} is negative`);
  const scale = ledgerUnitScale(decimals);
  let units = base / scale;
  const rest = base % scale;
  if (rest !== 0n) {
    if (round === 'exact') throw new RangeError(`token amount ${base} is not a whole number of ledger units (1 unit = ${scale} base units)`);
    if (round === 'ceil') units += 1n;
  }
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`token amount ${base} exceeds the ledger's safe range`);
  return Number(units);
}

/** Ledger units (a non-negative safe JS integer) → base units for the chain. */
export function fromLedger(units: number | bigint, decimals: number): bigint {
  const scale = ledgerUnitScale(decimals);
  if (typeof units === 'number') {
    if (!Number.isSafeInteger(units)) throw new RangeError(`ledger amount ${units} is not a safe integer`);
  }
  const u = toBigInt(units);
  if (u < 0n) throw new RangeError(`ledger amount ${units} is negative`);
  return u * scale;
}
