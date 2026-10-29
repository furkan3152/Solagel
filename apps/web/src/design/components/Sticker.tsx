import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { Tape } from './Tape';

export type StickerTone = 'cream' | 'white' | 'sun' | 'mist' | 'mint' | 'linen' | 'night';

export interface StickerProps extends HTMLAttributes<HTMLDivElement> {
  /** Card stock: `cream` (default), `white`, `sun`, `mist`, `mint` (success tint), `linen`, `night` (reef card on the night page). */
  tone?: StickerTone;
  /** Tilt in degrees (stickers are never quite straight; keep it within ±2). */
  tilt?: number;
  /** Shadow offset: `sm` 3 px, `md` 4 px (default), `lg` 8 px (hero cards, panels), `none`. */
  lift?: 'none' | 'sm' | 'md' | 'lg';
  /** Inner padding: `sm` 14 px, `md` 22 px (default), `lg` 30 px, `none`. */
  pad?: 'none' | 'sm' | 'md' | 'lg';
  /** A strip of tape across the top edge. */
  tape?: boolean;
  /** Corner radius: `md` 18 px (default), `lg` 26 px. */
  round?: 'md' | 'lg';
  /** Render as another element (section, article, li...). */
  as?: 'div' | 'section' | 'article' | 'li' | 'aside' | 'header' | 'footer';
  children?: ReactNode;
}

/**
 * The die-cut sticker: the basic card of the Storybook UI. Cream stock, 3 px
 * ink edge, soft corners, a hard offset shadow, optionally a bit of tape.
 */
export const Sticker = forwardRef<HTMLDivElement, StickerProps>(function Sticker(
  { tone = 'cream', tilt = 0, lift = 'md', pad = 'md', tape = false, round = 'md', as = 'div', className, style, children, ...rest },
  ref,
) {
  const Tag = as as 'div';
  const s: CSSProperties = tilt ? { ...style, transform: `rotate(${tilt}deg)` } : (style ?? {});
  return (
    <Tag
      ref={ref}
      className={`kb-sticker kb-sticker--${tone} kb-sticker--lift-${lift} kb-sticker--pad-${pad}${round === 'lg' ? ' kb-sticker--round' : ''}${className ? ` ${className}` : ''}`}
      style={s}
      {...rest}
    >
      {tape && <Tape className="kb-sticker__tape" rotate={3} width={96} />}
      {children}
    </Tag>
  );
});
