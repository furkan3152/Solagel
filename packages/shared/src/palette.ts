/**
 * The "Ring Storybook" palette (spec §6.3): Elysium / Kinetiq colours drawn
 * like a picture book. Every fill has ONE hard-edged shadow tone (`SHADE`),
 * every outline is `INK`.
 *
 * Single source of truth for every colour the canvas art uses (coins, food,
 * the world), the site illustrations and the arena inks. The CSS tokens in
 * `apps/web/src/design/tokens.css` repeat these values (CSS cannot import TS);
 * `apps/web/test/palette.test.ts` keeps the two in step and checks every
 * text / background pair for >= 4.5:1 contrast.
 *
 * Hex values are upper case: `@elymum/art` compares inks by string.
 */

/** The whole picture-book box of paints. Fills; small text uses the text-safe `TEXT_INKS`. */
export const ELYSIUM = {
  // night (orbit)
  /** Outline ink and the deepest night. */
  abyss: '#04181C',
  deep: '#071317',
  /** Night page. */
  trench: '#0F2A30',
  /** Night cards, raised. */
  reef: '#163B44',
  /** Night lines, the far ring. */
  current: '#1E4D5A',
  // water and light
  teal: '#2D7388',
  cyan: '#34B7DD',
  spray: '#6FCDE8',
  foam: '#93D9EE',
  mist: '#DBF2F9',
  // day (the plain)
  plain: '#F8F7F4',
  linen: '#F1EFE8',
  sand: '#EBE6DD',
  sand2: '#DDD6C7',
  stone: '#6B655A',
  /** Sticker card stock. */
  cream: '#F6EEDA',
  // signals
  sun: '#F2C14E',
  up: '#3C9A87',
  down: '#FF5252',
  // the habitat's fields (illustration only), top terrace to bottom
  meadow: '#B9D98F',
  clover: '#8CC47A',
  verdant: '#5FA36A',
  forest: '#3E8A5C',
  pine: '#2F6E4F',
  // little warm things
  /** Coin cheeks, tongues. */
  blush: '#F39B86',
  /** House roofs, the odd berry. */
  coral: '#D9714F',
  white: '#FFFFFF',
} as const;

export type ElysiumPaint = keyof typeof ELYSIUM;

/**
 * The one hard shadow tone under each fill (cel shading: no gradients). Used
 * for the shaded side of a coin, a terrace's lip, a cloud's belly.
 */
export const SHADE: Record<ElysiumPaint, string> = {
  abyss: '#000B0D',
  deep: '#020A0C',
  trench: '#071317',
  reef: '#0F2A30',
  current: '#163B44',
  teal: '#1F5566',
  cyan: '#2490B0',
  spray: '#4FAECB',
  foam: '#69B4CC',
  mist: '#B5DDEA',
  plain: '#EBE6DD',
  linen: '#DDD6C7',
  sand: '#DDD6C7',
  sand2: '#C9C0AE',
  stone: '#4A453B',
  cream: '#DCCDA8',
  sun: '#D49A2B',
  up: '#2B7465',
  down: '#C93A3A',
  meadow: '#9CC77A',
  clover: '#74B064',
  verdant: '#4C8F58',
  forest: '#2F7049',
  pine: '#24563D',
  blush: '#D97A66',
  coral: '#B4553A',
  white: '#DBF2F9',
};

/** Text-safe accent inks (>= 4.5:1), for small text on the day and night pages. */
export const TEXT_INKS = {
  day: { teal: '#2D7388', up: '#2B7465', down: '#C42F2F', sun: '#8A5F0E', cyan: '#1E6F8C' },
  night: { teal: '#93D9EE', up: '#6FD3B8', down: '#FF8A80', sun: '#F2C14E', cyan: '#6FCDE8' },
} as const;

/** The coin body paints (fill + shade), in the order the art cycles them. */
export const COIN_PAINTS = ['cyan', 'sun', 'teal', 'up', 'foam', 'cream', 'coral', 'spray'] as const satisfies readonly ElysiumPaint[];

/** Outline ink, faces and body text on day: the deep teal-black. */
export const INK = ELYSIUM.abyss;

/** Sticker card stock (cream; stays cream in both themes). */
export const CARD_PAPER = ELYSIUM.cream;

/** Day page (the plain at dawn). */
export const PAPER = ELYSIUM.plain;

/** Secondary ink on day (captions, labels). */
export const INK_2 = ELYSIUM.stone;

/** Night (in orbit): page, card and the light ink printed on it. */
export const NIGHT = {
  paper: ELYSIUM.trench,
  card: ELYSIUM.reef,
  ink: ELYSIUM.cream,
  ink2: '#BFD8DD',
} as const;

/**
 * Legacy names (the old riso inks), aliased to the nearest Storybook paint so
 * code that still says `RISO.fluoPink` keeps compiling and draws in the new
 * palette. New code uses `ELYSIUM`.
 * @deprecated use `ELYSIUM` / `SHADE`.
 */
export const RISO = {
  fluoPink: ELYSIUM.blush,
  teal: ELYSIUM.teal,
  mustard: ELYSIUM.sun,
  blue: ELYSIUM.cyan,
  green: ELYSIUM.up,
  orange: ELYSIUM.coral,
  purple: SHADE.teal,
  red: ELYSIUM.down,
  aqua: ELYSIUM.spray,
  lilac: ELYSIUM.foam,
  mint: ELYSIUM.clover,
  brown: SHADE.sun,
} as const;

/** @deprecated legacy name, see `RISO`. */
export type RisoInk = keyof typeof RISO;
