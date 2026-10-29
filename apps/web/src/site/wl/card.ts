import { CARD_PAPER, INK, PAPER, RISO } from '@elymum/art';
import { drawCoinLook } from '../../render/coin';
import { lookForHandle, seeded, hash32, ticketNo } from '../coinLook';

/** The shareable WL ticket card: 1200 × 675 (X shows 16:9 images whole). */
export const CARD_W = 1200;
export const CARD_H = 675;

const DISPLAY = "'Bricolage Grotesque Variable', 'Bricolage Grotesque', system-ui, sans-serif";
const MONO = "'DM Mono', ui-monospace, monospace";
const PINK_TEXT = '#C71466';
const INK_2 = '#5B5577';

/** Waits for the card's fonts (so the first draw is not in a fallback face). */
export async function cardFonts(): Promise<void> {
  try {
    await Promise.all([document.fonts.load(`800 80px ${DISPLAY}`), document.fonts.load(`500 30px ${MONO}`)]);
  } catch {
    /* no font loading API: draw with what there is */
  }
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

/** Text shrunk to fit `maxW`, starting at `size`. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: string, family: string, size: number, maxW: number): number {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > 18 && ctx.measureText(text).width > maxW) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${family}`;
  }
  return s;
}

/** Draws the riso ticket card for `handle` (normalised, no `@`; empty shows a placeholder). */
export function drawTicketCard(canvas: HTMLCanvasElement, handle: string): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  if (canvas.width !== CARD_W || canvas.height !== CARD_H) {
    canvas.width = CARD_W;
    canvas.height = CARD_H;
  }
  const name = handle || 'yourhandle';
  const look = lookForHandle(name);
  const no = handle ? ticketNo(handle) : '0000';
  const r = seeded(hash32(`grain:${name}`));

  // paper and its grain
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = INK;
  for (let i = 0; i < 2600; i++) {
    ctx.globalAlpha = 0.03 + r() * 0.05;
    ctx.fillRect(r() * CARD_W, r() * CARD_H, 1.6, 1.6);
  }
  ctx.globalAlpha = 1;

  // halftone bloom behind the ticket, in the coin's second ink
  ctx.save();
  ctx.fillStyle = look.overprint;
  ctx.globalAlpha = 0.28;
  for (let y = 0; y < CARD_H; y += 14) {
    for (let x = 0; x < 620; x += 14) {
      const d = Math.hypot(x - 260, y - 330) / 360;
      const rad = Math.max(0, 4.6 * (1 - d));
      if (rad < 0.4) continue;
      ctx.beginPath();
      ctx.arc(x + (y % 28 ? 7 : 0), y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  const X = 56;
  const Y = 64;
  const W = CARD_W - 112;
  const H = CARD_H - 128;
  const PERF = X + W - 300;

  // the second pass, printed off register
  ctx.fillStyle = RISO.fluoPink;
  roundRect(ctx, X + 14, Y + 14, W, H, 26);
  ctx.fill();

  // ticket stock with notches at the perforation
  ctx.save();
  roundRect(ctx, X, Y, W, H, 26);
  ctx.fillStyle = CARD_PAPER;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
  for (const ny of [Y, Y + H]) {
    ctx.beginPath();
    ctx.arc(PERF, ny, 24, 0, Math.PI * 2);
    ctx.fillStyle = PAPER;
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.arc(PERF, ny, 24, ny === Y ? 0 : Math.PI, ny === Y ? Math.PI : Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([12, 12]);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(PERF, Y + 34);
  ctx.lineTo(PERF, Y + H - 34);
  ctx.stroke();
  ctx.setLineDash([]);

  // the coin
  const cx = X + 190;
  const cy = Y + H / 2 + 8;
  ctx.save();
  ctx.fillStyle = look.overprint;
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  ctx.arc(cx, cy, 164, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  drawCoinLook(ctx, cx, cy, 134, look, { time: 0, lookX: 0.35, lookY: 0.15, expression: handle ? 'happy' : 'sleep', pxPerUnit: 1, seed: hash32(name) % 1000 });

  // the copy
  const tx = X + 378;
  const maxW = PERF - tx - 36;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = PINK_TEXT;
  ctx.font = `500 26px ${MONO}`;
  ctx.fillText('SLANA  ·  WL TICKET', tx, Y + 86);

  const at = `@${name}`;
  const size = fitFont(ctx, at, '800', DISPLAY, 104, maxW);
  const hy = Y + 86 + 26 + size * 0.95;
  ctx.font = `800 ${size}px ${DISPLAY}`;
  ctx.fillStyle = RISO.fluoPink;
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillText(at, tx + size * 0.045, hy + size * 0.04);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = handle ? INK : INK_2;
  ctx.fillText(at, tx, hy);

  ctx.fillStyle = INK;
  ctx.font = `500 34px ${MONO}`;
  ctx.fillText(`NO. ${no}`, tx, hy + 74);
  ctx.fillStyle = INK_2;
  ctx.font = `500 21px ${MONO}`;
  ctx.fillText('ADMIT ONE  ·  ARENA OPENS SOON', tx, Y + H - 92);
  ctx.fillText('EAT. GROW. LAST THE ROUND.', tx, Y + H - 58);

  // the stub
  const sx = PERF + 36;
  const sw = X + W - sx - 36;
  ctx.font = `800 168px ${DISPLAY}`;
  ctx.fillStyle = RISO.teal;
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillText('WL', sx + 9, Y + 236);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = INK;
  ctx.fillText('WL', sx, Y + 228);
  ctx.font = `500 26px ${MONO}`;
  ctx.fillText('SLANA.IO', sx, Y + 290);
  ctx.fillStyle = INK_2;
  ctx.fillText('@SLANAIO', sx, Y + 326);

  // the stamp
  ctx.save();
  ctx.translate(sx + sw / 2 + 4, Y + H - 108);
  ctx.rotate(-0.22);
  ctx.strokeStyle = PINK_TEXT;
  ctx.fillStyle = PINK_TEXT;
  ctx.lineWidth = 6;
  ctx.globalAlpha = 0.92;
  ctx.beginPath();
  ctx.arc(0, 0, 70, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, 58, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = `500 30px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.fillText(handle ? 'VALID' : 'BLANK', 0, 4);
  ctx.font = `500 15px ${MONO}`;
  ctx.fillText('ROUND 001', 0, 30);
  ctx.restore();
  ctx.textAlign = 'left';
}

/** The card as a PNG. */
export function cardBlob(handle: string): Promise<Blob | null> {
  const c = document.createElement('canvas');
  drawTicketCard(c, handle);
  return new Promise((resolve) => {
    try {
      c.toBlob((b) => resolve(b), 'image/png');
    } catch {
      resolve(null);
    }
  });
}
