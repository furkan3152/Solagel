import { CellFlag } from '@slana/shared';
import { drawAccessoryBack, drawAccessoryFront, symbolAnchor, twinkle } from './accessories';
import { drawFace, type Expression } from './faces';
import type { CoinLook } from './looks';
import { CARD_PAPER, INK, RISO } from './palette';
import { drawSymbol } from './symbols';

const TAU = Math.PI * 2;

/**
 * Minimal structural view of the web client's jelly outline
 * (`apps/web/src/render/jelly.ts` JellyBody satisfies it).
 */
export interface JellyLike {
  /** Adds the wobbly outline for radius r as a closed sub-path (no beginPath). */
  trace(ctx: CanvasRenderingContext2D, r: number): void;
}

export interface CoinState {
  /** Milliseconds; drives blinking, spinning props and flag effects. 0 = still frame. */
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
  /** Screen pixels per unit of r (camera zoom × dpr); sets the level of detail. Default 1. */
  pxPerUnit?: number;
  /** Cash-out progress 0..1 for the dotted ring; animated from `time` when omitted. */
  cashout?: number;
  /**
   * Optional cache for the halftone shade (the costliest layer: hundreds of
   * dots). Called with the radius and dot spacing; return an image of
   * `drawHalftoneDots(ctx, r, spacing)` rendered into a 2r × 2r box (origin at
   * its centre), or null to draw the dots directly.
   */
  halftone?: (r: number, spacing: number) => CanvasImageSource | null;
  /**
   * Fast opaque body (one flat fill instead of paper + multiply). Visually the
   * same; opt-in for the live renderer only. Off for Pass images (byte-stable).
   */
  fastBody?: boolean;
  /**
   * Below this many screen px of radius the overprint pass and the halftone are
   * skipped (they are invisible that small). 0 / unset: always drawn.
   */
  minPrintPx?: number;
}

function bodyPath(ctx: CanvasRenderingContext2D, r: number, jelly: JellyLike | null | undefined, detail: number): void {
  ctx.beginPath();
  if (jelly && detail > 16) jelly.trace(ctx, r);
  else ctx.arc(0, 0, r, 0, TAU);
}

/** Pick a cheek colour that reads on the body ink. */
function blushFor(body: string): string {
  const b = body.toUpperCase();
  return b === RISO.fluoPink || b === RISO.red || b === RISO.purple ? RISO.mustard : RISO.fluoPink;
}

/**
 * Draws a risograph coin character at the origin with radius r.
 * Layers: back accessories → overprint (misregistered second ink, multiply)
 * → body ink (multiply) → ink rim → halftone shade → specials → symbol →
 * face → front accessories → flag effects. No filters and no text, so it
 * renders the same in browsers and in @napi-rs/canvas.
 */
export function drawRisoCoin(ctx: CanvasRenderingContext2D, look: CoinLook, r: number, state: CoinState): void {
  const ppu = state.pxPerUnit ?? 1;
  const detail = r * ppu;
  const flags = state.flags ?? 0;
  const afk = (flags & CellFlag.Afk) !== 0;
  const seed = state.seed ?? 0;
  const minPx = 1 / ppu;
  const rimW = Math.max(r * 0.07, 1.5 * minPx);
  const lineW = Math.max(r * 0.045, 1.2 * minPx);

  ctx.save();
  if (state.alpha !== undefined) ctx.globalAlpha *= state.alpha;
  if (afk) ctx.globalAlpha *= 0.7;

  // tiny: a flat ink dot with a rim
  if (detail < 5) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = look.body;
    ctx.fill();
    ctx.restore();
    return;
  }

  const time = state.time;
  if (flags & CellFlag.Pump) drawSpeedLines(ctx, r, state, look.overprint, lineW);
  const acc = { body: look.body, accent: look.overprint, lineW };
  if (detail > 14) drawAccessoryBack(ctx, look.accessory, r, acc, time);

  // 1. overprint: the second ink, misregistered, peeking out from under the body
  const ox = (look.offset.dx * r) / 40;
  const oy = (look.offset.dy * r) / 40;
  const small = detail < (state.minPrintPx ?? 0);
  if (small) {
    // tiny on screen: a plain offset fill under the body reads the same (no clip, no blend)
    ctx.save();
    ctx.translate(ox, oy);
    bodyPath(ctx, r, state.jelly, detail);
    ctx.fillStyle = look.overprint;
    ctx.fill();
    ctx.restore();
  } else {
    ctx.save();
    ctx.beginPath();
    ctx.rect(-r * 3, -r * 3, r * 6, r * 6);
    if (state.jelly && detail > 16) state.jelly.trace(ctx, r * 0.96);
    else ctx.arc(0, 0, r * 0.96, 0, TAU);
    ctx.clip('evenodd');
    ctx.translate(ox, oy);
    ctx.globalCompositeOperation = 'multiply';
    bodyPath(ctx, r, state.jelly, detail);
    ctx.fillStyle = look.overprint;
    ctx.fill();
    ctx.restore();
  }

  // 2. body ink, over a paper base so it reads the same on any background.
  // `fastBody` (web renderer only): an opaque body is one flat fill of ink × paper
  // instead of a paper fill plus a multiply blend. Pass images keep the exact
  // two-step print so their bytes never change.
  bodyPath(ctx, r, state.jelly, detail);
  if (state.fastBody && ctx.globalAlpha >= 0.999) {
    ctx.fillStyle = inkOnPaper(look.body);
    ctx.fill();
  } else {
    ctx.fillStyle = CARD_PAPER;
    ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = look.body;
    ctx.fill();
    ctx.restore();
  }

  // 3. ink rim (+ the coin's inner groove)
  const gold = look.special === 'gold' || (look.special?.startsWith('oneOfOne') ?? false);
  if (detail > 10 && !gold) {
    ctx.save();
    ctx.globalAlpha *= 0.4;
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(r * 0.03, minPx);
    ctx.setLineDash([r * 0.09, r * 0.06]);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.8, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
  bodyPath(ctx, r, state.jelly, detail);
  ctx.lineWidth = rimW;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.stroke();

  // 4. halftone shade on the lower-right crescent
  if (detail > 18 && !small) {
    ctx.save();
    bodyPath(ctx, r - rimW * 0.5, state.jelly, detail);
    ctx.clip();
    const spacing = Math.max(r * 0.075, 3 * minPx);
    const cached = state.halftone?.(r, spacing) ?? null;
    // Dark ink dots at 30 % read the same multiplied or laid over; a cached image
    // is laid over (source-over), which GPUs blend without reading the target back.
    ctx.globalCompositeOperation = cached ? 'source-over' : 'multiply';
    ctx.globalAlpha *= 0.3;
    if (cached) ctx.drawImage(cached, -r, -r, r * 2, r * 2);
    else drawHalftoneDots(ctx, r, spacing);
    ctx.restore();
  }

  // specials
  if (look.special === 'holo' || (look.special && look.special.startsWith('oneOfOne'))) {
    ctx.save();
    bodyPath(ctx, r - rimW * 0.5, state.jelly, detail);
    ctx.clip();
    drawHolo(ctx, r, time);
    ctx.restore();
  }
  if (gold) drawGoldLeaf(ctx, r, rimW, lineW, time);

  // 5. symbol
  const anchor = symbolAnchor(look.accessory, r);
  const sym = () => {
    if (detail <= 22) return;
    ctx.save();
    ctx.translate(anchor.x, anchor.y);
    drawSymbol(ctx, look.symbol, anchor.s, {
      fill: CARD_PAPER,
      ink: INK,
      overprint: look.overprint,
      lineW: Math.max(anchor.s * 0.2, minPx),
      offX: (look.offset.dx * anchor.s) / 22,
      offY: (look.offset.dy * anchor.s) / 22,
    });
    ctx.restore();
  };
  if (!anchor.onTop) sym();

  // 6. face
  if (detail > 8) {
    drawFace(ctx, r, {
      expression: afk ? 'sleep' : state.expression,
      eyes: look.eyes,
      mouth: look.mouth,
      lookX: state.lookX,
      lookY: state.lookY,
      time,
      seed,
      detail,
      blush: blushFor(look.body),
    });
  }

  // 7. accessory
  if (detail > 14) drawAccessoryFront(ctx, look.accessory, r, acc, time);
  if (anchor.onTop) sym();

  // 8. flag effects
  if (flags & CellFlag.Shield) drawShield(ctx, r, time, lineW);
  if (flags & CellFlag.CashingOut) drawCashout(ctx, r, state.cashout ?? ((time / 2000) % 1), lineW);
  if (flags & CellFlag.Magnet) drawMagnet(ctx, r, time, lineW);
  if (afk) drawZzz(ctx, r, time, lineW);

  ctx.restore();
}

const paperInk = new Map<string, string>();

/** `ink` multiplied onto card paper, as a hex colour (cached). */
function inkOnPaper(ink: string): string {
  let c = paperInk.get(ink);
  if (!c) {
    const a = parseHex(ink);
    const p = parseHex(CARD_PAPER);
    c = a && p ? `#${[0, 1, 2].map((i) => Math.round((a[i] * p[i]) / 255).toString(16).padStart(2, '0')).join('')}` : ink;
    paperInk.set(ink, c);
  }
  return c;
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Rotated (45°) halftone grid whose dots grow towards the lower right, in
 * plain INK at the current alpha (the coin multiplies it in at 30 %). Exported
 * so renderers can cache it per size (see `CoinState.halftone`).
 */
export function drawHalftoneDots(ctx: CanvasRenderingContext2D, r: number, sp: number): void {
  const cx = -r * 0.24;
  const cy = -r * 0.28;
  const inner = r * 0.86;
  const band = r * 0.42;
  const c = Math.SQRT1_2;
  const n = Math.ceil((r * 1.5) / sp);
  ctx.fillStyle = INK;
  // one path per dot: a single path with thousands of arcs is pathologically slow in Skia
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const x = (i - j) * sp * c;
      const y = (i + j) * sp * c;
      if (x * x + y * y > r * r) continue;
      const d = Math.hypot(x - cx, y - cy) - inner;
      if (d <= 0) continue;
      const t = Math.min(1, d / band);
      const dr = sp * 0.5 * Math.sqrt(t) * 0.92;
      if (dr < sp * 0.08) continue;
      ctx.beginPath();
      ctx.arc(x, y, dr, 0, TAU);
      ctx.fill();
    }
  }
}

/** Iridescent diagonal bands (holo foil). */
function drawHolo(ctx: CanvasRenderingContext2D, r: number, time: number): void {
  const bands = ['#9FF0F5', '#D9C9FF', '#FFC6DA', '#C6F5DE', '#FFF1B0'];
  const w = r * 0.32;
  const shift = ((time / 40) % (w * bands.length)) - w * bands.length;
  ctx.save();
  ctx.globalAlpha *= 0.3;
  ctx.rotate(-Math.PI / 5);
  for (let k = 0, x = -r * 2 + shift; x < r * 2; x += w, k++) {
    ctx.fillStyle = bands[k % bands.length];
    ctx.fillRect(x, -r * 1.5, w * 0.62, r * 3);
  }
  ctx.restore();
}

/** Gold-leaf edge: a mustard band between two ink lines, with twinkles. */
function drawGoldLeaf(ctx: CanvasRenderingContext2D, r: number, rimW: number, lineW: number, time: number): void {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = r * 0.1 + lineW * 1.6;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.84, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = RISO.mustard;
  ctx.lineWidth = r * 0.1;
  ctx.stroke();
  ctx.strokeStyle = CARD_PAPER;
  ctx.globalAlpha *= 0.85;
  ctx.lineWidth = r * 0.025;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.84, 1.08 * Math.PI, 1.38 * Math.PI);
  ctx.stroke();
  ctx.restore();
  const p = 0.75 + 0.25 * Math.sin(time / 260);
  twinkle(ctx, -r * 0.86, -r * 0.62, r * 0.13 * p, RISO.mustard, rimW * 0.45);
  twinkle(ctx, r * 0.92, r * 0.5, r * 0.09 * (1.75 - p), RISO.mustard, rimW * 0.45);
}

function drawShield(ctx: CanvasRenderingContext2D, r: number, time: number, lineW: number): void {
  const R = r * 1.2 * (1 + Math.sin(time / 180) * 0.015);
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = lineW;
  ctx.lineCap = 'round';
  ctx.setLineDash([r * 0.16, r * 0.11]);
  ctx.lineDashOffset = -time / 30;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function drawCashout(ctx: CanvasRenderingContext2D, r: number, progress: number, lineW: number): void {
  const n = 24;
  const R = r * 1.32;
  const filled = Math.round(Math.min(1, Math.max(0, progress)) * n);
  ctx.save();
  // multiply into the caller's alpha (a fading or AFK cell), never overwrite it
  const base = ctx.globalAlpha;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * TAU;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * R, Math.sin(a) * R, i < filled ? r * 0.045 : r * 0.025, 0, TAU);
    if (i < filled) {
      ctx.fillStyle = RISO.mustard;
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = lineW * 0.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = INK;
      ctx.globalAlpha = base * 0.45;
      ctx.fill();
      ctx.globalAlpha = base;
    }
  }
  ctx.restore();
}

function drawMagnet(ctx: CanvasRenderingContext2D, r: number, time: number, lineW: number): void {
  ctx.save();
  ctx.strokeStyle = RISO.fluoPink;
  ctx.lineWidth = lineW * 0.7;
  ctx.setLineDash([r * 0.05, r * 0.07]);
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

function drawSpeedLines(ctx: CanvasRenderingContext2D, r: number, s: CoinState, color: string, lineW: number): void {
  const len = Math.hypot(s.lookX, s.lookY);
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
    ctx.lineWidth = lineW * 1.4;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineW * 0.6;
    ctx.stroke();
  }
  ctx.restore();
}

/** Vector "z z z" floating up (no text rendering). */
export function drawZzz(ctx: CanvasRenderingContext2D, r: number, time: number, lineW: number): void {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = lineW * 0.9;
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
