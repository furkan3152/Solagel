import type { CSSProperties } from 'react';

export interface StampSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  /** Read to screen readers (role="status"); omit when a visible label sits next to it. */
  label?: string;
  className?: string;
}

const SIZE = { sm: 18, md: 28, lg: 44 } as const;

/**
 * Waiting, Paper Ticket style: a date stamper. Its band ticks round a notch at
 * a time and the stamp presses down on every turn, leaving a ring of ink.
 * Reduced motion: a still stamp.
 */
export function StampSpinner({ size = 'md', label, className }: StampSpinnerProps) {
  const px = SIZE[size];
  return (
    <span
      className={`kb-spinner kb-spinner--${size}${className ? ` ${className}` : ''}`}
      style={{ width: px, height: px }}
      {...(label ? { role: 'status', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <svg viewBox="0 0 40 40" width={px} height={px} aria-hidden="true">
        {/* the ink the last press left (pink pass, off register) */}
        <circle className="kb-spinner__ink" cx="21.5" cy="21.5" r="15" />
        <g className="kb-spinner__stamp">
          <circle className="kb-spinner__rim" cx="20" cy="20" r="15" />
          <circle className="kb-spinner__band" cx="20" cy="20" r="10.5" pathLength="24" />
          <circle className="kb-spinner__hub" cx="20" cy="20" r="3.2" />
        </g>
      </svg>
    </span>
  );
}

export interface SkeletonProps {
  /** Number of printed rows. */
  rows?: number;
  /** Read to screen readers while the rows stand in for content. */
  label?: string;
  className?: string;
}

/** Row widths (%) so a stand-in table reads like set type, not a bar chart. */
const WIDTHS = [86, 64, 92, 71, 58, 80, 67, 88];

/**
 * Rows printed in halftone while their content loads: a rank chip, a name and
 * a figure per row, with a slow ink pass sweeping down the page (none under
 * reduced motion).
 */
export function Skeleton({ rows = 5, label, className }: SkeletonProps) {
  return (
    <div className={`kb-skeleton${className ? ` ${className}` : ''}`} {...(label ? { role: 'status', 'aria-label': label } : { 'aria-hidden': true })}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="kb-skeleton__row" style={{ '--w': `${WIDTHS[i % WIDTHS.length]}%`, '--i': i } as CSSProperties}>
          <span className="kb-skeleton__chip halftone" />
          <span className="kb-skeleton__bar halftone" />
          <span className="kb-skeleton__fig halftone" />
        </div>
      ))}
    </div>
  );
}
