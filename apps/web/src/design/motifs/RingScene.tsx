import { ELYSIUM, SHADE } from '@elymum/shared';
import { useId, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { WOBBLE } from './InkDefs';
import { useOffscreenPause } from './useOffscreenPause';

/**
 * The Elysium ring habitat as a picture-book plate (spec §6.5): the ground
 * curving up both sides in terraces, the far side of the ring arching overhead
 * with its spokes and lights, the planet seen through the sky band, a moon,
 * chubby clouds, tiny houses, lollipop trees and pines, a canal and a
 * zig-zag path. Everything has a 3 px ink outline and one hard shade.
 *
 * `time`: `dawn` (the plain, day) or `night` (moonlit fields, lit windows).
 * `variant`: `full` (1440 × 880 hero), `compact` (terraces + planet top,
 * 1440 × 520), `horizon` (the front terraces only, 1440 × 240, for footers
 * and section seams). The SVG slices to cover its box; put HTML (cards,
 * coins) on top as `children`.
 */
export type RingTime = 'dawn' | 'night';
export type RingVariant = 'full' | 'compact' | 'horizon';

export interface RingSceneProps {
  time?: RingTime;
  variant?: RingVariant;
  /** Drifting clouds (default true). */
  clouds?: boolean;
  /** Ring lights crawl, clouds drift, stars twinkle (default true; off under reduced motion and off screen). */
  animate?: boolean;
  /** Hand-inked wobble on the terraces (default true). */
  wobble?: boolean;
  /** How the art fits its box (default `xMidYMax slice`). */
  preserveAspectRatio?: string;
  className?: string;
  style?: CSSProperties;
  /** HTML laid over the plate. */
  children?: ReactNode;
}

const VIEW: Record<RingVariant, string> = {
  full: '0 0 1440 880',
  compact: '0 360 1440 520',
  horizon: '0 640 1440 240',
};

interface Paints {
  sky: [string, string, string, string];
  star: string;
  arch: string;
  archBand: string;
  archLights: string;
  spoke: string;
  spokeLit: string;
  planet: string;
  planetLit: string;
  land: string;
  cloudsOnPlanet: string;
  halo: string;
  moon: string;
  moonShade: string;
  terraces: { fill: string; lip: string }[];
  sand: string;
  sandLip: string;
  pebble: string;
  bush: string;
  canal: string;
  canalShine: string;
  path: string;
  house: string;
  roof: string;
  window: string;
  leaf: string;
  leafShine: string;
  pine: string;
  cloud: string;
  cloudBelly: string;
}

const DAWN: Paints = {
  sky: [ELYSIUM.trench, ELYSIUM.teal, ELYSIUM.spray, ELYSIUM.mist],
  star: ELYSIUM.cream,
  arch: ELYSIUM.current,
  archBand: ELYSIUM.reef,
  archLights: ELYSIUM.sun,
  spoke: ELYSIUM.reef,
  spokeLit: ELYSIUM.current,
  planet: SHADE.teal,
  planetLit: ELYSIUM.teal,
  land: ELYSIUM.up,
  cloudsOnPlanet: ELYSIUM.mist,
  halo: ELYSIUM.spray,
  moon: ELYSIUM.cream,
  moonShade: SHADE.cream,
  terraces: [
    { fill: ELYSIUM.meadow, lip: SHADE.meadow },
    { fill: ELYSIUM.clover, lip: SHADE.clover },
    { fill: ELYSIUM.verdant, lip: SHADE.verdant },
    { fill: ELYSIUM.forest, lip: SHADE.forest },
  ],
  sand: ELYSIUM.sand,
  sandLip: ELYSIUM.sand2,
  pebble: ELYSIUM.sand2,
  bush: ELYSIUM.pine,
  canal: ELYSIUM.spray,
  canalShine: ELYSIUM.mist,
  path: ELYSIUM.cream,
  house: ELYSIUM.cream,
  roof: ELYSIUM.coral,
  window: ELYSIUM.sun,
  leaf: ELYSIUM.forest,
  leafShine: ELYSIUM.clover,
  pine: ELYSIUM.pine,
  cloud: ELYSIUM.white,
  cloudBelly: ELYSIUM.mist,
};

const NIGHT: Paints = {
  sky: [ELYSIUM.abyss, ELYSIUM.deep, ELYSIUM.trench, ELYSIUM.reef],
  star: ELYSIUM.cream,
  arch: ELYSIUM.reef,
  archBand: ELYSIUM.trench,
  archLights: ELYSIUM.sun,
  spoke: ELYSIUM.trench,
  spokeLit: ELYSIUM.reef,
  planet: SHADE.teal,
  planetLit: ELYSIUM.teal,
  land: ELYSIUM.up,
  cloudsOnPlanet: ELYSIUM.foam,
  halo: ELYSIUM.cyan,
  moon: ELYSIUM.cream,
  moonShade: SHADE.cream,
  terraces: [
    { fill: '#3F6E5E', lip: '#355F51' },
    { fill: '#335F51', lip: '#2A5245' },
    { fill: '#28503F', lip: '#204535' },
    { fill: '#1F4234', lip: '#18372B' },
  ],
  sand: ELYSIUM.reef,
  sandLip: ELYSIUM.trench,
  pebble: ELYSIUM.current,
  bush: '#173229',
  canal: ELYSIUM.cyan,
  canalShine: ELYSIUM.foam,
  path: ELYSIUM.sun,
  house: '#C9BFA6',
  roof: SHADE.coral,
  window: ELYSIUM.sun,
  leaf: '#24503B',
  leafShine: '#3F7A5A',
  pine: '#1B4130',
  cloud: '#2F6577',
  cloudBelly: '#24515F',
};

/** Terrace bands: top edge y at the sides (yEdge) and the dip in the middle (yMid). */
const BANDS = [
  { y: 300, mid: 760, dash: '140 70 50 120 90 60', off: 0, lipW: 10 },
  { y: 372, mid: 840, dash: '60 40 120 90 30 160', off: 37, lipW: 12 },
  { y: 452, mid: 930, dash: '140 70 50 120 90 60', off: 74, lipW: 14 },
  { y: 548, mid: 1030, dash: '60 40 120 90 30 160', off: 111, lipW: 16 },
];

type PropKind = 'house' | 'tree' | 'pine';
/** [kind, x, y] placed on the terrace tops (front to back order does not matter: they are small). */
const PROPS: [PropKind, number, number][] = [
  ['house', 560, 503], ['tree', 600, 510], ['tree', 880, 508], ['house', 840, 504],
  ['pine', 300, 420], ['pine', 318, 428], ['tree', 1160, 436],
  ['tree', 140, 460], ['house', 190, 482], ['tree', 236, 498],
  ['house', 1236, 490], ['tree', 1290, 466], ['pine', 1196, 506],
  ['pine', 70, 500], ['pine', 96, 512], ['tree', 440, 634], ['house', 1010, 638], ['tree', 1052, 632], ['pine', 1380, 498],
  ['tree', 300, 704], ['tree', 326, 712], ['pine', 352, 722],
  ['tree', 470, 640], ['pine', 496, 648], ['tree', 930, 650], ['tree', 960, 646],
  ['pine', 680, 520], ['tree', 700, 524], ['house', 740, 528], ['house', 770, 528],
  ['tree', 400, 560], ['house', 370, 552], ['tree', 1090, 556], ['pine', 1120, 548], ['tree', 1180, 684], ['house', 1230, 664], ['tree', 40, 590],
];

const STARS: [number, number, number][] = [
  [700, 60, 1], [910, 120, 0.8], [1180, 48, 1], [640, 170, 0.8], [1330, 160, 1], [820, 200, 0.7], [520, 90, 0.7], [260, 70, 0.9], [120, 150, 0.7], [400, 200, 0.6],
];
const DOTS: [number, number, number][] = [
  [760, 110, 2.2], [1040, 70, 2], [1260, 110, 2.4], [980, 190, 1.8], [1400, 80, 2], [180, 40, 1.8], [330, 120, 2], [590, 30, 1.6], [60, 90, 2], [470, 150, 1.6],
];

/** A house, lollipop tree or pine at the origin (base centre), ink-outlined. */
function Prop({ kind, p }: { kind: PropKind; p: Paints }): ReactElement {
  const ink = ELYSIUM.abyss;
  if (kind === 'house') {
    return (
      <g>
        <path d="M-12 0 V-16 L0 -27 L12 -16 V0 Z" fill={p.house} stroke={ink} strokeWidth={2.5} strokeLinejoin="round" />
        <path d="M-15 -14 L0 -29 L15 -14 L12 -16 L0 -27 L-12 -16Z" fill={p.roof} />
        <path d="M-15 -14 L0 -29 L15 -14" fill="none" stroke={ink} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        <rect className="kb-ring__window" x={-4} y={-11} width={8} height={8} rx={1.5} fill={p.window} stroke={ink} strokeWidth={2} />
      </g>
    );
  }
  if (kind === 'tree') {
    return (
      <g>
        <path d="M0 0 V-14" stroke={ink} strokeWidth={3} strokeLinecap="round" />
        <circle cx={0} cy={-24} r={12} fill={p.leaf} stroke={ink} strokeWidth={2.5} />
        <path d="M-5 -30 a8 8 0 0 1 8 -3" stroke={p.leafShine} strokeWidth={3} fill="none" strokeLinecap="round" />
      </g>
    );
  }
  return (
    <g>
      <path d="M0 0 V-8" stroke={ink} strokeWidth={3} strokeLinecap="round" />
      <path d="M0 -40 L11 -8 H-11 Z" fill={p.pine} stroke={ink} strokeWidth={2.5} strokeLinejoin="round" />
      <path d="M-2 -32 L-6 -16" stroke={p.leafShine} strokeWidth={2.5} strokeLinecap="round" opacity={0.8} />
    </g>
  );
}

/** A stand-alone scene prop (house / tree / pine) for decorating screens. */
export function SceneProp({ kind, time = 'dawn', size = 40, className, style }: { kind: PropKind; time?: RingTime; size?: number; className?: string; style?: CSSProperties }): ReactElement {
  return (
    <svg className={className} style={style} viewBox="-18 -44 36 48" width={size * 0.75} height={size} aria-hidden="true" focusable="false" overflow="visible">
      <Prop kind={kind} p={time === 'night' ? NIGHT : DAWN} />
    </svg>
  );
}

export function RingScene({
  time = 'dawn',
  variant = 'full',
  clouds = true,
  animate = true,
  wobble = true,
  preserveAspectRatio = 'xMidYMax slice',
  className,
  style,
  children,
}: RingSceneProps): ReactElement {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [ref, visible] = useOffscreenPause<HTMLDivElement>();
  const p = time === 'night' ? NIGHT : DAWN;
  const ink = ELYSIUM.abyss;
  const arch = 'M-60 520 C 180 40, 1260 40, 1500 520';
  const wob = wobble ? `url(#${WOBBLE})` : undefined;
  const showSky = variant !== 'horizon';

  return (
    <div
      ref={ref}
      className={`kb-ring kb-ring--${variant} kb-ring--${time}${animate ? ' is-animated' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      data-paused={!visible || undefined}
    >
      <svg className="kb-ring__art" viewBox={VIEW[variant]} preserveAspectRatio={preserveAspectRatio} aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={p.sky[0]} />
            <stop offset=".34" stopColor={p.sky[1]} />
            <stop offset=".62" stopColor={p.sky[2]} />
            <stop offset=".8" stopColor={p.sky[3]} />
          </linearGradient>
          <clipPath id={`${id}planet`}>
            <circle cx={1010} cy={600} r={250} />
          </clipPath>
          <clipPath id={`${id}moon`}>
            <circle cx={1238} cy={288} r={20} />
          </clipPath>
          <g id={`${id}cloud`}>
            <g stroke={ink} strokeWidth={6} fill={ink}>
              <circle cx={40} cy={40} r={28} />
              <circle cx={80} cy={26} r={36} />
              <circle cx={124} cy={38} r={30} />
              <circle cx={154} cy={52} r={20} />
              <rect x={18} y={44} width={150} height={26} rx={13} />
            </g>
            <g fill={p.cloud}>
              <circle cx={40} cy={40} r={28} />
              <circle cx={80} cy={26} r={36} />
              <circle cx={124} cy={38} r={30} />
              <circle cx={154} cy={52} r={20} />
              <rect x={18} y={44} width={150} height={26} rx={13} />
            </g>
            <path fill={p.cloudBelly} d="M18 58 H168 V57 a13 13 0 0 1 -13 13 H31 a13 13 0 0 1 -13 -13z" />
            <path d="M58 22 q10 -14 26 -10" stroke={ink} strokeWidth={2.5} fill="none" strokeLinecap="round" opacity={0.35} />
          </g>
          <path id={`${id}star`} d="M0 -7 Q1 -1 7 0 Q1 1 0 7 Q-1 1 -7 0 Q-1 -1 0 -7Z" />
        </defs>

        {showSky && (
          <>
            <rect width={1440} height={880} fill={`url(#${id}sky)`} />
            <g className="kb-ring__stars" fill={p.star}>
              {STARS.map(([x, y, s], i) => (
                <use key={i} href={`#${id}star`} transform={`translate(${x} ${y}) scale(${s})`} className="kb-ring__twinkle" style={{ animationDelay: `${-i * 0.7}s` }} />
              ))}
              {DOTS.map(([x, y, r], i) => (
                <circle key={i} cx={x} cy={y} r={r} opacity={0.9} />
              ))}
              {time === 'night' &&
                DOTS.map(([x, y, r], i) => <circle key={`n${i}`} cx={(x * 1.37 + 211) % 1440} cy={y + 180 + ((i * 37) % 90)} r={r * 0.8} opacity={0.7} />)}
            </g>

            {/* the far side of the ring, arching overhead */}
            <g>
              <path d={arch} fill="none" stroke={ink} strokeWidth={58} strokeLinecap="round" />
              <path d={arch} fill="none" stroke={p.arch} strokeWidth={50} />
              <path d={arch} fill="none" stroke={p.archBand} strokeWidth={18} transform="translate(0,16)" />
              <path className="kb-ring__lights" d={arch} fill="none" stroke={p.archLights} strokeWidth={6} strokeDasharray="3 22" strokeLinecap="round" transform="translate(0,-6)" />
              <path d={arch} fill="none" stroke={ink} strokeWidth={3} transform="translate(0,28)" />
              <g stroke={ink} strokeWidth={3} fill={p.spoke} strokeLinejoin="round">
                <path d="M352 210 L376 210 L396 520 L338 520 Z" />
                <path d="M1064 210 L1088 210 L1102 520 L1046 520 Z" />
              </g>
              <g fill={p.spokeLit}>
                <rect x={356} y={212} width={6} height={300} />
                <rect x={1068} y={212} width={6} height={300} />
              </g>
            </g>

            {/* the planet through the sky band */}
            <g>
              <circle cx={1010} cy={600} r={262} fill="none" stroke={p.halo} strokeWidth={4} opacity={0.5} />
              <circle cx={1010} cy={600} r={250} fill={p.planet} />
              <g clipPath={`url(#${id}planet)`}>
                <circle cx={976} cy={566} r={250} fill={p.planetLit} />
                <path d="M850 440 q30 -26 70 -14 q22 10 46 0 q26 -8 30 14 q4 18 -28 22 q-36 4 -58 18 q-30 14 -56 0 q-26 -16 -4 -40z" fill={p.land} stroke={ink} strokeWidth={3} />
                <path d="M1090 410 q50 -12 90 18 q26 26 -6 40 q-40 16 -66 -6 q-30 -28 -18 -52z" fill={p.land} stroke={ink} strokeWidth={3} />
                <path d="M930 520 q24 -10 40 4 q8 12 -10 16 q-22 4 -30 -20z" fill={p.land} stroke={ink} strokeWidth={3} />
                <g stroke={p.cloudsOnPlanet} strokeWidth={6} fill="none" strokeLinecap="round">
                  <path d="M790 400 q60 -24 120 -12" />
                  <path d="M960 470 q50 -12 100 0 q20 6 10 16" />
                  <path d="M1000 380 q40 -10 70 4" />
                  <path d="M1150 470 q30 -6 50 6" />
                </g>
                <path d="M1260 600 A250 250 0 0 0 1060 354 A250 250 0 0 1 1260 600Z" fill={p.planet} />
              </g>
              <circle cx={1010} cy={600} r={250} fill="none" stroke={ink} strokeWidth={3} />
              <circle cx={1238} cy={288} r={20} fill={p.moonShade} />
              <circle cx={1232} cy={282} r={20} fill={p.moon} clipPath={`url(#${id}moon)`} />
              <circle cx={1233} cy={282} r={3.5} fill={p.moonShade} />
              <circle cx={1243} cy={292} r={2.5} fill={p.moonShade} />
              <circle cx={1238} cy={288} r={20} fill="none" stroke={ink} strokeWidth={3} />
            </g>

            {clouds && (
              <g className="kb-ring__clouds">
                <g className="kb-ring__drift" style={{ animationDelay: '-38s', '--x': '600px' } as CSSProperties}>
                  <use href={`#${id}cloud`} y={250} />
                </g>
                <g className="kb-ring__drift is-slow" style={{ animationDelay: '-20s', '--x': '120px' } as CSSProperties}>
                  <use href={`#${id}cloud`} y={330} transform="scale(.8)" />
                </g>
                <g className="kb-ring__drift is-slow" style={{ animationDelay: '-70s', '--x': '1180px' } as CSSProperties}>
                  <use href={`#${id}cloud`} y={190} />
                </g>
              </g>
            )}
          </>
        )}

        {/* terraces: the ground curving up both sides */}
        <g filter={wob}>
          {BANDS.map((b, i) => {
            const t = p.terraces[i];
            const top = (dy: number) => `M-40 ${b.y + dy} Q 720 ${b.mid + dy} 1480 ${b.y + dy}`;
            return (
              <g key={i}>
                <path d={`${top(0)} V 900 H -40 Z`} fill={t.fill} stroke={ink} strokeWidth={3} />
                <path d={top(16)} fill="none" stroke={t.lip} strokeWidth={b.lipW} />
                {[34, 46, 58].map((dy, j) => (
                  <path key={dy} d={top(dy)} fill="none" stroke={t.lip} strokeWidth={3} strokeLinecap="round" strokeDasharray={b.dash} strokeDashoffset={b.off + j * 6} />
                ))}
                {i === 1 && (
                  <g>
                    <path d="M590 600 Q 720 625 860 598" fill="none" stroke={ink} strokeWidth={13} strokeLinecap="round" />
                    <path d="M590 600 Q 720 625 860 598" fill="none" stroke={p.canal} strokeWidth={7} strokeLinecap="round" />
                    <path className="kb-ring__ripple" d="M640 604 h18 M760 612 h14" stroke={p.canalShine} strokeWidth={2.5} strokeLinecap="round" />
                  </g>
                )}
              </g>
            );
          })}
          <path d="M-40 680 Q 720 1010 1480 680 V 900 H -40 Z" fill={p.sand} stroke={ink} strokeWidth={3} />
          <path d="M-40 700 Q 720 1030 1480 700" fill="none" stroke={p.sandLip} strokeWidth={10} />
        </g>
        <g fill={p.pebble} stroke={ink} strokeWidth={2}>
          <ellipse cx={160} cy={808} rx={10} ry={5} />
          <ellipse cx={420} cy={852} rx={7} ry={4} />
          <ellipse cx={1180} cy={826} rx={9} ry={4.5} />
          <ellipse cx={1320} cy={790} rx={6} ry={3} />
          <ellipse cx={640} cy={872} rx={8} ry={4} />
        </g>
        <g fill={p.bush} stroke={ink} strokeWidth={2.5}>
          {[
            [150, 482],
            [560, 668],
            [1250, 560],
            [860, 728],
          ].map(([x, y]) => (
            <path key={`${x}`} d={`M${x} ${y} a9 9 0 0 1 16 -6 a9 9 0 0 1 16 4 a7 7 0 0 1 -2 10 h-28 a6 6 0 0 1 -2 -8z`} />
          ))}
        </g>
        <path
          d="M1100 700 L1130 640 L1100 600 L1135 560 L1110 520"
          fill="none"
          stroke={p.path}
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="1 9"
          filter={wob}
        />
        <g>
          {PROPS.map(([kind, x, y], i) => (
            <g key={i} transform={`translate(${x} ${y})`}>
              <Prop kind={kind} p={p} />
            </g>
          ))}
        </g>
      </svg>
      {children != null && <div className="kb-ring__over">{children}</div>}
    </div>
  );
}
