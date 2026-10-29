import type { HTMLAttributes, ReactNode } from 'react';

export interface PlateLabelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** The plate number, as a roman numeral or a number ("II" or 2). */
  numeral: string | number;
  /** The caption in Fraunces, e.g. "The mint, after dark". */
  title: ReactNode;
  /** Right-hand mono note, e.g. "/mint". */
  aside?: ReactNode;
  /** Heading level for the title (default: not a heading, a caption). */
  level?: 2 | 3;
}

const ROMAN: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
function roman(n: number): string {
  let out = '';
  for (const [v, r] of ROMAN) while (n >= v) { out += r; n -= v; }
  return out;
}

/**
 * The book-plate caption between sections: "PLATE II  The mint, after dark
 * - - - - - /MINT". Ink rule on top, dashed rule running to the aside.
 */
export function PlateLabel({ numeral, title, aside, level, className, ...rest }: PlateLabelProps) {
  const n = typeof numeral === 'number' ? roman(numeral) : numeral;
  const T = level ? (`h${level}` as const) : 'b';
  return (
    <div {...rest} className={`kb-plate${className ? ` ${className}` : ''}`}>
      <span className="kb-plate__no">Plate {n}</span>
      <T className="kb-plate__title">{title}</T>
      <span className="kb-plate__rule" aria-hidden="true" />
      {aside != null && <span className="kb-plate__aside">{aside}</span>}
    </div>
  );
}
