import type { SkinDef } from '@solagel/shared';
import { heartPath } from './symbols';

const TAU = Math.PI * 2;
export const INK = '#2B1B44';

export type Expression = 'happy' | 'hungry' | 'scared' | 'sleep' | 'dead' | 'love' | 'proud';

export interface FaceOpts {
  expression: Expression;
  /** Eye direction, each in -1..1. */
  lookX: number;
  lookY: number;
  time: number;
  seed: number;
  /** Radius on screen in px (level of detail). */
  detail: number;
}

const isBlinking = (time: number, seed: number): boolean => (time + seed * 977) % 4200 < 130;

function roundEyes(ctx: CanvasRenderingContext2D, r: number, o: FaceOpts, sparkle = false, scale = 1): void {
  const ex = r * 0.3;
  const ey = -r * 0.04;
  const er = r * 0.13 * scale;
  const lx = o.lookX * r * 0.045;
  const ly = o.lookY * r * 0.035;
  if (isBlinking(o.time, o.seed)) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = r * 0.055;
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(s * ex, ey - er * 0.2, er * 0.85, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }
    return;
  }
  for (const s of [-1, 1]) {
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.ellipse(s * ex + lx, ey + ly, er, er * 1.1, 0, 0, TAU);
    ctx.fill();
    if (o.detail > 14) {
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(s * ex + lx - er * 0.32, ey + ly - er * 0.38, er * (sparkle ? 0.42 : 0.34), 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s * ex + lx + er * 0.34, ey + ly + er * 0.36, er * (sparkle ? 0.22 : 0.15), 0, TAU);
      ctx.fill();
    }
  }
}

function closedHappyEyes(ctx: CanvasRenderingContext2D, r: number): void {
  // ^ ^
  ctx.strokeStyle = INK;
  ctx.lineWidth = r * 0.06;
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(s * r * 0.3, r * 0.02, r * 0.11, 1.15 * Math.PI, 1.85 * Math.PI);
    ctx.stroke();
  }
}

function sleepyEyes(ctx: CanvasRenderingContext2D, r: number): void {
  // ∪ ∪ with lashes
  ctx.strokeStyle = INK;
  ctx.lineWidth = r * 0.055;
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(s * r * 0.3, -r * 0.08, r * 0.11, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s * r * 0.3 + s * r * 0.11, -r * 0.03);
    ctx.lineTo(s * r * 0.3 + s * r * 0.16, -r * 0.0);
    ctx.stroke();
  }
}

function scaredEyes(ctx: CanvasRenderingContext2D, r: number): void {
  // > <
  ctx.strokeStyle = INK;
  ctx.lineWidth = r * 0.06;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of [-1, 1]) {
    const cx = s * r * 0.3;
    ctx.beginPath();
    ctx.moveTo(cx - s * r * 0.1, -r * 0.13);
    ctx.lineTo(cx + s * r * 0.06, -r * 0.04);
    ctx.lineTo(cx - s * r * 0.1, r * 0.05);
    ctx.stroke();
  }
}

function deadEyes(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = r * 0.05;
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    const cx = s * r * 0.3;
    const cy = -r * 0.04;
    const d = r * 0.08;
    ctx.beginPath();
    ctx.moveTo(cx - d, cy - d);
    ctx.lineTo(cx + d, cy + d);
    ctx.moveTo(cx + d, cy - d);
    ctx.lineTo(cx - d, cy + d);
    ctx.stroke();
  }
}

function heartEyes(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.fillStyle = '#FF4F8B';
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.translate(s * r * 0.3, -r * 0.05);
    heartPath(ctx, r * 0.13);
    ctx.fill();
    ctx.restore();
  }
}

function blush(ctx: CanvasRenderingContext2D, r: number, color: string, strength = 0.55): void {
  ctx.save();
  ctx.globalAlpha *= strength;
  ctx.fillStyle = color;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * r * 0.5, r * 0.14, r * 0.12, r * 0.07, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function smile(ctx: CanvasRenderingContext2D, r: number, width = 0.1, y = 0.17): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = r * 0.05;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, r * (y - 0.03), r * width, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
}

function catMouth(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = r * 0.045;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(-r * 0.055, r * 0.12, r * 0.055, 0.05 * Math.PI, 0.95 * Math.PI);
  ctx.arc(r * 0.055, r * 0.12, r * 0.055, 0.05 * Math.PI, 0.95 * Math.PI);
  ctx.stroke();
}

function openMouth(ctx: CanvasRenderingContext2D, r: number, big = false): void {
  const w = r * (big ? 0.16 : 0.12);
  const y = r * 0.15;
  ctx.fillStyle = '#5B1E3A';
  ctx.beginPath();
  ctx.moveTo(-w, y);
  ctx.quadraticCurveTo(0, y - w * 0.2, w, y);
  ctx.quadraticCurveTo(w, y + w * 1.45, 0, y + w * 1.45);
  ctx.quadraticCurveTo(-w, y + w * 1.45, -w, y);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#FF7A9C';
  ctx.beginPath();
  ctx.ellipse(0, y + w * 1.3, w * 0.75, w * 0.55, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function oMouth(ctx: CanvasRenderingContext2D, r: number, size = 0.06): void {
  ctx.fillStyle = '#5B1E3A';
  ctx.beginPath();
  ctx.ellipse(0, r * 0.19, r * size, r * size * 1.25, 0, 0, TAU);
  ctx.fill();
}

function wobblyMouth(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = r * 0.045;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const y = r * 0.2;
  ctx.moveTo(-r * 0.12, y);
  ctx.quadraticCurveTo(-r * 0.06, y - r * 0.05, 0, y);
  ctx.quadraticCurveTo(r * 0.06, y + r * 0.05, r * 0.12, y);
  ctx.stroke();
}

function sweatDrop(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.save();
  ctx.translate(r * 0.55, -r * 0.35);
  ctx.fillStyle = '#9FE3FF';
  ctx.strokeStyle = '#4AA8D8';
  ctx.lineWidth = r * 0.02;
  ctx.beginPath();
  const s = r * 0.1;
  ctx.moveTo(0, -s * 1.4);
  ctx.quadraticCurveTo(s, 0, 0, s);
  ctx.quadraticCurveTo(-s, 0, 0, -s * 1.4);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function snout(ctx: CanvasRenderingContext2D, r: number, color: string, nostrils: boolean): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, r * 0.2, r * 0.2, r * 0.13, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = INK;
  if (nostrils) {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * r * 0.075, r * 0.2, r * 0.03, r * 0.045, 0, 0, TAU);
      ctx.fill();
    }
  } else {
    ctx.beginPath();
    ctx.ellipse(0, r * 0.15, r * 0.07, r * 0.05, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = r * 0.03;
    ctx.beginPath();
    ctx.moveTo(0, r * 0.18);
    ctx.lineTo(0, r * 0.24);
    ctx.stroke();
  }
}

function dogNose(ctx: CanvasRenderingContext2D, r: number, tongue: boolean): void {
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(0, r * 0.11, r * 0.075, r * 0.055, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = r * 0.04;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, r * 0.15);
  ctx.lineTo(0, r * 0.2);
  ctx.arc(-r * 0.07, r * 0.2, r * 0.07, 0, Math.PI * 0.85);
  ctx.moveTo(0, r * 0.2);
  ctx.arc(r * 0.07, r * 0.2, r * 0.07, Math.PI, Math.PI * 0.15, true);
  ctx.stroke();
  if (tongue) {
    ctx.fillStyle = '#FF7A9C';
    ctx.beginPath();
    ctx.ellipse(r * 0.02, r * 0.29, r * 0.055, r * 0.075, 0.15, 0, TAU);
    ctx.fill();
  }
}

function laserEyes(ctx: CanvasRenderingContext2D, r: number, o: FaceOpts): void {
  const glow = 0.75 + 0.25 * Math.sin(o.time / 120 + o.seed);
  for (const s of [-1, 1]) {
    const cx = s * r * 0.3 + o.lookX * r * 0.04;
    const cy = -r * 0.04 + o.lookY * r * 0.03;
    // beam
    const len = r * 1.7;
    const ang = Math.atan2(o.lookY || 0.05, o.lookX || 1);
    ctx.save();
    ctx.globalAlpha *= 0.35 * glow;
    const fade = ctx.createLinearGradient(cx, cy, cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
    fade.addColorStop(0, '#FF2E4D');
    fade.addColorStop(1, 'rgba(255,46,77,0)');
    ctx.strokeStyle = fade;
    ctx.lineWidth = r * 0.09;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
    ctx.stroke();
    ctx.globalAlpha /= 0.35;
    ctx.globalAlpha *= 0.7;
    ctx.strokeStyle = '#FFD1D8';
    ctx.lineWidth = r * 0.03;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
    ctx.stroke();
    ctx.restore();
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.17);
    g.addColorStop(0, '#FFFFFF');
    g.addColorStop(0.35, '#FF5468');
    g.addColorStop(1, 'rgba(255,40,70,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.17, 0, TAU);
    ctx.fill();
  }
}

function ghostEyes(ctx: CanvasRenderingContext2D, r: number, o: FaceOpts): void {
  if (isBlinking(o.time, o.seed)) {
    sleepyEyes(ctx, r);
    return;
  }
  ctx.fillStyle = INK;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * r * 0.24 + o.lookX * r * 0.04, -r * 0.08 + o.lookY * r * 0.03, r * 0.085, r * 0.15, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(s * r * 0.24 + o.lookX * r * 0.04 - r * 0.025, -r * 0.14 + o.lookY * r * 0.03, r * 0.03, 0, TAU);
    ctx.fill();
    ctx.fillStyle = INK;
  }
}

function ninjaMask(ctx: CanvasRenderingContext2D, r: number, o: FaceOpts): void {
  ctx.fillStyle = '#1A1B26';
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.04, r * 0.82, r * 0.2, 0, 0, TAU);
  ctx.fill();
  if (isBlinking(o.time, o.seed)) {
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = r * 0.04;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * r * 0.4, -r * 0.04);
      ctx.lineTo(s * r * 0.18, -r * 0.04);
      ctx.stroke();
    }
    return;
  }
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.ellipse(s * r * 0.29, -r * 0.04, r * 0.13, r * 0.075, s * -0.15, 0, TAU);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(s * r * 0.29 + o.lookX * r * 0.05, -r * 0.04 + o.lookY * r * 0.02, r * 0.055, 0, TAU);
    ctx.fill();
  }
}

/** Draws the face of a coin character centred at (0,0) for radius r. */
export function drawFace(ctx: CanvasRenderingContext2D, r: number, skin: SkinDef, o: FaceOpts): void {
  const e = o.expression;
  const style = skin.face;

  // eyes
  if (e === 'dead') deadEyes(ctx, r);
  else if (e === 'love') heartEyes(ctx, r);
  else if (e === 'scared' && style !== 'ninja') scaredEyes(ctx, r);
  else if (e === 'sleep') sleepyEyes(ctx, r);
  else {
    switch (style) {
      case 'cool':
        break; // sunglasses accessory covers the eyes
      case 'frog':
        break; // eyes sit on top of the head (accessory)
      case 'sleepy':
        if (e === 'hungry') roundEyes(ctx, r, o, true);
        else sleepyEyes(ctx, r);
        break;
      case 'happy':
        if (e === 'proud') closedHappyEyes(ctx, r);
        else roundEyes(ctx, r, o, e === 'hungry');
        break;
      case 'laser':
        laserEyes(ctx, r, o);
        break;
      case 'ghost':
        ghostEyes(ctx, r, o);
        break;
      case 'ninja':
        ninjaMask(ctx, r, o);
        break;
      default:
        if (e === 'proud') closedHappyEyes(ctx, r);
        else roundEyes(ctx, r, o, e === 'hungry');
    }
  }
  if (o.detail < 16) return;

  // cheeks
  if (style !== 'ninja' && style !== 'laser') blush(ctx, r, skin.colors.blush, style === 'ghost' ? 0.4 : 0.55);

  // mouth
  if (e === 'scared') {
    wobblyMouth(ctx, r);
    sweatDrop(ctx, r);
    return;
  }
  if (e === 'dead') {
    oMouth(ctx, r, 0.05);
    return;
  }
  if (e === 'sleep') {
    oMouth(ctx, r, 0.035);
    return;
  }
  switch (style) {
    case 'cat':
      if (e === 'hungry') openMouth(ctx, r);
      else catMouth(ctx, r);
      break;
    case 'happy':
      openMouth(ctx, r, e === 'hungry');
      break;
    case 'dog':
      dogNose(ctx, r, e === 'hungry' || e === 'happy');
      break;
    case 'frog': {
      ctx.strokeStyle = INK;
      ctx.lineWidth = r * 0.05;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, -r * 0.2, r * 0.42, 0.22 * Math.PI, 0.78 * Math.PI);
      ctx.stroke();
      if (e === 'hungry') {
        ctx.fillStyle = '#FF7A9C';
        ctx.beginPath();
        ctx.ellipse(0, r * 0.24, r * 0.08, r * 0.05, 0, 0, TAU);
        ctx.fill();
      }
      break;
    }
    case 'bull':
      snout(ctx, r, 'rgba(255,255,255,0.55)', true);
      break;
    case 'bear':
      snout(ctx, r, 'rgba(255,236,226,0.85)', false);
      break;
    case 'ghost':
      oMouth(ctx, r, e === 'hungry' ? 0.07 : 0.05);
      break;
    case 'ninja':
      break;
    case 'cool': {
      ctx.strokeStyle = INK;
      ctx.lineWidth = r * 0.05;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-r * 0.1, r * 0.2);
      ctx.quadraticCurveTo(r * 0.05, r * 0.27, r * 0.14, r * 0.15);
      ctx.stroke();
      break;
    }
    case 'laser': {
      ctx.strokeStyle = INK;
      ctx.lineWidth = r * 0.05;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-r * 0.1, r * 0.21);
      ctx.lineTo(r * 0.1, r * 0.21);
      ctx.stroke();
      break;
    }
    default:
      if (e === 'hungry') openMouth(ctx, r);
      else smile(ctx, r);
  }
}
