import { formatToken } from '@elymum/shared';

/**
 * Amounts in summaries (balances, receipts, HUD stickers, standings): never more than `maxFrac`
 * decimals, and compact (K / M / B / T) once the whole part would get long, so a whale balance
 * such as 999,999,999,999.123456 never pushes its column into the next one. The exact value
 * belongs in a `title` / tooltip or the confirm step (`formatToken` with the token's decimals).
 *
 * `compactFrom`: whole tokens from which the compact form is used (default one billion: up to
 * 999,999,999.99 reads in full).
 */
export function summaryAmount(raw: bigint | number, decimals: number, opts: { maxFrac?: number; compactFrom?: number } = {}): string {
  const maxFrac = opts.maxFrac ?? 2;
  const from = BigInt(Math.round(opts.compactFrom ?? 1e9));
  const v = typeof raw === 'bigint' ? raw : BigInt(Math.round(raw));
  const abs = v < 0n ? -v : v;
  const compact = abs >= from * 10n ** BigInt(decimals);
  return formatToken(v, decimals, { maxFrac, compact });
}

/** The exact amount (every decimal the token has, trailing zeros trimmed), for titles and tooltips. */
export function exactAmount(raw: bigint | number, decimals: number): string {
  return formatToken(raw, decimals, { maxFrac: decimals });
}
