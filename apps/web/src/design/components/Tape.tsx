import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

export interface TapeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'style'> {
  /** Degrees, default -4. */
  rotate?: number;
  tone?: 'mustard' | 'pink' | 'teal' | 'paper';
  /** Width in px (default 88). */
  width?: number;
  /** Optional mono text written on the tape. */
  children?: ReactNode;
  className?: string;
  /** Position it: tape is absolutely positioned by default. */
  style?: CSSProperties;
  /** Render in flow instead of absolutely positioned. */
  inline?: boolean;
}

/** A strip of translucent masking tape with torn ends. Decorative. */
export function Tape({ rotate = -4, tone = 'mustard', width = 88, children, className, style, inline = false, ...rest }: TapeProps) {
  return (
    <span
      {...rest}
      className={`kb-tape kb-tape--${tone}${inline ? ' is-inline' : ''}${className ? ` ${className}` : ''}`}
      style={{ ...style, width, transform: `rotate(${rotate}deg)` }}
      aria-hidden={children ? undefined : true}
    >
      {children != null && <span className="kb-tape__text mono">{children}</span>}
    </span>
  );
}
