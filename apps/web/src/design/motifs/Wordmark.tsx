import { ELYSIUM, SHADE } from '@elymum/shared';
import type { CSSProperties, ReactElement } from 'react';

/**
 * The ELYMUM letters, hand-built (no font): each letter is a single skeleton
 * path drawn with a fat round brush. Layers per letter, bottom to top: the
 * hard offset shadow, the ink outline (brush + 6), the shade paint, the lit
 * paint pushed up-left (so the shade shows as a rim on the lower right), a
 * shine dab. Letters sit a little off the baseline and off true, like
 * stickers pressed down by hand.
 */
const LETTERS: { d: string; x: number; rot: number; dy: number; shine?: string }[] = [
  // E
  { d: 'M58 18 H16 V94 H58 M16 56 H50', x: 0, rot: -4, dy: 1, shine: 'M8 34 v12' },
  // L
  { d: 'M16 18 V94 H56', x: 76, rot: 2.5, dy: 4, shine: 'M8 32 v14' },
  // Y
  { d: 'M12 18 L38 56 L64 18 M38 56 V94', x: 140, rot: -2, dy: -2, shine: 'M7 24 l5 7' },
  // M
  { d: 'M16 94 V18 L44 58 L72 18 V94', x: 216, rot: 3, dy: 2, shine: 'M8 36 v12' },
  // U
  { d: 'M16 18 V62 C16 100 70 100 70 62 V18', x: 304, rot: -2.5, dy: -1, shine: 'M8 30 v12' },
  // M
  { d: 'M16 94 V18 L44 58 L72 18 V94', x: 386, rot: 2, dy: 3, shine: 'M8 36 v12' },
];

const BRUSH = 24;
const EDGE = 6;
const SHADOW = 5;

export type WordmarkPaint = 'cyan' | 'sun' | 'cream' | 'foam';

export interface WordmarkProps {
  /** Rendered height in px; width follows (about 4.3 × height). Default 96. */
  height?: number;
  /** Letter paint (default cyan). */
  paint?: WordmarkPaint;
  /** Accessible name (default "Elymum"). */
  title?: string;
  /** Letters hop one after another on hover (and once on mount). Ignored with `diecut`. */
  playful?: boolean;
  /**
   * Cut out like a sticker: a cream border with its own ink edge and shadow
   * around the whole word. Use it when the wordmark sits straight on the night
   * page or on a photo, where the ink outline alone would disappear.
   */
  diecut?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** The hand-built ELYMUM wordmark (spec §6.4): chunky cyan letters, ink stroke, hard offset shadow. */
export function Wordmark({ height = 96, paint = 'cyan', title = 'Elymum', playful = true, diecut = false, className, style }: WordmarkProps): ReactElement {
  const lit = ELYSIUM[paint];
  const shade = SHADE[paint];
  const ink = ELYSIUM.abyss;
  const pad = diecut ? 13 : 0;
  const vbW = 486 + pad * 2;
  const vbH = 128 + pad * 2;
  const hop = playful && !diecut;
  const place = (l: (typeof LETTERS)[number], children: ReactElement) => (
    <g transform={`translate(${l.x} ${l.dy}) rotate(${l.rot} 40 56)`}>{children}</g>
  );
  const HALO = BRUSH + EDGE + 26;
  return (
    <svg
      className={`kb-wordmark${hop ? ' kb-wordmark--playful' : ''}${className ? ` ${className}` : ''}`}
      viewBox={`${-6 - pad} ${-4 - pad} ${vbW} ${vbH}`}
      height={height}
      width={(height * vbW) / vbH}
      role="img"
      aria-label={title}
      style={style}
      focusable="false"
    >
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {diecut && (
          <g>
            {LETTERS.map((l, i) => (
              <g key={`s${i}`}>{place(l, <path d={l.d} stroke={ink} strokeWidth={HALO + 6} transform="translate(6 6)" />)}</g>
            ))}
            {LETTERS.map((l, i) => (
              <g key={`o${i}`}>{place(l, <path d={l.d} stroke={ink} strokeWidth={HALO + 6} />)}</g>
            ))}
            {LETTERS.map((l, i) => (
              <g key={`c${i}`}>{place(l, <path d={l.d} stroke={ELYSIUM.cream} strokeWidth={HALO} />)}</g>
            ))}
          </g>
        )}
        {LETTERS.map((l, i) => (
          <g key={i} transform={`translate(${l.x} ${l.dy})`}>
            <g className="kb-wordmark__letter" style={{ transformOrigin: '40px 56px', animationDelay: `${i * 70}ms` } as CSSProperties}>
              <g transform={`rotate(${l.rot} 40 56)`}>
                <path d={l.d} stroke={ink} strokeWidth={BRUSH + EDGE} transform={`translate(${SHADOW} ${SHADOW})`} />
                <path d={l.d} stroke={ink} strokeWidth={BRUSH + EDGE} />
                <path d={l.d} stroke={shade} strokeWidth={BRUSH} />
                <path d={l.d} stroke={lit} strokeWidth={BRUSH - 5} transform="translate(-1.6 -1.8)" />
                {l.shine && <path d={l.shine} stroke={ELYSIUM.mist} strokeWidth={4.5} transform="translate(5 0)" />}
              </g>
            </g>
          </g>
        ))}
      </g>
    </svg>
  );
}

export interface CoinMarkProps {
  /** Rendered size in px (default 48). */
  size?: number;
  /** Coin paint (default cyan). */
  paint?: 'cyan' | 'sun' | 'teal';
  /** Accessible name; omit when a visible "Elymum" sits next to it. */
  title?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * The compact mark: a coin with a fat cream E pressed into it, ink outline and
 * one hard shade. Used for the favicon, the nav and small brand spots.
 */
export function CoinMark({ size = 48, paint = 'cyan', title, className, style }: CoinMarkProps): ReactElement {
  const ink = ELYSIUM.abyss;
  const e = 'M15 -22 H-12 V22 H15 M-12 0 H10';
  return (
    <svg
      className={`kb-coinmark${className ? ` ${className}` : ''}`}
      viewBox="-56 -56 116 116"
      width={size}
      height={size}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <circle cx={4} cy={4} r={47} fill={ink} />
      <circle r={46} fill={SHADE[paint]} />
      <clipPath id="kb-coinmark-clip">
        <circle r={46} />
      </clipPath>
      <circle cx={-5} cy={-7} r={45} fill={ELYSIUM[paint]} clipPath="url(#kb-coinmark-clip)" />
      <circle r={36} fill="none" stroke={SHADE[paint]} strokeWidth={3} />
      <path d="M-36 -10 A37 37 0 0 1 -18 -32" stroke="#FFFFFF" strokeWidth={5} fill="none" strokeLinecap="round" opacity={0.85} />
      <circle r={46} fill="none" stroke={ink} strokeWidth={5} />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d={e} stroke={ink} strokeWidth={22} transform="translate(3 3)" />
        <path d={e} stroke={ink} strokeWidth={22} />
        <path d={e} stroke={ELYSIUM.cream} strokeWidth={14} />
      </g>
    </svg>
  );
}
