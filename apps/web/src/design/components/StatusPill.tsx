import type { HTMLAttributes, ReactNode } from 'react';

export type StatusTone = 'live' | 'ok' | 'warn' | 'danger' | 'idle' | 'mainnet' | 'testnet';

export interface StatusPillProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /**
   * `live` cyan pulsing dot, `ok` green, `warn` sun, `danger` red, `idle` stone;
   * `mainnet` solid red pill, `testnet` solid sun pill (the admin network badge).
   */
  tone?: StatusTone;
  children: ReactNode;
  /** The dot pulses (default: only `live`). */
  pulse?: boolean;
  size?: 'sm' | 'md';
}

/** A pill-shaped status sticker: ink edge, a coloured dot (or a solid fill for networks), Geist Mono caps. */
export function StatusPill({ tone = 'idle', children, pulse, size = 'md', className, ...rest }: StatusPillProps) {
  const beats = pulse ?? tone === 'live';
  return (
    <span {...rest} className={`kb-pill kb-pill--${tone} kb-pill--${size}${beats ? ' is-pulse' : ''}${className ? ` ${className}` : ''}`}>
      <span className="kb-pill__dot" aria-hidden="true" />
      <span className="kb-pill__text">{children}</span>
    </span>
  );
}
