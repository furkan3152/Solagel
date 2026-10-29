import { CARD_PAPER, INK, RISO, drawCoinInterior, drawHalftoneDots, heartPath, lookForBasicSkin, starPath, type CoinInterior, type CoinLook } from '@elymum/art';
import { PowerUpType } from '@elymum/shared';

const TAU = Math.PI * 2;

/**
 * Riso confetti for food variants 0..5: [shape, ink, overprint]. Variant 6 is
 * a gem, 7 a golden coin. `FOOD_COLORS[v][0]` stays the particle ink.
 */
type ConfettiShape = 'dot' | 'star' | 'tri';
const CONFETTI: [ConfettiShape, string, string][] = [
  ['dot', RISO.fluoPink, RISO.mustard],
  ['star', RISO.teal, RISO.fluoPink],
  ['tri', RISO.mustard, RISO.blue],
  ['dot', RISO.blue, RISO.aqua],
  ['tri', RISO.orange, RISO.teal],
  ['star', RISO.green, RISO.mustard],
];
export const FOOD_COLORS: [string, string][] = CONFETTI.map(([, ink, over]) => [ink, over]);

export type Sprite = { canvas: HTMLCanvasElement; size: number };

/** Sprites are rendered once at high resolution and drawn scaled (radius → size/2 * 0.8). */
const SPRITE_FILL = 0.8;
export const spriteScale = (r: number, sprite: Sprite): number => (r * 2) / (sprite.size * SPRITE_FILL);

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.translate(size / 2, size / 2);
  return [c, ctx];
}

/**
 * One riso print of a path: the second ink misregistered by (dx, dy) peeking
 * out from under the first, then an ink rim. `path` adds a sub-path.
 */
function risoPrint(
  ctx: CanvasRenderingContext2D,
  path: (ctx: CanvasRenderingContext2D) => void,
  ink: string,
  over: string,
  o: { dx: number; dy: number; rim: number; rimColor?: string },
): void {
  ctx.save();
  ctx.translate(o.dx, o.dy);
  ctx.beginPath();
  path(ctx);
  ctx.fillStyle = over;
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  path(ctx);
  ctx.fillStyle = ink;
  ctx.fill();
  if (o.rim > 0) {
    ctx.lineWidth = o.rim;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = o.rimColor ?? INK;
    ctx.stroke();
  }
}

const triPath = (s: number) => (ctx: CanvasRenderingContext2D) => {
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i / 3) * TAU;
    const x = Math.cos(a) * s;
    const y = Math.sin(a) * s + s * 0.18;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
};

/** Food confetti: dot, star or triangle in riso inks, one rotation per sprite. */
function confettiSprite(variant: number, rot: number, size = 48): Sprite {
  const [canvas, ctx] = makeCanvas(size);
  const r = (size / 2) * SPRITE_FILL;
  const [shape, ink, over] = CONFETTI[variant];
  ctx.rotate(rot);
  const off = { dx: r * 0.16, dy: r * 0.14, rim: r * 0.1 };
  if (shape === 'dot') risoPrint(ctx, (c) => c.arc(0, 0, r * 0.82, 0, TAU), ink, over, off);
  else if (shape === 'star') risoPrint(ctx, (c) => starPath(c, r, r * 0.45, 5), ink, over, off);
  else risoPrint(ctx, triPath(r * 0.95), ink, over, off);
  return { canvas, size };
}

/** Gem food (mass 2): a faceted aqua diamond with a blue pass. */
function gemSprite(size = 64): Sprite {
  const [canvas, ctx] = makeCanvas(size);
  const s = (size / 2) * SPRITE_FILL;
  const body = (c: CanvasRenderingContext2D) => {
    c.moveTo(-s * 0.95, -s * 0.2);
    c.lineTo(-s * 0.5, -s * 0.75);
    c.lineTo(s * 0.5, -s * 0.75);
    c.lineTo(s * 0.95, -s * 0.2);
    c.lineTo(0, s * 0.95);
    c.closePath();
  };
  risoPrint(ctx, body, RISO.aqua, RISO.blue, { dx: s * 0.14, dy: s * 0.12, rim: s * 0.11 });
  ctx.strokeStyle = INK;
  ctx.lineWidth = s * 0.07;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-s * 0.95, -s * 0.2);
  ctx.lineTo(s * 0.95, -s * 0.2);
  ctx.moveTo(-s * 0.32, -s * 0.2);
  ctx.lineTo(0, s * 0.85);
  ctx.lineTo(s * 0.32, -s * 0.2);
  ctx.stroke();
  ctx.strokeStyle = CARD_PAPER;
  ctx.lineWidth = s * 0.09;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-s * 0.55, -s * 0.48);
  ctx.lineTo(-s * 0.32, -s * 0.48);
  ctx.stroke();
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
 * A mustard riso coin: overprint, ink rim, inner dotted groove and either a
 * star (golden food) or a stamped "$" (loot).
 */
function mustardCoin(size: number, mark: 'star' | 'dollar'): Sprite {
  const [canvas, ctx] = makeCanvas(size);
  const r = (size / 2) * SPRITE_FILL;
  risoPrint(ctx, (c) => c.arc(0, 0, r, 0, TAU), RISO.mustard, RISO.orange, { dx: r * 0.1, dy: r * 0.1, rim: r * 0.12 });
  // halftone shade on the lower right
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.94, 0, TAU);
  ctx.clip();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.28;
  drawHalftoneDots(ctx, r, r * 0.11);
  ctx.restore();
  // groove
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = r * 0.05;
  ctx.setLineDash([r * 0.1, r * 0.08]);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.74, 0, TAU);
  ctx.stroke();
  ctx.restore();
  if (mark === 'star') {
    risoPrint(ctx, (c) => starPath(c, r * 0.46, r * 0.2), CARD_PAPER, RISO.orange, { dx: r * 0.06, dy: r * 0.06, rim: r * 0.07 });
  } else {
    // the "$" stamp: a rubber-stamp ring with the sign, slightly off-centre and turned
    ctx.save();
    ctx.rotate(-0.18);
    ctx.translate(-r * 0.02, r * 0.02);
    ctx.strokeStyle = INK;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = r * 0.13;
    ctx.beginPath();
    dollarPath(ctx, r * 0.5);
    ctx.stroke();
    ctx.restore();
  }
  // print highlight
  ctx.strokeStyle = CARD_PAPER;
  ctx.lineCap = 'round';
  ctx.lineWidth = r * 0.1;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, 1.12 * Math.PI, 1.36 * Math.PI);
  ctx.stroke();
  return { canvas, size };
}

/** Rug cactus: a green riso spiky ball with a mischievous face and a pink flower. */
function cactusSprite(size = 320): Sprite {
  const [canvas, ctx] = makeCanvas(size);
  const r = (size / 2) * SPRITE_FILL * 0.86;
  const spikes = 22;
  const spikePath = (c: CanvasRenderingContext2D) => {
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * TAU;
      const a0 = a - 0.1;
      const a1 = a + 0.1;
      c.moveTo(Math.cos(a0) * r * 0.9, Math.sin(a0) * r * 0.9);
      c.lineTo(Math.cos(a) * r * 1.2, Math.sin(a) * r * 1.2);
      c.lineTo(Math.cos(a1) * r * 0.9, Math.sin(a1) * r * 0.9);
      c.closePath();
    }
  };
  risoPrint(ctx, spikePath, CARD_PAPER, RISO.mustard, { dx: r * 0.03, dy: r * 0.03, rim: r * 0.035 });
  // body: green over a misregistered teal pass
  risoPrint(ctx, (c) => c.arc(0, 0, r, 0, TAU), RISO.green, RISO.teal, { dx: r * 0.06, dy: r * 0.05, rim: r * 0.065 });
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.96, 0, TAU);
  ctx.clip();
  // ribs
  ctx.strokeStyle = INK;
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = r * 0.035;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.abs(i) * r * 0.3 + r * 0.05, r * 1.02, 0, -Math.PI / 2, Math.PI / 2, i < 0);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.3;
  drawHalftoneDots(ctx, r, r * 0.07);
  ctx.restore();
  // prickle dots
  ctx.fillStyle = CARD_PAPER;
  for (let i = 0; i < 14; i++) {
    const a = i * 2.39996;
    const d = r * (0.25 + ((i * 37) % 60) / 100);
    ctx.beginPath();
    ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r * 0.028, 0, TAU);
    ctx.fill();
  }
  // face: slanted brows and a smirk (it *will* rug you)
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * r * 0.28, r * 0.06, r * 0.075, r * 0.095, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = CARD_PAPER;
    ctx.beginPath();
    ctx.arc(s * r * 0.28 - r * 0.025, r * 0.03, r * 0.028, 0, TAU);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.lineWidth = r * 0.055;
    ctx.beginPath();
    ctx.moveTo(s * r * 0.42, -r * 0.1);
    ctx.lineTo(s * r * 0.15, -r * 0.03);
    ctx.stroke();
  }
  ctx.lineWidth = r * 0.055;
  ctx.beginPath();
  ctx.moveTo(-r * 0.12, r * 0.25);
  ctx.quadraticCurveTo(r * 0.04, r * 0.33, r * 0.16, r * 0.2);
  ctx.stroke();
  ctx.fillStyle = RISO.fluoPink;
  ctx.globalAlpha = 0.75;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * r * 0.5, r * 0.25, r * 0.1, r * 0.055, 0, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // flower
  ctx.save();
  ctx.translate(r * 0.15, -r * 0.88);
  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.rotate((i / 5) * TAU);
    risoPrint(ctx, (c) => c.ellipse(0, -r * 0.13, r * 0.08, r * 0.13, 0, 0, TAU), RISO.fluoPink, RISO.mustard, { dx: r * 0.015, dy: r * 0.015, rim: r * 0.025 });
    ctx.restore();
  }
  ctx.fillStyle = RISO.mustard;
  ctx.strokeStyle = INK;
  ctx.lineWidth = r * 0.025;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.07, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  return { canvas, size };
}

/** Power-up sticker: card disc with an ink rim, riso ring and the power drawn in ink. */
function powerUpSprite(type: PowerUpType, size = 160): Sprite {
  const [canvas, ctx] = makeCanvas(size);
  const r = (size / 2) * SPRITE_FILL;
  const tint: Record<PowerUpType, [string, string]> = {
    [PowerUpType.Magnet]: [RISO.fluoPink, RISO.mustard],
    [PowerUpType.Pump]: [RISO.orange, RISO.fluoPink],
    [PowerUpType.Shield]: [RISO.blue, RISO.aqua],
    [PowerUpType.Bag]: [RISO.mustard, RISO.orange],
  };
  const [ink, over] = tint[type];
  risoPrint(ctx, (c) => c.arc(0, 0, r, 0, TAU), ink, over, { dx: r * 0.08, dy: r * 0.08, rim: r * 0.08 });
  ctx.fillStyle = CARD_PAPER;
  ctx.strokeStyle = INK;
  ctx.lineWidth = r * 0.05;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.7, 0, TAU);
  ctx.fill();
  ctx.stroke();
  // perforated ring between the two
  ctx.save();
  ctx.strokeStyle = CARD_PAPER;
  ctx.lineWidth = r * 0.06;
  ctx.setLineDash([r * 0.08, r * 0.1]);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.86, 0, TAU);
  ctx.stroke();
  ctx.restore();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const lw = r * 0.07;
  switch (type) {
    case PowerUpType.Magnet: {
      ctx.lineWidth = r * 0.24;
      ctx.strokeStyle = INK;
      const u = (c: CanvasRenderingContext2D) => {
        c.arc(0, -r * 0.02, r * 0.3, Math.PI, 0, true);
        c.moveTo(-r * 0.3, -r * 0.02);
        c.lineTo(-r * 0.3, -r * 0.34);
        c.moveTo(r * 0.3, -r * 0.02);
        c.lineTo(r * 0.3, -r * 0.34);
      };
      ctx.beginPath();
      u(ctx);
      ctx.stroke();
      ctx.lineWidth = r * 0.14;
      ctx.strokeStyle = RISO.fluoPink;
      ctx.beginPath();
      u(ctx);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.strokeStyle = CARD_PAPER;
      ctx.beginPath();
      ctx.moveTo(-r * 0.3, -r * 0.24);
      ctx.lineTo(-r * 0.3, -r * 0.36);
      ctx.moveTo(r * 0.3, -r * 0.24);
      ctx.lineTo(r * 0.3, -r * 0.36);
      ctx.stroke();
      break;
    }
    case PowerUpType.Pump: {
      ctx.save();
      ctx.rotate(Math.PI / 4);
      risoPrint(
        ctx,
        (c) => {
          c.moveTo(0, -r * 0.5);
          c.bezierCurveTo(r * 0.25, -r * 0.3, r * 0.22, r * 0.1, r * 0.16, r * 0.28);
          c.lineTo(-r * 0.16, r * 0.28);
          c.bezierCurveTo(-r * 0.22, r * 0.1, -r * 0.25, -r * 0.3, 0, -r * 0.5);
        },
        CARD_PAPER,
        RISO.orange,
        { dx: r * 0.04, dy: r * 0.04, rim: lw },
      );
      ctx.fillStyle = RISO.aqua;
      ctx.beginPath();
      ctx.arc(0, -r * 0.12, r * 0.08, 0, TAU);
      ctx.fill();
      ctx.stroke();
      risoPrint(
        ctx,
        (c) => {
          c.moveTo(-r * 0.12, r * 0.32);
          c.lineTo(0, r * 0.56);
          c.lineTo(r * 0.12, r * 0.32);
          c.closePath();
        },
        RISO.fluoPink,
        RISO.mustard,
        { dx: 0, dy: r * 0.04, rim: lw * 0.8 },
      );
      ctx.restore();
      break;
    }
    case PowerUpType.Shield: {
      risoPrint(
        ctx,
        (c) => {
          c.moveTo(0, -r * 0.46);
          c.quadraticCurveTo(r * 0.3, -r * 0.34, r * 0.4, -r * 0.34);
          c.quadraticCurveTo(r * 0.42, r * 0.22, 0, r * 0.48);
          c.quadraticCurveTo(-r * 0.42, r * 0.22, -r * 0.4, -r * 0.34);
          c.quadraticCurveTo(-r * 0.3, -r * 0.34, 0, -r * 0.46);
        },
        RISO.aqua,
        RISO.blue,
        { dx: r * 0.05, dy: r * 0.05, rim: lw },
      );
      ctx.fillStyle = CARD_PAPER;
      ctx.beginPath();
      heartPath(ctx, r * 0.15);
      ctx.fill();
      break;
    }
    case PowerUpType.Bag: {
      risoPrint(
        ctx,
        (c) => {
          c.moveTo(-r * 0.12, -r * 0.28);
          c.quadraticCurveTo(-r * 0.5, -r * 0.08, -r * 0.42, r * 0.26);
          c.quadraticCurveTo(-r * 0.35, r * 0.48, 0, r * 0.48);
          c.quadraticCurveTo(r * 0.35, r * 0.48, r * 0.42, r * 0.26);
          c.quadraticCurveTo(r * 0.5, -r * 0.08, r * 0.12, -r * 0.28);
          c.lineTo(r * 0.24, -r * 0.46);
          c.lineTo(-r * 0.24, -r * 0.46);
          c.closePath();
        },
        RISO.mustard,
        RISO.orange,
        { dx: r * 0.05, dy: r * 0.05, rim: lw },
      );
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

/** Ejected mass: a little riso coin in the skin's inks. */
function ejectSprite(skinId: number, size = 72): Sprite {
  const [canvas, ctx] = makeCanvas(size);
  const r = (size / 2) * SPRITE_FILL;
  const look = lookForBasicSkin(skinId);
  ctx.fillStyle = CARD_PAPER;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  risoPrint(ctx, (c) => c.arc(0, 0, r, 0, TAU), look.body, look.overprint, { dx: r * 0.12, dy: r * 0.12, rim: r * 0.12 });
  ctx.strokeStyle = INK;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = r * 0.07;
  ctx.setLineDash([r * 0.16, r * 0.12]);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.66, 0, TAU);
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

/** Confetti rotations pre-rendered per variant (cheap: no per-frame rotate). */
const ROTATIONS = 6;
/** Halftone shades cached per on-screen radius bucket (≈ 12 % steps). */
const HALFTONE_STEP = 1.12;
/** Largest cached halftone radius, device px (≈ 256). */
const HALFTONE_MAX_PX = 256;
const HALFTONE_MAX_BUCKET = Math.floor(Math.log(HALFTONE_MAX_PX) / Math.log(HALFTONE_STEP));
const HALFTONE_MAX_BYTES = 16 * 1024 * 1024;

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
  private halftones = new Map<number, HTMLCanvasElement>();
  private halftoneBytes = 0;
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
      this.food = CONFETTI.map((_, v) => Array.from({ length: ROTATIONS }, (_, k) => confettiSprite(v, (k / ROTATIONS) * TAU, 48)));
      this.food.push([gemSprite(64)]);
      this.gold = mustardCoin(96, 'star');
      this.food.push([this.gold]);
    }
    const set = this.food[variant] ?? this.food[0];
    return set[Math.floor(seed * set.length) % set.length];
  }

  lootSprite(): Sprite {
    return (this.loot ??= mustardCoin(128, 'dollar'));
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

  /**
   * `CoinState.halftone` provider: the coin's halftone shade rendered once per
   * on-screen size bucket. `ppu` is device pixels per world unit. Images are
   * capped at HALFTONE_MAX_PX radius: bigger coins reuse the capped image
   * scaled up (above ~20 px the dot spacing is a fixed share of r, so the
   * pattern is the same, only softer). The cache is cleared past HALFTONE_MAX_BYTES.
   */
  halftone(r: number, spacing: number, ppu: number): HTMLCanvasElement | null {
    const px = r * ppu;
    if (px < 10) return null;
    const bucket = Math.min(Math.round(Math.log(px) / Math.log(HALFTONE_STEP)), HALFTONE_MAX_BUCKET);
    let c = this.halftones.get(bucket);
    if (!c) {
      const R = Math.ceil(HALFTONE_STEP ** bucket);
      c = document.createElement('canvas');
      c.width = c.height = R * 2;
      const ctx = c.getContext('2d')!;
      ctx.translate(R, R);
      // same spacing rule as the art (r × 0.075, at least 3 screen px)
      drawHalftoneDots(ctx, R, Math.max(R * 0.075, (spacing / r) * R));
      const bytes = c.width * c.height * 4;
      if (this.halftones.size >= 64 || this.halftoneBytes + bytes > HALFTONE_MAX_BYTES) {
        this.halftones.clear();
        this.halftoneBytes = 0;
      }
      this.halftones.set(bucket, c);
      this.halftoneBytes += bytes;
    }
    return c;
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
