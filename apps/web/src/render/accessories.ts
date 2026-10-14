import type { Accessory, SkinColors } from '@slana/shared';
import { INK } from './faces';
import { starPath } from './symbols';

const TAU = Math.PI * 2;

/** Accessories drawn BEFORE the body (they stick out from behind it). */
export function drawAccessoryBack(ctx: CanvasRenderingContext2D, kind: Accessory, r: number, c: SkinColors, lineW: number): void {
  switch (kind) {
    case 'dogEars': {
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(s * r * 0.62, -r * 0.58);
        ctx.rotate(s * 0.55);
        ctx.fillStyle = c.dark;
        ctx.strokeStyle = c.rim;
        ctx.lineWidth = lineW * 0.8;
        ctx.beginPath();
        ctx.moveTo(-r * 0.22, r * 0.18);
        ctx.quadraticCurveTo(-r * 0.12, -r * 0.42, 0, -r * 0.46);
        ctx.quadraticCurveTo(r * 0.12, -r * 0.42, r * 0.22, r * 0.18);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,190,190,0.75)';
        ctx.beginPath();
        ctx.moveTo(-r * 0.1, r * 0.1);
        ctx.quadraticCurveTo(0, -r * 0.3, r * 0.1, r * 0.1);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      return;
    }
    case 'bearEars': {
      for (const s of [-1, 1]) {
        const x = s * r * 0.62;
        const y = -r * 0.66;
        ctx.fillStyle = c.base;
        ctx.strokeStyle = c.rim;
        ctx.lineWidth = lineW * 0.8;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.24, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,200,190,0.9)';
        ctx.beginPath();
        ctx.arc(x, y + r * 0.02, r * 0.12, 0, TAU);
        ctx.fill();
      }
      return;
    }
    case 'horns': {
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(s * r * 0.6, -r * 0.58);
        ctx.fillStyle = '#FFF1D2';
        ctx.strokeStyle = '#8F6A3A';
        ctx.lineWidth = lineW * 0.75;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(-s * r * 0.24, r * 0.16);
        ctx.quadraticCurveTo(s * r * 0.02, -r * 0.12, s * r * 0.38, -r * 0.62);
        ctx.quadraticCurveTo(s * r * 0.36, -r * 0.08, s * r * 0.16, r * 0.24);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = 'rgba(143,106,58,0.45)';
        ctx.lineWidth = lineW * 0.45;
        ctx.beginPath();
        ctx.moveTo(-s * r * 0.02, r * 0.02);
        ctx.lineTo(s * r * 0.12, r * 0.08);
        ctx.moveTo(s * r * 0.08, -r * 0.16);
        ctx.lineTo(s * r * 0.22, -r * 0.1);
        ctx.stroke();
        ctx.restore();
      }
      return;
    }
    default:
      return;
  }
}

/** Accessories drawn AFTER the face. */
export function drawAccessoryFront(
  ctx: CanvasRenderingContext2D,
  kind: Accessory,
  r: number,
  c: SkinColors,
  lineW: number,
  time: number,
  look: { x: number; y: number },
): void {
  switch (kind) {
    case 'bow': {
      ctx.save();
      ctx.translate(r * 0.42, -r * 0.7);
      ctx.rotate(0.35);
      ctx.fillStyle = '#FF5C93';
      ctx.strokeStyle = '#C2305F';
      ctx.lineWidth = lineW * 0.6;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(s * r * 0.32, -r * 0.26, s * r * 0.34, 0);
        ctx.quadraticCurveTo(s * r * 0.32, r * 0.26, 0, 0);
        ctx.fill();
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.08, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      return;
    }
    case 'sunglasses': {
      const lx = look.x * r * 0.03;
      ctx.fillStyle = '#1D1730';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * r * 0.08 + lx, -r * 0.14);
        ctx.lineTo(s * r * 0.5 + lx, -r * 0.14);
        ctx.quadraticCurveTo(s * r * 0.5 + lx, r * 0.08, s * r * 0.3 + lx, r * 0.08);
        ctx.quadraticCurveTo(s * r * 0.1 + lx, r * 0.08, s * r * 0.08 + lx, -r * 0.14);
        ctx.fill();
      }
      ctx.fillRect(-r * 0.1 + lx, -r * 0.13, r * 0.2, r * 0.05);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(s * r * 0.24 + lx - r * 0.06, -r * 0.07, r * 0.07, r * 0.03, -0.5, 0, TAU);
        ctx.fill();
      }
      return;
    }
    case 'frogEyes': {
      for (const s of [-1, 1]) {
        const x = s * r * 0.34;
        const y = -r * 0.72;
        ctx.fillStyle = c.base;
        ctx.strokeStyle = c.rim;
        ctx.lineWidth = lineW * 0.8;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.26, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(x, y, r * 0.17, 0, TAU);
        ctx.fill();
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(x + look.x * r * 0.06, y + look.y * r * 0.05, r * 0.1, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(x + look.x * r * 0.06 - r * 0.035, y + look.y * r * 0.05 - r * 0.035, r * 0.035, 0, TAU);
        ctx.fill();
      }
      return;
    }
    case 'beanie': {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-r * 0.78, -r * 0.42);
      ctx.quadraticCurveTo(-r * 0.75, -r * 1.12, 0, -r * 1.12);
      ctx.quadraticCurveTo(r * 0.75, -r * 1.12, r * 0.78, -r * 0.42);
      ctx.closePath();
      ctx.fillStyle = '#FF8FB8';
      ctx.fill();
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = r * 0.07;
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(i * r * 0.22, -r * 1.2);
        ctx.lineTo(i * r * 0.22, -r * 0.4);
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = '#C2507C';
      ctx.lineWidth = lineW * 0.8;
      ctx.beginPath();
      ctx.moveTo(-r * 0.78, -r * 0.42);
      ctx.quadraticCurveTo(-r * 0.75, -r * 1.12, 0, -r * 1.12);
      ctx.quadraticCurveTo(r * 0.75, -r * 1.12, r * 0.78, -r * 0.42);
      ctx.stroke();
      // cuff
      ctx.fillStyle = '#FFB3CF';
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.45, r * 0.82, r * 0.14, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      // pompom
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(0, -r * 1.14, r * 0.15, 0, TAU);
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'helmet': {
      ctx.save();
      ctx.globalAlpha *= 0.18;
      ctx.fillStyle = '#BFE6FF';
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.14, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(160,200,235,0.9)';
      ctx.lineWidth = lineW * 0.9;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.14, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = r * 0.06;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.02, 1.12 * Math.PI, 1.38 * Math.PI);
      ctx.stroke();
      // antenna
      ctx.strokeStyle = '#8A93AB';
      ctx.lineWidth = lineW * 0.6;
      ctx.beginPath();
      ctx.moveTo(r * 0.4, -r * 1.07);
      ctx.lineTo(r * 0.55, -r * 1.38);
      ctx.stroke();
      ctx.fillStyle = (time / 400) % 2 < 1 ? '#FF5C93' : '#FFC93C';
      ctx.beginPath();
      ctx.arc(r * 0.55, -r * 1.4, r * 0.07, 0, TAU);
      ctx.fill();
      return;
    }
    case 'spout': {
      const t = time / 300;
      ctx.fillStyle = '#9FDBFF';
      ctx.strokeStyle = '#4AA8D8';
      ctx.lineWidth = lineW * 0.5;
      for (let i = 0; i < 3; i++) {
        const phase = (t + i / 3) % 1;
        const a = -Math.PI / 2 + (i - 1) * 0.55;
        const d = r * (0.95 + phase * 0.45);
        const x = Math.cos(a) * d;
        const y = Math.sin(a) * d;
        const s = r * 0.1 * (1 - phase * 0.5);
        ctx.globalAlpha = 1 - phase * 0.7;
        ctx.beginPath();
        ctx.arc(x, y, s, 0, TAU);
        ctx.fill();
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      return;
    }
    case 'sparkles': {
      ctx.fillStyle = '#FFFFFF';
      for (let i = 0; i < 3; i++) {
        const a = time / 1300 + (i * TAU) / 3;
        const pulse = 0.6 + 0.4 * Math.sin(time / 200 + i * 2);
        ctx.save();
        ctx.translate(Math.cos(a) * r * 0.98, Math.sin(a) * r * 0.98);
        ctx.globalAlpha *= pulse;
        starPath(ctx, r * 0.13 * pulse, r * 0.045, 4, 0);
        ctx.fill();
        ctx.restore();
      }
      return;
    }
    case 'crown': {
      ctx.save();
      ctx.translate(0, -r * 0.82);
      ctx.fillStyle = '#FFD54A';
      ctx.strokeStyle = '#B07A00';
      ctx.lineWidth = lineW * 0.75;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(-r * 0.45, r * 0.12);
      ctx.lineTo(-r * 0.5, -r * 0.3);
      ctx.lineTo(-r * 0.22, -r * 0.08);
      ctx.lineTo(0, -r * 0.42);
      ctx.lineTo(r * 0.22, -r * 0.08);
      ctx.lineTo(r * 0.5, -r * 0.3);
      ctx.lineTo(r * 0.45, r * 0.12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      const gems = ['#FF5C93', '#7CC8FF', '#4FE0A8'];
      gems.forEach((g, i) => {
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc((i - 1) * r * 0.24, r * 0.0, r * 0.06, 0, TAU);
        ctx.fill();
      });
      ctx.restore();
      return;
    }
    case 'headband': {
      ctx.save();
      ctx.fillStyle = '#FF4F5E';
      ctx.strokeStyle = '#B5222F';
      ctx.lineWidth = lineW * 0.6;
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.42, r * 0.86, r * 0.13, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      // tails fluttering behind
      const wave = Math.sin(time / 160) * r * 0.05;
      ctx.beginPath();
      ctx.moveTo(r * 0.8, -r * 0.42);
      ctx.quadraticCurveTo(r * 1.1, -r * 0.55 + wave, r * 1.3, -r * 0.35 + wave);
      ctx.lineTo(r * 1.22, -r * 0.27 + wave);
      ctx.quadraticCurveTo(r * 1.05, -r * 0.4, r * 0.8, -r * 0.32);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      return;
    }
    default:
      return;
  }
}
