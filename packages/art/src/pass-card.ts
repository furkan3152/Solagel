import { twinkle } from './accessories';
import { drawRisoCoin } from './coin';
import { drawDigits, measureDigits } from './digits';
import { lookForPass } from './looks';
import { CARD_PAPER, INK, PAPERS, RISO } from './palette';
import { mulberry32 } from './rng';
import { starPath } from './symbols';
import { SEALED_LOOK, type PassTraits } from './traits';

const TAU = Math.PI * 2;

/** Paper grain: two offset layers of faint ink dots (kept off the very edge). */
function grain(ctx: CanvasRenderingContext2D, size: number, n: number): void {
  const rnd = mulberry32(0x5eed ^ Math.imul(n, 2654435761));
  const margin = size * 0.012;
  ctx.save();
  ctx.fillStyle = INK;
  for (const [step, alpha, dot] of [
    [size / 70, 0.06, size / 900],
    [size / 46, 0.045, size / 700],
  ] as const) {
    ctx.globalAlpha = alpha;
    for (let y = margin + step / 2; y < size - margin; y += step) {
      for (let x = margin + step / 2; x < size - margin; x += step) {
        const jx = x + (rnd() - 0.5) * step * 0.9;
        const jy = y + (rnd() - 0.5) * step * 0.9;
        const rr = dot * (0.6 + rnd() * 0.9);
        ctx.beginPath();
        ctx.arc(jx, jy, rr, 0, TAU);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Ticket frame: solid rule, dashed inner rule, punched notches on the sides. */
function frame(ctx: CanvasRenderingContext2D, size: number, paper: string): void {
  const m = size * 0.045;
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = size * 0.006;
  roundRect(ctx, m, m, size - m * 2, size - m * 2, size * 0.03);
  ctx.stroke();
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = size * 0.003;
  ctx.setLineDash([size * 0.012, size * 0.01]);
  roundRect(ctx, m * 1.6, m * 1.6, size - m * 3.2, size - m * 3.2, size * 0.022);
  ctx.stroke();
  ctx.restore();
  // notches
  ctx.save();
  ctx.fillStyle = paper;
  ctx.strokeStyle = INK;
  ctx.lineWidth = size * 0.006;
  for (const x of [m, size - m]) {
    ctx.beginPath();
    ctx.arc(x, size * 0.74, size * 0.03, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, size * 0.74, size * 0.03, x < size / 2 ? -Math.PI / 2 : Math.PI / 2, x < size / 2 ? Math.PI / 2 : Math.PI * 1.5);
    ctx.stroke();
  }
  ctx.restore();
}

/** "No. 0412" stamp in a rotated box at the bottom left. */
function numberStamp(ctx: CanvasRenderingContext2D, n: number, size: number, color: string): void {
  const text = `No. ${String(n).padStart(4, '0')}`;
  const h = size * 0.042;
  const w = measureDigits(text, h);
  const px = h * 0.6;
  ctx.save();
  ctx.translate(size * 0.1, size * 0.86);
  ctx.rotate(-0.05);
  ctx.globalCompositeOperation = 'multiply';
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.006;
  roundRect(ctx, 0, -px, w + px * 2, h + px * 2, size * 0.008);
  ctx.stroke();
  drawDigits(ctx, text, px, 0, h);
  ctx.restore();
}

/** Round starburst rarity stamp (legendary), top right. */
function rarityStamp(ctx: CanvasRenderingContext2D, size: number, color: string, big: boolean): void {
  const R = size * (big ? 0.085 : 0.06);
  ctx.save();
  ctx.translate(size * 0.835, size * 0.165);
  ctx.rotate(-0.2);
  ctx.globalCompositeOperation = 'multiply';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size * 0.006;
  // scalloped edge
  ctx.beginPath();
  const teeth = 22;
  for (let i = 0; i <= teeth * 2; i++) {
    const a = (i / (teeth * 2)) * TAU;
    const rr = i % 2 === 0 ? R : R * 0.92;
    if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.74, 0, TAU);
  ctx.stroke();
  if (big) {
    starPath(ctx, R * 0.5, R * 0.22);
    ctx.fill();
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(s * R * 0.5, R * 0.3);
      starPath(ctx, R * 0.16, R * 0.07);
      ctx.fill();
      ctx.restore();
    }
  } else {
    starPath(ctx, R * 0.42, R * 0.19);
    ctx.fill();
  }
  ctx.restore();
}

/** Red wax seal for unrevealed passes. */
function waxSeal(ctx: CanvasRenderingContext2D, size: number): void {
  const R = size * 0.075;
  ctx.save();
  ctx.translate(size * 0.835, size * 0.165);
  ctx.rotate(0.15);
  ctx.beginPath();
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * TAU;
    const rr = R * (1 + 0.06 * Math.sin(a * 7) + 0.03 * Math.sin(a * 3 + 1));
    if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = RISO.red;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = size * 0.005;
  ctx.stroke();
  ctx.strokeStyle = CARD_PAPER;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = size * 0.006;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.68, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.32, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/**
 * Draws a Slana Pass card (square, `size` px) at the canvas origin: paper
 * with grain, a ticket frame, the coin at 62 % of the size, a "No. 0412"
 * stamp and, for legendaries, a rarity stamp. `traits === null` draws the
 * sealed (unrevealed) pass.
 */
export function drawPassCard(ctx: CanvasRenderingContext2D, traits: PassTraits | null, n: number, size: number): void {
  const paper = traits ? PAPERS[traits.paper] : PAPERS.cream;
  ctx.save();
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, size, size);
  grain(ctx, size, n);
  frame(ctx, size, paper);

  const r = size * 0.31;
  const cx = size / 2;
  const cy = size * 0.53;

  // soft halftone "floor" shadow under the coin
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = INK;
  ctx.globalAlpha = 0.16;
  const sp = size * 0.014;
  const rx = r * 0.8;
  const ry = r * 0.1;
  for (let x = -rx; x <= rx; x += sp) {
    for (let y = -ry; y <= ry; y += sp) {
      const t = 1 - (x * x) / (rx * rx) - (y * y) / (ry * ry);
      if (t <= 0) continue;
      const dr = sp * 0.45 * Math.sqrt(t);
      ctx.beginPath();
      ctx.arc(cx + x + r * 0.08, cy + r * 1.02 + y, dr, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();

  ctx.save();
  ctx.translate(cx, cy);
  const look = traits ? lookForPass(traits) : SEALED_LOOK;
  drawRisoCoin(ctx, look, r, {
    time: 0,
    lookX: traits ? 0.25 : 0,
    lookY: traits ? 0.15 : 0,
    expression: traits ? 'happy' : 'sleep',
    pxPerUnit: 1,
  });
  if (!traits) drawSleepZ(ctx, r);
  ctx.restore();

  if (traits?.special && traits.special !== 'gold' && traits.special !== 'holo') {
    // 1/1: a couple of extra twinkles on the paper
    twinkle(ctx, size * 0.17, size * 0.3, size * 0.03, RISO.mustard, size * 0.004);
    twinkle(ctx, size * 0.86, size * 0.62, size * 0.022, RISO.fluoPink, size * 0.004);
  }

  numberStamp(ctx, n, size, traits?.rarity === 'legendary' ? '#D6245F' : INK);
  if (!traits) waxSeal(ctx, size);
  else if (traits.rarity === 'legendary') rarityStamp(ctx, size, '#D6245F', true);
  else if (traits.rarity === 'rare') rarityStamp(ctx, size, '#08716F', false);
  ctx.restore();
}

function drawSleepZ(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = r * 0.05;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  [
    [-0.74, -0.84, 0.07],
    [-0.9, -1.04, 0.09],
    [-1.04, -1.28, 0.11],
  ].forEach(([x, y, h]) => {
    ctx.beginPath();
    ctx.moveTo(r * (x - h * 0.7), r * (y - h));
    ctx.lineTo(r * (x + h * 0.7), r * (y - h));
    ctx.lineTo(r * (x - h * 0.7), r * (y + h));
    ctx.lineTo(r * (x + h * 0.7), r * (y + h));
    ctx.stroke();
  });
  ctx.restore();
}
