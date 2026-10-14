import { CARD_PAPER, INK, RISO } from './palette';
import { heartPath, starPath } from './symbols';
import type { EyesKind, MouthKind } from './traits';

const TAU = Math.PI * 2;

export type Expression = 'happy' | 'hungry' | 'scared' | 'sleep' | 'dead' | 'love' | 'proud';

export interface FaceOpts {
  expression: Expression;
  eyes: EyesKind;
  mouth: MouthKind;
  /** Eye direction, each in -1..1. */
  lookX: number;
  lookY: number;
  time: number;
  seed: number;
  /** Radius on screen in px (level of detail). */
  detail: number;
  /** Cheek colour. */
  blush: string;
}

const EYE_X = 0.31;
const EYE_Y = 0.04;

const isBlinking = (time: number, seed: number): boolean => time > 0 && (time + seed * 977) % 4200 < 130;

function line(ctx: CanvasRenderingContext2D, r: number, w = 0.055): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = r * w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

function look(r: number, o: FaceOpts): { lx: number; ly: number } {
  return { lx: o.lookX * r * 0.05, ly: o.lookY * r * 0.04 };
}

/* ───────────────────────────── eyes ───────────────────────────── */

function blinkLids(ctx: CanvasRenderingContext2D, r: number): void {
  line(ctx, r);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(s * r * EYE_X, r * (EYE_Y - 0.04), r * 0.1, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }
}

function oneRoundEye(ctx: CanvasRenderingContext2D, x: number, y: number, er: number, o: FaceOpts, sparkle: boolean): void {
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(x, y, er, er * 1.2, 0, 0, TAU);
  ctx.fill();
  if (o.detail > 14) {
    ctx.fillStyle = CARD_PAPER;
    ctx.beginPath();
    ctx.arc(x - er * 0.3, y - er * 0.42, er * (sparkle ? 0.44 : 0.36), 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + er * 0.32, y + er * 0.42, er * (sparkle ? 0.2 : 0.14), 0, TAU);
    ctx.fill();
  }
}

function roundEyes(ctx: CanvasRenderingContext2D, r: number, o: FaceOpts, sparkle = false, only?: -1 | 1): void {
  const { lx, ly } = look(r, o);
  const er = r * (sparkle ? 0.14 : 0.125);
  for (const s of [-1, 1] as const) {
    if (only && s !== only) continue;
    oneRoundEye(ctx, s * r * EYE_X + lx, r * EYE_Y + ly, er, o, sparkle);
  }
}

function happyArcs(ctx: CanvasRenderingContext2D, r: number, only?: -1 | 1): void {
  // ^ ^
  line(ctx, r, 0.06);
  for (const s of [-1, 1] as const) {
    if (only && s !== only) continue;
    ctx.beginPath();
    ctx.arc(s * r * EYE_X, r * (EYE_Y + 0.06), r * 0.1, 1.12 * Math.PI, 1.88 * Math.PI);
    ctx.stroke();
  }
}

function sleepyEyes(ctx: CanvasRenderingContext2D, r: number, o: FaceOpts): void {
  // heavy-lidded: the lower half of a round eye under a flat lid
  const { lx, ly } = look(r, o);
  const er = r * 0.115;
  for (const s of [-1, 1]) {
    const x = s * r * EYE_X + lx * 0.6;
    const y = r * (EYE_Y + 0.02) + ly * 0.4;
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.ellipse(x, y, er, er * 1.1, 0, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    if (o.detail > 14) {
      ctx.fillStyle = CARD_PAPER;
      ctx.beginPath();
      ctx.arc(x - er * 0.35, y + er * 0.38, er * 0.22, 0, TAU);
      ctx.fill();
    }
    line(ctx, r, 0.05);
    ctx.beginPath();
    ctx.moveTo(x - er * 1.35, y - er * 0.05 + s * 0);
    ctx.lineTo(x + er * 1.35, y - er * 0.05);
    ctx.stroke();
  }
}

function closedSleepEyes(ctx: CanvasRenderingContext2D, r: number): void {
  // ∪ ∪ with a tiny lash
  line(ctx, r);
  for (const s of [-1, 1]) {
    const cx = s * r * EYE_X;
    ctx.beginPath();
    ctx.arc(cx, r * (EYE_Y - 0.03), r * 0.1, 0.12 * Math.PI, 0.88 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + s * r * 0.1, r * (EYE_Y + 0.0));
    ctx.lineTo(cx + s * r * 0.15, r * (EYE_Y + 0.025));
    ctx.stroke();
  }
}

function starEyes(ctx: CanvasRenderingContext2D, r: number, o: FaceOpts): void {
  const { lx, ly } = look(r, o);
  const spin = Math.sin(o.time / 500 + o.seed) * 0.12;
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.translate(s * r * EYE_X + lx, r * EYE_Y + ly);
    ctx.fillStyle = INK;
    starPath(ctx, r * 0.15, r * 0.072, 5, -Math.PI / 2 + spin);
    ctx.fill();
    if (o.detail > 14) {
      ctx.fillStyle = CARD_PAPER;
      ctx.beginPath();
      ctx.arc(-r * 0.03, -r * 0.035, r * 0.026, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

function heartEyes(ctx: CanvasRenderingContext2D, r: number, o: FaceOpts, big: boolean): void {
  const { lx, ly } = look(r, o);
  const pulse = big ? 1 + Math.sin(o.time / 140) * 0.06 : 1;
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.translate(s * r * EYE_X + lx, r * (EYE_Y - 0.01) + ly);
    ctx.scale(pulse, pulse);
    heartPath(ctx, r * (big ? 0.17 : 0.14));
    ctx.fillStyle = RISO.fluoPink;
    ctx.fill();
    line(ctx, r, 0.04);
    ctx.stroke();
    if (o.detail > 14) {
      ctx.fillStyle = CARD_PAPER;
      ctx.beginPath();
      ctx.arc(-r * 0.05, -r * 0.03, r * 0.025, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

function sunglasses(ctx: CanvasRenderingContext2D, r: number, o: FaceOpts): void {
  const lx = o.lookX * r * 0.025;
  const y0 = r * (EYE_Y - 0.12);
  ctx.fillStyle = INK;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * r * 0.07 + lx, y0);
    ctx.lineTo(s * r * 0.5 + lx, y0);
    ctx.quadraticCurveTo(s * r * 0.5 + lx, y0 + r * 0.24, s * r * 0.29 + lx, y0 + r * 0.24);
    ctx.quadraticCurveTo(s * r * 0.08 + lx, y0 + r * 0.24, s * r * 0.07 + lx, y0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillRect(-r * 0.09 + lx, y0, r * 0.18, r * 0.05);
  if (o.detail > 14) {
    ctx.strokeStyle = CARD_PAPER;
    ctx.lineCap = 'round';
    ctx.lineWidth = r * 0.035;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * r * 0.3 + lx - r * 0.1, y0 + r * 0.1);
      ctx.lineTo(s * r * 0.3 + lx - r * 0.02, y0 + r * 0.04);
      ctx.stroke();
    }
  }
}

function determinedEyes(ctx: CanvasRenderingContext2D, r: number, o: FaceOpts): void {
  roundEyes(ctx, r, o);
  line(ctx, r, 0.055);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * r * 0.2, r * (EYE_Y - 0.2));
    ctx.lineTo(s * r * 0.41, r * (EYE_Y - 0.24));
    ctx.stroke();
  }
}

function dizzyEyes(ctx: CanvasRenderingContext2D, r: number, o: FaceOpts): void {
  line(ctx, r, 0.04);
  const rot = o.time / 260;
  for (const s of [-1, 1]) {
    const cx = s * r * EYE_X;
    const cy = r * EYE_Y;
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const a = rot * s + t * TAU * 2.2;
      const rr = r * 0.13 * t;
      const x = cx + Math.cos(a) * rr * s;
      const y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function scaredEyes(ctx: CanvasRenderingContext2D, r: number): void {
  // > <
  line(ctx, r, 0.06);
  for (const s of [-1, 1]) {
    const cx = s * r * EYE_X;
    ctx.beginPath();
    ctx.moveTo(cx - s * r * 0.1, r * (EYE_Y - 0.09));
    ctx.lineTo(cx + s * r * 0.06, r * EYE_Y);
    ctx.lineTo(cx - s * r * 0.1, r * (EYE_Y + 0.09));
    ctx.stroke();
  }
}

function deadEyes(ctx: CanvasRenderingContext2D, r: number): void {
  line(ctx, r, 0.05);
  for (const s of [-1, 1]) {
    const cx = s * r * EYE_X;
    const cy = r * EYE_Y;
    const d = r * 0.075;
    ctx.beginPath();
    ctx.moveTo(cx - d, cy - d);
    ctx.lineTo(cx + d, cy + d);
    ctx.moveTo(cx + d, cy - d);
    ctx.lineTo(cx - d, cy + d);
    ctx.stroke();
  }
}

function drawEyes(ctx: CanvasRenderingContext2D, r: number, o: FaceOpts): void {
  const e = o.expression;
  if (e === 'dead') return deadEyes(ctx, r);
  if (e === 'love') return heartEyes(ctx, r, o, true);
  if (e === 'scared') return scaredEyes(ctx, r);
  if (e === 'sleep') return closedSleepEyes(ctx, r);
  if (o.eyes === 'sunglasses') return sunglasses(ctx, r, o);
  if (e === 'proud') return happyArcs(ctx, r);
  const blink = isBlinking(o.time, o.seed);
  switch (o.eyes) {
    case 'round':
      return blink ? blinkLids(ctx, r) : roundEyes(ctx, r, o, e === 'hungry');
    case 'sleepy':
      return blink ? blinkLids(ctx, r) : sleepyEyes(ctx, r, o);
    case 'star':
      return starEyes(ctx, r, o);
    case 'wink':
      happyArcs(ctx, r, 1);
      return blink ? undefined : roundEyes(ctx, r, o, e === 'hungry', -1);
    case 'heart':
      return heartEyes(ctx, r, o, false);
    case 'determined':
      return blink ? blinkLids(ctx, r) : determinedEyes(ctx, r, o);
    case 'dizzy':
      return dizzyEyes(ctx, r, o);
  }
}

/* ───────────────────────────── mouths ───────────────────────────── */

const MOUTH_Y = 0.27;

function smile(ctx: CanvasRenderingContext2D, r: number, width = 0.11): void {
  line(ctx, r, 0.05);
  ctx.beginPath();
  ctx.arc(0, r * (MOUTH_Y - 0.06), r * width, 0.18 * Math.PI, 0.82 * Math.PI);
  ctx.stroke();
}

function dMouth(ctx: CanvasRenderingContext2D, r: number, w: number, h: number): void {
  const y = r * (MOUTH_Y - 0.03);
  ctx.beginPath();
  ctx.moveTo(-w, y);
  ctx.lineTo(w, y);
  ctx.bezierCurveTo(w, y + h * 1.1, -w, y + h * 1.1, -w, y);
  ctx.closePath();
}

function grin(ctx: CanvasRenderingContext2D, r: number): void {
  const w = r * 0.15;
  const h = r * 0.15;
  dMouth(ctx, r, w, h);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = CARD_PAPER;
  ctx.fillRect(-w, r * (MOUTH_Y - 0.03), w * 2, h * 0.3);
  ctx.fillStyle = RISO.fluoPink;
  ctx.beginPath();
  ctx.ellipse(0, r * (MOUTH_Y - 0.03) + h * 0.95, w * 0.6, h * 0.4, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  line(ctx, r, 0.045);
  dMouth(ctx, r, w, h);
  ctx.stroke();
}

function openMouth(ctx: CanvasRenderingContext2D, r: number, big: boolean): void {
  const w = r * (big ? 0.15 : 0.12);
  const y = r * (MOUTH_Y - 0.05);
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(-w, y);
    ctx.quadraticCurveTo(0, y - w * 0.25, w, y);
    ctx.quadraticCurveTo(w, y + w * 1.5, 0, y + w * 1.5);
    ctx.quadraticCurveTo(-w, y + w * 1.5, -w, y);
    ctx.closePath();
  };
  path();
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = RISO.fluoPink;
  ctx.beginPath();
  ctx.ellipse(0, y + w * 1.35, w * 0.75, w * 0.55, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function oMouth(ctx: CanvasRenderingContext2D, r: number, size = 0.055): void {
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(0, r * (MOUTH_Y + 0.01), r * size, r * size * 1.25, 0, 0, TAU);
  ctx.fill();
}

function catMouth(ctx: CanvasRenderingContext2D, r: number): void {
  line(ctx, r, 0.045);
  const y = r * (MOUTH_Y - 0.06);
  ctx.beginPath();
  ctx.arc(-r * 0.06, y, r * 0.06, 0.05 * Math.PI, 0.95 * Math.PI);
  ctx.moveTo(r * 0.12, y);
  ctx.arc(r * 0.06, y, r * 0.06, 0.05 * Math.PI, 0.95 * Math.PI);
  ctx.stroke();
}

function tongueMouth(ctx: CanvasRenderingContext2D, r: number): void {
  const x = r * 0.04;
  const y = r * (MOUTH_Y + 0.04);
  ctx.fillStyle = RISO.fluoPink;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.055, y - r * 0.02);
  ctx.lineTo(x - r * 0.055, y + r * 0.04);
  ctx.arc(x, y + r * 0.04, r * 0.055, Math.PI, 0, true);
  ctx.lineTo(x + r * 0.055, y - r * 0.02);
  ctx.closePath();
  ctx.fill();
  line(ctx, r, 0.035);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + r * 0.045);
  ctx.stroke();
  smile(ctx, r);
}

function fangMouth(ctx: CanvasRenderingContext2D, r: number): void {
  smile(ctx, r, 0.12);
  const x = r * 0.055;
  const y = r * (MOUTH_Y + 0.045);
  ctx.fillStyle = CARD_PAPER;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.03, y - r * 0.005);
  ctx.lineTo(x + r * 0.035, y - r * 0.015);
  ctx.lineTo(x + r * 0.012, y + r * 0.06);
  ctx.closePath();
  ctx.fill();
  line(ctx, r, 0.03);
  ctx.stroke();
}

function wobblyMouth(ctx: CanvasRenderingContext2D, r: number): void {
  line(ctx, r, 0.045);
  const y = r * (MOUTH_Y + 0.02);
  ctx.beginPath();
  ctx.moveTo(-r * 0.12, y);
  ctx.quadraticCurveTo(-r * 0.06, y - r * 0.05, 0, y);
  ctx.quadraticCurveTo(r * 0.06, y + r * 0.05, r * 0.12, y);
  ctx.stroke();
}

function sweatDrop(ctx: CanvasRenderingContext2D, r: number, time: number): void {
  ctx.save();
  ctx.translate(r * 0.56, -r * 0.3 + Math.sin(time / 200) * r * 0.02);
  const s = r * 0.1;
  ctx.beginPath();
  ctx.moveTo(0, -s * 1.4);
  ctx.quadraticCurveTo(s, 0, 0, s);
  ctx.quadraticCurveTo(-s, 0, 0, -s * 1.4);
  ctx.closePath();
  ctx.fillStyle = RISO.aqua;
  ctx.fill();
  line(ctx, r, 0.03);
  ctx.stroke();
  ctx.restore();
}

function drawMouth(ctx: CanvasRenderingContext2D, r: number, o: FaceOpts): void {
  switch (o.expression) {
    case 'scared':
      wobblyMouth(ctx, r);
      sweatDrop(ctx, r, o.time);
      return;
    case 'dead':
      return wobblyMouth(ctx, r);
    case 'sleep':
      return oMouth(ctx, r, 0.035);
    case 'hungry':
      return openMouth(ctx, r, true);
    case 'proud':
      return o.mouth === 'grin' || o.mouth === 'fang' || o.mouth === 'tongue' ? grin(ctx, r) : smile(ctx, r, 0.13);
    default:
      break;
  }
  switch (o.mouth) {
    case 'smile':
      return smile(ctx, r);
    case 'grin':
      return grin(ctx, r);
    case 'o':
      return oMouth(ctx, r);
    case 'tongue':
      return tongueMouth(ctx, r);
    case 'cat':
      return catMouth(ctx, r);
    case 'fang':
      return fangMouth(ctx, r);
  }
}

function blush(ctx: CanvasRenderingContext2D, r: number, color: string): void {
  ctx.save();
  ctx.globalAlpha *= 0.85;
  ctx.fillStyle = color;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * r * 0.53, r * 0.24, r * 0.1, r * 0.065, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** Draws a coin character's face centred on (0,0) for radius r. */
export function drawFace(ctx: CanvasRenderingContext2D, r: number, o: FaceOpts): void {
  ctx.save();
  if (o.detail >= 16 && o.eyes !== 'sunglasses') blush(ctx, r, o.blush);
  drawEyes(ctx, r, o);
  if (o.detail >= 12) drawMouth(ctx, r, o);
  ctx.restore();
}
