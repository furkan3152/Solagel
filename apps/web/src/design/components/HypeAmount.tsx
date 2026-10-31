import type { HTMLAttributes } from 'react';

export interface HypeAmountProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Amount in HYPE (a number or a decimal string). Ignored when `wei` is given. */
  value?: number | string;
  /** Amount in wei (18 decimals), exact. */
  wei?: bigint;
  /** Decimals shown (default 4). Rounds half up. */
  decimals?: number;
  /** USD value to show as "≈ $1.00" (omit or null to hide; the sun tag only shows with a value). */
  usd?: number | null;
  /** Unit after the number (default "HYPE"). */
  unit?: string;
  /** `sm` inline in text, `md` card figures (default), `lg` the price on the mint card. */
  size?: 'sm' | 'md' | 'lg';
  /** Put the USD tag under the amount instead of beside it. */
  stack?: boolean;
}

/** Format a wei amount with `decimals` places, half-up, grouping the integer part. Exact (bigint). */
export function formatWei(wei: bigint, decimals = 4): string {
  const neg = wei < 0n;
  let v = neg ? -wei : wei;
  const scale = 10n ** BigInt(18 - Math.min(decimals, 18));
  v = (v + scale / 2n) / scale; // round half up to `decimals`
  const s = v.toString().padStart(decimals + 1, '0');
  const int = s.slice(0, s.length - decimals);
  const frac = decimals > 0 ? s.slice(-decimals) : '';
  const grouped = BigInt(int).toLocaleString('en-US');
  return `${neg ? '−' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

export function formatHype(value: number | string, decimals = 4): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatUsd(usd: number): string {
  return usd.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * A HYPE amount: the figure in Geist Mono (teal, bold), the unit after it, and
 * the dollar value in a little sun tag ("≈ $1.00"). Screen readers hear
 * "0.0213 HYPE, about $1.00".
 */
export function HypeAmount({ value, wei, decimals = 4, usd, unit = 'HYPE', size = 'md', stack = false, className, ...rest }: HypeAmountProps) {
  const fig = wei !== undefined ? formatWei(wei, decimals) : value !== undefined ? formatHype(value, decimals) : '—';
  const hasUsd = usd != null && Number.isFinite(usd);
  return (
    <span {...rest} className={`kb-hype kb-hype--${size}${stack ? ' kb-hype--stack' : ''}${className ? ` ${className}` : ''}`}>
      <span className="kb-hype__amt">
        <b className="kb-hype__num">{fig}</b> <span className="kb-hype__unit">{unit}</span>
      </span>
      {hasUsd && (
        <span className="kb-hype__usd">
          <span aria-hidden="true">≈ </span>
          <span className="kb-sr">about </span>
          {formatUsd(usd)}
        </span>
      )}
    </span>
  );
}
