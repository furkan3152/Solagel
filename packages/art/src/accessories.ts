import { CARD_PAPER, INK, RISO } from './palette';
import type { AccessoryKind } from './looks';

const TAU = Math.PI * 2;

export interface AccessoryColors {
  /** Body ink of the coin. */
  body: string;
  /** Overprint ink: used as the accent of hats & co. */
  accent: string;
  /** Ink line width. */
  lineW: number;
}

/** Fill the current path and outline it in ink. */
function inked(ctx: CanvasRenderingContext2D, fill: string, lineW: number): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = lineW;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

const differs = (a: string, b: string, alt: string): string => (a.toUpperCase() === b.toUpperCase() ? alt : a);

/** Where the coin symbol sits for an accessory (hats carry it on the front). */
export function symbolAnchor(kind: AccessoryKind, r: number): { x: number; y: number; s: number; onTop: boolean } {
  switch (kind) {
    case 'cap':
      return { x: -r * 0.02, y: -r * 0.74, s: r * 0.13, onTop: true };
    case 'beanie':
      return { x: 0, y: -r * 0.84, s: r * 0.13, onTop: true };
    case 'cowboy':
      return { x: 0, y: -r * 0.86, s: r * 0.1, onTop: true };
    default:
      return { x: 0, y: -r * 0.5, s: r * 0.17, onTop: false };
  }
}

/** Accessories drawn BEFORE the body (they stick out from behind it). */
export function drawAccessoryBack(ctx: CanvasRenderingContext2D, kind: AccessoryKind, r: number, c: AccessoryColors, time: number): void {
  ctx.save();
  switch (kind) {
    case 'horns': {
      const fill = differs(RISO.red, c.body, RISO.mustard);
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(s * r * 0.52, -r * 0.72);
        ctx.rotate(s * 0.35);
        ctx.beginPath();
        ctx.moveTo(-r * 0.17, r * 0.12);
        ctx.quadraticCurveTo(-r * 0.12, -r * 0.2, s * r * 0.08, -r * 0.42);
        ctx.quadraticCurveTo(r * 0.14, -r * 0.16, r * 0.17, r * 0.12);
        ctx.closePath();
        inked(ctx, fill, c.lineW * 0.85);
        ctx.restore();
      }
      break;
    }
    case 'headphones': {
      // band over the head
      ctx.lineCap = 'round';
      ctx.strokeStyle = INK;
      ctx.lineWidth = r * 0.17 + c.lineW * 2;
      ctx.beginPath();
      ctx.arc(0, -r * 0.05, r * 1.0, 1.1 * Math.PI, 1.9 * Math.PI);
      ctx.stroke();
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = r * 0.17;
      ctx.stroke();
      break;
    }
    case 'halo': {
      // back half of the ring
      const y = -r * 1.12 + Math.sin(time / 420) * r * 0.03;
      ctx.lineCap = 'round';
      ctx.strokeStyle = INK;
      ctx.lineWidth = r * 0.1 + c.lineW * 2;
      ctx.beginPath();
      ctx.ellipse(0, y, r * 0.5, r * 0.14, 0, Math.PI, TAU);
      ctx.stroke();
      ctx.strokeStyle = RISO.mustard;
      ctx.lineWidth = r * 0.1;
      ctx.stroke();
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

function domePath(ctx: CanvasRenderingContext2D, r: number, w: number, base: number, top: number): void {
  ctx.beginPath();
  ctx.moveTo(-r * w, -r * base);
  ctx.bezierCurveTo(-r * w, -r * top, r * w, -r * top, r * w, -r * base);
  ctx.closePath();
}

/** Accessories drawn AFTER the face. */
export function drawAccessoryFront(ctx: CanvasRenderingContext2D, kind: AccessoryKind, r: number, c: AccessoryColors, time: number): void {
  const lw = c.lineW;
  ctx.save();
  switch (kind) {
    case 'crown': {
      ctx.translate(0, -r * 0.9);
      ctx.rotate(-0.06);
      ctx.beginPath();
      ctx.moveTo(-r * 0.42, r * 0.16);
      ctx.lineTo(-r * 0.5, -r * 0.28);
      ctx.lineTo(-r * 0.22, -r * 0.06);
      ctx.lineTo(0, -r * 0.42);
      ctx.lineTo(r * 0.22, -r * 0.06);
      ctx.lineTo(r * 0.5, -r * 0.28);
      ctx.lineTo(r * 0.42, r * 0.16);
      ctx.closePath();
      inked(ctx, differs(RISO.mustard, c.body, RISO.orange), lw * 0.85);
      [RISO.fluoPink, RISO.teal, RISO.fluoPink].forEach((g, i) => {
        ctx.beginPath();
        ctx.arc((i - 1) * r * 0.22, r * 0.04, r * 0.055, 0, TAU);
        inked(ctx, g, lw * 0.5);
      });
      for (const x of [-r * 0.5, 0, r * 0.5]) {
        ctx.beginPath();
        ctx.arc(x, x === 0 ? -r * 0.44 : -r * 0.3, r * 0.05, 0, TAU);
        inked(ctx, CARD_PAPER, lw * 0.5);
      }
      break;
    }
    case 'cap': {
      // brim towards the right, dome over the forehead
      ctx.beginPath();
      ctx.moveTo(r * 0.1, -r * 0.5);
      ctx.quadraticCurveTo(r * 0.85, -r * 0.62, r * 1.08, -r * 0.44);
      ctx.quadraticCurveTo(r * 0.8, -r * 0.36, r * 0.1, -r * 0.42);
      ctx.closePath();
      inked(ctx, c.accent, lw * 0.85);
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = 'rgba(27,23,50,0.25)'; // INK at 25 %
      ctx.fill();
      ctx.restore();
      domePath(ctx, r, 0.8, 0.46, 1.27);
      inked(ctx, c.accent, lw * 0.85);
      ctx.strokeStyle = INK;
      ctx.lineWidth = lw * 0.5;
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.0);
      ctx.quadraticCurveTo(-r * 0.12, -r * 0.7, -r * 0.05, -r * 0.48);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -r * 1.02, r * 0.06, 0, TAU);
      inked(ctx, c.accent, lw * 0.6);
      break;
    }
    case 'beanie': {
      domePath(ctx, r, 0.8, 0.5, 1.45);
      ctx.save();
      inked(ctx, c.accent, lw * 0.85);
      ctx.clip();
      ctx.strokeStyle = INK;
      ctx.globalAlpha *= 0.35;
      ctx.lineWidth = lw * 0.6;
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(i * r * 0.2, -r * 1.2);
        ctx.lineTo(i * r * 0.2, -r * 0.5);
        ctx.stroke();
      }
      ctx.restore();
      // cuff
      ctx.beginPath();
      ctx.moveTo(-r * 0.86, -r * 0.62);
      ctx.quadraticCurveTo(0, -r * 0.78, r * 0.86, -r * 0.62);
      ctx.lineTo(r * 0.84, -r * 0.42);
      ctx.quadraticCurveTo(0, -r * 0.56, -r * 0.84, -r * 0.42);
      ctx.closePath();
      inked(ctx, c.accent, lw * 0.85);
      // pompom
      ctx.beginPath();
      ctx.arc(0, -r * 1.12, r * 0.14, 0, TAU);
      inked(ctx, CARD_PAPER, lw * 0.85);
      break;
    }
    case 'halo': {
      // front half of the ring (back half is drawn behind the body)
      const y = -r * 1.12 + Math.sin(time / 420) * r * 0.03;
      ctx.lineCap = 'round';
      ctx.strokeStyle = INK;
      ctx.lineWidth = r * 0.1 + lw * 2;
      ctx.beginPath();
      ctx.ellipse(0, y, r * 0.5, r * 0.14, 0, 0, Math.PI);
      ctx.stroke();
      ctx.strokeStyle = RISO.mustard;
      ctx.lineWidth = r * 0.1;
      ctx.stroke();
      break;
    }
    case 'propeller': {
      domePath(ctx, r, 0.56, 0.78, 1.38);
      ctx.save();
      inked(ctx, c.accent, lw * 0.85);
      ctx.clip();
      ctx.fillStyle = differs(RISO.mustard, c.accent, RISO.fluoPink);
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.2);
      ctx.lineTo(-r * 0.25, -r * 0.6);
      ctx.lineTo(r * 0.25, -r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      domePath(ctx, r, 0.56, 0.78, 1.38);
      ctx.strokeStyle = INK;
      ctx.lineWidth = lw * 0.85;
      ctx.stroke();
      // stem + spinning blades
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.2);
      ctx.lineTo(0, -r * 1.36);
      ctx.stroke();
      const spin = Math.cos(time / 90);
      ctx.save();
      ctx.translate(0, -r * 1.38);
      ctx.scale(Math.abs(spin) < 0.15 ? 0.15 : spin, 1);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(s * r * 0.24, 0, r * 0.24, r * 0.07, 0, 0, TAU);
        inked(ctx, s < 0 ? RISO.fluoPink : RISO.teal, lw * 0.6);
      }
      ctx.restore();
      ctx.beginPath();
      ctx.arc(0, -r * 1.38, r * 0.05, 0, TAU);
      inked(ctx, RISO.mustard, lw * 0.5);
      break;
    }
    case 'headphones': {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(s * r * 0.98, -r * 0.08, r * 0.15, r * 0.25, 0, 0, TAU);
        inked(ctx, c.accent, lw * 0.85);
        ctx.beginPath();
        ctx.ellipse(s * r * 0.98 + s * r * 0.03, -r * 0.08, r * 0.06, r * 0.14, 0, 0, TAU);
        inked(ctx, CARD_PAPER, lw * 0.5);
      }
      break;
    }
    case 'partyHat': {
      ctx.translate(r * 0.18, -r * 0.8);
      ctx.rotate(0.22);
      const cone = () => {
        ctx.beginPath();
        ctx.moveTo(-r * 0.3, r * 0.06);
        ctx.lineTo(0, -r * 0.62);
        ctx.lineTo(r * 0.3, r * 0.06);
        ctx.quadraticCurveTo(0, r * 0.14, -r * 0.3, r * 0.06);
        ctx.closePath();
      };
      cone();
      ctx.save();
      ctx.fillStyle = c.accent;
      ctx.fill();
      ctx.clip();
      ctx.strokeStyle = differs(RISO.mustard, c.accent, RISO.fluoPink);
      ctx.lineWidth = r * 0.07;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(-r * 0.4, -r * 0.45 + i * r * 0.17);
        ctx.lineTo(r * 0.4, -r * 0.6 + i * r * 0.17);
        ctx.stroke();
      }
      ctx.restore();
      cone();
      ctx.strokeStyle = INK;
      ctx.lineWidth = lw * 0.85;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -r * 0.64, r * 0.08, 0, TAU);
      inked(ctx, CARD_PAPER, lw * 0.6);
      break;
    }
    case 'cowboy': {
      const felt = differs(RISO.brown, c.body, RISO.mustard);
      domePath(ctx, r, 0.48, 0.62, 1.45);
      inked(ctx, felt, lw * 0.85);
      // band
      ctx.beginPath();
      ctx.moveTo(-r * 0.48, -r * 0.8);
      ctx.quadraticCurveTo(0, -r * 0.9, r * 0.48, -r * 0.8);
      ctx.lineTo(r * 0.48, -r * 0.66);
      ctx.quadraticCurveTo(0, -r * 0.76, -r * 0.48, -r * 0.66);
      ctx.closePath();
      inked(ctx, c.accent, lw * 0.6);
      // brim
      ctx.beginPath();
      ctx.moveTo(-r * 1.05, -r * 0.78);
      ctx.quadraticCurveTo(-r * 0.9, -r * 0.5, 0, -r * 0.52);
      ctx.quadraticCurveTo(r * 0.9, -r * 0.5, r * 1.05, -r * 0.78);
      ctx.quadraticCurveTo(r * 0.8, -r * 0.6, 0, -r * 0.64);
      ctx.quadraticCurveTo(-r * 0.8, -r * 0.6, -r * 1.05, -r * 0.78);
      ctx.closePath();
      inked(ctx, felt, lw * 0.85);
      break;
    }
    case 'flower': {
      ctx.translate(r * 0.55, -r * 0.7);
      ctx.rotate(time / 3000);
      for (let i = 0; i < 6; i++) {
        const a = (i * TAU) / 6;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * r * 0.15, Math.sin(a) * r * 0.15, r * 0.12, r * 0.08, a, 0, TAU);
        inked(ctx, CARD_PAPER, lw * 0.55);
      }
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.09, 0, TAU);
      inked(ctx, differs(RISO.mustard, c.body, RISO.orange), lw * 0.55);
      break;
    }
    case 'laurel': {
      // two leafy branches hugging the top of the head, tips meeting at the crown
      const leaf = differs(RISO.green, c.body, RISO.mustard);
      const R = r * 0.94;
      for (const s of [-1, 1]) {
        ctx.strokeStyle = INK;
        ctx.lineWidth = lw * 0.6;
        ctx.beginPath();
        ctx.arc(0, 0, R, s < 0 ? Math.PI * 1.05 : Math.PI * 1.55, s < 0 ? Math.PI * 1.45 : Math.PI * 1.95);
        ctx.stroke();
        for (let i = 0; i < 5; i++) {
          const a = s < 0 ? Math.PI * (1.08 + i * 0.085) : Math.PI * (1.92 - i * 0.085);
          for (const side of [-1, 1]) {
            ctx.save();
            ctx.translate(Math.cos(a) * R, Math.sin(a) * R);
            // tangent pointing towards the crown, leaves fanned out either side
            ctx.rotate(a + (s < 0 ? Math.PI / 2 : -Math.PI / 2) + side * 0.6);
            ctx.beginPath();
            ctx.ellipse(r * 0.09, 0, r * 0.1, r * 0.042, 0, 0, TAU);
            inked(ctx, leaf, lw * 0.45);
            ctx.restore();
          }
        }
      }
      break;
    }
    case 'horns':
    case 'none':
      break;
  }
  ctx.restore();
}
