import { useId, type ReactElement } from 'react';
import { useOffscreenPause } from '../../design';

/**
 * A postage stamp on each departures-board pass: a tiny living picture of the arena it goes
 * to. Asphodel Meadow's flowers sway, the Lethe flows past its shore, the Golden Bough's one
 * golden branch glints, the boats of the Isles of the Blessed bob at anchor; practice is a
 * pond with a coin paddling in it. CSS loops only (transform / opacity), paused off screen,
 * still under reduced motion (lobby.css). The picture is decoration: the pass says the name.
 */
export function ArenaVignette({ arenaId }: { arenaId: number | null }) {
  const [ref, visible] = useOffscreenPause<HTMLSpanElement>();
  const scene = arenaId === null ? 'pond' : (SCENES[arenaId] ?? 'meadow');
  const clip = `av-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <span ref={ref} className={`av av--${scene}`} data-paused={!visible || undefined} aria-hidden="true">
      <svg viewBox="0 0 60 68" className="av__svg" focusable="false">
        {/* the stamp: white stock with a perforated edge (holes in the pass's cream) */}
        <rect x="2" y="2" width="56" height="64" rx="3" className="av__stock" />
        {PERFS.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="2.1" className="av__perf" />
        ))}
        <clipPath id={clip}>
          <rect x="8" y="8" width="44" height="52" rx="2.5" />
        </clipPath>
        <g clipPath={`url(#${clip})`}>{ART[scene]}</g>
        <rect x="8" y="8" width="44" height="52" rx="2.5" className="av__frame" />
      </svg>
    </span>
  );
}

type Scene = 'meadow' | 'lethe' | 'bough' | 'isles' | 'pond';
const SCENES: Record<number, Scene> = { 1: 'meadow', 2: 'lethe', 3: 'bough', 4: 'isles' };

/** Perforation holes along the stamp's edge. */
const PERFS: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let x = 7; x <= 53; x += 6.5) out.push([x, 2], [x, 66]);
  for (let y = 9; y <= 60; y += 6.4) out.push([2, y], [58, y]);
  return out;
})();

/** Leaves on the golden bough (gold, ink-edged). */
const GOLD_LEAVES = ['M38 32 q1 -6 6 -7 q-1 5 -6 7z', 'M42 29 q5 0 7 4 q-5 1 -7 -4z', 'M44 25 q0 -5 5 -7 q0 5 -5 7z', 'M47 22 q4 -2 7 1 q-4 2 -7 -1z'];

/** An asphodel: a thin stem and a pale six-point star with a sun eye. */
function Asphodel({ x, base, h, delay, s = 1 }: { x: number; base: number; h: number; delay: number; s?: number }) {
  const top = base - h;
  const petals = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2;
    return `M${x} ${top} L${(x + Math.cos(a) * 4.2 * s).toFixed(2)} ${(top + Math.sin(a) * 4.2 * s).toFixed(2)}`;
  }).join(' ');
  return (
    <g className="av-sway" style={{ animationDelay: `${delay}s` }}>
      <path d={`M${x} ${base} Q${x - 1.5} ${base - h / 2} ${x} ${top}`} className="av-stem" />
      <path d={`M${x} ${base - h * 0.45} q-4 -1 -5 -4`} className="av-stem" />
      <path d={petals} className="av-petal-ink" />
      <path d={petals} className="av-petal" />
      <circle cx={x} cy={top} r={1.5 * s} className="av-eye" />
    </g>
  );
}

const ART: Record<Scene, ReactElement> = {
  meadow: (
    <>
      <rect x="0" y="0" width="60" height="68" fill="#DBF2F9" />
      <circle cx="41" cy="20" r="5.5" fill="#F2C14E" stroke="#04181C" strokeWidth="1.6" />
      <g className="av-cloud">
        <path d="M10 22c0-3 3-4 5-3 1-3 6-3 7 0 3 0 3 4 0 4h-11c-1 0-1-1-1-1z" fill="#FFFFFF" stroke="#04181C" strokeWidth="1.4" />
      </g>
      <path d="M0 44 Q16 34 32 41 T64 37 V70 H0Z" fill="#B9D98F" stroke="#04181C" strokeWidth="1.6" />
      <path d="M0 52 Q20 45 40 51 T64 49 V70 H0Z" fill="#8CC47A" stroke="#04181C" strokeWidth="1.6" />
      <Asphodel x={18} base={61} h={18} delay={0} />
      <Asphodel x={30} base={62} h={13} delay={-0.7} s={0.85} />
      <Asphodel x={42} base={61} h={20} delay={-1.4} />
    </>
  ),
  lethe: (
    <>
      <rect x="0" y="0" width="60" height="68" fill="#DBF2F9" />
      {/* a pale moon over the river of forgetting */}
      <path d="M42 13a6 6 0 1 0 5 9 5 5 0 1 1 -5 -9z" fill="#F6EEDA" stroke="#04181C" strokeWidth="1.4" />
      <rect x="0" y="30" width="60" height="40" fill="#2D7388" stroke="#04181C" strokeWidth="1.6" />
      <g className="av-flow">
        <path d="M-12 38 q3 -2.5 6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0" className="av-wave" />
        <path d="M-15 45 q3 -2.5 6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0" className="av-wave is-soft" />
      </g>
      <g className="av-flow is-slow">
        <path d="M-12 51 q3 -2.5 6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0" className="av-wave is-soft" />
      </g>
      <path d="M0 58 Q18 52 34 57 T64 54 V70 H0Z" fill="#EBE6DD" stroke="#04181C" strokeWidth="1.6" />
      <path d="M14 57 q1 -7 3 -9 M17 57 q0 -6 -2 -8 M19 57 q1 -5 4 -6" stroke="#2F6E4F" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <circle cx="44" cy="58" r="2" fill="#DDD6C7" stroke="#04181C" strokeWidth="1.2" />
    </>
  ),
  bough: (
    <>
      <rect x="0" y="0" width="60" height="68" fill="#F6EEDA" />
      <rect x="0" y="0" width="60" height="26" fill="#DBF2F9" />
      <path d="M0 54 Q30 48 64 54 V70 H0Z" fill="#5FA36A" stroke="#04181C" strokeWidth="1.6" />
      {/* the trunk, the crown, then the one golden branch */}
      <path d="M28 58 C28 50 27 44 29 38 L33 38 C34 44 33 50 34 58Z" fill="#6B655A" stroke="#04181C" strokeWidth="1.6" strokeLinejoin="round" />
      <g className="av-crown">
        <path d="M14 33c-3-6 2-12 8-11 1-6 11-8 14-2 6-2 11 4 8 9 4 4 0 11-6 9-3 4-11 4-14 0-6 2-12-1-10-5z" fill="#3E8A5C" stroke="#04181C" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M20 28c2-2 4-2 6-1M34 25c2-1 4 0 5 2" stroke="#2F7049" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </g>
      <g className="av-branch">
        <path d="M32 34 Q40 31 47 22" stroke="#04181C" strokeWidth="4.2" fill="none" strokeLinecap="round" />
        <path d="M32 34 Q40 31 47 22" stroke="#F2C14E" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        {GOLD_LEAVES.map((d, i) => (
          <path key={i} d={d} fill="#F2C14E" stroke="#04181C" strokeWidth="1.2" strokeLinejoin="round" />
        ))}
      </g>
      <path className="av-glint" d="M45 11 L46.3 15.2 L50.5 16.5 L46.3 17.8 L45 22 L43.7 17.8 L39.5 16.5 L43.7 15.2Z" fill="#FFFFFF" stroke="#04181C" strokeWidth="1" strokeLinejoin="round" />
    </>
  ),
  isles: (
    <>
      <rect x="0" y="0" width="60" height="68" fill="#DBF2F9" />
      <path d="M6 40 Q14 28 24 38 Q30 33 36 40Z" fill="#5FA36A" stroke="#04181C" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M17 33 v-7" stroke="#04181C" strokeWidth="1.4" />
      <circle cx="17" cy="24.5" r="3.4" fill="#3E8A5C" stroke="#04181C" strokeWidth="1.4" />
      <path d="M38 40 Q45 31 54 40Z" fill="#8CC47A" stroke="#04181C" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="0" y="39" width="60" height="30" fill="#3C9A87" stroke="#04181C" strokeWidth="1.6" />
      <g className="av-flow is-slow">
        <path d="M-12 47 q3 -2 6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0" className="av-wave is-soft" />
        <path d="M-15 56 q3 -2 6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0" className="av-wave is-soft" />
      </g>
      <g className="av-boat">
        <path d="M30 29 V46" stroke="#04181C" strokeWidth="1.4" />
        <path d="M31 30 L40 43 H31Z" fill="#FFFFFF" stroke="#04181C" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M22 46 H42 L39 51 H25Z" fill="#D9714F" stroke="#04181C" strokeWidth="1.5" strokeLinejoin="round" />
      </g>
      <g className="av-boat is-far">
        <path d="M41 50 h8 l-1.5 2.5 h-5z" fill="#F2C14E" stroke="#04181C" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M45 50 v-5 l3 5" fill="#FFFFFF" stroke="#04181C" strokeWidth="1.1" strokeLinejoin="round" />
      </g>
    </>
  ),
  pond: (
    <>
      <rect x="0" y="0" width="60" height="68" fill="#B9D98F" />
      <ellipse cx="30" cy="42" rx="22" ry="14" fill="#6FCDE8" stroke="#04181C" strokeWidth="1.6" />
      <path d="M14 40 q3 -1.6 6 0 M36 49 q3 -1.6 6 0" stroke="#FFFFFF" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <path d="M40 36 a5 3.4 0 1 0 0.1 0 l-4 2z" fill="#5FA36A" stroke="#04181C" strokeWidth="1.3" strokeLinejoin="round" />
      <g className="av-paddle">
        <circle cx="25" cy="40" r="7" fill="#93D9EE" stroke="#04181C" strokeWidth="1.6" />
        <circle cx="22.6" cy="39" r="1.1" fill="#04181C" />
        <circle cx="27.4" cy="39" r="1.1" fill="#04181C" />
        <path d="M23 42 q2 1.6 4 0" stroke="#04181C" strokeWidth="1.1" fill="none" strokeLinecap="round" />
        <path d="M18 44 q7 3 14 0" stroke="#FFFFFF" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      </g>
      <path d="M44 57 v-8 M47 57 v-11 M50 57 v-7" stroke="#2F6E4F" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
};
