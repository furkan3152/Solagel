/**
 * The "Paper Ticket" brand palette ("fresh riso inks on bright paper").
 *
 * Single source of truth for every colour the canvas art uses (coins, food,
 * stickers, the world) and for the arena inks. The CSS tokens in
 * `apps/web/src/design/tokens.css` repeat these values (CSS cannot import TS);
 * a web test keeps the two in step and checks every text / background pair
 * for >= 4.5:1 contrast. The list with OKLCH values is `docs/design/palette.md`.
 *
 * Hex values are upper case: `@slana/art` compares inks by string.
 */

/** Risograph inks. Fills, strokes and large type; small text uses the text-safe inks in tokens.css. */
export const RISO = {
  /** oklch(0.655 0.240 2) */
  fluoPink: '#FB2F85',
  /** oklch(0.671 0.116 189) */
  teal: '#01ACA4',
  /** "Gold": oklch(0.820 0.168 78) */
  mustard: '#FFB413',
  /** oklch(0.540 0.249 267) */
  blue: '#3055FC',
  /** oklch(0.659 0.158 155) */
  green: '#17AD65',
  /** oklch(0.710 0.192 44) */
  orange: '#FF7024',
  /** oklch(0.549 0.255 293) */
  purple: '#7F39F4',
  /** oklch(0.630 0.235 30) */
  red: '#F72E1C',
  /** oklch(0.770 0.132 214) */
  aqua: '#1AC9E7',
  /** oklch(0.729 0.161 297) */
  lilac: '#B38FFF',
  /** oklch(0.800 0.158 165) */
  mint: '#30DDA4',
  /** oklch(0.520 0.115 50) */
  brown: '#9C5223',
} as const;

export type RisoInk = keyof typeof RISO;

/** Dark ink used for outlines, faces and body text: a deep indigo black, oklch(0.225 0.051 288). */
export const INK = '#1B1732';

/** Card paper (lighter than the page paper); used for highlights / knock-outs. */
export const CARD_PAPER = '#FFFDF6';

/** Page paper (paper print), oklch(0.968 0.029 90). */
export const PAPER = '#FCF4DF';

/** Night print: stock, card and the light ink printed on it. */
export const NIGHT = {
  paper: '#19142E',
  card: '#251F3D',
  ink: '#F5EEDC',
  ink2: '#B1ACCC',
} as const;

/** Secondary ink on paper (labels, captions). */
export const INK_2 = '#5B5577';
