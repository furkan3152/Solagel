import { ELYSIUM, SHADE } from '@elymum/shared';
import { useId, type CSSProperties, type ReactElement } from 'react';

/** Body paints a coin can wear (fill + its one hard shade). */
export type CoinPaint = 'cyan' | 'sun' | 'teal' | 'up' | 'foam' | 'cream' | 'coral' | 'spray' | 'blush';
export type CoinMood = 'smile' | 'happy' | 'smug' | 'scared' | 'chomp' | 'sleepy' | 'open';

export interface CoinCharacterProps {
  paint?: CoinPaint;
  mood?: CoinMood;
  /** Rendered width in px (the coin is 82% of it; feet and shadow use the rest). Default 112. */
  size?: number;
  /** Pupil offset in coin units (about -4..4 each): where the coin is looking. */
  look?: [number, number];
  /** Little stubby feet (site pages). Off for tokens, emblems and the arena. */
  feet?: boolean;
  /** A soft ground shadow under the coin. */
  ground?: boolean;
  /** A sweat drop (scared coins). */
  sweat?: boolean;
  /** Idle bob (2.6 s). Stops under reduced motion and while paused. */
  bob?: boolean;
  /** Blinks every 5 s (eyes that are open). Default true. */
  blink?: boolean;
  /** Animation offset in seconds so a crowd does not move in step. */
  phase?: number;
  /** `chomp` only: the jaw keeps working (open/shut loop). Default true. */
  chewing?: boolean;
  /** Accessible name. Omit for decoration (aria-hidden). */
  title?: string;
  className?: string;
  style?: CSSProperties;
}

const INK = ELYSIUM.abyss;

/**
 * An Elymum coin with a face (spec §6.5): flat paint, one hard shade on the
 * lower right, a rim, a shine, ink outline at a steady ~3 px whatever the size,
 * big eyes, blush cheeks. Moods: smile, happy, smug, scared, chomp, sleepy,
 * open. Pure SVG + CSS (storybook.css `.kb-coin`), safe on any page.
 * The in-game canvas renderer draws its own coins; this one is for the site.
 */
export function CoinCharacter({
  paint = 'cyan',
  mood = 'smile',
  size = 112,
  look = [0, 0],
  feet = false,
  ground = false,
  sweat = false,
  bob = false,
  blink = true,
  phase = 0,
  chewing = true,
  title,
  className,
  style,
}: CoinCharacterProps): ReactElement {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const c = ELYSIUM[paint];
  const s = SHADE[paint];
  // stroke widths in coin units so they render at ~3 px / ~2.6 px
  const W = Math.min((3 * 112) / size, 6.2);
  const Wf = Math.min((2.6 * 112) / size, 5);
  const [lx, ly] = look;
  const delay = { animationDelay: `${-phase}s` } as CSSProperties;
  const blinkDelay = { animationDelay: `${(phase * 1.7) % 5}s` } as CSSProperties;

  const eye = (x: number) => {
    if (mood === 'happy') {
      return <path d={`M${x - 8} -4 Q${x} -15 ${x + 8} -4`} fill="none" stroke={INK} strokeWidth={W} strokeLinecap="round" />;
    }
    if (mood === 'sleepy') {
      return (
        <g>
          <path d={`M${x - 9} -6 Q${x} 2 ${x + 9} -6`} fill="none" stroke={INK} strokeWidth={W} strokeLinecap="round" />
          <path d={`M${x - 7} 0 l-2 3 M${x} 2 v3 M${x + 7} 0 l2 3`} stroke={INK} strokeWidth={W * 0.55} strokeLinecap="round" />
        </g>
      );
    }
    return (
      <g className={blink ? 'kb-coin__blink' : undefined} style={blinkDelay}>
        <ellipse cx={x} cy={-6} rx={10} ry={12.5} fill="#FFFFFF" stroke={INK} strokeWidth={Wf} />
        <circle cx={x + lx} cy={-5 + ly} r={mood === 'scared' ? 3.6 : 6} fill={INK} />
        <circle cx={x + lx - 2.2} cy={-8 + ly} r={2.1} fill="#FFFFFF" />
        {mood === 'smug' && (
          <path d={`M${x - 11.5} -6 L${x + 11.5} -6 A11 13 0 0 0 ${x - 11.5} -6Z`} fill={c} stroke={INK} strokeWidth={W} strokeLinejoin="round" />
        )}
      </g>
    );
  };

  const smile = <path d="M-9 13 Q0 22 9 13" fill="none" stroke={INK} strokeWidth={W} strokeLinecap="round" />;
  const open = (
    <g>
      <path d="M-11 11 Q0 13 11 11 Q10 27 0 27 Q-10 27 -11 11Z" fill={INK} stroke={INK} strokeWidth={W} strokeLinejoin="round" />
      <path d="M-6 23 Q0 18 6 23 Q3 26 0 26 Q-3 26 -6 23Z" fill={ELYSIUM.blush} />
    </g>
  );
  const chompOpen = (
    <g>
      <path d="M-20 8 Q0 4 20 8 Q20 38 0 38 Q-20 38 -20 8Z" fill={INK} stroke={INK} strokeWidth={W} strokeLinejoin="round" />
      <path d="M-14 9 l4 6 l4 -6 M6 9 l4 6 l4 -6" fill="#FFFFFF" />
      <path d="M-10 32 Q0 25 10 32 Q5 36 0 36 Q-5 36 -10 32Z" fill={ELYSIUM.blush} />
    </g>
  );
  const chompShut = (
    <g>
      <path d="M-15 13 Q0 24 15 13" fill="none" stroke={INK} strokeWidth={W} strokeLinecap="round" />
      <path d="M-6 17 l3 4 l3 -3.4 l3 3.4 l3 -4" fill="#FFFFFF" stroke={INK} strokeWidth={W * 0.6} strokeLinejoin="round" />
    </g>
  );

  let mouth: ReactElement;
  switch (mood) {
    case 'smug':
      mouth = <path d="M-6 15 Q4 19 12 11" fill="none" stroke={INK} strokeWidth={W} strokeLinecap="round" />;
      break;
    case 'happy':
    case 'open':
      mouth = open;
      break;
    case 'scared':
      mouth = <path d="M-8 18 q4 -5 8 0 t8 0" fill="none" stroke={INK} strokeWidth={W} strokeLinecap="round" />;
      break;
    case 'chomp':
      mouth = chewing ? (
        <g>
          <g className="kb-coin__jaw-open" style={delay}>
            {chompOpen}
          </g>
          <g className="kb-coin__jaw-shut" style={delay}>
            {chompShut}
          </g>
        </g>
      ) : (
        chompOpen
      );
      break;
    case 'sleepy':
      mouth = <ellipse cx={2} cy={17} rx={4} ry={3.2} fill={INK} />;
      break;
    default:
      mouth = smile;
  }

  const brows =
    mood === 'scared' ? (
      <path d="M-24 -24 L-9 -21 M24 -24 L9 -21" stroke={INK} strokeWidth={W} strokeLinecap="round" />
    ) : mood === 'smug' ? (
      <path d="M-25 -21 Q-16 -25 -7 -21 M7 -22 Q16 -27 25 -23" stroke={INK} strokeWidth={W} fill="none" strokeLinecap="round" />
    ) : mood === 'chomp' ? (
      <path d="M-25 -25 L-8 -19 M25 -25 L8 -19" stroke={INK} strokeWidth={W} strokeLinecap="round" />
    ) : null;

  const cls = `kb-coin${bob ? ' kb-coin--bob' : ''}${mood === 'chomp' && chewing ? ' kb-coin--chewing' : ''}${className ? ` ${className}` : ''}`;
  return (
    <span className={cls} style={{ width: size, ...delay, ...style }}>
      <svg
        viewBox="-56 -56 112 112"
        width={size}
        height={size}
        overflow="visible"
        role={title ? 'img' : undefined}
        aria-label={title}
        aria-hidden={title ? undefined : true}
        focusable="false"
      >
        <defs>
          <clipPath id={`${uid}c`}>
            <circle r={46} />
          </clipPath>
        </defs>
        {ground && <ellipse cx={0} cy={feet ? 53 : 50} rx={34} ry={5} fill={INK} opacity={0.18} />}
        {feet && (
          <g stroke={INK} strokeWidth={W} fill={s} strokeLinejoin="round">
            <path d="M-30 52 Q-30 42 -18 42 Q-6 42 -6 52 Z" />
            <path d="M6 52 Q6 42 18 42 Q30 42 30 52 Z" />
          </g>
        )}
        {/* body: shade disc, then the lit paint offset up-left (one hard shadow) */}
        <circle r={46} fill={s} />
        <g clipPath={`url(#${uid}c)`}>
          <circle cx={-6} cy={-8} r={46} fill={c} />
        </g>
        <circle r={37.5} fill="none" stroke={s} strokeWidth={2.5} opacity={0.9} />
        <path d="M-36 -10 A37 37 0 0 1 -18 -32" stroke="#FFFFFF" strokeWidth={5} fill="none" strokeLinecap="round" opacity={0.85} />
        <circle r={46} fill="none" stroke={INK} strokeWidth={W} />
        <ellipse cx={-27} cy={9} rx={6} ry={3.6} fill={ELYSIUM.blush} opacity={paint === 'blush' || paint === 'coral' ? 0.95 : 0.75} />
        <ellipse cx={27} cy={9} rx={6} ry={3.6} fill={ELYSIUM.blush} opacity={paint === 'blush' || paint === 'coral' ? 0.95 : 0.75} />
        {brows}
        {eye(-15)}
        {eye(15)}
        {mouth}
        {sweat && (
          <path className="kb-coin__sweat" d="M38 -30 q6 9 0 13 q-6 -4 0 -13Z" fill={ELYSIUM.mist} stroke={INK} strokeWidth={2.5} />
        )}
        {mood === 'sleepy' && (
          <g className="kb-coin__zzz" fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M40 -44 h8 l-8 9 h8" />
            <path d="M52 -60 h6 l-6 7 h6" opacity={0.7} />
          </g>
        )}
      </svg>
    </span>
  );
}
