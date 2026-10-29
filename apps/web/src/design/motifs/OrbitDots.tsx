import { ELYSIUM } from '@elymum/shared';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { useReducedMotion } from '../motion';
import { useOffscreenPause } from './useOffscreenPause';

export interface OrbitStation {
  /** Position on the orbit, 0..1 clockwise from the left end. */
  at: number;
  /** Label printed next to the station (Geist Mono caps). */
  label: ReactNode;
  /** Station reached: filled sun dot. */
  done?: boolean;
}

export interface OrbitDotsProps {
  /** viewBox width / height (default 600 × 240). */
  width?: number;
  height?: number;
  /** Coins riding the orbit (default 3). */
  coins?: number;
  /** Seconds per lap (default 18). */
  duration?: number;
  stations?: OrbitStation[];
  /** `day` teal dots on the plain, `night` foam dots in orbit. */
  tone?: 'day' | 'night';
  className?: string;
  style?: CSSProperties;
  title?: string;
}

const PAINTS = [ELYSIUM.sun, ELYSIUM.cyan, ELYSIUM.up, ELYSIUM.foam, ELYSIUM.blush];

/**
 * A dotted orbit ellipse with little outlined coins travelling it (and
 * optional stations: "ticket → eat → bell → paid"). SMIL motion, paused off
 * screen; reduced motion: the coins sit still on the orbit.
 */
export function OrbitDots({ width = 600, height = 240, coins = 3, duration = 18, stations = [], tone = 'night', className, style, title }: OrbitDotsProps): ReactElement {
  const reduced = useReducedMotion();
  const [ref, visible] = useOffscreenPause<SVGSVGElement>();
  const cx = width / 2;
  const cy = height / 2;
  const rx = width / 2 - (stations.length ? 70 : 24);
  const ry = height / 2 - 24;
  const path = `M${cx - rx} ${cy} A${rx} ${ry} 0 1 1 ${cx + rx} ${cy} A${rx} ${ry} 0 1 1 ${cx - rx} ${cy}`;
  // `at` 0 = left end, going over the top (clockwise on screen)
  const pt = (at: number) => {
    const a = Math.PI + at * Math.PI * 2;
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  };
  return (
    <svg
      ref={ref}
      className={`kb-orbit kb-orbit--${tone}${className ? ` ${className}` : ''}`}
      viewBox={`0 0 ${width} ${height}`}
      style={style}
      data-paused={!visible || undefined}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      overflow="visible"
    >
      <ellipse className="kb-orbit__track" cx={cx} cy={cy} rx={rx} ry={ry} fill="none" strokeWidth={3} strokeDasharray="1 12" strokeLinecap="round" />
      <ellipse className="kb-orbit__inner" cx={cx} cy={cy} rx={rx * 0.62} ry={ry * 0.5} fill="none" strokeWidth={2} strokeDasharray="2 9" strokeLinecap="round" />
      {stations.map((s, i) => {
        const p = pt(s.at);
        const dx = p.x - cx;
        const side = Math.abs(dx) > rx * 0.7;
        const below = p.y > cy + 1;
        const lx = side ? Math.sign(dx) * 18 : 0;
        const ly = side ? 4 : below ? 30 : -18;
        const anchor = side ? (dx > 0 ? 'start' : 'end') : 'middle';
        return (
          <g key={i} className={`kb-orbit__station${s.done ? ' is-done' : ''}`} transform={`translate(${p.x} ${p.y})`}>
            <circle r={9} strokeWidth={3} stroke={ELYSIUM.abyss} />
            <text x={lx} y={ly} textAnchor={anchor} className="kb-orbit__label">
              {s.label}
            </text>
          </g>
        );
      })}
      {Array.from({ length: coins }, (_, i) => {
        const offset = i / coins;
        const fill = PAINTS[i % PAINTS.length];
        const r = 9 - (i % 3) * 1.6;
        const body = (
          <g>
            <circle r={r} fill={fill} stroke={ELYSIUM.abyss} strokeWidth={2.5} />
            <circle cx={-r * 0.32} cy={-r * 0.1} r={r * 0.16} fill={ELYSIUM.abyss} />
            <circle cx={r * 0.32} cy={-r * 0.1} r={r * 0.16} fill={ELYSIUM.abyss} />
          </g>
        );
        if (reduced) {
          const p = pt(offset);
          return (
            <g key={i} transform={`translate(${p.x} ${p.y})`}>
              {body}
            </g>
          );
        }
        return (
          <g key={i}>
            {body}
            <animateMotion dur={`${duration}s`} repeatCount="indefinite" path={path} begin={`${-offset * duration}s`} />
          </g>
        );
      })}
    </svg>
  );
}
