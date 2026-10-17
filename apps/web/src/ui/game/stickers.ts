/**
 * Emote stickers (ruling R4: no emoji in UI chrome). Each system emote is a
 * die-cut risograph sticker: a card-stock border with an ink hairline, flat
 * riso inks with a misregistered second pass (multiply) and hand-lettered
 * stroke type (no fonts: SVG used as an image cannot load web fonts).
 *
 * The same markup feeds the HUD buttons (<img src>) and the canvas renderer
 * (decoded once into an Image and drawn above the cell).
 */

import { CARD_PAPER, INK as PALETTE_INK, RISO } from '@slana/art';

const INK = PALETTE_INK;
const CARD = CARD_PAPER;
const PINK = RISO.fluoPink;
const TEAL = RISO.teal;
const MUSTARD = RISO.mustard;
const BLUE = RISO.blue;
const AQUA = RISO.aqua;
const ORANGE = RISO.orange;
const MINT = RISO.mint;
/** Pale mint stock behind the rocket. */
const MINT_PALE = '#D6F7E8';

/** Stroke letters on a 10 × 14 cell (only the ones the stickers spell). */
const GLYPHS: Record<string, { d: string; w: number }> = {
  G: { d: 'M8.6 3.2C7.4 1.3 4.6.6 2.9 2.4 1 4.4.9 9.4 2.9 11.6c1.9 2 5.2 1.6 5.9-1V8.3H5.6', w: 10 },
  M: { d: 'M1 13V1.2l4 7.2 4-7.2V13', w: 10 },
  W: { d: 'M.6 1.2 2.6 13 5 5.2 7.4 13 9.4 1.2', w: 10 },
  A: { d: 'M1 13 5 1.2 9 13M2.5 9h5', w: 10 },
  I: { d: 'M2 1.2V13', w: 4 },
};

/** Hand-lettered word centred on `cx`, cap height `h`. */
function letters(text: string, cx: number, top: number, h: number, color = INK, weight = 2.6): string {
  const s = h / 14;
  const gap = 1.6;
  const total = [...text].reduce((n, ch) => n + (GLYPHS[ch]?.w ?? 6) + gap, -gap) * s;
  let x = cx - total / 2;
  let out = '';
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (g) out += `<path d="${g.d}" transform="translate(${x.toFixed(2)} ${top}) scale(${s.toFixed(3)})" stroke-width="${(weight / s).toFixed(2)}"/>`;
    x += ((g?.w ?? 6) + gap) * s;
  }
  return `<g fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round">${out}</g>`;
}

/** Die-cut base: ink hairline, card border, then `fill`. */
function dieCut(shape: string, fill = CARD): string {
  return (
    `<g stroke-linejoin="round">` +
    `<g fill="${INK}" stroke="${INK}" stroke-width="9" opacity=".9">${shape}</g>` +
    `<g fill="${CARD}" stroke="${CARD}" stroke-width="6">${shape}</g>` +
    `<g fill="${fill}">${shape}</g>` +
    `</g>`
  );
}

/** A riso shape: the second ink peeks out from under the first (misregistration), ink outline. */
function riso(shape: string, ink: string, over: string, dx = 1.8, dy = 1.8, outline = 2): string {
  return (
    `<g transform="translate(${dx} ${dy})" fill="${over}">${shape}</g>` +
    `<g fill="${ink}">${shape}</g>` +
    `<g fill="none" stroke="${INK}" stroke-width="${outline}" stroke-linejoin="round">${shape}</g>`
  );
}

const face = (cx: number, cy: number, r: number, ink: string, over: string) => riso(`<circle cx="${cx}" cy="${cy}" r="${r}"/>`, ink, over);

const circleBase = `<circle cx="32" cy="32" r="27"/>`;

const BODIES: Record<number, string> = {
  // 0 · GM: a sun rising over a ruled horizon
  0:
    dieCut(circleBase) +
    `<g stroke="${INK}" stroke-width="2.2" stroke-linecap="round">` +
    [-60, -30, 0, 30, 60].map((a) => {
      const r0 = 14;
      const r1 = 19;
      const rad = ((a - 90) * Math.PI) / 180;
      return `<path d="M${(32 + Math.cos(rad) * r0).toFixed(1)} ${(30 + Math.sin(rad) * r0).toFixed(1)}L${(32 + Math.cos(rad) * r1).toFixed(1)} ${(30 + Math.sin(rad) * r1).toFixed(1)}"/>`;
    }).join('') +
    `</g>` +
    `<clipPath id="h"><rect x="0" y="0" width="64" height="35"/></clipPath>` +
    `<g clip-path="url(#h)">${face(32, 32, 10, MUSTARD, ORANGE)}</g>` +
    `<path d="M14 35h36" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>` +
    `<path d="M27.5 29.5q1.6-1.6 3.2 0M33.3 29.5q1.6-1.6 3.2 0" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>` +
    letters('GM', 32, 39, 11.5),
  // 1 · WAGMI: a pink ribbon banner
  1:
    dieCut(`<path d="M3 22h7v-4h44v4h7l-5 10 5 10h-7v4H10v-4H3l5-10z"/>`) +
    riso(`<path d="M10 18h44v28H10z"/>`, PINK, MUSTARD, 1.6, 1.6) +
    `<path d="M10 22H3l5 10-5 10h7M54 22h7l-5 10 5 10h-7" fill="${PINK}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>` +
    letters('WAGMI', 32, 26.5, 10.5, INK, 2.3),
  // 2 · rocket, tilted for take-off
  2:
    dieCut(circleBase, MINT_PALE) +
    `<g transform="rotate(40 32 32)">` +
    `<path d="M27 44q5 12 5 14q0-2 5-14z" fill="${PINK}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>` +
    `<path d="M29.5 44q2.5 6 2.5 8q0-2 2.5-8z" fill="${MUSTARD}"/>` +
    riso(`<path d="M24 38l-5 7 7-1zM40 38l5 7-7-1z"/>`, TEAL, BLUE, 1, 1, 1.8) +
    riso(`<path d="M32 9c7 6 9 16 7 34h-14c-2-18 0-28 7-34z"/>`, CARD, AQUA, 1.6, 1.4) +
    `<path d="M26.4 18h11.2" stroke="${INK}" stroke-width="1.8"/>` +
    `<path d="M32 9c3 2.6 5 5.6 5.6 9H26.4c.6-3.4 2.6-6.4 5.6-9z" fill="${TEAL}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>` +
    face(32, 27, 4.4, AQUA, BLUE) +
    `</g>`,
  // 3 · diamond hands: a faceted gem with twinkles
  3:
    dieCut(circleBase) +
    riso(`<path d="M16 26l7-9h18l7 9-16 20z"/>`, AQUA, BLUE, 2, 2) +
    `<path d="M16 26h32M23 17l4 9 5-9 5 9 4-9M27 26l5 20 5-20" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<path d="M47 11l1.3 3.4 3.4 1.3-3.4 1.3L47 20.4l-1.3-3.4-3.4-1.3 3.4-1.3z" fill="${MUSTARD}" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>` +
    `<path d="M15 41l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1z" fill="${PINK}" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/>`,
  // 4 · rekt: a coin crying rivers
  4:
    dieCut(circleBase) +
    face(32, 32, 17, ORANGE, PINK) +
    `<path d="M22.5 27l5 2.5-5 2.5M41.5 27l-5 2.5 5 2.5" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M25 33c-1 5-2 9 0 14M39 33c1 5 2 9 0 14" fill="none" stroke="${AQUA}" stroke-width="3.2" stroke-linecap="round"/>` +
    `<path d="M27.5 41.5q4.5-4 9 0" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`,
  // 5 · yum: happy eyes, tongue out
  5:
    dieCut(circleBase) +
    face(32, 32, 17, MUSTARD, ORANGE) +
    `<path d="M23 29q3-4 6 0M35 29q3-4 6 0" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>` +
    `<ellipse cx="21.5" cy="35" rx="3" ry="1.8" fill="${PINK}" opacity=".85"/><ellipse cx="42.5" cy="35" rx="3" ry="1.8" fill="${PINK}" opacity=".85"/>` +
    `<path d="M26 36q6 5 12 0" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M33 38.6q.4 5.6 3.2 5.4 2.8-.2 2.2-6.6" fill="${PINK}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>`,
  // 6 · salute: a wink and a flat hand to the brow
  6:
    dieCut(circleBase) +
    face(30, 35, 15.5, TEAL, MINT) +
    `<ellipse cx="24.5" cy="33" rx="1.9" ry="2.6" fill="${INK}"/>` +
    `<path d="M32.5 33.5q2.5-2 5 0" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M25.5 41.5q4 2.4 8 0" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M47 22.5l7 8" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><path d="M47 22.5l7 8" stroke="${TEAL}" stroke-width="3.6" stroke-linecap="round"/>` +
    `<g transform="rotate(-16 34 19)">` +
    riso(`<path d="M20.5 16h25a3.4 3.4 0 0 1 0 6.8h-25a3.4 3.4 0 0 1 0-6.8z"/><path d="M38 16q.6-4.6 4.4-4.2 2.2.4 1.6 4.2z"/>`, CARD, MUSTARD, 1.2, 1.2, 1.8) +
    `<path d="M22 19.4h21" stroke="${INK}" stroke-width="1.1" stroke-linecap="round" opacity=".6"/>` +
    `</g>`,
  // 7 · love: a heart die-cut
  7:
    dieCut(`<path d="M32 54C14 41 7 32 7 22.5 7 15 13 9.5 19.6 9.5c5.4 0 9.6 3.2 12.4 7.6 2.8-4.4 7-7.6 12.4-7.6C51 9.5 57 15 57 22.5 57 32 50 41 32 54z"/>`) +
    riso(
      `<path d="M32 48C18 38 13 31 13 23.6 13 18 17.3 14 22.2 14c4.4 0 7.6 2.8 9.8 6.6 2.2-3.8 5.4-6.6 9.8-6.6C46.7 14 51 18 51 23.6 51 31 46 38 32 48z"/>`,
      PINK,
      MUSTARD,
      2.2,
      2,
    ) +
    `<path d="M19.5 22q1-4.5 5.5-5" fill="none" stroke="${CARD}" stroke-width="2.6" stroke-linecap="round"/>`,
};

export const STICKER_COUNT = 8;

/** Full SVG markup of an emote sticker (64 × 64 viewBox). */
export function stickerSvg(id: number, size = 64): string {
  const body = BODIES[id] ?? BODIES[0];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">${body}</svg>`;
}

const urls = new Map<number, string>();

/** A data URL for <img> / canvas use (cached). */
export function stickerUrl(id: number): string {
  let u = urls.get(id);
  if (!u) {
    u = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(stickerSvg(id, 128))}`;
    urls.set(id, u);
  }
  return u;
}

const images = new Map<number, HTMLImageElement>();

/** Decoded sticker image for the canvas, or null while it is still loading. */
export function stickerImage(id: number): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null;
  let img = images.get(id);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    img.src = stickerUrl(id);
    images.set(id, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}
