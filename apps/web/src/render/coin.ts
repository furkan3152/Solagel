import { CellFlag, rainbowColor, type SkinColors, type SkinDef } from '@solagel/shared';
import { drawAccessoryBack, drawAccessoryFront } from './accessories';
import { drawFace, type Expression } from './faces';
import type { JellyBody } from './jelly';
import { drawSymbol } from './symbols';

const TAU = Math.PI * 2;

export interface CoinOpts {
  time: number;
  lookX: number;
  lookY: number;
  expression: Expression;
  /** Pixels per world unit (camera zoom × dpr) — used for LOD and min line widths. */
  pxPerUnit: number;
  jelly?: JellyBody | null;
  flags?: number;
  seed?: number;
  alpha?: number;
}

function skinColors(skin: SkinDef, time: number, seed: number): SkinColors {
  if (!skin.rainbow) return skin.colors;
  const off = seed * 37;
  return {
    light: rainbowColor(time, off, 90),
    base: rainbowColor(time, off + 30, 72),
    dark: rainbowColor(time, off + 70, 58),
    rim: rainbowColor(time, off + 90, 38),
    symbol: '#FFFFFF',
    blush: skin.colors.blush,
  };
}

function bodyPath(ctx: CanvasRenderingContext2D, r: number, jelly: JellyBody | null | undefined, detail: number): void {
  ctx.beginPath();
  if (jelly && detail > 16) jelly.trace(ctx, r);
  else ctx.arc(0, 0, r, 0, TAU);
}

/**
 * Draws one cute coin character centred at (x, y) with world radius r.
 * Layers: back accessories → jelly body (gradient + coin rim + groove + gloss)
 * → embossed symbol → face → front accessories → status effects.
 */
export function drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, skin: SkinDef, o: CoinOpts): void {
  const detail = r * o.pxPerUnit;
  const seed = o.seed ?? 0;
  const c = skinColors(skin, o.time, seed);
  const flags = o.flags ?? 0;
  const afk = (flags & CellFlag.Afk) !== 0;

  ctx.save();
  ctx.translate(x, y);
  if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
  if (afk) ctx.globalAlpha *= 0.65;

  // tiny cells: just a dot with a rim
  if (detail < 5) {
    ctx.fillStyle = c.base;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.restore();
    return;
  }

  const minPx = 1 / o.pxPerUnit;
  const rimW = Math.max(r * 0.085, 2 * minPx);

  if (flags & CellFlag.Pump) drawSpeedLines(ctx, r, o, c);
  if (detail > 14) drawAccessoryBack(ctx, skin.accessory, r, c, rimW);

  // body
  bodyPath(ctx, r, o.jelly, detail);
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.42, r * 0.08, 0, 0, r * 1.12);
  g.addColorStop(0, c.light);
  g.addColorStop(0.48, c.base);
  g.addColorStop(1, c.dark);
  ctx.save();
  if (skin.translucent) ctx.globalAlpha *= 0.85;
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.clip();
  if (skin.faceted && detail > 18) drawFacets(ctx, r);
  // embossed inner groove (coin edge)
  if (detail > 10) {
    ctx.lineWidth = Math.max(r * 0.035, minPx);
    ctx.strokeStyle = 'rgba(255,255,255,0.42)';
    ctx.beginPath();
    ctx.arc(0, r * 0.012, r * 0.8, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(40,20,70,0.14)';
    ctx.beginPath();
    ctx.arc(0, -r * 0.012, r * 0.83, 0, TAU);
    ctx.stroke();
  }
  // lower shade for volume
  const shade = ctx.createLinearGradient(0, r * 0.2, 0, r);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(40,10,60,0.12)');
  ctx.fillStyle = shade;
  ctx.fillRect(-r, 0, r * 2, r);
  ctx.restore();

  // rim
  bodyPath(ctx, r, o.jelly, detail);
  ctx.lineWidth = rimW;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = c.rim;
  ctx.stroke();

  // gloss
  if (detail > 8) {
    ctx.save();
    ctx.globalAlpha *= 0.5;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.ellipse(-r * 0.4, -r * 0.5, r * 0.26, r * 0.13, -0.6, 0, TAU);
    ctx.fill();
    ctx.globalAlpha *= 0.9;
    ctx.beginPath();
    ctx.arc(-r * 0.66, -r * 0.24, r * 0.055, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // stamped symbol on the "forehead"
  if (detail > 22 && skin.symbol !== 'none' && skin.accessory !== 'beanie' && skin.accessory !== 'headband') {
    ctx.save();
    ctx.translate(0, -r * 0.5);
    drawSymbol(ctx, skin.symbol, r * 0.175, c.symbol, c.rim);
    ctx.restore();
  }

  if (detail > 8) {
    drawFace(ctx, r, skin, { expression: afk ? 'sleep' : o.expression, lookX: o.lookX, lookY: o.lookY, time: o.time, seed, detail });
  }
  if (detail > 14) drawAccessoryFront(ctx, skin.accessory, r, c, rimW, o.time, { x: o.lookX, y: o.lookY });

  if (flags & CellFlag.Shield) drawShield(ctx, r, o.time, minPx);
  if (flags & CellFlag.Magnet) drawMagnetAura(ctx, r, o.time, minPx);
  if (afk) drawZzz(ctx, r, o.time);

  ctx.restore();
}

function drawFacets(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.save();
  ctx.globalAlpha *= 0.22;
  ctx.fillStyle = '#FFFFFF';
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * TAU;
    const a1 = ((i + 0.5) / 6) * TAU;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a0) * r, Math.sin(a0) * r);
    ctx.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawShield(ctx: CanvasRenderingContext2D, r: number, time: number, minPx: number): void {
  const pulse = 1 + Math.sin(time / 180) * 0.02;
  const R = r * 1.16 * pulse;
  const g = ctx.createRadialGradient(0, 0, r * 0.95, 0, 0, R);
  g.addColorStop(0, 'rgba(124,200,255,0)');
  g.addColorStop(1, 'rgba(124,200,255,0.35)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(160,220,255,0.95)';
  ctx.lineWidth = Math.max(r * 0.03, 2 * minPx);
  ctx.setLineDash([r * 0.18, r * 0.1]);
  ctx.lineDashOffset = -time / 30;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawMagnetAura(ctx: CanvasRenderingContext2D, r: number, time: number, minPx: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,92,147,0.55)';
  ctx.lineWidth = Math.max(r * 0.02, 1.5 * minPx);
  for (let i = 0; i < 2; i++) {
    const p = ((time / 900 + i / 2) % 1 + 1) % 1;
    ctx.globalAlpha = 1 - p;
    ctx.beginPath();
    ctx.arc(0, 0, r * (1.5 - p * 0.45), 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSpeedLines(ctx: CanvasRenderingContext2D, r: number, o: CoinOpts, c: SkinColors): void {
  const len = Math.hypot(o.lookX, o.lookY);
  if (len < 0.1) return;
  const bx = -o.lookX / len;
  const by = -o.lookY / len;
  ctx.save();
  ctx.strokeStyle = c.light;
  ctx.lineCap = 'round';
  ctx.lineWidth = r * 0.07;
  for (let i = -1; i <= 1; i++) {
    const px = -by * i * r * 0.45;
    const py = bx * i * r * 0.45;
    const wob = Math.sin(o.time / 60 + i) * r * 0.08;
    ctx.globalAlpha = 0.5 - Math.abs(i) * 0.15;
    ctx.beginPath();
    ctx.moveTo(px + bx * r * 1.05, py + by * r * 1.05);
    ctx.lineTo(px + bx * (r * 1.55 + wob), py + by * (r * 1.55 + wob));
    ctx.stroke();
  }
  ctx.restore();
}

function drawZzz(ctx: CanvasRenderingContext2D, r: number, time: number): void {
  ctx.save();
  ctx.fillStyle = '#6E56C4';
  ctx.textAlign = 'center';
  for (let i = 0; i < 3; i++) {
    const p = ((time / 1500 + i / 3) % 1 + 1) % 1;
    ctx.globalAlpha = 1 - p;
    ctx.font = `700 ${r * (0.18 + i * 0.05)}px Fredoka, system-ui, sans-serif`;
    ctx.fillText('z', r * (0.6 + p * 0.35), -r * (0.7 + p * 0.6));
  }
  ctx.restore();
}
