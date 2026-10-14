/**
 * Token amounts.
 *
 * Amounts travel as raw base units (a pump.fun style token has 6 decimals and
 * a 1e9 supply, so even whole-supply amounts fit a JS number). The SDK keeps
 * them as `bigint`; the server and web use `number` only after `toSafeAmount`.
 * All formatting and parsing here is exact integer arithmetic, so there is no
 * floating point drift and no dependence on the runtime's ICU data.
 */

/** Display symbol used when the server config does not set one. */
export const TOKEN_SYMBOL_DEFAULT = '$SLANA';

type Lang = 'tr' | 'en';

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

const SEPARATORS = {
  tr: { group: '.', decimal: ',' },
  en: { group: ',', decimal: '.' },
} as const;

/** Compact tiers, ascending. `exp` is the power of ten of whole tokens the suffix stands for. */
const COMPACT = {
  // B = bin (thousand), Mn = milyon (million)
  tr: [
    { exp: 0, suffix: '' },
    { exp: 3, suffix: ' B' },
    { exp: 6, suffix: ' Mn' },
  ],
  en: [
    { exp: 0, suffix: '' },
    { exp: 3, suffix: 'K' },
    { exp: 6, suffix: 'M' },
  ],
} as const;

const PLAIN = [{ exp: 0, suffix: '' }] as const;

function checkDecimals(decimals: number): void {
  // SPL mint decimals are a u8
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
 * Human-readable token amount.
 *
 * - tr groups thousands with `.` and uses `,` for decimals; en is the reverse.
 * - At most `maxFrac` decimals (default 2, never more than the token has),
 *   rounded half up, trailing zeros stripped: `1.234,5`, `1,234.5`.
 * - `compact` shortens amounts from one thousand tokens up: `12.4K` / `3.2M`
 *   in en, `12,4 B` (bin) / `3,2 Mn` (milyon) in tr. Rounding that reaches
 *   1000 moves up a tier (999.999K prints as 1M).
 * - Negative amounts (value deltas) get a leading `-`. A `number` input is
 *   rounded to whole base units; NaN and infinities throw `RangeError`.
 */
export function formatToken(
  raw: number | bigint,
  decimals: number,
  lang: Lang,
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

  const tiers = opts.compact ? COMPACT[lang] : PLAIN;
  let tier = 0;
  while (tier + 1 < tiers.length && abs >= 10n ** BigInt(decimals + tiers[tier + 1].exp)) tier++;
  let r = roundFixed(abs, decimals + tiers[tier].exp, maxFrac);
  if (r.whole >= 1000n && tier + 1 < tiers.length) {
    tier++;
    r = roundFixed(abs, decimals + tiers[tier].exp, maxFrac);
  }

  const sep = SEPARATORS[lang];
  const whole = r.whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, sep.group);
  return `${value < 0n ? '-' : ''}${whole}${r.frac ? sep.decimal + r.frac : ''}${tiers[tier].suffix}`;
}

/** Digits of a whole part that is plain or has well-formed thousands groups (`1.234` in tr, `1,234` in en). */
function wholeDigits(text: string, group: string): string | null {
  if (!text.includes(group)) return /^\d*$/.test(text) ? text : null;
  const groups = text.split(group);
  return /^\d{1,3}$/.test(groups[0]) && groups.slice(1).every((g) => /^\d{3}$/.test(g)) ? groups.join('') : null;
}

/**
 * Parses user-typed text such as `1.234,5` (tr) or `1,234.5` (en) into raw
 * base units. It refuses to guess: in tr `1.5` is a malformed thousands group
 * (not one and a half), so it throws `SyntaxError` instead of reading it as
 * 15 tokens. Extra decimal places beyond `decimals` throw `RangeError` unless
 * they are all zeros. Signs, exponents, symbols and inner spaces are rejected.
 */
export function parseToken(text: string, decimals: number, lang: Lang): bigint {
  checkDecimals(decimals);
  const { group, decimal } = SEPARATORS[lang];
  const parts = text.trim().split(decimal);
  const whole = parts.length <= 2 ? wholeDigits(parts[0], group) : null;
  const fracText = parts[1] ?? '';
  if (whole === null || !/^\d*$/.test(fracText) || (whole === '' && fracText === '')) {
    throw new SyntaxError(`invalid ${lang} token amount ${JSON.stringify(text)}`);
  }
  if (/[1-9]/.test(fracText.slice(decimals))) {
    throw new RangeError(`token amount ${JSON.stringify(text)} has more than ${decimals} decimal places`);
  }
  return BigInt(whole + fracText.slice(0, decimals).padEnd(decimals, '0') || '0');
}
