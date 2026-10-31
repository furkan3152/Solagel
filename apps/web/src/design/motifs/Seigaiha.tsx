import type { CSSProperties, ReactElement } from 'react';

export interface SeigaihaProps {
  /** Rows of scales (default 4). */
  rows?: number;
  /** Outer radius of one scale in viewBox units (default 40). */
  r?: number;
  /** Width the pattern is drawn across (viewBox units, default 1440). It is sliced to fit. */
  span?: number;
  /**
   * `night` reef lines on the night page (the mint band), `day` sand lines on
   * the plain, `ink` outlined ink scales for stickers / card backs.
   */
  tone?: 'night' | 'day' | 'ink';
  /** Fill each scale with the page colour so rows overlap like real seigaiha (default true). */
  filled?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Seigaiha: stacked rows of half-circle wave scales (three rings each), drawn
 * back to front so every row tucks under the next. Used as section seams,
 * the bottom band of night sections and card backs. Decorative.
 */
export function Seigaiha({ rows = 4, r = 40, span = 1440, tone = 'night', filled = true, className, style }: SeigaihaProps): ReactElement {
  const step = r * 2;
  const rowH = r * 0.85;
  const h = rows * rowH + r * 0.2;
  const paths: ReactElement[] = [];
  for (let row = 0; row < rows; row++) {
    const y = r + row * rowH;
    const off = (row % 2) * r;
    for (let x = -step + off; x < span + step; x += step) {
      const k = `${row}:${x}`;
      paths.push(
        <g key={k}>
          {filled && <path className="kb-seigaiha__fill" d={`M${x - r} ${y} A${r} ${r} 0 0 1 ${x + r} ${y} Z`} />}
          <path d={`M${x - r} ${y} A${r} ${r} 0 0 1 ${x + r} ${y}`} />
          <path d={`M${x - r * 0.68} ${y} A${r * 0.68} ${r * 0.68} 0 0 1 ${x + r * 0.68} ${y}`} />
          <path d={`M${x - r * 0.36} ${y} A${r * 0.36} ${r * 0.36} 0 0 1 ${x + r * 0.36} ${y}`} />
        </g>,
      );
    }
  }
  return (
    <svg
      className={`kb-seigaiha kb-seigaiha--${tone}${className ? ` ${className}` : ''}`}
      viewBox={`0 0 ${span} ${h}`}
      preserveAspectRatio="xMidYMax slice"
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <g fill="none" strokeWidth={3} strokeLinecap="round">
        {paths}
      </g>
    </svg>
  );
}
