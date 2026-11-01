import { CellFlag } from '@elymum/shared';
import { drawAccessoryBack, drawAccessoryFront, symbolAnchor, type AccessoryColors } from './accessories';
import { drawFace, type Expression, type FaceOpts } from './faces';
import type { CoinLook } from './looks';
import { CARD_PAPER, ELYSIUM, INK, shadeOf } from './palette';
import { drawSymbol } from './symbols';

const TAU = Math.PI * 2;

/**
 * Minimal structural view of the web client's jelly outline
 * (`apps/web/src/render/jelly.ts` JellyBody satisfies it).
 */
export interface JellyLike {
  /** Adds the wobbly outline for radius r as a closed sub-path (no beginPath). */
  trace(ctx: CanvasRenderingContext2D, r: number): void;
  /**
   * Smallest and largest radial displacement of the outline right now, as a
   * fraction of r (optional; without it a cached interior is never used).
   */
  extent?(): { min: number; max: number };
  /**
   * Optional: adds the shade region without a clip, as two closed sub-paths whose even-odd fill is
   * the outline for radius r minus the disc at (lx, ly) of radius lr (no beginPath). Without it the
   * shade is clipped to `trace` (an anti-aliased clip: the most expensive step of a wobbly coin).
   */
  traceShade?(ctx: CanvasRenderingContext2D, r: number, lx: number, ly: number, lr: number): void;
}

/** A cached coin interior (see `CoinState.interior` and `drawCoinInterior`). */
export interface CoinInterior {
  image: CanvasImageSource;
  /** Width and height of the (square) image, px. */
  size: number;
  /** The coin radius it was drawn at, px (the image centre is the coin centre). */
  radius: number;
}

/**
 * Interior disc radius (fraction of r) of a cached interior. The ink outline
 * (drawn after it) covers the disc edge while the jelly outline stays within
 * half the outline width of the circle (`jellyCalm`), so the disc never shows
 * past the outline or leaves a gap.
 */
const INTERIOR_DISC = 0.995;

export interface CoinState {
  /** Milliseconds; drives blinking, the chomp, spinning props and flag effects. 0 = still frame. */
  time: number;
  /** Eye direction, each in -1..1. */
  lookX: number;
  lookY: number;
  expression: Expression;
  jelly?: JellyLike | null;
  /** CellFlag bits (shield, cash-out, magnet, pump, afk). */
  flags?: number;
  alpha?: number;
  /** Per-character phase (blink timing). */
  seed?: number;
  /** Screen pixels per unit of r (camera zoom × dpr); sets the level of detail and the ink line width. Default 1. */
  pxPerUnit?: number;
  /** Cash-out progress 0..1 for the dotted ring; animated from `time` when omitted. */
  cashout?: number;
  /** @deprecated the riso halftone is gone; ignored. */
  halftone?: (r: number, spacing: number) => CanvasImageSource | null;
  /** @deprecated every body is one flat fill now; ignored. */
  fastBody?: boolean;
  /**
   * Below this many screen px of radius the coin skips its fine interior
   * details (inner groove, highlight) and never uses the interior cache.
   * 0 / unset: always drawn.
   */
  minPrintPx?: number;
  /**
   * Optional cache for the coin's static interior: the cel-shaded body, inner
   * groove, highlight and embossed symbol in one image (`drawCoinInterior`
   * rendered at about r × pxPerUnit px). Return null to draw the layers
   * directly. Used only for opaque coins when the jelly outline stays close
   * to the circle; the result looks the same.
   */
  interior?: (look: CoinLook, r: number) => CoinInterior | null;
}

/** Offset of the lit disc (units of r): the shade is the crescent it leaves on the lower right. */
const LIT_DX = -6 / 46;
const LIT_DY = -8 / 46;
const LIT_L = Math.hypot(LIT_DX, LIT_DY);
const LIT_A = Math.atan2(LIT_DY, LIT_DX);
const LIT_HALF = Math.acos(LIT_L / 2);
/** Highlight arc: upper left, from 195° to 241°, on 0.8 r. */
const HL_A0 = (195.5 * Math.PI) / 180;
const HL_A1 = (241 * Math.PI) / 180;

/**
 * Ink outline of a coin in screen px for its on-screen radius: about 3 px at
 * normal sizes (spec: illustration strokes stay ~3 px), thinner on tiny
 * coins, a touch heavier on huge ones.
 */
export function coinOutlinePx(detail: number): number {
  return detail < 22 ? Math.max(1, detail * 0.135) : Math.min(4.5, 3 + Math.max(0, (detail - 160) / 200));
}

/** The shade crescent (disc of radius r minus the lit disc), as a new path. */
function crescentPath(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  ctx.arc(0, 0, r, LIT_A + LIT_HALF, LIT_A + TAU - LIT_HALF, false);
  ctx.arc(LIT_DX * r, LIT_DY * r, r, LIT_A + Math.PI + LIT_HALF, LIT_A + Math.PI - LIT_HALF, true);
  ctx.closePath();
}

function shadeFor(look: CoinLook): string {
  return look.shade ?? shadeOf(look.body);
}

/** Inner groove and the white highlight arc (static, proportional to r). */
function drawRimDetails(ctx: CanvasRenderingContext2D, look: CoinLook, r: number): void {
  ctx.save();
  ctx.globalAlpha *= 0.9;
  ctx.strokeStyle = shadeFor(look);
  ctx.lineWidth = r * 0.054;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.815, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha /= 0.9;
  ctx.globalAlpha *= 0.85;
  ctx.strokeStyle = ELYSIUM.white;
  ctx.lineCap = 'round';
  ctx.lineWidth = r * 0.105;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.8, HL_A0, HL_A1);
  ctx.stroke();
  ctx.restore();
}

/** Scratch option objects (drawing is synchronous and never re-enters: no per-coin garbage). */
const EMBOSS = { fill: '', ink: INK, overprint: INK, lineW: 0, emboss: true };
const STAMP = { fill: CARD_PAPER, ink: INK, overprint: INK, lineW: 0, offX: 0, offY: 0 };
const ANCHOR = { x: 0, y: 0, s: 0, onTop: false };
const ACC: AccessoryColors = { body: '', accent: '', lineW: 0 };
const FACE: FaceOpts = { expression: 'happy', eyes: 'round', mouth: 'smile', lookX: 0, lookY: 0, time: 0, seed: 0, detail: 0, blush: '', body: '', lineW: 0 };

function drawEmbossedSymbol(ctx: CanvasRenderingContext2D, look: CoinLook, anchor: { x: number; y: number; s: number }): void {
  ctx.save();
  ctx.translate(anchor.x, anchor.y);
  EMBOSS.fill = shadeFor(look);
  drawSymbol(ctx, look.symbol, anchor.s, EMBOSS);
  ctx.restore();
}

/**
 * The static interior of a coin of radius r px at the origin, for caching
 * (`CoinState.interior`): flat body, the one shade tone on the lower right,
 * inner groove, highlight and the embossed symbol (when it sits on the face).
 * Drawn at one screen px per unit, like `drawRisoCoin` with pxPerUnit 1.
 */
export function drawCoinInterior(ctx: CanvasRenderingContext2D, look: CoinLook, r: number): void {
  const rd = r * INTERIOR_DISC;
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, rd, 0, TAU);
  ctx.fillStyle = look.body;
  ctx.fill();
  crescentPath(ctx, rd);
  ctx.fillStyle = shadeFor(look);
  ctx.fill();
  drawRimDetails(ctx, look, r);
  const anchor = symbolAnchor(look.accessory, r, ANCHOR);
  if (!anchor.onTop) drawEmbossedSymbol(ctx, look, anchor);
  ctx.restore();
}

function drawCoinSymbol(ctx: CanvasRenderingContext2D, look: CoinLook, anchor: { x: number; y: number; s: number }, lineW: number): void {
  ctx.save();
  ctx.translate(anchor.x, anchor.y);
  STAMP.lineW = Math.min(lineW * 0.5, anchor.s * 0.2);
  STAMP.offX = anchor.s * 0.14;
  STAMP.offY = anchor.s * 0.14;
  drawSymbol(ctx, look.symbol, anchor.s, STAMP);
  ctx.restore();
}

function bodyPath(ctx: CanvasRenderingContext2D, r: number, jelly: JellyLike | null | undefined, detail: number): void {
  ctx.beginPath();
  if (jelly && detail > 16) jelly.trace(ctx, r);
  else ctx.arc(0, 0, r, 0, TAU);
}

/** Cheek colour that reads on the body paint (memoised: no string work per coin per frame). */
const BLUSH = new Map<string, string>();
function blushFor(body: string): string {
  let c = BLUSH.get(body);
  if (c === undefined) {
    const b = body.toUpperCase();
    c = b === ELYSIUM.blush || b === ELYSIUM.down ? ELYSIUM.coral : ELYSIUM.blush;
    BLUSH.set(body, c);
  }
  return c;
}

/**
 * The coin's shadow on the floor: a flat ink ellipse under it (no blur). Draw
 * every coin's shadow before the coins, at the caller's alpha (about 0.45 on night).
 */
export function drawCoinShadow(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  ctx.ellipse(0, r * 1.06, r * 0.76, r * 0.12, 0, 0, TAU);
  ctx.fill();
}

/**
 * Draws a Storybook coin character at the origin with radius r: confident ink
 * outline (~3 screen px), a flat cel fill with one hard shade tone on the
 * lower right, an inner groove and a white highlight, big eyes, a mood mouth
 * and coral cheeks. Layers: back accessories → body (cached interior or drawn)
 * → outline → face → front accessories → flag effects. No filters and no
 * text, so it renders the same in browsers and in @napi-rs/canvas.
 */
export function drawRisoCoin(ctx: CanvasRenderingContext2D, look: CoinLook, r: number, state: CoinState): void {
  const ppu = state.pxPerUnit ?? 1;
  const detail = r * ppu;
  const flags = state.flags ?? 0;
  const afk = (flags & CellFlag.Afk) !== 0;
  const W = coinOutlinePx(detail) / ppu;

  ctx.save();
  if (state.alpha !== undefined) ctx.globalAlpha *= state.alpha;
  if (afk) ctx.globalAlpha *= 0.7;

  // tiny: a flat paint dot with an ink edge
  if (detail < 5) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = look.body;
    ctx.fill();
    if (detail >= 2.5) {
      ctx.lineWidth = W;
      ctx.strokeStyle = INK;
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  const time = state.time;
  if (flags & CellFlag.Pump) drawSpeedLines(ctx, r, state, look.overprint, W);
  const acc = ACC;
  acc.body = look.body;
  acc.accent = look.overprint;
  acc.lineW = W;
  if (detail > 14) drawAccessoryBack(ctx, look.accessory, r, acc, time);

  const small = detail < (state.minPrintPx ?? 0);
  const anchor = symbolAnchor(look.accessory, r, ANCHOR);
  const cached = !small && detail > 22 && ctx.globalAlpha >= 0.999 && jellyCalm(state.jelly, Math.max(0.003, W / (2 * r) - (1 - INTERIOR_DISC))) ? (state.interior?.(look, r) ?? null) : null;
  if (cached) {
    const k = r / cached.radius;
    const half = (cached.size / 2) * k;
    ctx.drawImage(cached.image, -half, -half, cached.size * k, cached.size * k);
  } else {
    // flat body + the shade crescent (clipped to the wobbly outline when it is drawn)
    const wobbly = !!state.jelly && detail > 16;
    bodyPath(ctx, r, state.jelly, detail);
    ctx.fillStyle = look.body;
    ctx.fill();
    if (detail > 7) {
      ctx.fillStyle = shadeFor(look);
      if (wobbly && state.jelly!.traceShade) {
        // the outline minus the lit disc as one even-odd fill (no clip)
        ctx.beginPath();
        state.jelly!.traceShade(ctx, r, LIT_DX * r * 1.05, LIT_DY * r * 1.05, r * 1.05);
        ctx.fill('evenodd');
      } else if (wobbly) {
        ctx.save();
        ctx.clip();
        crescentPath(ctx, r * 1.05);
        ctx.fill();
        ctx.restore();
      } else {
        crescentPath(ctx, r);
        ctx.fill();
      }
    }
    if (detail > 18 && !small) drawRimDetails(ctx, look, r);
    if (!anchor.onTop && detail > 22) drawEmbossedSymbol(ctx, look, anchor);
  }

  // ink outline
  bodyPath(ctx, r, state.jelly, detail);
  ctx.lineWidth = W;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.stroke();

  drawFront(ctx, look, r, state, detail, anchor, acc, W);
  ctx.restore();
}

/** Alias with the Storybook name. */
export const drawCoinCharacter = drawRisoCoin;

/** True when there is no jelly, or its outline stays close enough to the circle for a cached interior. */
function jellyCalm(jelly: JellyLike | null | undefined, tol: number): boolean {
  if (!jelly) return true;
  const e = jelly.extent?.();
  return !!e && e.min >= -tol && e.max <= tol;
}

/** Face, front accessory, a symbol worn on the hat and the flag effects (on top of the body). */
function drawFront(
  ctx: CanvasRenderingContext2D,
  look: CoinLook,
  r: number,
  state: CoinState,
  detail: number,
  anchor: { x: number; y: number; s: number; onTop: boolean },
  acc: AccessoryColors,
  W: number,
): void {
  const flags = state.flags ?? 0;
  const afk = (flags & CellFlag.Afk) !== 0;
  const time = state.time;
  if (detail > 8) {
    const f = FACE;
    f.expression = afk ? 'sleep' : state.expression;
    f.eyes = look.eyes;
    f.mouth = look.mouth;
    f.lookX = state.lookX;
    f.lookY = state.lookY;
    f.time = time;
    f.seed = state.seed ?? 0;
    f.detail = detail;
    f.blush = blushFor(look.body);
    f.body = look.body;
    f.lineW = W * 0.95;
    drawFace(ctx, r, f);
  }

  if (detail > 14) drawAccessoryFront(ctx, look.accessory, r, acc, time);
  if (anchor.onTop && detail > 22) drawCoinSymbol(ctx, look, anchor, W);

  if (flags & CellFlag.Shield) drawShield(ctx, r, time, W);
  if (flags & CellFlag.CashingOut) drawCashout(ctx, r, state.cashout ?? ((time / 2000) % 1), W);
  if (flags & CellFlag.Magnet) drawMagnet(ctx, r, time, W);
  if (afk) drawZzz(ctx, r, time, W);
}

/** Shield: a cyan bubble around the coin (ink edge, foam inner line, a highlight). */
function drawShield(ctx: CanvasRenderingContext2D, r: number, time: number, W: number): void {
  const R = r * 1.2 * (1 + Math.sin(time / 180) * 0.015);
  ctx.save();
  ctx.globalAlpha *= 0.22;
  ctx.fillStyle = ELYSIUM.spray;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.arc(0, 0, r, 0, TAU, true);
  ctx.fill();
  ctx.globalAlpha /= 0.22;
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = W;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = ELYSIUM.spray;
  ctx.lineWidth = W * 0.9;
  ctx.beginPath();
  ctx.arc(0, 0, R - W, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = ELYSIUM.white;
  ctx.lineWidth = Math.max(W * 1.2, r * 0.05);
  ctx.beginPath();
  ctx.arc(0, 0, R - W * 1.6 - r * 0.03, HL_A0 + 0.1, HL_A1 - 0.05);
  ctx.stroke();
  ctx.restore();
}

/** Cash-out: a ring of sun dots filling up clockwise (empty ones are faint ink). */
function drawCashout(ctx: CanvasRenderingContext2D, r: number, progress: number, W: number): void {
  const n = 24;
  const R = r * 1.32;
  const filled = Math.round(Math.min(1, Math.max(0, progress)) * n);
  ctx.save();
  // multiply into the caller's alpha (a fading or AFK cell), never overwrite it
  const base = ctx.globalAlpha;
  ctx.lineWidth = W * 0.7;
  ctx.strokeStyle = INK;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * TAU;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * R, Math.sin(a) * R, i < filled ? r * 0.05 : r * 0.025, 0, TAU);
    if (i < filled) {
      ctx.fillStyle = ELYSIUM.sun;
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillStyle = INK;
      ctx.globalAlpha = base * 0.5;
      ctx.fill();
      ctx.globalAlpha = base;
    }
  }
  ctx.restore();
}

/** Magnet: two coral rings pulling inward. */
function drawMagnet(ctx: CanvasRenderingContext2D, r: number, time: number, W: number): void {
  ctx.save();
  ctx.strokeStyle = ELYSIUM.coral;
  ctx.lineWidth = W;
  ctx.lineCap = 'round';
  ctx.setLineDash([W * 0.01, W * 3.2]);
  const base = ctx.globalAlpha;
  for (let i = 0; i < 2; i++) {
    const p = (((time / 900 + i / 2) % 1) + 1) % 1;
    ctx.globalAlpha = base * (1 - p);
    ctx.beginPath();
    ctx.arc(0, 0, r * (1.55 - p * 0.45), 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

/** Pump: three ink speed lines with a sun core streaming behind the coin. */
function drawSpeedLines(ctx: CanvasRenderingContext2D, r: number, s: CoinState, color: string, W: number): void {
  const len = Math.sqrt(s.lookX * s.lookX + s.lookY * s.lookY);
  if (len < 0.1) return;
  const bx = -s.lookX / len;
  const by = -s.lookY / len;
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = -1; i <= 1; i++) {
    const px = -by * i * r * 0.45;
    const py = bx * i * r * 0.45;
    const wob = Math.sin(s.time / 60 + i) * r * 0.08;
    ctx.beginPath();
    ctx.moveTo(px + bx * r * 1.1, py + by * r * 1.1);
    ctx.lineTo(px + bx * (r * 1.55 + wob), py + by * (r * 1.55 + wob));
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(W * 2.4, r * 0.07);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(W * 2.4, r * 0.07) - W * 1.6;
    ctx.stroke();
  }
  ctx.restore();
}

/** Vector "z z z" floating up (no text rendering). */
export function drawZzz(ctx: CanvasRenderingContext2D, r: number, time: number, lineW: number): void {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = lineW;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const base = ctx.globalAlpha;
  for (let i = 0; i < 3; i++) {
    const p = time > 0 ? (((time / 1500 + i / 3) % 1) + 1) % 1 : i / 3;
    const h = r * (0.09 + i * 0.03);
    const x = r * (0.62 + p * 0.35);
    const y = -r * (0.72 + p * 0.6);
    ctx.globalAlpha = base * (time > 0 ? 1 - p : 1);
    ctx.beginPath();
    ctx.moveTo(x - h * 0.7, y - h);
    ctx.lineTo(x + h * 0.7, y - h);
    ctx.lineTo(x - h * 0.7, y + h);
    ctx.lineTo(x + h * 0.7, y + h);
    ctx.stroke();
  }
  ctx.restore();
}
