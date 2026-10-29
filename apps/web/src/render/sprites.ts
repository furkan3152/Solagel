import { CARD_PAPER, ELYSIUM, INK, SHADE, drawCoinInterior, heartPath, lookForBasicSkin, shadeOf, starPath, type CoinInterior, type CoinLook } from '@elymum/art';
import { PowerUpType } from '@elymum/shared';

const TAU = Math.PI * 2;
const P = ELYSIUM;

/**
 * Food in the Storybook style (spec §6.6 `FoodBit`): seeds, grapes and pears
 * drawn in ink over a soft flat glow, so food can be found on the night floor.
 * Variants 0..5 are the common bits, 6 the big pear (mass 2), 7 the golden
 * drachma. `FOOD_COLORS[v][0]` stays the particle colour of a variant.
 */
type FoodShape = 'seed' | 'grapes' | 'pear';
const FOOD: [FoodShape, string][] = [
  ['seed', P.blush],
  ['grapes', P.spray],
  ['pear', P.sun],
  ['seed', P.foam],
  ['seed', P.up],
  ['seed', P.cream],
];
export const FOOD_COLORS: [string, string][] = FOOD.map(([, c]) => [c, shadeOf(c)]);

export type Sprite = { canvas: HTMLCanvasElement; size: number };

/** Sprites are rendered once at high resolution and drawn scaled (radius → size/2 * 0.8). */
const SPRITE_FILL = 0.8;
export const spriteScale = (r: number, sprite: Sprite): number => (r * 2) / (sprite.size * SPRITE_FILL);

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.translate(size / 2, size / 2);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  return [c, ctx];
}

/** Fill the current path, then outline it in ink. */
function inked(ctx: CanvasRenderingContext2D, fill: string, lineW: number): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lineW;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

/** A flat glow disc (no blur: two translucent discs of the paint). */
function glow(ctx: CanvasRenderingContext2D, R: number, color: string, a = 0.16): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = a;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = a * 0.9;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.72, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** Cel shade: the lower-right crescent of the current shape (clipped), one flat tone. */
function celShade(ctx: CanvasRenderingContext2D, path: () => void, R: number, color: string, dx = -0.28, dy = -0.34): void {
  ctx.save();
  path();
  ctx.clip();
  ctx.beginPath();
  ctx.rect(-R * 3, -R * 3, R * 6, R * 6);
  ctx.arc(R * dx, R * dy, R * 1.02, 0, TAU, true);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function pearPath(ctx: CanvasRenderingContext2D, u: number): void {
  ctx.beginPath();
  ctx.moveTo(0, -8 * u);
  ctx.quadraticCurveTo(5 * u, -8 * u, 5 * u, -2 * u);
  ctx.quadraticCurveTo(8 * u, 2 * u, 8 * u, 5 * u);
  ctx.quadraticCurveTo(8 * u, 10 * u, 0, 10 * u);
  ctx.quadraticCurveTo(-8 * u, 10 * u, -8 * u, 5 * u);
  ctx.quadraticCurveTo(-8 * u, 2 * u, -5 * u, -2 * u);
  ctx.quadraticCurveTo(-5 * u, -8 * u, 0, -8 * u);
  ctx.closePath();
}

/** One food bit; `rot` tilts pears and grapes a little (seeds are round). */
function foodSprite(variant: number, rot: number, size = 56): Sprite {
  const [canvas, ctx] = makeCanvas(size);
  const r = (size / 2) * SPRITE_FILL;
  const [shape, color] = FOOD[variant];
  if (shape === 'seed') {
    glow(ctx, r * 1.05, color);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.55, 0, TAU);
    inked(ctx, color, r * 0.24);
    ctx.fillStyle = P.white;
    ctx.beginPath();
    ctx.arc(-r * 0.18, -r * 0.18, r * 0.16, 0, TAU);
    ctx.fill();
  } else if (shape === 'grapes') {
    const u = r / 12;
    glow(ctx, r * 1.05, color);
    ctx.rotate(rot);
    const grapes: [number, number][] = [
      [-4, -3],
      [4, -3],
      [0, 4],
    ];
    // ink silhouette first (a joined outline), then the fills
    ctx.fillStyle = INK;
    for (const [x, y] of grapes) {
      ctx.beginPath();
      ctx.arc(x * u, y * u, 4.5 * u + 1.2 * u, 0, TAU);
      ctx.fill();
    }
    for (const [x, y] of grapes) {
      ctx.beginPath();
      ctx.arc(x * u, y * u, 4.5 * u - 1.1 * u, 0, TAU);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.fillStyle = P.white;
      ctx.beginPath();
      ctx.arc((x - 1.4) * u, (y - 1.4) * u, 1.1 * u, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2 * u;
    ctx.beginPath();
    ctx.moveTo(0, -7 * u);
    ctx.quadraticCurveTo(1 * u, -10 * u, 3.5 * u, -11 * u);
    ctx.stroke();
  } else {
    pearBit(ctx, r, rot, false);
  }
  return { canvas, size };
}

/** A pear (sun, cel shaded); `leaf` for the big pear. */
function pearBit(ctx: CanvasRenderingContext2D, r: number, rot: number, leaf: boolean): void {
  const u = r / 11.5;
  glow(ctx, r * 1.05, P.sun, leaf ? 0.2 : 0.16);
  ctx.rotate(rot);
  ctx.translate(0, -0.6 * u);
  if (leaf) {
    ctx.beginPath();
    ctx.moveTo(1 * u, -9 * u);
    ctx.quadraticCurveTo(5 * u, -14 * u, 9.5 * u, -11.5 * u);
    ctx.quadraticCurveTo(6 * u, -7.5 * u, 1 * u, -9 * u);
    ctx.closePath();
    inked(ctx, P.verdant, 1.8 * u);
  }
  pearPath(ctx, u);
  inked(ctx, P.sun, 2.4 * u);
  celShade(ctx, () => pearPath(ctx, u * 0.93), 9 * u, SHADE.sun, -0.3, -0.25);
  pearPath(ctx, u);
  ctx.lineWidth = 2.4 * u;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.strokeStyle = P.white;
  ctx.lineWidth = 1.6 * u;
  ctx.beginPath();
  ctx.moveTo(-4.8 * u, 3 * u);
  ctx.quadraticCurveTo(-5 * u, 0, -3.4 * u, -1.6 * u);
  ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.4 * u;
  ctx.beginPath();
  ctx.moveTo(0, -8 * u);
  ctx.quadraticCurveTo(1 * u, -12 * u, 4 * u, -13 * u);
  ctx.stroke();
}

/** The big pear (mass 2): a pear with a leaf and a stronger glow. */
function bigPearSprite(size = 72): Sprite {
  const [canvas, ctx] = makeCanvas(size);
  pearBit(ctx, (size / 2) * SPRITE_FILL, -0.12, true);
  return { canvas, size };
}

/** "$" as strokes (no canvas text in sprites, same as the art package). */
function dollarPath(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.moveTo(s * 0.42, -s * 0.42);
  ctx.bezierCurveTo(s * 0.2, -s * 0.66, -s * 0.5, -s * 0.62, -s * 0.48, -s * 0.24);
  ctx.bezierCurveTo(-s * 0.46, s * 0.08, s * 0.46, -s * 0.06, s * 0.48, s * 0.26);
  ctx.bezierCurveTo(s * 0.5, s * 0.64, -s * 0.24, s * 0.68, -s * 0.46, s * 0.4);
  ctx.moveTo(0, -s * 0.82);
  ctx.lineTo(0, s * 0.82);
}

/**
 * A gold coin in the coin style (flat sun, one shade crescent, inner groove,
 * highlight, ink edge): a drachma with a struck "Δ" (golden food, over a sun
 * glow) or a stamped "$" (loot; its glow is drawn live).
 */
function goldCoin(size: number, mark: 'drachma' | 'dollar'): Sprite {
  const [canvas, ctx] = makeCanvas(size);
  const r = (size / 2) * SPRITE_FILL * (mark === 'drachma' ? 0.72 : 0.92);
  if (mark === 'drachma') glow(ctx, (size / 2) * SPRITE_FILL * 1.15, P.sun, 0.2);
  // body, shade, groove, highlight: the coin's own interior (a hat look keeps the face blank)
  const look: CoinLook = { ...lookForBasicSkin(1), body: P.sun, shade: SHADE.sun, accessory: 'cap' };
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.clip();
  drawCoinInterior(ctx, look, r);
  ctx.restore();
  // the struck mark
  ctx.lineWidth = r * 0.11;
  if (mark === 'drachma') {
    ctx.strokeStyle = SHADE.sun;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.38);
    ctx.lineTo(r * 0.34, r * 0.26);
    ctx.lineTo(-r * 0.34, r * 0.26);
    ctx.closePath();
    ctx.stroke();
  } else {
    ctx.save();
    ctx.rotate(-0.14);
    ctx.strokeStyle = INK;
    ctx.lineWidth = r * 0.12;
    ctx.beginPath();
    dollarPath(ctx, r * 0.48);
    ctx.stroke();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.lineWidth = r * (mark === 'drachma' ? 0.16 : 0.1);
  ctx.strokeStyle = INK;
  ctx.stroke();
  return { canvas, size };
}

/**
 * The thorn bush (virus): a round barrel cactus in ink and cel greens, cream
 * thorns all round, ribs, a coral flower and a face that is up to no good.
 */
function cactusSprite(size = 320): Sprite {
  const [canvas, ctx] = makeCanvas(size);
  const r = (size / 2) * SPRITE_FILL * 0.86;
  const lw = r * 0.05;
  // thorns: cream spikes with ink edges, behind the body
  const spikes = 20;
  ctx.beginPath();
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * TAU + 0.08;
    const a0 = a - 0.085;
    const a1 = a + 0.085;
    const out = i % 2 ? 1.2 : 1.27;
    ctx.moveTo(Math.cos(a0) * r * 0.92, Math.sin(a0) * r * 0.92);
    ctx.lineTo(Math.cos(a) * r * out, Math.sin(a) * r * out);
    ctx.lineTo(Math.cos(a1) * r * 0.92, Math.sin(a1) * r * 0.92);
    ctx.closePath();
  }
  inked(ctx, P.cream, lw * 0.8);
  // body: flat verdant, forest shade crescent, ink edge
  const body = () => {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
  };
  body();
  ctx.fillStyle = P.verdant;
  ctx.fill();
  celShade(ctx, body, r, P.forest, -0.13, -0.17);
  // ribs
  ctx.save();
  body();
  ctx.clip();
  ctx.strokeStyle = P.forest;
  ctx.lineWidth = r * 0.045;
  for (let i = -2; i <= 2; i++) {
    if (i === 0) continue;
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.abs(i) * r * 0.36, r * 1.02, 0, -Math.PI / 2, Math.PI / 2, i < 0);
    ctx.stroke();
  }
  ctx.restore();
  // highlight
  ctx.strokeStyle = P.meadow;
  ctx.lineWidth = r * 0.09;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.8, 3.4, 4.2);
  ctx.stroke();
  body();
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.stroke();
  // little thorn ticks on the ribs
  ctx.strokeStyle = P.cream;
  ctx.lineWidth = r * 0.03;
  for (let i = 0; i < 12; i++) {
    const a = i * 2.39996;
    const d = r * (0.3 + ((i * 37) % 55) / 100);
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    if (Math.abs(y) < r * 0.45 && Math.abs(x) < r * 0.62) continue; // keep the face clear
    ctx.beginPath();
    ctx.moveTo(x - r * 0.04, y - r * 0.03);
    ctx.lineTo(x + r * 0.04, y + r * 0.03);
    ctx.moveTo(x + r * 0.04, y - r * 0.03);
    ctx.lineTo(x - r * 0.04, y + r * 0.03);
    ctx.stroke();
  }
  // face: white eyes under scowling brows, a smirk, cheeks
  const u = r / 46;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * 13 * u, 2 * u, 8 * u, 9.5 * u, 0, 0, TAU);
    inked(ctx, P.white, lw * 0.7);
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(s * 13 * u + 2 * u, 4 * u, 4.6 * u, 0, TAU);
    ctx.fill();
    ctx.fillStyle = P.white;
    ctx.beginPath();
    ctx.arc(s * 13 * u + 0.4 * u, 2 * u, 1.6 * u, 0, TAU);
    ctx.fill();
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw * 0.9;
  ctx.beginPath();
  ctx.moveTo(-22 * u, -12 * u);
  ctx.lineTo(-6 * u, -6 * u);
  ctx.moveTo(22 * u, -12 * u);
  ctx.lineTo(6 * u, -6 * u);
  ctx.moveTo(-7 * u, 18 * u);
  ctx.quadraticCurveTo(4 * u, 23 * u, 12 * u, 14 * u);
  ctx.stroke();
  ctx.fillStyle = P.blush;
  ctx.globalAlpha = 0.8;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * 25 * u, 14 * u, 5.5 * u, 3.3 * u, 0, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // flower on top
  ctx.save();
  ctx.translate(r * 0.18, -r * 0.92);
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU - Math.PI / 2;
    const x = Math.cos(a) * r * 0.12;
    const y = Math.sin(a) * r * 0.12;
    ctx.moveTo(x + r * 0.09, y);
    ctx.arc(x, y, r * 0.09, 0, TAU);
  }
  ctx.lineWidth = lw * 1.6;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = P.coral;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.075, 0, TAU);
  inked(ctx, P.sun, lw * 0.6);
  ctx.restore();
  return { canvas, size };
}

/** Power-up sticker: a cream disc with an ink edge and a hard ink shadow, a paint ring and the power in ink. */
function powerUpSprite(type: PowerUpType, size = 160): Sprite {
  const [canvas, ctx] = makeCanvas(size);
  const r = (size / 2) * SPRITE_FILL;
  const lw = r * 0.075;
  const paint: Record<PowerUpType, string> = {
    [PowerUpType.Magnet]: P.down,
    [PowerUpType.Pump]: P.sun,
    [PowerUpType.Shield]: P.cyan,
    [PowerUpType.Bag]: P.up,
  };
  const ring = paint[type];
  // hard shadow (down-right, no blur)
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(r * 0.09, r * 0.11, r, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  inked(ctx, ring, lw);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.72, 0, TAU);
  inked(ctx, P.cream, lw * 0.8);
  // dotted stitch on the ring
  ctx.save();
  ctx.strokeStyle = P.cream;
  ctx.lineWidth = r * 0.055;
  ctx.setLineDash([0.01, r * 0.16]);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.86, 0, TAU);
  ctx.stroke();
  ctx.restore();
  switch (type) {
    case PowerUpType.Magnet: {
      const u = (c: CanvasRenderingContext2D) => {
        c.beginPath();
        c.arc(0, -r * 0.02, r * 0.3, Math.PI, 0, true);
        c.moveTo(-r * 0.3, -r * 0.02);
        c.lineTo(-r * 0.3, -r * 0.34);
        c.moveTo(r * 0.3, -r * 0.02);
        c.lineTo(r * 0.3, -r * 0.34);
      };
      ctx.lineCap = 'butt';
      ctx.strokeStyle = INK;
      ctx.lineWidth = r * 0.26;
      u(ctx);
      ctx.stroke();
      ctx.strokeStyle = P.down;
      ctx.lineWidth = r * 0.26 - lw * 1.6;
      u(ctx);
      ctx.stroke();
      ctx.strokeStyle = P.cream;
      ctx.beginPath();
      ctx.moveTo(-r * 0.3, -r * 0.22);
      ctx.lineTo(-r * 0.3, -r * 0.34 + lw * 0.2);
      ctx.moveTo(r * 0.3, -r * 0.22);
      ctx.lineTo(r * 0.3, -r * 0.34 + lw * 0.2);
      ctx.stroke();
      break;
    }
    case PowerUpType.Pump: {
      // a rocket: cream body, cyan window, coral fins, sun flame
      ctx.save();
      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      ctx.moveTo(-r * 0.12, r * 0.3);
      ctx.lineTo(0, r * 0.56);
      ctx.lineTo(r * 0.12, r * 0.3);
      ctx.closePath();
      inked(ctx, P.sun, lw * 0.8);
      ctx.beginPath();
      ctx.moveTo(-r * 0.15, r * 0.12);
      ctx.lineTo(-r * 0.3, r * 0.32);
      ctx.lineTo(-r * 0.12, r * 0.28);
      ctx.moveTo(r * 0.15, r * 0.12);
      ctx.lineTo(r * 0.3, r * 0.32);
      ctx.lineTo(r * 0.12, r * 0.28);
      inked(ctx, P.coral, lw * 0.8);
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.5);
      ctx.bezierCurveTo(r * 0.25, -r * 0.3, r * 0.22, r * 0.1, r * 0.16, r * 0.3);
      ctx.lineTo(-r * 0.16, r * 0.3);
      ctx.bezierCurveTo(-r * 0.22, r * 0.1, -r * 0.25, -r * 0.3, 0, -r * 0.5);
      inked(ctx, P.white, lw);
      ctx.beginPath();
      ctx.arc(0, -r * 0.12, r * 0.085, 0, TAU);
      inked(ctx, P.cyan, lw * 0.7);
      ctx.restore();
      break;
    }
    case PowerUpType.Shield: {
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.46);
      ctx.quadraticCurveTo(r * 0.3, -r * 0.34, r * 0.4, -r * 0.34);
      ctx.quadraticCurveTo(r * 0.42, r * 0.22, 0, r * 0.48);
      ctx.quadraticCurveTo(-r * 0.42, r * 0.22, -r * 0.4, -r * 0.34);
      ctx.quadraticCurveTo(-r * 0.3, -r * 0.34, 0, -r * 0.46);
      ctx.closePath();
      inked(ctx, P.cyan, lw);
      ctx.fillStyle = P.cream;
      heartPath(ctx, r * 0.15);
      ctx.fill();
      break;
    }
    case PowerUpType.Bag: {
      ctx.beginPath();
      ctx.moveTo(-r * 0.12, -r * 0.28);
      ctx.quadraticCurveTo(-r * 0.5, -r * 0.08, -r * 0.42, r * 0.26);
      ctx.quadraticCurveTo(-r * 0.35, r * 0.48, 0, r * 0.48);
      ctx.quadraticCurveTo(r * 0.35, r * 0.48, r * 0.42, r * 0.26);
      ctx.quadraticCurveTo(r * 0.5, -r * 0.08, r * 0.12, -r * 0.28);
      ctx.lineTo(r * 0.24, -r * 0.46);
      ctx.lineTo(-r * 0.24, -r * 0.46);
      ctx.closePath();
      inked(ctx, P.sun, lw);
      ctx.strokeStyle = INK;
      ctx.lineWidth = lw * 0.9;
      ctx.beginPath();
      ctx.moveTo(-r * 0.16, -r * 0.28);
      ctx.lineTo(r * 0.16, -r * 0.28);
      ctx.stroke();
      ctx.lineWidth = lw * 1.1;
      ctx.beginPath();
      ctx.save();
      ctx.translate(0, r * 0.12);
      dollarPath(ctx, r * 0.25);
      ctx.restore();
      ctx.stroke();
      break;
    }
  }
  return { canvas, size };
}

/** Ejected mass: a little blank coin in the skin's paint (flat, one shade, ink edge). */
function ejectSprite(skinId: number, size = 72): Sprite {
  const [canvas, ctx] = makeCanvas(size);
  const r = (size / 2) * SPRITE_FILL;
  const look = lookForBasicSkin(skinId);
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.clip();
  // a hat-wearing look keeps its symbol off the face: a blank coin
  drawCoinInterior(ctx, { ...look, accessory: 'cap' }, r);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.lineWidth = r * 0.16;
  ctx.strokeStyle = INK;
  ctx.stroke();
  return { canvas, size };
}

/** Loot glint: a 4-point twinkle in card paper with an ink rim (drawn live, pulsing). */
export function drawGlint(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  starPath(ctx, s, s * 0.28, 4, 0);
  ctx.fillStyle = CARD_PAPER;
  ctx.fill();
  ctx.lineWidth = s * 0.16;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
}

/** Food tilts pre-rendered per variant (cheap: no per-frame rotate). */
const ROTATIONS = 5;
const TILT = 0.7;

/** Coin interiors are cached per look in ≈ 6 % radius steps (drawn at most ±3 % scaled). */
const INTERIOR_STEP = 1.06;
const INTERIOR_LOG = Math.log(INTERIOR_STEP);
/** Smallest and largest cached interior radius, device px (outside: drawn directly). */
const INTERIOR_MIN_PX = 20;
const INTERIOR_MAX_PX = 420;
const INTERIOR_MAX_BYTES = 48 * 1024 * 1024;

/** Lazily created, cached sprites. Must only be used in the browser. */
export class SpriteCache {
  private food: Sprite[][] | null = null;
  private cactus: Sprite | null = null;
  private gold: Sprite | null = null;
  private loot: Sprite | null = null;
  private powerUps = new Map<number, Sprite>();
  private ejects = new Map<number, Sprite>();
  /** Coin interiors by look, then radius bucket (LRU over all looks by insertion order). */
  private interiors = new Map<CoinLook, Map<number, CoinInterior>>();
  private interiorLru = new Map<CoinInterior, Map<number, CoinInterior>>();
  private interiorBytes = 0;

  /**
   * `CoinState.interior` provider: the coin's static interior (`drawCoinInterior`)
   * rendered once per look and on-screen radius bucket. `ppu` is device px per
   * world unit. Null outside the cached size range (the coin draws it directly).
   */
  coinInterior(look: CoinLook, r: number, ppu: number): CoinInterior | null {
    const px = r * ppu;
    if (px < INTERIOR_MIN_PX || px > INTERIOR_MAX_PX) return null;
    const bucket = Math.round(Math.log(px) / INTERIOR_LOG);
    let byBucket = this.interiors.get(look);
    if (!byBucket) {
      byBucket = new Map();
      this.interiors.set(look, byBucket);
    }
    let it = byBucket.get(bucket);
    if (it) {
      // refresh its LRU position
      this.interiorLru.delete(it);
      this.interiorLru.set(it, byBucket);
      return it;
    }
    const radius = INTERIOR_STEP ** bucket;
    const size = Math.ceil(radius * 2) + 4;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.translate(size / 2, size / 2);
    drawCoinInterior(ctx, look, radius);
    it = { image: c, size, radius };
    byBucket.set(bucket, it);
    this.interiorLru.set(it, byBucket);
    this.interiorBytes += size * size * 4;
    for (const [old, owner] of this.interiorLru) {
      if (this.interiorBytes <= INTERIOR_MAX_BYTES) break;
      if (old === it) continue;
      this.interiorLru.delete(old);
      for (const [b, v] of owner) if (v === old) owner.delete(b);
      this.interiorBytes -= old.size * old.size * 4;
    }
    return it;
  }

  /** Food sprite for a variant; `seed` (0..1) picks one of the pre-rendered rotations. */
  foodSprite(variant: number, seed = 0): Sprite {
    if (!this.food) {
      this.food = FOOD.map(([shape], v) =>
        shape === 'seed' ? [foodSprite(v, 0)] : Array.from({ length: ROTATIONS }, (_, k) => foodSprite(v, (k / (ROTATIONS - 1) - 0.5) * TILT)),
      );
      this.food.push([bigPearSprite(72)]);
      this.gold = goldCoin(96, 'drachma');
      this.food.push([this.gold]);
    }
    const set = this.food[variant] ?? this.food[0];
    return set[Math.floor(seed * set.length) % set.length];
  }

  lootSprite(): Sprite {
    return (this.loot ??= goldCoin(128, 'dollar'));
  }

  cactusSprite(): Sprite {
    return (this.cactus ??= cactusSprite(320));
  }

  powerUpSprite(type: number): Sprite {
    let s = this.powerUps.get(type);
    if (!s) {
      s = powerUpSprite(type as PowerUpType, 160);
      this.powerUps.set(type, s);
    }
    return s;
  }

  ejectSprite(skin: number): Sprite {
    let s = this.ejects.get(skin);
    if (!s) {
      s = ejectSprite(skin, 72);
      this.ejects.set(skin, s);
    }
    return s;
  }

  /** @deprecated the riso halftone is gone: always null (kept for older callers). */
  halftone(_r: number, _spacing: number, _ppu: number): HTMLCanvasElement | null {
    return null;
  }
}

/** Draws a cached sprite centred at (x, y) with world radius r. */
export function drawSprite(ctx: CanvasRenderingContext2D, sprite: Sprite, x: number, y: number, r: number, rot = 0): void {
  const s = spriteScale(r, sprite);
  const half = (sprite.size * s) / 2;
  if (rot === 0) {
    ctx.drawImage(sprite.canvas, x - half, y - half, sprite.size * s, sprite.size * s);
  } else {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.drawImage(sprite.canvas, -half, -half, sprite.size * s, sprite.size * s);
    ctx.restore();
  }
}
