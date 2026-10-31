import { ELYSIUM, SHADE } from '@elymum/shared';
import { useId, type ReactElement, type SVGProps } from 'react';
import type { CoinPaint } from './CoinCharacter';

export type SceneCoinMood = 'smile' | 'happy' | 'scared' | 'chomp' | 'sleepy' | 'worried' | 'wink';

export interface SceneCoinProps extends Omit<SVGProps<SVGGElement>, 'mood' | 'stroke'> {
  /** Centre in the parent SVG's units. */
  x?: number;
  y?: number;
  /** Coin radius in the parent SVG's units. */
  r?: number;
  paint?: CoinPaint | 'bot';
  mood?: SceneCoinMood;
  /** Pupil offset (coin units, about -4..4). */
  look?: [number, number];
  /** Stubby feet under the coin. */
  feet?: boolean;
  /** A builder's hard hat (the workshop foreman). */
  hat?: boolean;
  /** A little antenna: a bot (worth 0). */
  antenna?: boolean;
  /** Outline width in the parent's units (default 2.4). */
  stroke?: number;
  /** Blink loop on open eyes (uses the shared `.kb-coin__blink` loop). */
  blink?: boolean;
}

const INK = ELYSIUM.abyss;

/**
 * A coin character drawn as an SVG `<g>`, to live inside a bigger illustration (a scene, a
 * comic panel): the same picture-book coin as `CoinCharacter` (flat paint, one hard shade,
 * rim, shine, blush, big eyes) at a steady outline width in the parent's units. Extra props
 * for scenes: a hard hat (the workshop foreman), an antenna (a bot), a worried face.
 */
export function SceneCoin({
  x = 0,
  y = 0,
  r = 20,
  paint = 'cyan',
  mood = 'smile',
  look = [0, 0],
  feet = false,
  hat = false,
  antenna = false,
  stroke = 2.4,
  blink = false,
  className,
  ...rest
}: SceneCoinProps): ReactElement {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const k = r / 46;
  const W = stroke / k;
  const isBot = paint === 'bot';
  const c = isBot ? ELYSIUM.sand2 : ELYSIUM[paint];
  const s = isBot ? ELYSIUM.stone : SHADE[paint];
  const [lx, ly] = look;
  const eye = (ex: number, i: number) => {
    if (mood === 'happy' || (mood === 'wink' && i === 1)) return <path d={`M${ex - 8} -4 Q${ex} -15 ${ex + 8} -4`} fill="none" stroke={INK} strokeWidth={W} strokeLinecap="round" />;
    if (mood === 'sleepy') return <path d={`M${ex - 9} -6 Q${ex} 2 ${ex + 9} -6`} fill="none" stroke={INK} strokeWidth={W} strokeLinecap="round" />;
    return (
      <g className={blink ? 'kb-coin__blink' : undefined}>
        <ellipse cx={ex} cy={-6} rx={10} ry={12.5} fill="#FFFFFF" stroke={INK} strokeWidth={W * 0.85} />
        <circle cx={ex + lx} cy={-5 + ly} r={mood === 'scared' || mood === 'worried' ? 3.8 : 6} fill={INK} />
        <circle cx={ex + lx - 2.2} cy={-8 + ly} r={2.1} fill="#FFFFFF" />
      </g>
    );
  };
  let mouth: ReactElement;
  switch (mood) {
    case 'happy':
    case 'wink':
      mouth = (
        <g>
          <path d="M-11 11 Q0 13 11 11 Q10 27 0 27 Q-10 27 -11 11Z" fill={INK} stroke={INK} strokeWidth={W} strokeLinejoin="round" />
          <path d="M-6 23 Q0 18 6 23 Q3 26 0 26 Q-3 26 -6 23Z" fill={ELYSIUM.blush} />
        </g>
      );
      break;
    case 'scared':
      mouth = <path d="M-8 18 q4 -5 8 0 t8 0" fill="none" stroke={INK} strokeWidth={W} strokeLinecap="round" />;
      break;
    case 'worried':
      mouth = <path d="M-8 19 Q0 12 8 19" fill="none" stroke={INK} strokeWidth={W} strokeLinecap="round" />;
      break;
    case 'chomp':
      mouth = (
        <g>
          <path d="M-20 8 Q0 4 20 8 Q20 38 0 38 Q-20 38 -20 8Z" fill={INK} stroke={INK} strokeWidth={W} strokeLinejoin="round" />
          <path d="M-14 9 l4 6 l4 -6 M6 9 l4 6 l4 -6" fill="#FFFFFF" />
        </g>
      );
      break;
    case 'sleepy':
      mouth = <ellipse cx={2} cy={17} rx={4} ry={3.2} fill={INK} />;
      break;
    default:
      mouth = <path d="M-9 13 Q0 22 9 13" fill="none" stroke={INK} strokeWidth={W} strokeLinecap="round" />;
  }
  const brows =
    mood === 'scared' || mood === 'worried' ? (
      <path d="M-24 -23 L-9 -27 M24 -23 L9 -27" stroke={INK} strokeWidth={W} strokeLinecap="round" />
    ) : mood === 'chomp' ? (
      <path d="M-25 -25 L-8 -19 M25 -25 L8 -19" stroke={INK} strokeWidth={W} strokeLinecap="round" />
    ) : null;
  return (
    <g {...rest} className={className} transform={`translate(${x} ${y}) scale(${k})`}>
      <defs>
        <clipPath id={`${uid}c`}>
          <circle r={46} />
        </clipPath>
      </defs>
      {feet && (
        <g stroke={INK} strokeWidth={W} fill={s} strokeLinejoin="round">
          <path d="M-30 52 Q-30 40 -18 40 Q-6 40 -6 52 Z" />
          <path d="M6 52 Q6 40 18 40 Q30 40 30 52 Z" />
        </g>
      )}
      {antenna && (
        <g stroke={INK} strokeWidth={W} strokeLinecap="round">
          <path d="M0 -46 V-62" />
          <circle cy={-66} r={6} fill={ELYSIUM.down} />
        </g>
      )}
      <circle r={46} fill={s} />
      <g clipPath={`url(#${uid}c)`}>
        <circle cx={-6} cy={-8} r={46} fill={c} />
      </g>
      <circle r={37.5} fill="none" stroke={s} strokeWidth={2.5} opacity={0.9} />
      <path d="M-36 -10 A37 37 0 0 1 -18 -32" stroke="#FFFFFF" strokeWidth={5} fill="none" strokeLinecap="round" opacity={0.85} />
      <circle r={46} fill="none" stroke={INK} strokeWidth={W} />
      <ellipse cx={-27} cy={9} rx={6} ry={3.6} fill={ELYSIUM.blush} opacity={0.75} />
      <ellipse cx={27} cy={9} rx={6} ry={3.6} fill={ELYSIUM.blush} opacity={0.75} />
      {brows}
      {eye(-15, 0)}
      {eye(15, 1)}
      {mouth}
      {hat && (
        <g stroke={INK} strokeWidth={W} strokeLinejoin="round">
          <path d="M-40 -30 Q-38 -66 0 -68 Q38 -66 40 -30 Z" fill={ELYSIUM.sun} />
          <path d="M-8 -67 Q0 -70 8 -67 L6 -34 L-6 -34 Z" fill={SHADE.sun} />
          <path d="M-52 -30 H52 Q54 -22 46 -22 H-46 Q-54 -22 -52 -30 Z" fill={ELYSIUM.sun} />
          <path d="M-30 -52 Q-26 -60 -18 -63" fill="none" stroke="#FFFFFF" strokeWidth={W * 1.1} strokeLinecap="round" opacity={0.8} />
        </g>
      )}
    </g>
  );
}
