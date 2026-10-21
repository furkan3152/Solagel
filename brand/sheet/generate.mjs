#!/usr/bin/env node
/**
 * The Slana brand sheet (brand/brand-sheet.png, 2400×5440): logo lockups on
 * paper and night stock, the palette with hex values, type specimens, the
 * mascot and its cast, the graphic devices, and do's and don'ts.
 *
 *   node brand/sheet/generate.mjs
 *
 * Output is deterministic.
 */
import { join } from 'node:path';
import {
  ARENAS,
  BLUE,
  BRAND,
  CARD_PAPER,
  FACES,
  GOLD,
  INK,
  INK_2,
  NIGHT,
  PAPER,
  PINK,
  PINK_TEXT,
  RED,
  RISO,
  TAU,
  TEAL,
  TEAL_INK,
  arm,
  bell,
  coin,
  flame,
  font,
  grid,
  halftone,
  heroCoin,
  inkText,
  label,
  layer,
  legs,
  lookForBasicSkin,
  mono,
  paper,
  pellet,
  perforation,
  regMarks,
  render,
  roundRect,
  roundStamp,
  sans,
  saveSmall,
  smooth,
  stampAt,
  sunburst,
  tape,
  ticket,
  wordStamp,
  wordmark,
  wordmarkWidth,
} from '../lib/riso.mjs';

const W = 2400;
const H = 5440;
const L = 120;
const R = W - 120;

function section(x, no, title, y) {
  label(x, no, L, y, 22, PINK_TEXT, { spacing: 0.2 });
  font(x, 64, { weight: 800, wdth: 85 });
  x.letterSpacing = '-1px';
  x.fillStyle = INK;
  x.fillText(title, L + 80, y + 8);
  perforation(x, L, y + 34, R, y + 34, { lw: 2.5, dash: 8, alpha: 0.4 });
}

function panel(x, px, py, w, h, { fill = CARD_PAPER, shadow = INK, dark = false } = {}) {
  x.save();
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = shadow;
  roundRect(x, px + 10, py + 10, w, h, 16);
  x.fill();
  x.restore();
  roundRect(x, px, py, w, h, 16);
  x.fillStyle = fill;
  x.fill();
  x.lineWidth = 4;
  x.strokeStyle = INK;
  x.stroke();
}

function caption(x, text, px, py, color = INK_2) {
  label(x, text, px, py, 17, color, { spacing: 0.16 });
}

/** Lockup: coin mark + wordmark. */
function lockup(x, px, py, size, dark) {
  x.save();
  x.translate(px + size * 0.48, py - size * 0.36);
  heroCoin(x, size * 0.46, { face: FACES.beam, faceScale: 1.28, faceY: 0.1, symbol: 'star', ghostOver: dark });
  x.restore();
  wordmark(x, px + size * 1.08, py, size, { onDark: dark });
}

function check(x, cx, cy, s, ok) {
  x.save();
  x.beginPath();
  x.arc(cx, cy, s, 0, TAU);
  x.fillStyle = ok ? TEAL : RED;
  x.fill();
  x.lineWidth = s * 0.14;
  x.strokeStyle = INK;
  x.stroke();
  x.strokeStyle = CARD_PAPER;
  x.lineWidth = s * 0.22;
  x.lineCap = 'round';
  x.lineJoin = 'round';
  x.beginPath();
  if (ok) {
    x.moveTo(cx - s * 0.45, cy + s * 0.02);
    x.lineTo(cx - s * 0.1, cy + s * 0.35);
    x.lineTo(cx + s * 0.48, cy - s * 0.32);
  } else {
    x.moveTo(cx - s * 0.38, cy - s * 0.38);
    x.lineTo(cx + s * 0.38, cy + s * 0.38);
    x.moveTo(cx + s * 0.38, cy - s * 0.38);
    x.lineTo(cx - s * 0.38, cy + s * 0.38);
  }
  x.stroke();
  x.restore();
}

function sheet(x) {
  paper(x, W, H, 2001);
  grid(x, -10, -10, W + 20, H + 20, 40, 0.07);
  regMarks(x, W, H, 40, 14, { lw: 2 });

  // ── header ──
  label(x, 'SLANA · BRAND SHEET', L, 150, 26, INK, { spacing: 0.24 });
  label(x, 'PAPER TICKET · RISO ON BRIGHT PAPER · OCTOBER 2026', R, 150, 22, INK_2, { align: 'right', spacing: 0.2 });
  x.fillStyle = INK;
  x.fillRect(L, 172, R - L, 4);
  layer(x, W, H, (l) => halftone(l, 1500, 200, 820, 520, 16, PINK, (px, py) => {
    const d = Math.hypot(px - 1980, py - 420) / 290;
    return d < 1 ? 1 - smooth(0.35, 1, d) * 0.92 : 0;
  }), { op: 'multiply', alpha: 0.9, wear: 0.4, seed: 2002 });
  wordmark(x, L - 8, 470, 300);
  font(x, 64, { weight: 800, wdth: 85, opsz: 48 });
  x.fillStyle = INK;
  x.letterSpacing = '-1px';
  x.fillText('Eat. Grow. Last the round.', L, 590);
  sans(x, 30, 500);
  x.fillStyle = INK_2;
  x.fillText('Five-minute coin arenas on Solana. @slanaio · slana.io · $SLANA', L, 650);
  x.save();
  x.translate(1980, 420);
  x.rotate(-0.06);
  legs(x, 190, { spread: 0.34, len: 0.3, kick: 0.1 });
  arm(x, 190, Math.PI * 1.05, [-1.3, -0.5], { bend: -0.3 });
  arm(x, 190, -0.1, [1.25, -0.35], { bend: 0.2 });
  heroCoin(x, 190, { face: FACES.beam, faceScale: 1.28, faceY: 0.1, symbol: 'star' });
  x.restore();

  // ── 01 logo ──
  let y = 790;
  section(x, '01', 'Logo lockups', y);
  const lw = (R - L - 40) / 2;
  const lh = 520;
  const ly = y + 80;
  panel(x, L, ly, lw, lh, { fill: PAPER, shadow: PINK });
  panel(x, L + lw + 40, ly, lw, lh, { fill: NIGHT.paper, shadow: TEAL });
  // light
  wordmark(x, L + 70, ly + 200, 150);
  lockup(x, L + 70, ly + 400, 110, false);
  x.save();
  x.translate(L + lw - 160, ly + 330);
  x.save();
  roundRect(x, -100, -100, 200, 200, 44);
  x.clip();
  x.fillStyle = PINK;
  x.fillRect(-100, -100, 200, 200);
  x.globalCompositeOperation = 'multiply';
  sunburst(x, 0, 6, 200, 16, PINK);
  x.globalCompositeOperation = 'source-over';
  heroCoin(x, 70, { face: FACES.beam, faceScale: 1.34, faceY: 0.12, ghostA: TEAL, ghostB: null, ghostOver: true, symbol: 'star' });
  x.restore();
  roundRect(x, -100, -100, 200, 200, 44);
  x.lineWidth = 4;
  x.strokeStyle = INK;
  x.stroke();
  x.restore();
  caption(x, 'ON PAPER #FCF4DF · WORDMARK · COIN LOCKUP · ICON', L + 40, ly + lh - 30);
  // dark
  const dx = L + lw + 40;
  wordmark(x, dx + 70, ly + 200, 150, { onDark: true });
  lockup(x, dx + 70, ly + 400, 110, true);
  x.save();
  x.translate(dx + lw - 160, ly + 330);
  heroCoin(x, 92, { face: FACES.beam, faceScale: 1.3, faceY: 0.1, symbol: 'star', ghostOver: true });
  x.restore();
  caption(x, 'ON NIGHT STOCK #19142E · PASSES PRINT OVER, NOT MULTIPLY', dx + 40, ly + lh - 30, '#B1ACCC');

  // ── 02 palette ──
  y = ly + lh + 130;
  section(x, '02', 'Palette', y);
  const core = [
    ['INK', INK, 'outlines, faces, text. never pure black', CARD_PAPER],
    ['PAPER', PAPER, 'page and world stock', INK],
    ['CARD', CARD_PAPER, 'tickets, cards, knock-outs', INK],
    ['RISO PINK', PINK, 'hero ink, offset ghost, CTAs', INK],
    ['RISO TEAL', TEAL, 'second ink, stamps, success', INK],
    ['GOLD', GOLD, 'coins, loot, tape', INK],
  ];
  const sw = (R - L - 5 * 30) / 6;
  const sy0 = y + 80;
  core.forEach(([name, hex, use, on], i) => {
    const px = L + i * (sw + 30);
    x.save();
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = i % 2 ? PINK : TEAL;
    roundRect(x, px + 9, sy0 + 9, sw, 300, 14);
    x.fill();
    x.restore();
    roundRect(x, px, sy0, sw, 300, 14);
    x.fillStyle = hex;
    x.fill();
    x.lineWidth = 4;
    x.strokeStyle = INK;
    x.stroke();
    font(x, 40, { weight: 800, wdth: 85 });
    x.fillStyle = on;
    x.letterSpacing = '-0.5px';
    x.fillText(name, px + 26, sy0 + 66);
    mono(x, 30, 0.04);
    x.fillText(hex.toUpperCase(), px + 26, sy0 + 270);
    sans(x, 22, 500);
    x.fillStyle = INK_2;
    const words = use;
    x.fillText(words, px + 4, sy0 + 340);
  });
  // arena inks
  const ay = sy0 + 400;
  label(x, 'ARENA INKS', L, ay, 20, INK, { spacing: 0.2 });
  const aw = (R - L - 3 * 30) / 4;
  ARENAS.forEach((a, i) => {
    const px = L + i * (aw + 30);
    x.save();
    x.translate(px, ay + 30);
    const t = ticket(x, { w: aw, h: 150, stripe: a.ink, shadow: a.ink, perfAt: 0.74, lw: 3.5, radius: 12, stripeW: 0.05 });
    x.restore();
    x.save();
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = a.ink;
    roundRect(x, px + aw * 0.08, ay + 60, aw * 0.18, 90, 10);
    x.fill();
    x.restore();
    roundRect(x, px + aw * 0.08, ay + 60, aw * 0.18, 90, 10);
    x.lineWidth = 3;
    x.strokeStyle = INK;
    x.stroke();
    font(x, 40, { weight: 800, wdth: 85 });
    x.fillStyle = INK;
    x.letterSpacing = '-0.5px';
    x.fillText(a.name, px + aw * 0.31, ay + 100);
    mono(x, 24, 0.04);
    x.fillStyle = INK_2;
    x.fillText(a.ink.toUpperCase(), px + aw * 0.31, ay + 140);
    coin(x, px + aw * 0.87, ay + 105, 30, lookForBasicSkin([2, 3, 1, 5][i]), { expression: 'happy' });
  });
  // text-safe inks
  const ty = ay + 250;
  label(x, 'TEXT-SAFE ON PAPER (4.5:1+)', L, ty, 20, INK, { spacing: 0.2 });
  const safe = [
    ['--ink-2', '#5B5577'],
    ['--pink-text', '#C71466'],
    ['--teal-ink', '#0F736E'],
    ['--mustard-text', '#885F0D'],
    ['--blue-ink', '#2F53F9'],
    ['--red-ink', '#CB1C0D'],
  ];
  safe.forEach(([n, hex], i) => {
    const px = L + i * ((R - L) / 6);
    x.beginPath();
    x.arc(px + 26, ty + 56, 24, 0, TAU);
    x.fillStyle = hex;
    x.fill();
    x.lineWidth = 3;
    x.strokeStyle = INK;
    x.stroke();
    mono(x, 22, 0.02);
    x.fillStyle = hex;
    x.fillText(n, px + 64, ty + 50);
    x.fillStyle = INK_2;
    x.fillText(hex, px + 64, ty + 78);
  });

  // ── 03 type ──
  y = ty + 170;
  section(x, '03', 'Type', y);
  const ty0 = y + 80;
  panel(x, L, ty0, 1360, 560, { shadow: PINK });
  label(x, 'BRICOLAGE GROTESQUE · 800 · WIDTH 85 · DISPLAY', L + 40, ty0 + 56, 20, INK_2, { spacing: 0.16 });
  inkText(x, 'Aa', L + 30, ty0 + 330, 300);
  inkText(x, 'Coins eat coins.', L + 520, ty0 + 200, 92);
  inkText(x, 'Last the round.', L + 520, ty0 + 300, 92, { ghostA: null });
  sans(x, 30, 500);
  x.fillStyle = INK_2;
  x.fillText('Body: Bricolage 500 at text size. Short, plain', L + 524, ty0 + 380);
  x.fillText('sentences; numbers set in full: 250,000 $SLANA.', L + 524, ty0 + 420);
  label(x, 'HEADLINES: SENTENCE CASE · TRACKING -2.5% · RISO GHOSTS ON', L + 40, ty0 + 520, 18, INK_2, { spacing: 0.14 });
  panel(x, L + 1400, ty0, R - L - 1400, 560, { shadow: TEAL });
  label(x, 'DM MONO · 500 · LABELS', L + 1440, ty0 + 56, 20, INK_2, { spacing: 0.16 });
  mono(x, 120, 0);
  x.fillStyle = INK;
  x.fillText('Aa 05', L + 1440, ty0 + 220);
  label(x, 'ADMIT ONE · ARENA 01', L + 1440, ty0 + 300, 30, INK, { spacing: 0.16 });
  label(x, '5-MIN ROUNDS · ON SOLANA', L + 1440, ty0 + 350, 30, TEAL_INK, { spacing: 0.16 });
  label(x, 'SLANA.IO/WL', L + 1440, ty0 + 400, 30, PINK_TEXT, { spacing: 0.06 });
  label(x, '0123456789 $ % · ', L + 1440, ty0 + 450, 30, INK_2, { spacing: 0.1 });
  label(x, 'UPPER CASE · TRACKED +14-20%', L + 1440, ty0 + 520, 18, INK_2, { spacing: 0.14 });

  // ── 04 mascot ──
  y = ty0 + 660;
  section(x, '04', 'The Slana coin and the pond', y);
  const my = y + 80;
  panel(x, L, my, 760, 640, { shadow: GOLD });
  layer(x, W, H, (l) => halftone(l, L + 4, my + 4, 752, 632, 14, PINK, (px, py) => {
    const d = Math.hypot(px - (L + 380), py - (my + 300)) / 300;
    return d < 1 ? 1 - smooth(0.35, 1, d) * 0.92 : 0;
  }), { op: 'multiply', alpha: 0.85, wear: 0.4, seed: 2003 });
  x.save();
  x.translate(L + 380, my + 300);
  x.rotate(-0.05);
  heroCoin(x, 210, { expression: 'hungry', mouth: 'grin', faceScale: 1.3, faceY: 0.1, symbol: 'star', lookX: 0.3 });
  x.restore();
  caption(x, 'GOLD BODY · REEDED EDGE · STAR · OVERSIZED FACE', L + 40, my + 610);
  // expressions
  const ex = L + 800;
  const faces = [
    ['BEAM', { face: FACES.beam }],
    ['HUNGRY', { expression: 'hungry', mouth: 'grin' }],
    ['SCARED', { expression: 'scared' }],
    ['LOVE', { expression: 'love', eyes: 'heart' }],
    ['PAID', { face: FACES.money }],
    ['GULP', { face: FACES.gulp }],
    ['CRY', { face: FACES.cry }],
    ['REKT', { face: FACES.dizzy }],
  ];
  const fw = (R - ex) / 4;
  faces.forEach(([name, o], i) => {
    const cx = ex + fw * (i % 4) + fw / 2;
    const cy = my + 120 + Math.floor(i / 4) * 200;
    x.save();
    x.translate(cx, cy);
    heroCoin(x, 70, { faceScale: 1.3, faceY: 0.1, symbol: 'star', ...o });
    x.restore();
    label(x, name, cx, cy + 102, 17, INK_2, { align: 'center', spacing: 0.18 });
  });
  // the cast
  const cy2 = my + 520;
  const names = ['SOLLY', 'GOLDIE', 'PENNY', 'MINTY', 'BUBBLES', 'SKYE', 'ZESTY', 'GRAPE'];
  const cw = (R - ex) / 8;
  names.forEach((n, i) => {
    const cx = ex + cw * i + cw / 2;
    coin(x, cx, cy2, 44, lookForBasicSkin(i), { expression: i === 5 ? 'sleep' : 'happy' });
    label(x, n, cx, cy2 + 80, 15, INK_2, { align: 'center', spacing: 0.12 });
  });
  label(x, 'THE CAST · THE EIGHT BASIC SKINS FROM PACKAGES/ART', ex, my + 448, 17, INK_2, { spacing: 0.16 });

  // ── 05 devices ──
  y = my + 740;
  section(x, '05', 'Paper goods', y);
  const dy = y + 90;
  const dw = (R - L - 4 * 30) / 5;
  const devices = ['TICKET + PERFORATION', 'MASKING TAPE', 'RUBBER STAMP', 'HALFTONE SCREEN', 'MISREGISTRATION'];
  devices.forEach((n, i) => {
    const px = L + i * (dw + 30);
    roundRect(x, px, dy, dw, 300, 14);
    x.strokeStyle = INK;
    x.globalAlpha = 0.35;
    x.lineWidth = 2;
    x.setLineDash([8, 8]);
    x.stroke();
    x.setLineDash([]);
    x.globalAlpha = 1;
    caption(x, n, px + 20, dy + 280);
  });
  x.save();
  x.translate(L + 40, dy + 70);
  ticket(x, { w: dw - 80, h: 120, stripe: PINK, shadow: TEAL, perfAt: 0.7, lw: 3.5 });
  label(x, 'ADMIT ONE', 30, 50, 16, INK_2);
  font(x, 34, { weight: 800, wdth: 85 });
  x.fillStyle = INK;
  x.fillText('Penny Pond', 28, 92);
  x.restore();
  tape(x, L + dw + 30 + dw / 2, dy + 130, dw * 0.7, 70, -0.2, GOLD, 2004);
  tape(x, L + dw + 30 + dw / 2, dy + 190, dw * 0.5, 54, 0.3, PINK, 2005);
  stampAt(x, W, H, L + (dw + 30) * 2 + dw / 2, dy + 130, -0.15, (l) => roundStamp(l, 95, 'ON SOLANA * 5-MIN ROUNDS * ', { color: TEAL_INK, size: 17, lw: 4 }), { seed: 2006 });
  layer(x, W, H, (l) => halftone(l, L + (dw + 30) * 3 + 20, dy + 20, dw - 40, 220, 16, PINK, (px) => smooth(L + (dw + 30) * 3, L + (dw + 30) * 3 + dw, px)), { op: 'multiply', wear: 0.3, seed: 2007 });
  const mx = L + (dw + 30) * 4 + dw / 2;
  inkText(x, 'slana', mx, dy + 175, 120, { align: 'center', offA: [-0.04, -0.035], offB: [0.06, 0.055] });

  // ── 06 do / don't ──
  y = dy + 400;
  section(x, '06', "Do's and don'ts", y);
  const gy = y + 80;
  const gw = (R - L - 3 * 30) / 4;
  const gh = 330;
  const tiles = [
    [true, 'Ink #1B1732 for black'],
    [true, 'Links ride a ticket stub'],
    [true, 'Ghosts small, down-right'],
    [true, 'Paper around the coin'],
    [false, 'No stretching the mark'],
    [false, 'No soft shadows, gradients'],
    [false, 'No off-palette neon'],
    [false, 'No text over halftone'],
  ];
  tiles.forEach(([ok, text], i) => {
    const px = L + (i % 4) * (gw + 30);
    const py = gy + Math.floor(i / 4) * (gh + 40);
    panel(x, px, py, gw, gh, { shadow: ok ? TEAL : RED });
    x.save();
    x.beginPath();
    x.roundRect(px + 4, py + 4, gw - 8, gh - 80, 12);
    x.clip();
    const cx = px + gw / 2;
    const cy = py + 130;
    if (i === 0) {
      x.fillStyle = INK;
      roundRect(x, cx - 150, cy - 70, 300, 140, 12);
      x.fill();
      wordmark(x, cx - 128, cy + 34, 92, { onDark: true });
    } else if (i === 1) {
      x.save();
      x.translate(cx - 190, cy - 45);
      const t = ticket(x, { w: 380, h: 90, stripe: PINK, shadow: PINK, perfAt: 0.55, lw: 3 });
      font(x, 30, { weight: 800, wdth: 85 });
      x.fillStyle = INK;
      x.fillText('Join the WL', 22, 58);
      mono(x, 22, 0);
      x.fillStyle = PINK_TEXT;
      x.fillText('slana.io/wl', t.perfX + 14, 54);
      x.restore();
    } else if (i === 2) {
      wordmark(x, cx - 150, cy + 40, 120);
    } else if (i === 3) {
      x.save();
      x.translate(cx, cy + 4);
      heroCoin(x, 92, { face: FACES.beam, faceScale: 1.28, faceY: 0.1 });
      x.restore();
    } else if (i === 4) {
      x.save();
      x.translate(cx - 175, cy + 40);
      x.scale(1.7, 0.75);
      wordmark(x, 0, 0, 110);
      x.restore();
    } else if (i === 5) {
      const g = x.createLinearGradient(cx - 150, cy - 60, cx + 150, cy + 60);
      g.addColorStop(0, '#8A2BE2');
      g.addColorStop(1, '#00BFFF');
      x.save();
      x.shadowColor = 'rgba(0,0,0,0.55)';
      x.shadowBlur = 24;
      x.shadowOffsetY = 10;
      font(x, 120, { weight: 800, wdth: 85 });
      x.fillStyle = g;
      x.fillText('slana', cx - 150, cy + 40);
      x.restore();
    } else if (i === 6) {
      x.fillStyle = '#000000';
      x.fillRect(px, py, gw, gh);
      font(x, 120, { weight: 800, wdth: 85 });
      x.fillStyle = '#39FF14';
      x.fillText('slana', cx - 150, cy + 40);
      x.fillStyle = '#FF00FF';
      x.beginPath();
      x.arc(cx + 150, cy - 60, 22, 0, TAU);
      x.fill();
    } else if (i === 7) {
      x.save();
      x.globalCompositeOperation = 'multiply';
      halftone(x, px, py, gw, gh, 20, TEAL, () => 0.85);
      x.restore();
      sans(x, 28, 500);
      x.fillStyle = INK_2;
      x.fillText('Five short steps, one', cx - 150, cy - 10);
      x.fillText('free signature.', cx - 150, cy + 30);
    }
    x.restore();
    check(x, px + 50, py + gh - 42, 24, ok);
    font(x, 32, { weight: 800, wdth: 85 });
    x.fillStyle = INK;
    x.letterSpacing = '-0.3px';
    x.fillText(text, px + 90, py + gh - 31);
  });

  // footer
  const fy = H - 90;
  perforation(x, L, fy - 40, R, fy - 40, { lw: 2.5, dash: 8, alpha: 0.4 });
  label(x, 'SOURCES: DOCS/DESIGN/PALETTE.MD · PACKAGES/SHARED/SRC/PALETTE.TS · PACKAGES/ART', L, fy, 18, INK_2, { spacing: 0.14 });
  label(x, 'REBUILD: NODE BRAND/SHEET/GENERATE.MJS', R, fy, 18, INK_2, { align: 'right', spacing: 0.14 });
}

console.log('Slana brand sheet');
const c = render(W, H, (x) => sheet(x), { ss: 1, seed: 2100, grainAmt: 5 });
saveSmall(c, BRAND, 'brand-sheet.png', 4);
