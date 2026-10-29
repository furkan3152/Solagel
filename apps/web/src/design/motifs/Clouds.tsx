import type { CSSProperties, ReactElement } from 'react';
import { useOffscreenPause } from './useOffscreenPause';

/** Three chubby cloud silhouettes (circles on a flat base), 0..2. */
const SHAPES: { circles: [number, number, number][]; base: [number, number, number, number]; shine: string }[] = [
  { circles: [[40, 40, 28], [80, 26, 36], [124, 38, 30], [154, 52, 20]], base: [18, 44, 150, 26], shine: 'M58 22 q10 -14 26 -10' },
  { circles: [[34, 46, 22], [66, 30, 30], [104, 24, 34], [142, 44, 24]], base: [14, 46, 150, 24], shine: 'M84 12 q12 -10 28 -4' },
  { circles: [[36, 44, 24], [72, 36, 30], [108, 44, 22]], base: [14, 46, 116, 24], shine: 'M54 20 q8 -10 22 -8' },
];

export interface CloudProps {
  /** 0, 1 or 2. */
  shape?: 0 | 1 | 2;
  /** Width in px (default 170). */
  width?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * One chubby outlined cloud: an ink silhouette 3 px larger all round, the white
 * puff on top, a flat belly shade and a single highlight stroke. Theme-aware
 * through `.kb-cloud` (night clouds are dusky teal).
 */
export function Cloud({ shape = 0, width = 170, className, style }: CloudProps): ReactElement {
  const s = SHAPES[shape];
  const [bx, by, bw, bh] = s.base;
  const parts = (
    <>
      {s.circles.map(([cx, cy, r], i) => (
        <circle key={i} cx={cx} cy={cy} r={r} />
      ))}
      <rect x={bx} y={by} width={bw} height={bh} rx={bh / 2} />
    </>
  );
  return (
    <svg
      className={`kb-cloud${className ? ` ${className}` : ''}`}
      viewBox="0 -14 180 92"
      width={width}
      height={(width * 92) / 180}
      style={style}
      aria-hidden="true"
      focusable="false"
      overflow="visible"
    >
      <g className="kb-cloud__edge" strokeWidth={6} strokeLinejoin="round">
        {parts}
      </g>
      <g className="kb-cloud__puff">{parts}</g>
      <path
        className="kb-cloud__belly"
        d={`M${bx} ${by + bh / 2 + 1} H${bx + bw} a${bh / 2} ${bh / 2} 0 0 1 -${bh / 2} ${bh / 2 - 1} H${bx + bh / 2} a${bh / 2} ${bh / 2} 0 0 1 -${bh / 2} -${bh / 2 - 1}z`}
      />
      <path className="kb-cloud__shine" d={s.shine} strokeWidth={2.5} fill="none" strokeLinecap="round" />
    </svg>
  );
}

export interface CloudsProps {
  /** How many clouds drift across (default 3). */
  count?: number;
  /** Seconds for one crossing (default 60; each cloud varies it). */
  speed?: number;
  /** Vertical band they float in, as % of the container [top, bottom]. */
  band?: [number, number];
  /** Cloud width in px (default 170). */
  width?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * A layer of clouds drifting left to right across its (positioned) parent.
 * Reduced motion: they stand still where they are. Paused off screen.
 */
export function Clouds({ count = 3, speed = 60, band = [8, 46], width = 170, className, style }: CloudsProps): ReactElement {
  const [ref, visible] = useOffscreenPause<HTMLDivElement>();
  return (
    <div ref={ref} className={`kb-clouds${className ? ` ${className}` : ''}`} data-paused={!visible || undefined} style={style} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const t = count === 1 ? 0.5 : i / (count - 1);
        const top = band[0] + (band[1] - band[0]) * ((i * 0.618) % 1);
        const dur = speed * (1 + (i % 3) * 0.28);
        return (
          <div
            key={i}
            className="kb-clouds__lane"
            style={{ top: `${top}%`, animationDuration: `${dur}s`, animationDelay: `${-dur * (0.15 + t * 0.7)}s`, '--x': `${4 + t * 70}%` } as CSSProperties}
          >
            <Cloud shape={(i % 3) as 0 | 1 | 2} width={width * (0.8 + ((i * 0.37) % 0.45))} />
          </div>
        );
      })}
    </div>
  );
}
