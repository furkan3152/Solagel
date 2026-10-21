#!/usr/bin/env node
/**
 * Slana Discord and Telegram assets: a 512 server icon, the 960×540 Discord
 * server banner, a 1280×640 Telegram header (pinned welcome post / channel
 * header) and a 640 Telegram group photo.
 *
 *   node brand/community/generate.mjs
 *
 * Output is deterministic.
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARENAS,
  CARD_PAPER,
  FACES,
  GOLD,
  INK,
  INK_2,
  PINK,
  PINK_TEXT,
  TAU,
  TEAL,
  TEAL_INK,
  coin,
  confetti,
  fmt,
  font,
  grid,
  halftone,
  heroCoin,
  label,
  layer,
  lookForBasicSkin,
  mono,
  paper,
  pellet,
  regMarks,
  render,
  roundStamp,
  saveSmall,
  smooth,
  speedLines,
  stampAt,
  sunburst,
  tape,
  ticket,
  wordmark,
  wordmarkWidth,
} from '../lib/riso.mjs';

const OUT = dirname(fileURLToPath(import.meta.url));

/** The icon: Slana coin on a pink sunburst, teal screen in the corners (safe inside a circle crop). */
function icon(x, S, { face = 'beam' } = {}) {
  paper(x, S, S, 1501);
  layer(x, S, S, (l) => {
    l.fillStyle = PINK;
    l.fillRect(0, 0, S, S);
  }, { op: 'multiply', wear: 0.5, seed: 1502 });
  layer(x, S, S, (l) => sunburst(l, S / 2, S * 0.53, S, 18, PINK), { op: 'multiply', alpha: 0.32, wear: 0.4, seed: 1503 });
  layer(
    x,
    S,
    S,
    (l) =>
      halftone(l, 0, 0, S, S, S * 0.026, TEAL, (px, py) => smooth(0.74, 1.3, Math.hypot(px - S / 2, py - S / 2) / (S / 2))),
    { op: 'multiply', alpha: 0.5, wear: 0.25, seed: 1504 },
  );
  for (const [px, py, s, kind, col] of [
    [0.2, 0.28, 0.016, 'star', GOLD],
    [0.8, 0.24, 0.013, 'dot', CARD_PAPER],
    [0.83, 0.7, 0.015, 'tri', GOLD],
    [0.17, 0.66, 0.012, 'dot', TEAL],
  ])
    pellet(x, px * S, py * S, s * S, kind, col);
  x.save();
  x.translate(S * 0.49, S * 0.51);
  x.rotate(-0.06);
  heroCoin(x, S * 0.33, { face: FACES[face], faceScale: 1.34, faceY: 0.12, symbol: 'star', ghostA: TEAL, ghostB: null, offA: [0.085, 0.075], ghostOver: true });
  x.restore();
}

function discordBanner(x, W, H) {
  paper(x, W, H, 1601);
  grid(x, -10, -10, W + 20, H + 20, 30, 0.09);
  // pink halftone sun behind the coin
  layer(x, W, H, (l) => halftone(l, 480, -40, 520, 620, 12, PINK, (px, py) => {
    const d = Math.hypot(px - 735, py - 270) / 250;
    return d < 1 ? 1 - smooth(0.35, 1, d) * 0.92 : 0;
  }), { op: 'multiply', alpha: 0.9, wear: 0.4, seed: 1602 });
  layer(x, W, H, (l) => halftone(l, 0, 380, 300, 180, 10, TEAL, (px, py) => 1 - smooth(0.2, 1, Math.hypot(px, py - H) / 240)), { op: 'multiply', alpha: 0.75, wear: 0.4, seed: 1603 });
  regMarks(x, W, H, 22, 9, { lw: 1.4 });
  label(x, 'COIN ARENAS · SOLANA', 56, 120, 17, PINK_TEXT, { spacing: 0.2 });
  wordmark(x, 50, 268, 168);
  x.save();
  x.translate(60, 310);
  x.rotate(-0.015);
  const t = ticket(x, { w: 410, h: 64, stripe: PINK, shadow: PINK, perfAt: 0.7, lw: 3, radius: 8 });
  font(x, 30, { weight: 800, wdth: 85, opsz: 48 });
  x.fillStyle = INK;
  x.fillText('Eat. Grow. Last.', 24, 44);
  mono(x, 17, 0.02);
  x.fillStyle = PINK_TEXT;
  x.textAlign = 'center';
  x.fillText('slana.io', t.perfX + (410 - t.perfX) / 2, 40);
  x.textAlign = 'left';
  x.restore();
  tape(x, 62, 316, 60, 22, 0.9, GOLD, 1604);
  // chase
  confetti(x, 470, 30, 470, 480, 10, 1605, { size: [5, 9], avoid: (px, py) => Math.hypot(px - 740, py - 280) < 210 });
  speedLines(x, 560, 110, 36, -1, -0.25, PINK, 3, 1);
  coin(x, 560, 110, 36, lookForBasicSkin(4), { expression: 'scared', lookX: 0.9, lookY: 0.4 });
  speedLines(x, 520, 400, 24, -1, 0.1, TEAL, 2, 1.1);
  coin(x, 520, 400, 24, lookForBasicSkin(5), { expression: 'scared', lookX: 0.9 });
  x.save();
  x.translate(740, 285);
  x.rotate(-0.08);
  heroCoin(x, 165, { expression: 'hungry', mouth: 'grin', lookX: -1, lookY: -0.5, faceScale: 1.18, faceY: 0.1 });
  x.restore();
  stampAt(x, W, H, 885, 470, 0.2, (l) => roundStamp(l, 50, 'WL OPEN * SLANA.IO/WL * ', { color: TEAL_INK, size: 11, lw: 3 }), { seed: 1606 });
}

function telegramHeader(x, W, H) {
  paper(x, W, H, 1701);
  grid(x, -10, -10, W + 20, H + 20, 32, 0.09);
  layer(x, W, H, (l) => halftone(l, 760, -40, 560, 560, 13, PINK, (px, py) => {
    const d = Math.hypot(px - 1050, py - 230) / 270;
    return d < 1 ? 1 - smooth(0.35, 1, d) * 0.92 : 0;
  }), { op: 'multiply', alpha: 0.9, wear: 0.4, seed: 1702 });
  regMarks(x, W, H, 24, 10, { lw: 1.5 });
  label(x, 'WELCOME TO THE POND', 64, 100, 19, PINK_TEXT, { spacing: 0.2 });
  wordmark(x, 56, 250, 176);
  font(x, 40, { weight: 800, wdth: 85, opsz: 48 });
  x.fillStyle = INK;
  x.letterSpacing = '-0.5px';
  x.fillText('Coins eat coins. Last the round.', 64, 318);
  label(x, '5-MIN ROUNDS · 5% FEE ON PROFIT · PAID AT THE BELL', 66, 362, 15, INK_2, { spacing: 0.14 });
  // hero
  x.save();
  x.translate(1060, 235);
  x.rotate(-0.06);
  heroCoin(x, 150, { face: FACES.beam, faceScale: 1.25, faceY: 0.1, symbol: 'star' });
  x.restore();
  confetti(x, 780, 30, 480, 400, 9, 1703, { size: [5, 9], avoid: (px, py) => Math.hypot(px - 1060, py - 235) < 190 });
  // the four arena tickets
  const tw = 270;
  const gap = 26;
  const x0 = (W - (tw * 4 + gap * 3)) / 2;
  ARENAS.forEach((a, i) => {
    x.save();
    x.translate(x0 + i * (tw + gap), 430 + (i % 2) * 8);
    x.rotate([-0.025, 0.015, -0.01, 0.02][i]);
    const t = ticket(x, { w: tw, h: 150, stripe: a.ink, shadow: a.ink === GOLD ? INK : a.ink, perfAt: 0.76, lw: 3, radius: 10, stripeW: 0.04 });
    label(x, `ARENA 0${a.id}`, 26, 36, 13, INK_2, { spacing: 0.16 });
    font(x, 32, { weight: 800, wdth: 82 });
    x.fillStyle = INK;
    x.letterSpacing = '-0.5px';
    x.fillText(a.name, 24, 78);
    font(x, 30, { weight: 800, wdth: 85 });
    x.fillStyle = a.id === 3 ? '#885F0D' : a.text;
    x.fillText(fmt(a.entry), 24, 124);
    coin(x, t.perfX + (tw - t.perfX) / 2, 75, 22, lookForBasicSkin([2, 3, 1, 5][i]), { expression: 'happy' });
    x.restore();
  });
  label(x, '@SLANAIO', 64, H - 22, 14, INK_2, { spacing: 0.18 });
  label(x, 'SLANA.IO', W - 64, H - 22, 14, INK_2, { align: 'right', spacing: 0.18 });
}

console.log('Slana community assets');
saveSmall(render(512, 512, (x) => icon(x, 512), { seed: 1 }), OUT, 'server-icon-512.png');
saveSmall(render(640, 640, (x) => icon(x, 640), { seed: 2 }), OUT, 'telegram-photo-640.png');
saveSmall(render(960, 540, (x, W, H) => discordBanner(x, W, H), { seed: 3 }), OUT, 'discord-banner-960x540.png');
saveSmall(render(1280, 640, (x, W, H) => telegramHeader(x, W, H), { seed: 4 }), OUT, 'telegram-header-1280x640.png');
