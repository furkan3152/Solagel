/**
 * X post and story designs. Every design is `draw(x, W, H, opts)` and lays
 * itself out for three shapes: wide (1600×900), square (1080×1080) and tall
 * (1080×1920 stories). Shared chrome (paper, grid, registration marks, the
 * masthead and the perforated footer) keeps them one family.
 */
import {
  ARENAS,
  MUSTARD_TEXT as MUSTARD,
  BLUE,
  CARD_PAPER,
  FACES,
  GOLD,
  INK,
  INK_2,
  PINK,
  PINK_TEXT,
  RED,
  RISO,
  TAU,
  TEAL,
  TEAL_INK,
  arm,
  bell,
  burstLines,
  coin,
  confetti,
  flame,
  fmt,
  font,
  grid,
  halftone,
  heroCoin,
  inkText,
  label,
  layer,
  legs,
  lookForBasicSkin,
  measure,
  mono,
  paper,
  pellet,
  perforation,
  regMarks,
  rectStamp,
  rng,
  roundRect,
  roundStamp,
  sans,
  sealedCard,
  smooth,
  sparkle,
  speedLines,
  stampAt,
  stopwatch,
  sunburst,
  tape,
  ticket,
  wordStamp,
  wordmark,
  wordmarkWidth,
} from './riso.mjs';
import { arenaScene } from './scenes.mjs';

export const shapeOf = (W, H) => (W / H > 1.3 ? 'wide' : H / W > 1.3 ? 'tall' : 'square');

// ── shared chrome ───────────────────────────────────────────────────────────

/** Wraps `text` into lines no wider than `maxW` at the current font. */
export function wrap(x, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (x.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function body(x, text, px, py, size, maxW, { color = INK_2, lh = 1.32, weight = 500, align = 'left' } = {}) {
  sans(x, size, weight);
  x.fillStyle = color;
  x.textAlign = align;
  const lines = wrap(x, text, maxW);
  lines.forEach((l, i) => x.fillText(l, px, py + i * size * lh));
  x.textAlign = 'left';
  return py + (lines.length - 1) * size * lh;
}

/**
 * Paper, grid, registration marks, the masthead (wordmark + handle) and a
 * perforated footer with a ticket number. Returns the layout margins.
 */
export function chrome(x, W, H, { seed = 1, no = '001', foot = 'SLANA.IO', base, gridOn = true, dark = false, masthead = true, footer = true } = {}) {
  const shape = shapeOf(W, H);
  const M = shape === 'wide' ? 72 : 64;
  paper(x, W, H, seed, base);
  if (gridOn) grid(x, -10, -10, W + 20, H + 20, shape === 'wide' ? 40 : 36, dark ? 0.12 : 0.08, dark ? CARD_PAPER : TEAL);
  regMarks(x, W, H, 30, 11, { lw: 1.6, ghosts: !dark });
  const top = shape === 'tall' ? 150 : M;
  if (masthead) {
    const ws = shape === 'wide' ? 58 : 54;
    wordmark(x, M - 4, top + ws * 0.78, ws, { onDark: dark });
    label(x, '@SLANAIO', W - M, top + ws * 0.62, shape === 'wide' ? 20 : 19, dark ? CARD_PAPER : INK, { align: 'right', spacing: 0.16 });
  }
  const fy = shape === 'tall' ? H - 150 : H - 44;
  if (footer) {
    perforation(x, M, fy - 34, W - M, fy - 34, { lw: 2.2, dash: 7, color: dark ? CARD_PAPER : INK, alpha: 0.45 });
    label(x, `NO. ${no}`, M, fy, 17, dark ? CARD_PAPER : INK_2, { spacing: 0.16 });
    label(x, foot, W - M, fy, 17, dark ? CARD_PAPER : INK_2, { align: 'right', spacing: 0.16 });
  }
  return { M, top, fy, shape };
}

/** The CTA: a ticket whose stub carries the link. */
export function ctaTicket(x, px, py, w, h, { left = 'ADMIT ONE', main = 'Join the WL', url = 'slana.io/wl', stripe = PINK, shadow = PINK, rot = -0.012, tapeSeed = 7, tapeOn = true } = {}) {
  const stub = Math.min(w * 0.46, Math.max(w * 0.36, url.length * h * 0.27 + h * 0.5));
  x.save();
  x.translate(px, py);
  x.rotate(rot);
  const t = ticket(x, { w, h, stripe, shadow, perfAt: (w - stub) / w, lw: 3.2, radius: 10, stripeW: 0.03 });
  const pad = w * 0.06;
  label(x, left, pad, h * 0.34, Math.max(13, h * 0.15), INK_2, { spacing: 0.16 });
  font(x, h * 0.36, { weight: 800, wdth: 85, opsz: 48 });
  x.letterSpacing = `${-0.01 * h}px`;
  x.fillStyle = INK;
  x.fillText(main, pad, h * 0.76);
  // arrow
  const aw = x.measureText(main).width;
  const ax = pad + aw + h * 0.16;
  const ay = h * 0.64;
  if (ax + h * 0.3 < t.perfX - h * 0.12) {
    x.strokeStyle = INK;
    x.lineWidth = h * 0.05;
    x.lineCap = 'round';
    x.lineJoin = 'round';
    x.beginPath();
    x.moveTo(ax, ay);
    x.lineTo(ax + h * 0.3, ay);
    x.moveTo(ax + h * 0.18, ay - h * 0.11);
    x.lineTo(ax + h * 0.3, ay);
    x.lineTo(ax + h * 0.18, ay + h * 0.11);
    x.stroke();
  }
  mono(x, Math.min(h * 0.3, (stub - h * 0.3) / (url.length * 0.62)), 0);
  x.fillStyle = PINK_TEXT;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(url, t.perfX + stub / 2, h * 0.52);
  x.textAlign = 'left';
  x.textBaseline = 'alphabetic';
  x.restore();
  if (tapeOn) tape(x, px + 8, py + 10, h * 0.8, h * 0.3, 0.85, GOLD, tapeSeed);
}

/** Halftone sun in a worn multiply layer. */
function haloSun(x, W, H, cx, cy, R, color = PINK, { sp = 15, seed = 2, alpha = 0.9 } = {}) {
  layer(
    x,
    W,
    H,
    (l) => {
      halftone(l, cx - R - 20, cy - R - 20, R * 2 + 40, R * 2 + 40, sp, color, (px, py) => {
        const d = Math.hypot(px - cx, py - cy) / R;
        return d < 1 ? 1 - smooth(0.35, 1, d) * 0.92 : 0;
      });
    },
    { op: 'multiply', alpha, wear: 0.4, seed },
  );
}

function cornerWash(x, W, H, cx, cy, R, color = TEAL, { sp = 13, seed = 3, alpha = 0.7 } = {}) {
  layer(
    x,
    W,
    H,
    (l) => {
      halftone(l, Math.max(0, cx - R), Math.max(0, cy - R), R * 2, R * 2, sp, color, (px, py) => 1 - smooth(0.2, 1, Math.hypot(px - cx, py - cy) / R));
    },
    { op: 'multiply', alpha, wear: 0.4, seed },
  );
}

/** Hero coin with arms and legs, waving and holding up a ticket. */
export function coinHoldingTicket(x, cx, cy, r, { word = 'WL', top = 'ADMIT ONE', stripe = PINK, rot = -0.06, expression = 'happy', face = 'beam' } = {}) {
  x.save();
  x.translate(cx, cy);
  x.rotate(rot);
  legs(x, r, { spread: 0.34, len: 0.3, kick: 0.12 });
  arm(x, r, Math.PI * 1.02, [-1.32, -0.42], { bend: -0.3 });
  arm(x, r, -0.15, [1.18, -0.78], { bend: 0.25, handR: 0 });
  heroCoin(x, r, { expression, face: FACES[face], faceScale: 1.25, faceY: 0.1, symbol: 'star' });
  // the ticket in the raised hand
  x.save();
  x.translate(r * 1.12, -r * 0.95);
  x.rotate(-0.38);
  const tw = r * 1.02;
  const th = r * 0.5;
  x.translate(-tw * 0.18, -th * 0.72);
  const t = ticket(x, { w: tw, h: th, stripe, shadow: TEAL, perfAt: 0.7, lw: r * 0.022, radius: r * 0.04 });
  label(x, top, tw * 0.09, th * 0.3, th * 0.12, INK_2, { spacing: 0.14 });
  font(x, th * 0.42, { weight: 800, wdth: 80 });
  x.fillStyle = INK;
  x.fillText(word, tw * 0.09, th * 0.76);
  x.save();
  x.translate(t.perfX + tw * 0.15, th * 0.5);
  x.fillStyle = PINK;
  x.strokeStyle = INK;
  x.lineWidth = r * 0.016;
  x.beginPath();
  x.arc(0, 0, th * 0.17, 0, TAU);
  x.fill();
  x.stroke();
  x.restore();
  x.restore();
  // mitten over the ticket
  x.fillStyle = CARD_PAPER;
  x.strokeStyle = INK;
  x.lineWidth = r * 0.045;
  x.beginPath();
  x.arc(r * 1.18, -r * 0.78, r * 0.13, 0, TAU);
  x.fill();
  x.stroke();
  x.restore();
}

// ── 1. WL is open ───────────────────────────────────────────────────────────

export function wlOpen(x, W, H) {
  const { M, top, fy, shape } = chrome(x, W, H, { seed: 101, no: '001 · WL ROUND 001', foot: 'SLANA NFT · ALLOWLIST' });
  if (shape === 'wide') {
    haloSun(x, W, H, 1190, 470, 390, PINK, { seed: 102 });
    label(x, 'SLANA NFT · ALLOWLIST', M, 226, 24, PINK_TEXT, { spacing: 0.18 });
    x.fillStyle = INK;
    x.fillRect(M, 242, 330, 3);
    inkText(x, 'WL is', M - 6, 412, 206);
    inkText(x, 'open.', M - 6, 588, 206);
    body(x, 'A few short tasks on X and one free signature. Every entry is checked by hand.', M, 652, 28, 640);
    ctaTicket(x, M, 712, 600, 88, { main: 'Join the WL', url: 'slana.io/wl' });
    confetti(x, 860, 130, 680, 640, 16, 104, { size: [7, 13], avoid: (px, py) => Math.hypot(px - 1190, py - 480) < 330 });
    coinHoldingTicket(x, 1170, 500, 205);
    stampAt(x, W, H, 1420, 700, -0.2, (l) => roundStamp(l, 82, 'WL OPEN * SLANA NFT * ROUND 001 * ', { color: TEAL_INK, size: 15, lw: 4 }), { seed: 105 });
  } else if (shape === 'square') {
    haloSun(x, W, H, 790, 640, 330, PINK, { seed: 102 });
    label(x, 'SLANA NFT · ALLOWLIST', M, 214, 22, PINK_TEXT, { spacing: 0.18 });
    x.fillStyle = INK;
    x.fillRect(M, 230, 300, 3);
    inkText(x, 'WL is', M - 6, 400, 196);
    inkText(x, 'open.', M - 6, 568, 196);
    body(x, 'A few short tasks on X and one free signature.', M, 640, 28, 420);
    confetti(x, 560, 420, 480, 440, 9, 104, { size: [6, 12], avoid: (px, py) => Math.hypot(px - 740, py - 690) < 270 });
    coinHoldingTicket(x, 735, 700, 150);
    ctaTicket(x, M, 870, 560, 92, { main: 'Join the WL', url: 'slana.io/wl' });
    stampAt(x, W, H, 900, 270, 0.18, (l) => roundStamp(l, 70, 'WL OPEN * SLANA NFT * ROUND 001 * ', { color: TEAL_INK, size: 13, lw: 3.6 }), { seed: 105 });
  } else {
    haloSun(x, W, H, 560, 1090, 400, PINK, { seed: 102 });
    cornerWash(x, W, H, W + 40, 640, 340, TEAL, { seed: 103 });
    label(x, 'SLANA NFT · ALLOWLIST', M, 330, 26, PINK_TEXT, { spacing: 0.18 });
    x.fillStyle = INK;
    x.fillRect(M, 348, 360, 3);
    inkText(x, 'WL is', M - 8, 560, 250);
    inkText(x, 'open.', M - 8, 770, 250);
    confetti(x, 60, 860, 960, 560, 14, 104, { size: [8, 14], avoid: (px, py) => Math.hypot(px - 520, py - 1120) < 330 || Math.hypot(px - 190, py - 880) < 110 });
    coinHoldingTicket(x, 500, 1130, 220);
    stampAt(x, W, H, 190, 880, -0.16, (l) => roundStamp(l, 86, 'WL OPEN * SLANA NFT * ROUND 001 * ', { color: TEAL_INK, size: 16, lw: 4 }), { seed: 105 });
    body(x, 'A few short tasks on X and one free signature. Every entry is checked by hand.', W / 2, 1520, 32, 800, { align: 'center' });
    ctaTicket(x, 110, 1600, 860, 120, { main: 'Join the WL', url: 'slana.io/wl' });
  }
}

// ── 2. Collab applications open ─────────────────────────────────────────────

function blankCoin(x, cx, cy, r, seed) {
  // the "your community" coin: a dashed die-line with a teal halftone inside
  x.save();
  x.translate(cx, cy);
  x.save();
  x.beginPath();
  x.arc(0, 0, r, 0, TAU);
  x.fillStyle = CARD_PAPER;
  x.fill();
  x.clip();
  x.globalCompositeOperation = 'multiply';
  halftone(x, -r, -r, r * 2, r * 2, r * 0.07, TEAL, (px, py) => 0.85 * smooth(0.62, 1, Math.hypot(px, py) / r));
  x.restore();
  x.strokeStyle = INK;
  x.lineWidth = r * 0.04;
  x.setLineDash([r * 0.11, r * 0.07]);
  x.beginPath();
  x.arc(0, 0, r, 0, TAU);
  x.stroke();
  x.setLineDash([]);
  // scissors mark on the die-line
  x.save();
  x.translate(Math.cos(-0.7) * r, Math.sin(-0.7) * r);
  x.rotate(-0.7 + Math.PI / 2);
  x.fillStyle = CARD_PAPER;
  x.beginPath();
  x.arc(0, 0, r * 0.11, 0, TAU);
  x.fill();
  x.lineWidth = r * 0.025;
  for (const s of [-1, 1]) {
    x.beginPath();
    x.arc(s * r * 0.045, r * 0.05, r * 0.03, 0, TAU);
    x.stroke();
    x.beginPath();
    x.moveTo(s * r * 0.035, r * 0.025);
    x.lineTo(-s * r * 0.03, -r * 0.07);
    x.stroke();
  }
  x.restore();
  font(x, r * 0.3, { weight: 800, wdth: 80 });
  x.fillStyle = INK;
  x.textAlign = 'center';
  x.fillText('you?', 0, -r * 0.02);
  x.textAlign = 'left';
  label(x, 'YOUR COMMUNITY', 0, r * 0.26, r * 0.1, TEAL_INK, { align: 'center', spacing: 0.1 });
  x.restore();
}

function collabPair(x, cx, cy, r) {
  // the Slana coin reaching over to shake the blank coin's hand
  const gap = r * 2.55;
  blankCoin(x, cx + gap / 2, cy + r * 0.05, r * 0.95, 5);
  x.save();
  x.translate(cx - gap / 2, cy);
  x.rotate(-0.05);
  legs(x, r, { spread: 0.32, len: 0.28 });
  arm(x, r, Math.PI * 0.98, [-1.25, -0.6], { bend: -0.25 });
  arm(x, r, 0.2, [1.55, 0.05], { bend: -0.08 });
  heroCoin(x, r, { face: FACES.beam, faceScale: 1.25, faceY: 0.1, symbol: 'star' });
  x.restore();
  // the x
  const mx = cx + r * 0.02;
  const my = cy - r * 0.95;
  x.save();
  x.lineCap = 'round';
  for (const [col, ox, oy, w] of [
    [TEAL, -4, -3, r * 0.12],
    [PINK, 5, 4, r * 0.12],
    [INK, 0, 0, r * 0.075],
  ]) {
    x.strokeStyle = col;
    x.lineWidth = w;
    if (col !== INK) x.globalCompositeOperation = 'multiply';
    x.beginPath();
    x.moveTo(mx - r * 0.18 + ox, my - r * 0.18 + oy);
    x.lineTo(mx + r * 0.18 + ox, my + r * 0.18 + oy);
    x.moveTo(mx + r * 0.18 + ox, my - r * 0.18 + oy);
    x.lineTo(mx - r * 0.18 + ox, my + r * 0.18 + oy);
    x.stroke();
    x.globalCompositeOperation = 'source-over';
  }
  x.restore();
  sparkle(x, mx - r * 0.5, my + r * 0.05, r * 0.08, GOLD, r * 0.015);
  sparkle(x, mx + r * 0.45, my - r * 0.2, r * 0.06, PINK, r * 0.012);
}

export function collabOpen(x, W, H) {
  const { M, shape } = chrome(x, W, H, { seed: 201, no: '002 · COLLABS', foot: 'DAOS · GUILDS · ALPHA GROUPS · NFT PROJECTS' });
  if (shape === 'wide') {
    haloSun(x, W, H, 1180, 520, 370, GOLD, { seed: 202, alpha: 0.95 });
    label(x, 'COLLABS · NOW TAKING APPLICATIONS', M, 236, 24, TEAL_INK, { spacing: 0.18 });
    x.fillStyle = INK;
    x.fillRect(M, 252, 330, 3);
    inkText(x, 'Collab', M - 6, 400, 186);
    inkText(x, 'applications', M - 4, 524, 116);
    inkText(x, 'are open.', M - 4, 634, 116);
    body(x, 'DAOs, guilds, alpha groups and NFT projects can get Slana WL spots to raffle to their members.', M, 684, 26, 680);
    ctaTicket(x, M, 734, 600, 84, { left: 'APPLY · FREE', main: 'Apply now', url: 'slana.io/collab', stripe: TEAL, shadow: TEAL });
    collabPair(x, 1170, 520, 150);
    confetti(x, 840, 150, 720, 640, 14, 204, { size: [6, 12], avoid: (px, py) => Math.abs(py - 520) < 230 && px > 900 && px < 1460 });
  } else if (shape === 'square') {
    haloSun(x, W, H, 560, 600, 250, GOLD, { seed: 202, alpha: 0.95 });
    label(x, 'COLLABS · NOW TAKING APPLICATIONS', M, 214, 22, TEAL_INK, { spacing: 0.18 });
    x.fillStyle = INK;
    x.fillRect(M, 230, 300, 3);
    inkText(x, 'Collab apps', M - 6, 360, 138);
    inkText(x, 'are open.', M - 6, 480, 138);
    collabPair(x, 545, 650, 112);
    body(x, 'Get Slana WL spots to raffle to your members.', M, 868, 27, 950);
    ctaTicket(x, M, 900, 600, 84, { left: 'APPLY · FREE', main: 'Apply now', url: 'slana.io/collab', stripe: TEAL, shadow: TEAL });
  } else {
    haloSun(x, W, H, 540, 1080, 460, GOLD, { seed: 202, alpha: 0.95 });
    label(x, 'COLLABS · NOW TAKING APPLICATIONS', M, 330, 24, TEAL_INK, { spacing: 0.18 });
    inkText(x, 'Collab apps', M - 6, 520, 160);
    inkText(x, 'are open.', M - 6, 680, 160);
    collabPair(x, 540, 1080, 160);
    body(x, 'DAOs, guilds, alpha groups and NFT projects can get Slana WL spots to raffle to their members.', W / 2, 1460, 34, 820, { align: 'center' });
    ctaTicket(x, 110, 1580, 860, 124, { left: 'APPLY · FREE', main: 'Apply now', url: 'slana.io/collab', stripe: TEAL, shadow: TEAL });
  }
}

// ── 3. Arena reveal ─────────────────────────────────────────────────────────

/** Paper card with the arena's name, entry and rules; returns nothing. */
function arenaTicket(x, a, w, h, { nameSize, feeSize, stack = true }) {
  const t = ticket(x, { w, h, stripe: a.ink, shadow: INK, perfAt: 0.8, lw: 4, radius: 14, stripeW: 0.03, shadowOff: 3 });
  const pad = w * 0.075;
  label(x, `ARENA 0${a.id} OF 04`, pad, h * 0.13, Math.max(16, h * 0.04), INK_2, { spacing: 0.18 });
  const words = a.name.split(' ');
  let y = h * 0.13 + nameSize * 0.98;
  const ghostA = a.id === 2 ? PINK : TEAL;
  const ghostB = a.ink;
  if (stack) {
    for (const wd of words) {
      inkText(x, wd, pad - nameSize * 0.02, y, nameSize, { ghostA, ghostB, alphaA: 0.55 });
      y += nameSize * 0.86;
    }
    y -= nameSize * 0.86;
  } else {
    const fitted = Math.min(nameSize, Math.floor((nameSize * (t.perfX - pad - h * 0.4)) / measure(x, a.name, nameSize, { tracking: -0.025 })));
    y = h * 0.13 + fitted * 0.98;
    inkText(x, a.name, pad - fitted * 0.02, y, fitted, { ghostA, ghostB, alphaA: 0.55 });
  }
  // entry fee block
  const ly = y + h * 0.1;
  perforation(x, pad, ly - h * 0.035, t.perfX - pad * 0.6, ly - h * 0.035, { lw: 2, dash: 6, alpha: 0.35 });
  label(x, 'ENTRY', pad, ly + h * 0.02, Math.max(15, h * 0.036), INK_2, { spacing: 0.18 });
  font(x, feeSize, { weight: 800, wdth: 85 });
  x.letterSpacing = `${-0.02 * feeSize}px`;
  x.fillStyle = a.id === 3 ? INK : a.text;
  const num = fmt(a.entry);
  x.fillText(num, pad - feeSize * 0.03, ly + h * 0.02 + feeSize * 0.98);
  const nw = x.measureText(num).width;
  mono(x, feeSize * 0.34, 0.02);
  x.fillStyle = INK;
  x.fillText('$SLANA', pad + nw + feeSize * 0.1, ly + h * 0.02 + feeSize * 0.98);
  // seal in the free corner of the card
  stampAt(x, x.canvas.width / (x.k ?? 1), x.canvas.height / (x.k ?? 1), t.perfX - h * 0.2, h * 0.3, 0.2, (l) => roundStamp(l, h * 0.13, `ARENA 0${a.id} * ${a.name.toUpperCase()} * `, { color: a.id === 3 ? MUSTARD : a.text, size: h * 0.024, lw: h * 0.007, center: `0${a.id}`, centerSize: h * 0.09 }), { seed: 330 + a.id, wear: 1 });
  // stub: the round clock
  const sx = t.perfX + (w - t.perfX) / 2;
  x.save();
  x.translate(sx, h * 0.5);
  x.rotate(-Math.PI / 2);
  mono(x, Math.max(16, h * 0.042), 0.2);
  x.fillStyle = INK;
  x.textAlign = 'center';
  x.fillText('5-MIN ROUNDS', 0, -h * 0.012);
  x.fillStyle = INK_2;
  x.fillText('ON SOLANA', 0, h * 0.05);
  x.textAlign = 'left';
  x.restore();
  return { t, pad, bottom: ly + h * 0.02 + feeSize * 0.98 };
}

function ruleChips(x, px, py, size, color = INK, { gap = 14, maxW = Infinity } = {}) {
  const items = ['5:00 ROUNDS', '5% FEE ON PROFIT', 'PAID AT THE BELL'];
  let cx = px;
  let cy = py;
  mono(x, size, 0.12);
  for (const it of items) {
    const w = x.measureText(it).width + size * 1.4;
    if (cx + w > px + maxW) {
      cx = px;
      cy += size * 2.3;
    }
    roundRect(x, cx, cy - size * 1.25, w, size * 1.9, size * 0.95);
    x.strokeStyle = color;
    x.lineWidth = 2.2;
    x.stroke();
    x.fillStyle = color;
    mono(x, size, 0.12);
    x.fillText(it, cx + size * 0.7, cy);
    cx += w + gap;
  }
}

export function arenaReveal(x, W, H, { id = 1 } = {}) {
  const a = ARENAS[id - 1];
  const dark = a.id === 4;
  const shape = shapeOf(W, H);
  paper(x, W, H, 300 + id);
  // full-bleed ink flood with a sunburst overprint
  layer(x, W, H, (l) => {
    l.fillStyle = a.ink;
    l.fillRect(0, 0, W, H);
  }, { op: 'multiply', wear: 0.45, seed: 310 + id });
  layer(x, W, H, (l) => {
    sunburst(l, shape === 'wide' ? W * 0.72 : W * 0.5, shape === 'tall' ? H * 0.34 : H * 0.42, Math.hypot(W, H), 30, a.id === 3 ? RISO.orange : INK, 0.02);
  }, { op: 'multiply', alpha: a.id === 3 ? 0.35 : 0.12, wear: 0.5, seed: 320 + id });
  grid(x, -10, -10, W + 20, H + 20, shape === 'wide' ? 40 : 36, 0.1, dark ? CARD_PAPER : INK);
  regMarks(x, W, H, 30, 11, { lw: 1.6, ghosts: false });
  const onInk = dark ? CARD_PAPER : INK;
  const M = shape === 'wide' ? 72 : 64;
  const top = shape === 'tall' ? 150 : M;
  const ws = shape === 'wide' ? 58 : 54;
  // the wordmark sits on a paper label so it stays clean on the ink
  x.save();
  x.translate(M - 22, top - 12);
  x.rotate(-0.02);
  x.save();
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = INK;
  roundRect(x, 6, 6, wordmarkWidth(x, ws) + 40, ws * 1.22, 10);
  x.fill();
  x.restore();
  roundRect(x, 0, 0, wordmarkWidth(x, ws) + 40, ws * 1.22, 10);
  x.fillStyle = CARD_PAPER;
  x.fill();
  x.lineWidth = 3;
  x.strokeStyle = INK;
  x.stroke();
  x.restore();
  wordmark(x, M - 4, top + ws * 0.78, ws);
  if (shape !== 'square') label(x, 'ARENA REVEAL', W - M, top + ws * 0.62, shape === 'wide' ? 20 : 19, onInk, { align: 'right', spacing: 0.18 });
  const fy = shape === 'tall' ? H - 150 : H - 44;
  perforation(x, M, fy - 34, W - M, fy - 34, { lw: 2.2, dash: 7, color: onInk, alpha: 0.5 });
  label(x, `NO. 00${2 + id} · ${a.name.toUpperCase()}`, M, fy, 17, onInk, { spacing: 0.16 });
  label(x, 'SLANA.IO', W - M, fy, 17, onInk, { align: 'right', spacing: 0.16 });

  const sceneBox = (bx, by, bw, bh, rot) => {
    x.save();
    x.translate(bx + bw / 2, by + bh / 2);
    x.rotate(rot);
    // riso shadow of the frame
    x.save();
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = dark ? INK : a.id === 3 ? INK : INK;
    x.globalAlpha = 0.85;
    roundRect(x, -bw / 2 + 12, -bh / 2 + 12, bw, bh, 16);
    x.fill();
    x.restore();
    roundRect(x, -bw / 2 - 10, -bh / 2 - 10, bw + 20, bh + 20, 22);
    x.fillStyle = CARD_PAPER;
    x.fill();
    x.lineWidth = 4;
    x.strokeStyle = INK;
    x.stroke();
    x.translate(-bw / 2, -bh / 2);
    x.fillStyle = '#FCF4DF';
    roundRect(x, 0, 0, bw, bh, 14);
    x.fill();
    x.restore();
    // the scene itself (drawn unrotated into the rotated box via transform)
    x.save();
    x.translate(bx + bw / 2, by + bh / 2);
    x.rotate(rot);
    x.translate(-bw / 2, -bh / 2);
    arenaScene(x, W, H, a.id, 0, 0, bw, bh, { radius: 14, frame: 5, seed: 400 });
    x.restore();
    tape(x, bx + 30, by + 10, 150, 46, -0.7, CARD_PAPER, 11 + id, { op: 'source-over', alpha: 0.82 });
    tape(x, bx + bw - 30, by + 14, 150, 46, 0.7, CARD_PAPER, 21 + id, { op: 'source-over', alpha: 0.82 });
  };

  if (shape === 'wide') {
    sceneBox(890, 150, 600, 600, 0.03);
    x.save();
    x.translate(M, 168);
    x.rotate(-0.015);
    arenaTicket(x, a, 740, 560, { nameSize: 150, feeSize: 92 });
    x.restore();
    ruleChips(x, M + 6, 790, 17, onInk);
  } else if (shape === 'square') {
    sceneBox(470, 128, 545, 545, 0.035);
    x.save();
    x.translate(M, 500);
    x.rotate(-0.02);
    arenaTicket(x, a, 600, 410, { nameSize: 104, feeSize: 70 });
    x.restore();
    ruleChips(x, M + 4, 972, 15, onInk);
  } else {
    sceneBox(120, 330, 840, 840, 0.025);
    x.save();
    x.translate(M + 10, 1200);
    x.rotate(-0.015);
    arenaTicket(x, a, 930, 430, { nameSize: 128, feeSize: 92, stack: false });
    x.restore();
    ruleChips(x, M + 14, 1708, 19, onInk, { maxW: 940 });
  }
}

// ── 4. How a round works ────────────────────────────────────────────────────

const STEPS = [
  { no: '01', title: 'Buy a ticket', body: 'Pick an arena. The entry is the value your coin carries in.', stamp: 'PUNCHED', ink: TEAL },
  { no: '02', title: 'Eat', body: 'Swallow confetti and smaller coins. What they carried is now in your till.', stamp: 'NOM', ink: PINK },
  { no: '03', title: 'The bell', body: 'Five minutes on the clock. Dodge the big ones until it rings.', stamp: 'DING', ink: GOLD },
  { no: '04', title: 'Paid', body: 'Every coin alive at the bell is paid its till, on Solana.', stamp: 'PAID', ink: INK },
];

function stepArt(x, i, cx, cy, s) {
  if (i === 0) {
    // a ticket being punched by a coin
    x.save();
    x.translate(cx - s * 0.1, cy + s * 0.05);
    x.rotate(-0.12);
    const tw = s * 1.5;
    const th = s * 0.72;
    x.translate(-tw / 2, -th / 2);
    const t = ticket(x, { w: tw, h: th, stripe: RED, shadow: TEAL, perfAt: 0.68, lw: s * 0.03, radius: s * 0.05 });
    label(x, 'ADMIT ONE', tw * 0.09, th * 0.3, th * 0.12, INK_2, { spacing: 0.14 });
    font(x, th * 0.24, { weight: 800, wdth: 80 });
    x.fillStyle = INK;
    x.fillText('Penny Pond', tw * 0.09, th * 0.6);
    mono(x, th * 0.11, 0.08);
    x.fillStyle = RED;
    x.fillText('1,000 $SLANA', tw * 0.09, th * 0.82);
    // punched hole
    x.fillStyle = INK;
    x.beginPath();
    x.arc(t.perfX + tw * 0.16, th * 0.5, th * 0.1, 0, TAU);
    x.fill();
    x.restore();
    coin(x, cx - s * 0.62, cy - s * 0.5, s * 0.26, lookForBasicSkin(1), { expression: 'happy', lookX: 0.8, lookY: 0.6 });
    burstLines(x, cx + s * 0.38, cy + s * 0.05, s * 0.12, s * 0.22, [-0.5, 0.2, 0.9], { lw: s * 0.035 });
  } else if (i === 1) {
    // hungry hero chasing a small coin and pellets
    x.save();
    x.translate(cx - s * 0.25, cy + s * 0.05);
    x.rotate(-0.1);
    heroCoin(x, s * 0.55, { expression: 'hungry', mouth: 'grin', lookX: 1, lookY: -0.2, faceScale: 1.2, symbol: 'star' });
    x.restore();
    speedLines(x, cx + s * 0.62, cy - s * 0.32, s * 0.2, 1, -0.2, PINK, 2, 0.8);
    coin(x, cx + s * 0.62, cy - s * 0.32, s * 0.2, lookForBasicSkin(5), { expression: 'scared', lookX: 1 });
    pellet(x, cx + s * 0.5, cy + s * 0.12, s * 0.06, 'star', GOLD);
    pellet(x, cx + s * 0.7, cy + s * 0.25, s * 0.05, 'dot', TEAL);
    pellet(x, cx + s * 0.42, cy + s * 0.42, s * 0.05, 'tri', BLUE);
    pellet(x, cx + s * 0.78, cy + s * 0.02, s * 0.05, 'gold', GOLD);
  } else if (i === 2) {
    stopwatch(x, cx + s * 0.38, cy + s * 0.2, s * 0.36, { label: '0:00', sweep: 0.999, accent: PINK });
    bell(x, cx - s * 0.25, cy - s * 0.05, s * 0.5, { tilt: -0.25 });
  } else {
    // receipt with the coin peeking
    x.save();
    x.translate(cx - s * 0.05, cy);
    x.rotate(0.05);
    const rw = s * 0.95;
    const rh = s * 1.15;
    x.translate(-rw / 2, -rh / 2);
    x.save();
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = PINK;
    receiptPath(x, rw, rh, 6, s * 0.03);
    x.translate(0, 0);
    x.restore();
    receiptPath(x, rw, rh, 7, 0);
    x.fillStyle = CARD_PAPER;
    x.fill();
    x.strokeStyle = INK;
    x.lineWidth = s * 0.025;
    x.stroke();
    mono(x, s * 0.07, 0.06);
    x.fillStyle = INK;
    const rows = [
      ['ENTRY', '1,000'],
      ['AT BELL', '2,000'],
      ['FEE 5%', '-50'],
    ];
    rows.forEach(([k, v], j) => {
      x.fillText(k, rw * 0.1, rh * (0.2 + j * 0.13));
      x.textAlign = 'right';
      x.fillText(v, rw * 0.9, rh * (0.2 + j * 0.13));
      x.textAlign = 'left';
    });
    x.fillRect(rw * 0.1, rh * 0.52, rw * 0.8, s * 0.012);
    font(x, s * 0.12, { weight: 800, wdth: 85 });
    x.fillText('1,950', rw * 0.1, rh * 0.68);
    x.restore();
    coin(x, cx - s * 0.62, cy + s * 0.4, s * 0.24, lookForBasicSkin(1), { expression: 'love' });
  }
}

function receiptPath(x, w, h, teeth, off) {
  x.beginPath();
  x.moveTo(off, off);
  x.lineTo(w + off, off);
  x.lineTo(w + off, h + off);
  const tw = w / teeth;
  for (let i = teeth; i > 0; i--) {
    x.lineTo(off + (i - 0.5) * tw, h + off - tw * 0.45);
    x.lineTo(off + (i - 1) * tw, h + off);
  }
  x.closePath();
}

function stepPanel(x, W, H, i, pw, ph, { titleSize, bodySize, artS, stampSize }) {
  const s = STEPS[i];
  label(x, s.no, pw * 0.09, ph * 0.1, Math.max(18, ph * 0.045), INK_2, { spacing: 0.16 });
  // art
  stepArt(x, i, pw * 0.5, ph * 0.36, artS);
  // title + body
  inkText(x, s.title, pw * 0.08, ph * 0.69, titleSize, { ghostB: s.ink === INK ? PINK : s.ink, ghostA: s.ink === TEAL ? PINK : TEAL, alphaA: 0.5 });
  body(x, s.body, pw * 0.08, ph * 0.69 + bodySize * 1.7, bodySize, pw * 0.84, { color: INK_2, lh: 1.3 });
}

export function howRound(x, W, H) {
  const { M, shape } = chrome(x, W, H, { seed: 501, no: '007 · HOW TO PLAY', foot: 'SLANA.IO' });
  const head = (px, py, size, kSize) => {
    label(x, 'HOW A ROUND WORKS', px, py - size * 1.02, kSize, PINK_TEXT, { spacing: 0.18 });
    inkText(x, 'Four tickets, one round.', px - 4, py, size);
  };
  if (shape === 'wide') {
    head(M, 252, 84, 22);
    const n = 4;
    const sx = M;
    const sy = 300;
    const sw = W - M * 2;
    const sh = 480;
    stripTicket(x, W, H, sx, sy, sw, sh, n, (i, pw, ph) => stepPanel(x, W, H, i, pw, ph, { titleSize: 50, bodySize: 20, artS: 150, stampSize: 30 }));
  } else if (shape === 'square') {
    head(M, 238, 72, 20);
    const sx = M;
    const sy = 280;
    const sw = W - M * 2;
    const sh = 700;
    gridTicket(x, W, H, sx, sy, sw, sh, (i, pw, ph) => stepPanel(x, W, H, i, pw, ph, { titleSize: 46, bodySize: 18, artS: 136, stampSize: 26 }));
  } else {
    head(M, 420, 92, 24);
    const sx = M;
    const sy = 480;
    const sw = W - M * 2;
    const sh = 1220;
    gridTicket(x, W, H, sx, sy, sw, sh, (i, pw, ph) => stepPanel(x, W, H, i, pw, ph, { titleSize: 56, bodySize: 24, artS: 150, stampSize: 30 }));
  }
}

/** One long ticket strip with perforations between `n` panels. */
function stripTicket(x, W, H, sx, sy, sw, sh, n, panel) {
  x.save();
  x.translate(sx, sy);
  // shadow + card
  x.save();
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = TEAL;
  roundRect(x, 9, 9, sw, sh, 14);
  x.fill();
  x.restore();
  const pw = sw / n;
  const nr = 16;
  const path = () => {
    x.beginPath();
    x.moveTo(14, 0);
    for (let i = 1; i < n; i++) {
      x.lineTo(pw * i - nr, 0);
      x.arc(pw * i, 0, nr, Math.PI, 0, true);
    }
    x.lineTo(sw - 14, 0);
    x.arcTo(sw, 0, sw, 14, 14);
    x.lineTo(sw, sh - 14);
    x.arcTo(sw, sh, sw - 14, sh, 14);
    for (let i = n - 1; i > 0; i--) {
      x.lineTo(pw * i + nr, sh);
      x.arc(pw * i, sh, nr, 0, Math.PI, true);
    }
    x.lineTo(14, sh);
    x.arcTo(0, sh, 0, sh - 14, 14);
    x.lineTo(0, 14);
    x.arcTo(0, 0, 14, 0, 14);
    x.closePath();
  };
  path();
  x.fillStyle = CARD_PAPER;
  x.fill();
  // stripes per panel
  x.save();
  path();
  x.clip();
  STEPS.forEach((s, i) => {
    x.fillStyle = s.ink;
    x.fillRect(pw * i, 0, pw, 12);
  });
  x.restore();
  path();
  x.strokeStyle = INK;
  x.lineWidth = 4;
  x.stroke();
  for (let i = 1; i < n; i++) perforation(x, pw * i, nr + 8, pw * i, sh - nr - 8, { lw: 3, dash: 9 });
  for (let i = 0; i < n; i++) {
    x.save();
    x.translate(pw * i, 0);
    panel(i, pw, sh);
    x.restore();
  }
  x.restore();
  // stamps on top of each panel, worn
  for (let i = 0; i < n; i++) {
    const s = STEPS[i];
    stampAt(x, W, H, sx + pw * i + pw * 0.76, sy + sh * 0.12, 0.16 - i * 0.07, (l) => wordStamp(l, s.stamp, { color: s.ink === GOLD ? '#C98A00' : s.ink === INK ? PINK_TEXT : s.ink === TEAL ? TEAL_INK : PINK_TEXT, size: 26, lw: 3.2 }), { seed: 600 + i, wear: 1.1 });
  }
  tape(x, sx + 20, sy + 6, 120, 38, -0.6, GOLD, 61);
  tape(x, sx + sw - 20, sy + sh - 6, 120, 38, -0.6, GOLD, 62);
}

/** 2×2 grid of ticket panels. */
function gridTicket(x, W, H, sx, sy, sw, sh, panel) {
  const gap = 26;
  const pw = (sw - gap) / 2;
  const ph = (sh - gap) / 2;
  for (let i = 0; i < 4; i++) {
    const px = sx + (i % 2) * (pw + gap);
    const py = sy + Math.floor(i / 2) * (ph + gap);
    x.save();
    x.translate(px, py);
    x.rotate([-0.01, 0.012, 0.008, -0.012][i]);
    const t = ticket(x, { w: pw, h: ph, stripe: null, shadow: STEPS[i].ink === INK ? PINK : STEPS[i].ink, perfAt: null, lw: 3.5, radius: 14, shadowOff: 2.6 });
    x.save();
    x.beginPath();
    x.roundRect(0, 0, pw, ph, 14);
    x.clip();
    x.fillStyle = STEPS[i].ink;
    x.fillRect(0, 0, pw, 11);
    x.restore();
    roundRect(x, 0, 0, pw, ph, 14);
    x.strokeStyle = INK;
    x.lineWidth = 3.5;
    x.stroke();
    panel(i, pw, ph);
    x.restore();
    const s = STEPS[i];
    stampAt(x, W, H, px + pw * 0.75, py + ph * 0.13, 0.16 - i * 0.07, (l) => wordStamp(l, s.stamp, { color: s.ink === GOLD ? '#C98A00' : s.ink === INK ? PINK_TEXT : s.ink === TEAL ? TEAL_INK : PINK_TEXT, size: 24, lw: 3 }), { seed: 600 + i, wear: 1.1 });
  }
  tape(x, sx + 10, sy + 4, 110, 36, -0.6, GOLD, 61);
}

// ── 5. Fee ──────────────────────────────────────────────────────────────────

function receipt(x, w, { rowSize = 26, totalSize = 64 } = {}) {
  const rows = [
    ['ARENA', 'PENNY POND'],
    ['ENTRY', '1,000'],
    ['TILL AT THE BELL', '2,000'],
    ['PROFIT', '1,000'],
    ['FEE 5% OF PROFIT', '-50'],
  ];
  const lh = rowSize * 1.9;
  const h = rowSize * 3.4 + rows.length * lh + totalSize * 2.4 + rowSize * 3;
  // shadow
  x.save();
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = PINK;
  receiptPath(x, w, h, 12, 10);
  x.fill();
  x.restore();
  receiptPath(x, w, h, 12, 0);
  x.fillStyle = CARD_PAPER;
  x.fill();
  x.strokeStyle = INK;
  x.lineWidth = 3.5;
  x.stroke();
  const pad = w * 0.08;
  label(x, 'SLANA · RECEIPT', w / 2, rowSize * 2, rowSize * 0.9, INK, { align: 'center', spacing: 0.22 });
  perforation(x, pad, rowSize * 2.9, w - pad, rowSize * 2.9, { lw: 2, dash: 5, alpha: 0.6 });
  let y = rowSize * 3.4 + lh * 0.6;
  for (const [k, v] of rows) {
    mono(x, rowSize, 0.06);
    x.fillStyle = k.startsWith('FEE') ? PINK_TEXT : INK;
    x.fillText(k, pad, y);
    x.textAlign = 'right';
    x.fillText(v, w - pad, y);
    x.textAlign = 'left';
    y += lh;
  }
  x.fillStyle = INK;
  x.fillRect(pad, y - lh * 0.55, w - pad * 2, 3);
  x.fillRect(pad, y - lh * 0.55 + 7, w - pad * 2, 3);
  label(x, 'YOU GET', pad, y + rowSize * 0.6, rowSize, INK, { spacing: 0.1 });
  font(x, totalSize, { weight: 800, wdth: 85 });
  x.fillStyle = INK;
  x.textAlign = 'right';
  x.fillText('1,950', w - pad, y + totalSize * 1.05);
  x.textAlign = 'left';
  mono(x, rowSize * 0.75, 0.1);
  x.fillStyle = INK_2;
  x.fillText('$SLANA, SETTLED ON SOLANA', pad, y + totalSize * 1.75);
  return h;
}

export function fee(x, W, H) {
  const { M, shape } = chrome(x, W, H, { seed: 701, no: '008 · THE FEE', foot: 'NO PROFIT, NO FEE' });
  const big = (px, py, size) => {
    inkText(x, '5%', px, py, size, { tracking: -0.06 });
  };
  if (shape === 'wide') {
    haloSun(x, W, H, 1230, 440, 400, GOLD, { seed: 702, alpha: 0.95 });
    label(x, 'ONE FLAT FEE', M, 236, 24, PINK_TEXT, { spacing: 0.18 });
    big(M - 14, 560, 360);
    inkText(x, 'Flat fee, on profit only.', M - 2, 650, 56, { ghostA: null });
    inkText(x, 'Paid at the bell.', M - 2, 722, 56, { ghostA: null, ghostB: GOLD });
    body(x, 'No profit, no fee. Floor loot left at the bell is burned.', M, 784, 26, 760);
    x.save();
    x.translate(980, 128);
    x.rotate(0.035);
    receipt(x, 480, { rowSize: 22, totalSize: 60 });
    x.restore();
    tape(x, 1220, 132, 160, 44, -0.08, GOLD, 71);
    bell(x, 1480, 690, 74, { tilt: 0.25 });
    stampAt(x, W, H, 1300, 640, -0.22, (l) => wordStamp(l, 'PAID', { color: PINK_TEXT, size: 70, lw: 6 }), { seed: 72, wear: 1.2 });
  } else if (shape === 'square') {
    haloSun(x, W, H, 800, 470, 330, GOLD, { seed: 702, alpha: 0.95 });
    label(x, 'ONE FLAT FEE', M, 214, 22, PINK_TEXT, { spacing: 0.18 });
    big(M - 12, 500, 320);
    inkText(x, 'Flat fee, on', M - 2, 590, 50, { ghostA: null });
    inkText(x, 'profit only.', M - 2, 650, 50, { ghostA: null });
    inkText(x, 'Paid at the bell.', M - 2, 720, 50, { ghostA: null, ghostB: GOLD });
    body(x, 'No profit, no fee. Floor loot left at the bell is burned.', M, 790, 24, 420);
    x.save();
    x.translate(600, 210);
    x.rotate(0.04);
    receipt(x, 400, { rowSize: 18, totalSize: 52 });
    x.restore();
    tape(x, 800, 214, 140, 40, -0.08, GOLD, 71);
    bell(x, 960, 880, 64, { tilt: 0.25 });
    stampAt(x, W, H, 790, 740, -0.22, (l) => wordStamp(l, 'PAID', { color: PINK_TEXT, size: 60, lw: 5 }), { seed: 72, wear: 1.2 });
  } else {
    haloSun(x, W, H, 540, 560, 420, GOLD, { seed: 702, alpha: 0.95 });
    label(x, 'ONE FLAT FEE', W / 2, 330, 26, PINK_TEXT, { align: 'center', spacing: 0.18 });
    inkText(x, '5%', W / 2, 700, 400, { tracking: -0.06, align: 'center' });
    inkText(x, 'Flat fee, on profit only.', W / 2, 800, 58, { ghostA: null, align: 'center' });
    inkText(x, 'Paid at the bell.', W / 2, 876, 58, { ghostA: null, ghostB: GOLD, align: 'center' });
    x.save();
    x.translate(270, 960);
    x.rotate(0.03);
    receipt(x, 540, { rowSize: 24, totalSize: 66 });
    x.restore();
    tape(x, 540, 964, 170, 46, -0.06, GOLD, 71);
    stampAt(x, W, H, 720, 1480, -0.22, (l) => wordStamp(l, 'PAID', { color: PINK_TEXT, size: 80, lw: 7 }), { seed: 72, wear: 1.2 });
    bell(x, 900, 1300, 80, { tilt: 0.25 });
    body(x, 'No profit, no fee. Floor loot left at the bell is burned.', W / 2, 1690, 30, 860, { align: 'center' });
  }
}

// ── 6. Coming soon: Slana NFT ───────────────────────────────────────────────

function cardFan(x, cx, cy, w, { spread = 1 } = {}) {
  const h = w * 1.4;
  const cards = [
    { dx: -0.78, dy: 0.1, rot: -0.24, ink: TEAL, ghost: PINK, no: '???', seal: GOLD },
    { dx: 0.78, dy: 0.1, rot: 0.24, ink: GOLD, ghost: TEAL, no: '???', seal: PINK },
    { dx: 0, dy: -0.06, rot: -0.02, ink: PINK, ghost: TEAL, no: '001', seal: RED },
  ];
  cards.forEach((c, i) => {
    x.save();
    x.translate(cx + c.dx * w * spread, cy + c.dy * w);
    x.rotate(c.rot * spread);
    x.translate(-w / 2, -h / 2);
    sealedCard(x, w, h, { ink: c.ink, ghost: c.ghost, no: c.no, seed: 900 + i, sealInk: c.seal });
    x.restore();
  });
}

export function nftSoon(x, W, H) {
  const { M, shape } = chrome(x, W, H, { seed: 801, no: '009 · ON THE PRESS', foot: 'WL OPEN · SLANA.IO/WL' });
  if (shape === 'wide') {
    haloSun(x, W, H, 1150, 470, 420, TEAL, { seed: 802, alpha: 0.75 });
    label(x, 'ON THE PRESS', M, 236, 24, PINK_TEXT, { spacing: 0.18 });
    inkText(x, 'Slana', M - 6, 420, 200);
    inkText(x, 'NFT', M - 6, 590, 200);
    stampAt(x, W, H, 560, 520, -0.12, (l) => wordStamp(l, 'COMING SOON', { color: PINK_TEXT, size: 46, lw: 5 }), { seed: 803, wear: 1 });
    body(x, 'The first collection is still on the press. WL holders and collab communities get first access to the mint.', M, 660, 26, 640);
    ctaTicket(x, M, 730, 560, 86, { main: 'Join the WL', url: 'slana.io/wl' });
    cardFan(x, 1150, 470, 250);
    confetti(x, 820, 100, 760, 720, 12, 804, { size: [6, 12], avoid: (px, py) => Math.abs(px - 1150) < 480 && Math.abs(py - 470) < 290 });
  } else if (shape === 'square') {
    haloSun(x, W, H, 540, 640, 380, TEAL, { seed: 802, alpha: 0.75 });
    label(x, 'ON THE PRESS', M, 214, 22, PINK_TEXT, { spacing: 0.18 });
    inkText(x, 'Slana NFT', M - 6, 360, 150);
    stampAt(x, W, H, 860, 230, 0.1, (l) => wordStamp(l, 'COMING SOON', { color: PINK_TEXT, size: 36, lw: 4 }), { seed: 803, wear: 1 });
    cardFan(x, 540, 640, 210);
    ctaTicket(x, M, 900, 560, 86, { main: 'Join the WL', url: 'slana.io/wl' });
  } else {
    haloSun(x, W, H, 540, 1000, 500, TEAL, { seed: 802, alpha: 0.75 });
    label(x, 'ON THE PRESS', M, 330, 26, PINK_TEXT, { spacing: 0.18 });
    inkText(x, 'Slana', M - 6, 520, 230);
    inkText(x, 'NFT', M - 6, 710, 230);
    stampAt(x, W, H, 760, 640, -0.12, (l) => wordStamp(l, 'COMING SOON', { color: PINK_TEXT, size: 48, lw: 5 }), { seed: 803, wear: 1 });
    cardFan(x, 540, 1080, 270);
    body(x, 'WL holders and collab communities get first access to the mint.', W / 2, 1490, 32, 820, { align: 'center' });
    ctaTicket(x, 110, 1580, 860, 124, { main: 'Join the WL', url: 'slana.io/wl' });
  }
}

// ── 7. Countdown ────────────────────────────────────────────────────────────

/** A flip-clock style tile made of a ticket torn across the middle. */
function digitTile(x, d, w, h, ink) {
  x.save();
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = ink;
  roundRect(x, 10, 10, w, h, w * 0.08);
  x.fill();
  x.restore();
  roundRect(x, 0, 0, w, h, w * 0.08);
  x.fillStyle = CARD_PAPER;
  x.fill();
  x.save();
  x.clip();
  x.globalCompositeOperation = 'multiply';
  x.globalAlpha = 0.12;
  halftone(x, 0, 0, w, h / 2, w * 0.05, INK, () => 0.5);
  x.restore();
  roundRect(x, 0, 0, w, h, w * 0.08);
  x.lineWidth = 4;
  x.strokeStyle = INK;
  x.stroke();
  font(x, h * 0.86, { weight: 800, wdth: 80 });
  x.textAlign = 'center';
  x.save();
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = TEAL;
  x.globalAlpha = 0.7;
  x.fillText(d, w / 2 - h * 0.012, h * 0.8 - h * 0.012);
  x.fillStyle = PINK;
  x.globalAlpha = 1;
  x.fillText(d, w / 2 + h * 0.02, h * 0.8 + h * 0.018);
  x.restore();
  x.fillStyle = INK;
  x.fillText(d, w / 2, h * 0.8);
  x.textAlign = 'left';
  // split + side notches
  x.fillStyle = PAPER_BG;
  for (const sx of [0, w]) {
    x.beginPath();
    x.arc(sx, h / 2, w * 0.06, 0, TAU);
    x.fill();
    x.strokeStyle = INK;
    x.lineWidth = 3;
    x.stroke();
  }
  x.strokeStyle = INK;
  x.lineWidth = 3;
  x.beginPath();
  x.moveTo(w * 0.06, h / 2);
  x.lineTo(w * 0.94, h / 2);
  x.stroke();
}
const PAPER_BG = '#FCF4DF';

export function countdown(x, W, H, { days = '7', date = 'SAT · NOV 14 · 18:00 UTC', title = 'The first bell', unit } = {}) {
  const { M, shape } = chrome(x, W, H, { seed: 1001, no: '010 · COUNTDOWN', foot: 'FOLLOW @SLANAIO FOR THE FIRST BELL' });
  const digits = String(days).padStart(2, '0');
  const u = unit ?? (Number(days) === 1 ? 'DAY TO GO' : 'DAYS TO GO');
  const tiles = (px, py, tw, th) => {
    [...digits].forEach((d, i) => {
      x.save();
      x.translate(px + i * (tw + tw * 0.12), py);
      x.rotate(i ? 0.02 : -0.02);
      digitTile(x, d, tw, th, i ? TEAL : PINK);
      x.restore();
    });
    return px + digits.length * tw * 1.12 - tw * 0.12;
  };
  const dateTicket = (px, py, w, h) => {
    x.save();
    x.translate(px, py);
    x.rotate(-0.012);
    const t = ticket(x, { w, h, stripe: GOLD, shadow: PINK, perfAt: 0.8, lw: 3.2, radius: 10 });
    label(x, 'SAVE THE DATE', w * 0.06, h * 0.36, h * 0.15, INK_2, { spacing: 0.16 });
    mono(x, Math.min(h * 0.3, (t.perfX - w * 0.12) / (date.length * 0.66)), 0.04);
    x.fillStyle = INK;
    x.fillText(date, w * 0.06, h * 0.76);
    x.save();
    x.translate(t.perfX + (w - t.perfX) / 2, h / 2);
    x.fillStyle = PINK;
    x.strokeStyle = INK;
    x.lineWidth = 3;
    starPathLocal(x, h * 0.2, h * 0.09);
    x.fill();
    x.stroke();
    x.restore();
    x.restore();
    tape(x, px + w - 10, py + 8, h * 0.8, h * 0.3, -0.8, GOLD, 1003);
  };
  if (shape === 'wide') {
    haloSun(x, W, H, 1240, 430, 360, GOLD, { seed: 1002 });
    label(x, 'COUNTDOWN', M, 236, 24, PINK_TEXT, { spacing: 0.18 });
    inkText(x, `${title}`, M - 4, 336, 96);
    const end = tiles(M, 380, 200, 276);
    label(x, u, end + 36, 650, 28, INK, { spacing: 0.16 });
    dateTicket(M, 704, 740, 90);
    bell(x, 1240, 400, 170, { tilt: -0.22 });
    coin(x, 1420, 640, 70, lookForBasicSkin(1), { expression: 'scared', lookX: -0.6, lookY: -0.8 });
    coin(x, 1080, 670, 54, lookForBasicSkin(4), { expression: 'happy', lookX: 0.6, lookY: -0.8 });
    stopwatch(x, 980, 250, 60, { label: null, sweep: 0.7, accent: PINK });
  } else if (shape === 'square') {
    haloSun(x, W, H, 800, 420, 300, GOLD, { seed: 1002 });
    label(x, 'COUNTDOWN', M, 214, 22, PINK_TEXT, { spacing: 0.18 });
    inkText(x, title, M - 4, 320, 84);
    bell(x, 830, 520, 130, { tilt: -0.22 });
    const end = tiles(M, 380, 190, 270);
    label(x, u, M, 712, 26, INK, { spacing: 0.16 });
    dateTicket(M, 800, 760, 96);
  } else {
    haloSun(x, W, H, 540, 600, 400, GOLD, { seed: 1002 });
    label(x, 'COUNTDOWN', W / 2, 330, 26, PINK_TEXT, { align: 'center', spacing: 0.18 });
    inkText(x, title, W / 2, 450, 110, { align: 'center' });
    bell(x, 540, 680, 150, { tilt: -0.2 });
    const tw = 280;
    const total = digits.length * tw * 1.12 - tw * 0.12;
    tiles((W - total) / 2, 900, tw, 380);
    label(x, u, W / 2, 1360, 32, INK, { align: 'center', spacing: 0.18 });
    dateTicket(110, 1440, 860, 124);
  }
}

function starPathLocal(x, outer, inner, points = 5) {
  x.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    if (i === 0) x.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  x.closePath();
}

export const DESIGNS = { wlOpen, collabOpen, arenaReveal, howRound, fee, nftSoon, countdown };
