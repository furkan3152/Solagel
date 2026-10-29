/**
 * Token amounts.
 *
 * Amounts travel as raw base units of the ERC-20 game token (its `decimals()`,
 * read from the contract). The SDK keeps them as `bigint`; the server and web
 * use `number` only after `toSafeAmount`, which refuses anything above
 * `Number.MAX_SAFE_INTEGER` (note: 1,000 tokens of an 18-decimal token is 1e21
 * base units, which does not fit). HYPE amounts (wei) always stay `bigint`.
 * All formatting and parsing here is exact integer arithmetic, so there is no
 * floating point drift and no dependence on the runtime's ICU data.
 */

/** Display symbol used when the server config does not set one. */
export const TOKEN_SYMBOL_DEFAULT = '$ELYMUM';

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Raw base units as a JS number, for the game server and web client.
 * Throws `RangeError` for anything that is not a whole amount in
 * `0..Number.MAX_SAFE_INTEGER`, so precision is never lost silently.
 */
export function toSafeAmount(raw: bigint | number): number {
  if (typeof raw === 'bigint') {
    if (raw < 0n) throw new RangeError(`token amount ${raw} is negative`);
    if (raw > MAX_SAFE) throw new RangeError(`token amount ${raw} exceeds Number.MAX_SAFE_INTEGER`);
    return Number(raw);
  }
  if (raw < 0) throw new RangeError(`token amount ${raw} is negative`);
  if (raw > Number.MAX_SAFE_INTEGER) throw new RangeError(`token amount ${raw} exceeds Number.MAX_SAFE_INTEGER`);
  if (!Number.isInteger(raw)) throw new RangeError(`token amount ${raw} is not a whole number of base units`);
  return raw === 0 ? 0 : raw; // normalises -0
}

/** en-US separators: `1,234.5`. */
const GROUP = ',';
const DECIMAL = '.';

/**
 * Compact tiers, ascending. `exp` is the power of ten of whole tokens the suffix
 * stands for. R15: K / M / B (thousand / million / billion), the crypto convention.
 */
const TIERS = [
  { exp: 0, suffix: '' },
  { exp: 3, suffix: 'K' },
  { exp: 6, suffix: 'M' },
  { exp: 9, suffix: 'B' },
] as const;

const PLAIN = [{ exp: 0, suffix: '' }] as const;

function checkDecimals(decimals: number): void {
  // ERC-20 decimals are a uint8
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new RangeError(`token decimals must be an integer in 0..255, got ${decimals}`);
  }
}

/** `abs` (non-negative, scaled by 10^decimals) rounded half up to at most `maxFrac` decimals. */
function roundFixed(abs: bigint, decimals: number, maxFrac: number): { whole: bigint; frac: string } {
  const frac = Math.min(maxFrac, decimals);
  const drop = 10n ** BigInt(decimals - frac);
  const units = (abs + drop / 2n) / drop; // in 10^-frac units
  const base = 10n ** BigInt(frac);
  const fracDigits = frac === 0 ? '' : (units % base).toString().padStart(frac, '0').replace(/0+$/, '');
  return { whole: units / base, frac: fracDigits };
}

/**
 * Human-readable token amount in en-US style.
 *
 * - Thousands are grouped with `,` and decimals use `.`.
 * - At most `maxFrac` decimals (default 2, never more than the token has),
 *   rounded half up, trailing zeros stripped: `1,234.5`.
 * - `compact` shortens amounts from one thousand tokens up with K / M / B:
 *   `12.4K`, `3.2M`. Rounding that reaches 1000 moves up a tier (999.999K prints as 1M).
 * - Negative amounts (value deltas) get a leading `-`. A `number` input is
 *   rounded to whole base units; NaN and infinities throw `RangeError`.
 */
export function formatToken(
  raw: number | bigint,
  decimals: number,
  opts: { maxFrac?: number; compact?: boolean } = {},
): string {
  checkDecimals(decimals);
  const maxFrac = opts.maxFrac ?? 2;
  if (!Number.isInteger(maxFrac) || maxFrac < 0) throw new RangeError(`maxFrac must be a non-negative integer, got ${maxFrac}`);

  let value: bigint;
  if (typeof raw === 'bigint') value = raw;
  else if (Number.isFinite(raw)) value = BigInt(Math.round(raw));
  else throw new RangeError(`token amount must be finite, got ${raw}`);
  const abs = value < 0n ? -value : value;

  const tiers = opts.compact ? TIERS : PLAIN;
  let tier = 0;
  while (tier + 1 < tiers.length && abs >= 10n ** BigInt(decimals + tiers[tier + 1].exp)) tier++;
  let r = roundFixed(abs, decimals + tiers[tier].exp, maxFrac);
  if (r.whole >= 1000n && tier + 1 < tiers.length) {
    tier++;
    r = roundFixed(abs, decimals + tiers[tier].exp, maxFrac);
  }

  const whole = r.whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, GROUP);
  // no sign when the amount rounds to zero (`formatToken(-1, 6)` is "0", not "-0")
  const negative = value < 0n && (r.whole > 0n || r.frac !== '');
  return `${negative ? '-' : ''}${whole}${r.frac ? DECIMAL + r.frac : ''}${tiers[tier].suffix}`;
}

/** Digits of a whole part that is plain or has well-formed thousands groups (`1,234`). */
function wholeDigits(text: string): string | null {
  if (!text.includes(GROUP)) return /^\d*$/.test(text) ? text : null;
  const groups = text.split(GROUP);
  return /^\d{1,3}$/.test(groups[0]) && groups.slice(1).every((g) => /^\d{3}$/.test(g)) ? groups.join('') : null;
}

/**
 * Parses user-typed text such as `1,234.5` into raw base units. It refuses to
 * guess: `1,5` is a malformed thousands group (not one and a half), so it
 * throws `SyntaxError` instead of reading it as 15 tokens. Extra decimal places
 * beyond `decimals` throw `RangeError` unless they are all zeros. Signs, exponents, symbols and inner spaces are rejected.
 */
export function parseToken(text: string, decimals: number): bigint {
  checkDecimals(decimals);
  const parts = text.trim().split(DECIMAL);
  const whole = parts.length <= 2 ? wholeDigits(parts[0]) : null;
  const fracText = parts[1] ?? '';
  if (whole === null || !/^\d*$/.test(fracText) || (whole === '' && fracText === '')) {
    throw new SyntaxError(`invalid token amount ${JSON.stringify(text)}`);
  }
  if (/[1-9]/.test(fracText.slice(decimals))) {
    throw new RangeError(`token amount ${JSON.stringify(text)} has more than ${decimals} decimal places`);
  }
  return BigInt(whole + fracText.slice(0, decimals).padEnd(decimals, '0') || '0');
}

/** Decimals of HYPE, the gas token (wei). */
export const HYPE_DECIMALS = 18;

/** A HYPE amount in wei for display: `0.0312 HYPE` (at most `maxFrac` decimals, default 4). */
export function formatHype(wei: bigint | number, maxFrac = 4): string {
  return `${formatToken(wei, HYPE_DECIMALS, { maxFrac })} HYPE`;
}
