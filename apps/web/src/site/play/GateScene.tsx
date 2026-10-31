import { ELYSIUM, SHADE } from '@elymum/shared';
import { useEffect, useState, type ReactElement } from 'react';
import { CoinCharacter, useOffscreenPause, useReducedMotion, type CoinMood } from '../../design';

/**
 * The gate to the ring, drawn as a little ferry gate on the night shore: two stone posts with
 * lanterns, an arched board, a striped barrier arm, an emblem slot with a lamp, and the guard: a
 * coin in a peaked cap.
 *
 * - `closed`: the guard is asleep (z's float off), the lamp is red, the lanterns are low.
 * - `holders`: the guard dozes, wakes with a start, then holds up an "Emblem?" card; while the
 *   visitor is at the sign-in (`attention`), the guard leans and looks over at them.
 * - `checking`: the guard inspects with a magnifier; the lamp blinks sun.
 * - `open`: the lamp turns green, the barrier swings up, the guard cheers.
 *
 * Decorative (aria-hidden). Reduced motion: every pose is still; the barrier simply sits where it
 * should.
 */
export type GateMode = 'closed' | 'holders' | 'checking' | 'open';

const INK = ELYSIUM.abyss;
const S = { stroke: INK, strokeWidth: 3, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };

function Post({ x }: { x: number }) {
  return (
    <g>
      <rect x={x + 4} y={96} width={34} height={190} rx={5} fill={INK} />
      <rect x={x} y={92} width={34} height={190} rx={5} fill={ELYSIUM.sand} {...S} />
      <rect x={x + 23} y={96} width={8} height={183} fill={ELYSIUM.sand2} />
      <path d={`M${x} 140 H${x + 34} M${x} 200 H${x + 34}`} stroke={INK} strokeWidth={2.4} opacity={0.5} />
      {/* the lantern */}
      <path d={`M${x - 4} 92 H${x + 38} L${x + 30} 80 H${x + 4}Z`} fill={ELYSIUM.teal} {...S} />
      <rect x={x + 6} y={52} width={22} height={28} rx={4} fill={INK} transform="translate(2 2)" />
      <rect className="pg-gate__lamp" x={x + 6} y={52} width={22} height={28} rx={4} fill={ELYSIUM.sun} {...S} />
      <path d={`M${x + 2} 52 L${x + 17} 38 L${x + 32} 52Z`} fill={ELYSIUM.teal} {...S} />
      <circle className="pg-gate__glow" cx={x + 17} cy={66} r={26} fill={ELYSIUM.sun} opacity={0.18} />
    </g>
  );
}

export function GateScene({ mode, attention = false }: { mode: GateMode; attention?: boolean }): ReactElement {
  const reduced = useReducedMotion();
  const [ref, visible] = useOffscreenPause<HTMLDivElement>();
  // holders: asleep first, then a start, then awake and asking
  const [awake, setAwake] = useState(mode !== 'holders' && mode !== 'closed');
  useEffect(() => {
    if (mode !== 'holders') {
      setAwake(mode !== 'closed');
      return;
    }
    if (reduced) {
      setAwake(true);
      return;
    }
    setAwake(false);
    const t = setTimeout(() => setAwake(true), 1400);
    return () => clearTimeout(t);
  }, [mode, reduced]);
  const asleep = mode === 'closed' || (mode === 'holders' && !awake);
  const mood: CoinMood = asleep ? 'sleepy' : mode === 'open' ? 'happy' : mode === 'checking' ? 'open' : attention ? 'smile' : 'smug';
  const look: [number, number] = attention ? [-4, 1] : mode === 'checking' ? [-3, 2] : [-2, 0];
  const lamp = mode === 'open' ? ELYSIUM.up : mode === 'checking' ? ELYSIUM.sun : ELYSIUM.down;
  const stripes = Array.from({ length: 6 }, (_, i) => i);
  return (
    <div ref={ref} className={`pg-gate is-${mode}${asleep ? ' is-asleep' : ' is-awake'}${attention ? ' is-attending' : ''}${visible ? '' : ' is-paused'}`} aria-hidden="true">
      <svg className="pg-gate__art" viewBox="0 0 400 300" focusable="false" overflow="visible">
        {/* the shore ledge */}
        <path d="M-20 300 Q200 262 420 290 V320 H-20Z" fill={ELYSIUM.pine} {...S} />
        <path d="M30 288 Q200 266 380 284" stroke={ELYSIUM.forest} strokeWidth={5} fill="none" strokeLinecap="round" />
        <Post x={52} />
        <Post x={232} />
        {/* the barrier arm, pivoting on the left post (behind the board when it swings up) */}
        <g className="pg-gate__arm">
          <rect x={80} y={190} width={162} height={16} rx={8} fill={INK} transform="translate(3 3)" />
          <rect x={80} y={190} width={162} height={16} rx={8} fill={ELYSIUM.cream} {...S} />
          {stripes.map((i) => (
            <path key={i} d={`M${100 + i * 24} 191.5 l12 0 l-8 13 l-12 0Z`} fill={i % 2 ? ELYSIUM.coral : ELYSIUM.sun} />
          ))}
          <rect x={80} y={190} width={162} height={16} rx={8} fill="none" {...S} />
          <circle cx={78} cy={198} r={11} fill={ELYSIUM.teal} {...S} />
          <circle cx={78} cy={198} r={3.5} fill={INK} />
        </g>
        {/* the arched board */}
        <path d="M40 96 Q155 40 278 96" stroke={INK} strokeWidth={20} fill="none" strokeLinecap="round" />
        <path d="M40 96 Q155 40 278 96" stroke={ELYSIUM.teal} strokeWidth={13} fill="none" strokeLinecap="round" />
        <path d="M40 96 Q155 40 278 96" stroke={ELYSIUM.sun} strokeWidth={3} strokeDasharray="2 14" fill="none" strokeLinecap="round" />
        <g transform="translate(159 70) rotate(-1.5)">
          <rect x={-56} y={-18} width={112} height={34} rx={7} fill={INK} transform="translate(3 3)" />
          <rect x={-56} y={-18} width={112} height={34} rx={7} fill={ELYSIUM.cream} {...S} />
          <text className="pg-gate__board" x={0} y={5} textAnchor="middle">
            RING GATE
          </text>
        </g>
        {/* the emblem slot with its lamp, on the right post */}
        <g transform="translate(232 150)">
          <rect x={-8} y={0} width={50} height={40} rx={6} fill={ELYSIUM.current} {...S} />
          <rect x={2} y={24} width={30} height={6} rx={3} fill={INK} />
          <circle className="pg-gate__signal" cx={17} cy={12} r={6} fill={lamp} stroke={INK} strokeWidth={2.4} />
        </g>
      </svg>

      {/* the guard */}
      <span className="pg-gate__guard">
        <span className="pg-gate__lean">
          <CoinCharacter paint="sun" mood={mood} size={118} feet ground look={look} bob={mode === 'open'} blink={!asleep} />
          <svg className="pg-gate__cap" viewBox="0 0 80 44" width={70} height={39} focusable="false">
            <path d="M8 30 C8 8 72 8 72 30Z" fill={ELYSIUM.teal} {...S} />
            <path d="M14 26 C20 14 54 12 64 22" stroke={SHADE.teal} strokeWidth={4} fill="none" strokeLinecap="round" />
            <path d="M2 32 Q40 22 78 32 Q40 42 2 32Z" fill={ELYSIUM.current} {...S} />
            <circle cx={40} cy={18} r={6} fill={ELYSIUM.sun} stroke={INK} strokeWidth={2.4} />
          </svg>
          {mode === 'holders' && awake && (
            <span className="pg-gate__ask">
              <span className="pg-gate__card mono">Emblem?</span>
            </span>
          )}
          {mode === 'checking' && (
            <svg className="pg-gate__glass" viewBox="0 0 60 60" width={64} height={64} focusable="false">
              <path d="M36 36 L54 54" stroke={INK} strokeWidth={10} strokeLinecap="round" />
              <path d="M36 36 L54 54" stroke={ELYSIUM.coral} strokeWidth={5} strokeLinecap="round" />
              <circle cx={24} cy={24} r={16} fill={ELYSIUM.mist} fillOpacity={0.85} {...S} />
              <path d="M15 21 a9 9 0 0 1 7 -7" stroke="#FFFFFF" strokeWidth={3} fill="none" strokeLinecap="round" />
            </svg>
          )}
        </span>
        {asleep && (
          <span className="pg-gate__zzz">
            <i>z</i>
            <i>z</i>
            <i>Z</i>
          </span>
        )}
        {mode === 'holders' && awake && !reduced && <span className="pg-gate__start mono">!</span>}
      </span>
    </div>
  );
}
