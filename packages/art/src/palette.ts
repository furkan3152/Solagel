/**
 * The "Ring Storybook" paints (spec §6.3). The values live in `@elymum/shared`
 * (one source for the art, the arena inks and the web app). `RISO` is the
 * deprecated alias set (old names mapped onto Storybook paints).
 */
import { ELYSIUM, SHADE } from '@elymum/shared';

export { CARD_PAPER, COIN_PAINTS, ELYSIUM, INK, INK_2, NIGHT, PAPER, RISO, SHADE, TEXT_INKS, type ElysiumPaint, type RisoInk } from '@elymum/shared';

const shadeByHex = new Map<string, string>();
for (const [k, v] of Object.entries(ELYSIUM)) if (!shadeByHex.has(v)) shadeByHex.set(v, SHADE[k as keyof typeof SHADE]);

/**
 * The one hard shadow tone of a fill: the palette's `SHADE` for a Storybook
 * paint, otherwise the colour darkened by about a quarter (cached).
 */
export function shadeOf(fill: string): string {
  const key = fill.toUpperCase();
  let s = shadeByHex.get(key);
  if (!s) {
    const m = /^#([0-9A-F]{6})$/.exec(key);
    if (!m) return fill;
    const n = parseInt(m[1], 16);
    const ch = (v: number) => Math.round(v * 0.74).toString(16).padStart(2, '0');
    s = `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`.toUpperCase();
    shadeByHex.set(key, s);
  }
  return s;
}
