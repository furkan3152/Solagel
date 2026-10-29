import { HYPE_DECIMALS, formatToken, parseToken } from '@elymum/shared';
import { getAddress, isAddress } from 'viem';

/**
 * Display helpers. Token amounts are bigint base units of the ERC-20 (its `decimals()`); HYPE
 * amounts are wei. All arithmetic is exact (no floating point).
 */

/** `1,234.5` (at most `maxFrac` decimals, default 6, never more than the token has). */
export function formatTokenAmount(raw: bigint | number, decimals: number, opts: { maxFrac?: number; compact?: boolean } = {}): string {
  return formatToken(raw, decimals, { maxFrac: opts.maxFrac ?? Math.min(decimals, 6), compact: opts.compact });
}

/** `1,234.5 $ELYMUM`. */
export function formatTokenWithSymbol(raw: bigint | number, decimals: number, symbol: string, opts: { maxFrac?: number; compact?: boolean } = {}): string {
  return `${formatTokenAmount(raw, decimals, opts)} ${symbol}`;
}

/** Whole tokens typed by a person (`1,000`, `0.5`) → base units. Throws `SyntaxError` / `RangeError`. */
export function parseTokenAmount(text: string, decimals: number): bigint {
  return parseToken(text.replace(/_/g, ''), decimals);
}

/** `0.0312 HYPE` (at most `maxFrac` decimals, default 6). */
export function formatHypeAmount(wei: bigint | number, maxFrac = 6): string {
  return `${formatToken(wei, HYPE_DECIMALS, { maxFrac })} HYPE`;
}

/** HYPE typed by a person (`0.03`) → wei. */
export function parseHypeAmount(text: string): bigint {
  return parseToken(text.trim().replace(/\s*HYPE$/i, '').replace(/_/g, ''), HYPE_DECIMALS);
}

/** Basis points as a percentage: `5.00 %`. */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)} %`;
}

/** US cents as dollars: `$1.00`. */
export function formatUsdCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

/** `0x1234…abcd` (keeps `0x` + `chars` hex digits at each end). Non-addresses are shortened the same way. */
export function shortAddress(address: string, chars = 4): string {
  const head = address.startsWith('0x') ? chars + 2 : chars;
  return address.length <= head + chars + 1 ? address : `${address.slice(0, head)}…${address.slice(-chars)}`;
}

/** A transaction hash shortened the same way (`0xabcdef…1234`). */
export function shortHash(hash: string, chars = 6): string {
  return shortAddress(hash, chars);
}

/** EIP-55 checksummed address, or null when `value` is not an address. Accepts any case. */
export function checksumAddress(value: string): `0x${string}` | null {
  const v = value.trim();
  return isAddress(v, { strict: false }) ? getAddress(v) : null;
}

/** Case-insensitive address equality (false for non-addresses). */
export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = checksumAddress(a);
  return x !== null && x === checksumAddress(b);
}

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export function isZeroAddress(a: string | null | undefined): boolean {
  return !a || /^0x0{40}$/i.test(a);
}
