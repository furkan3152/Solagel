import { motion } from 'motion/react';
import type { HTMLAttributes, ReactNode } from 'react';
import { springs, useReducedMotion } from '../motion';

export interface ArcGaugeProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  value: number;
  max: number;
  /** Fill paint: `up` (default), `sun`, `cyan`. */
  tone?: 'up' | 'sun' | 'cyan';
  /** Gauge width in px (default 150). */
  size?: number;
  /** Show the readout beside the arc ("2,614 / 5,000"). Default true. */
  readout?: boolean;
  /** Line under the readout, e.g. "52% minted. The rest are still deciding." */
  caption?: ReactNode;
  /** Accessible name of the meter (default "Minted"). */
  label?: string;
  /** Number formatter (default en-US grouping). */
  format?: (n: number) => string;
}

const ARC = 'M20 100 A80 80 0 0 1 180 100';
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/**
 * The needle gauge from the mint card: a fat ink arc with a white track, the
 * filled share in one paint, tick dots, and an ink needle that swings to the
 * value on a spring. role="meter".
 */
export function ArcGauge({ value, max, tone = 'up', size = 150, readout = true, caption, label = 'Minted', format = fmt, className, ...rest }: ArcGaugeProps) {
  const reduced = useReducedMotion();
  const share = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const pct = share * 100;
  const angle = -90 + share * 180; // needle: -90 (left) .. 90 (right)
  return (
    <div
      {...rest}
      className={`kb-gauge kb-gauge--${tone}${className ? ` ${className}` : ''}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${format(value)} of ${format(max)}`}
    >
      <svg className="kb-gauge__art" viewBox="0 0 200 116" width={size} height={(size * 116) / 200} aria-hidden="true" focusable="false">
        <path d={ARC} fill="none" stroke="var(--outline)" strokeWidth={28} strokeLinecap="round" />
        <path d={ARC} fill="none" className="kb-gauge__track" strokeWidth={21} strokeLinecap="round" />
        <motion.path
          d={ARC}
          fill="none"
          className="kb-gauge__fill"
          strokeWidth={21}
          strokeLinecap="round"
          pathLength={100}
          initial={false}
          animate={{ strokeDasharray: `${pct} 100` }}
          transition={reduced ? { duration: 0 } : springs.dial}
        />
        <path d={ARC} fill="none" stroke="var(--outline)" strokeWidth={2.5} strokeDasharray="1.5 11.07" pathLength={100} opacity={0.5} />
        <path d="M100 32 v-10" stroke="var(--outline)" strokeWidth={3} strokeLinecap="round" />
        <motion.g initial={false} animate={{ rotate: angle }} transition={reduced ? { duration: 0 } : springs.dial} style={{ originX: 0.5, originY: 1 }}>
          <path d="M100 100 L100 44" stroke="var(--outline)" strokeWidth={4} strokeLinecap="round" />
        </motion.g>
        <circle cx={100} cy={100} r={7} fill="var(--outline)" />
      </svg>
      {readout && (
        <div className="kb-gauge__read">
          <div className="kb-gauge__num">
            {format(value)}
            <small> / {format(max)}</small>
          </div>
          {caption != null && <div className="kb-gauge__sub">{caption}</div>}
        </div>
      )}
    </div>
  );
}
