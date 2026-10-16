/** Risograph inks of the "Paper Ticket" design system. */
export const RISO = {
  fluoPink: '#FF4F87',
  teal: '#0E9C9A',
  mustard: '#F2B705',
  blue: '#3B5BDB',
  green: '#1F9D61',
  orange: '#FF7A3D',
  purple: '#7B4FD6',
  red: '#E5402B',
  aqua: '#3CC6E0',
  lilac: '#B49CF0',
  mint: '#5FD3A6',
  brown: '#8C5A3C',
} as const;

export type RisoInk = keyof typeof RISO;

/** Dark ink used for outlines and faces. */
export const INK = '#1E1B2E';

/** Card paper (lighter than the page paper); used for highlights / knock-outs. */
export const CARD_PAPER = '#FFFCF4';
