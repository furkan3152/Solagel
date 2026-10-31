import { ELYSIUM, SHADE } from '@elymum/shared';
import { motion } from 'motion/react';
import type { ReactElement } from 'react';
import { springs, useReducedMotion, type CoinPaint } from '../../design';

const INK = ELYSIUM.abyss;
const VW = 460;
const VH = 168;
// the path climbs like the ring curving up: flat on the plain, then steeper
const P0 = [26, 136];
const P1 = [170, 140];
const P2 = [312, 112];
const P3 = [404, 34];

function at(t: number): [number, number] {
  const u = 1 - t;
  const x = u * u * u * P0[0] + 3 * u * u * t * P1[0] + 3 * u * t * t * P2[0] + t * t * t * P3[0];
  const y = u * u * u * P0[1] + 3 * u * u * t * P1[1] + 3 * u * t * t * P2[1] + t * t * t * P3[1];
  return [x, y];
}

export interface AscentProps {
  /** Number of chores. */
  total: number;
  /** Chores done (the coin stands on that terrace; at `total` it reaches the feast). */
  done: number;
  /** The visitor's coin paint (from their handle). */
  paint: CoinPaint;
  /** Index of the open chore (its terrace is ringed). */
  active: number;
  /** Station captions (default: the chore numbers). */
  labels?: string[];
  /** Caption of the top of the path (default "Feast"). */
  goal?: string;
}

/**
 * The WL ascent as a little map: a dotted path climbing the ring, one terrace per chore, the
 * visitor's coin hopping up a terrace each time a chore is done, the feast waiting at the top.
 * Done terraces keep a sun coin. Decorative (the progress bar next to it carries the numbers).
 */
export function Ascent({ total, done, paint, active, labels, goal = 'Feast' }: AscentProps): ReactElement {
  const reduced = useReducedMotion();
  const n = Math.max(1, total);
  // stations at even steps along the curve, leaving the last stretch for the feast
  const stations = Array.from({ length: n }, (_, i) => at((i / n) * 0.9));
  const feast = at(1);
  const [cx, cy] = done >= n ? feast : stations[Math.min(done, n - 1)];
  const lit = ELYSIUM[paint as keyof typeof ELYSIUM] ?? ELYSIUM.cyan;
  const shade = SHADE[paint as keyof typeof SHADE] ?? SHADE.cyan;
  const path = `M${P0[0]} ${P0[1]} C${P1[0]} ${P1[1]} ${P2[0]} ${P2[1]} ${P3[0]} ${P3[1]}`;
  return (
    <svg className="wl-ascent" viewBox={`0 0 ${VW} ${VH}`} aria-hidden="true" focusable="false" overflow="visible">
      {/* the far ring, just its edge */}
      <path d={`M-10 ${VH - 4} Q${VW / 2} ${VH - 40} ${VW + 10} ${VH - 92}`} fill="none" stroke={ELYSIUM.sand2} strokeWidth={3} strokeDasharray="10 9" strokeLinecap="round" />
      <path d={path} fill="none" stroke={INK} strokeWidth={4} strokeDasharray="0.5 11" strokeLinecap="round" />
      {stations.map(([x, y], i) => {
        const isDone = i < done;
        const isActive = i === active && !isDone;
        return (
          <g key={i} transform={`translate(${x} ${y})`} className={`wl-ascent__st${isDone ? ' is-done' : ''}${isActive ? ' is-active' : ''}`}>
            {/* the terrace: a little ledge of the plain */}
            <path d="M-17 7 Q0 1 17 7 L15 13 Q0 9 -15 13Z" fill={i % 2 ? ELYSIUM.clover : ELYSIUM.meadow} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
            {isActive && <circle r={14} fill="none" stroke={ELYSIUM.teal} strokeWidth={2.5} strokeDasharray="3 4" className="wl-ascent__ring" />}
            {isDone ? (
              <g>
                <circle r={9} fill={SHADE.sun} stroke={INK} strokeWidth={2.5} />
                <circle cx={-1} cy={-1.4} r={6.6} fill={ELYSIUM.sun} />
                <path d="M-3.6 0 l2.6 2.6 5 -5" fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
              </g>
            ) : (
              <circle r={7} fill={ELYSIUM.cream} stroke={INK} strokeWidth={2.5} />
            )}
            <text y={32} textAnchor="middle" className="wl-ascent__no">
              {labels?.[i] ?? i + 1}
            </text>
          </g>
        );
      })}
      {/* the feast: a plate of grapes and a pear */}
      <g transform={`translate(${feast[0]} ${feast[1]})`} className={`wl-ascent__feast${done >= n ? ' is-done' : ''}`}>
        <ellipse cx={2} cy={12} rx={28} ry={8} fill={INK} />
        <ellipse cy={9} rx={28} ry={8} fill="#FFFFFF" stroke={INK} strokeWidth={2.5} />
        <g stroke={INK} strokeWidth={2.2}>
          <circle cx={-12} cy={2} r={5.4} fill={ELYSIUM.teal} />
          <circle cx={-5} cy={3} r={5.4} fill={ELYSIUM.teal} />
          <circle cx={-9} cy={-5} r={5.4} fill={ELYSIUM.spray} />
        </g>
        <path d="M8 6 C2 6 2 -2 6 -5 C7 -10 13 -10 14 -5 C18 -2 18 6 12 6Z" fill={ELYSIUM.sun} stroke={INK} strokeWidth={2.4} strokeLinejoin="round" />
        <path d="M10 -9 q1 -5 4 -6" stroke={INK} strokeWidth={2.4} fill="none" strokeLinecap="round" />
        <text y={36} textAnchor="middle" className="wl-ascent__no">
          {goal.toUpperCase()}
        </text>
      </g>
      {/* dust kicked up where the coin lands (one puff left, one right, a speck) */}
      {!reduced && done > 0 && (
        <g key={`dust${done}`} transform={`translate(${cx + (done >= n ? -30 : 0)} ${cy - 2})`} className="wl-ascent__dust">
          <g className="wl-ascent__puff wl-ascent__puff--l">
            <circle r={5.5} cx={-2} fill="#FFFFFF" stroke={INK} strokeWidth={2} />
            <circle r={3.6} cx={-9} cy={1} fill="#FFFFFF" stroke={INK} strokeWidth={2} />
          </g>
          <g className="wl-ascent__puff wl-ascent__puff--r">
            <circle r={5.5} cx={2} fill="#FFFFFF" stroke={INK} strokeWidth={2} />
            <circle r={3.6} cx={9} cy={1} fill="#FFFFFF" stroke={INK} strokeWidth={2} />
          </g>
          <circle className="wl-ascent__puff wl-ascent__puff--c" r={2.4} cy={-6} fill={ELYSIUM.sand2} stroke={INK} strokeWidth={1.6} />
        </g>
      )}
      {/* at the top: a little victory burst of sparkles over the feast */}
      {!reduced && done >= n && (
        <g key="win" transform={`translate(${feast[0] - 10} ${feast[1] - 34})`} className="wl-ascent__win">
          {[-38, -12, 14, 40].map((dx, i) => (
            <path key={i} className="wl-ascent__spark" style={{ ['--dx' as string]: `${dx}px`, animationDelay: `${0.5 + i * 0.06}s` }} d="M0 -6 Q1 -1 6 0 Q1 1 0 6 Q-1 1 -6 0 Q-1 -1 0 -6Z" fill={i % 2 ? ELYSIUM.sun : ELYSIUM.foam} stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
          ))}
        </g>
      )}
      {/* the visitor's coin */}
      <motion.g initial={false} animate={{ x: cx + (done >= n ? -30 : 0), y: cy - 20 }} transition={reduced ? { duration: 0 } : springs.drop}>
        <motion.g
          key={done}
          initial={false}
          animate={
            reduced || done === 0
              ? { y: 0 }
              : done >= n
                ? { y: [0, -26, 0, -4, 0, -18, 0, -6, 0], scaleY: [1, 1.06, 0.86, 1, 1, 1.05, 0.9, 1, 1], rotate: [0, 0, 0, 0, 0, -12, 0, 8, 0] }
                : { y: [0, -26, 0, -4, 0], scaleY: [1, 1.06, 0.86, 1, 1] }
          }
          transition={done >= n && !reduced ? { duration: 1.3, times: [0, 0.18, 0.3, 0.38, 0.46, 0.62, 0.76, 0.88, 1], ease: 'easeOut' } : { duration: 0.62, times: [0, 0.38, 0.62, 0.8, 1], ease: 'easeOut' }}
        >
          <ellipse cy={18} rx={11} ry={3} fill={INK} opacity={0.2} />
          <circle r={14} fill={shade} stroke={INK} strokeWidth={2.6} />
          <circle cx={-1.8} cy={-2.2} r={11.4} fill={lit} />
          <circle r={14} fill="none" stroke={INK} strokeWidth={2.6} />
          <path d="M-10 -3 A10 10 0 0 1 -5 -9" stroke="#FFFFFF" strokeWidth={2.2} fill="none" strokeLinecap="round" opacity={0.85} />
          <ellipse cx={-4.6} cy={-2} rx={3.2} ry={3.9} fill="#FFFFFF" stroke={INK} strokeWidth={1.8} />
          <ellipse cx={4.6} cy={-2} rx={3.2} ry={3.9} fill="#FFFFFF" stroke={INK} strokeWidth={1.8} />
          <circle cx={-3.8} cy={-1.4} r={1.8} fill={INK} />
          <circle cx={5.4} cy={-1.4} r={1.8} fill={INK} />
          <path d="M-3 5 Q0 8 3 5" stroke={INK} strokeWidth={2} fill="none" strokeLinecap="round" />
          <ellipse cx={-8.5} cy={3.5} rx={2} ry={1.2} fill={ELYSIUM.blush} />
          <ellipse cx={8.5} cy={3.5} rx={2} ry={1.2} fill={ELYSIUM.blush} />
        </motion.g>
      </motion.g>
    </svg>
  );
}
