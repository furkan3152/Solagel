#!/usr/bin/env node
/**
 * Slana arena posters: one 2000×2800 riso print per arena (Penny Pond, Silver
 * Creek, Gold Lake, Whale Bay), collectible-print style with registration
 * marks, colour bars and an edition seal.
 *
 *   node brand/posters/generate.mjs              # all four
 *   node brand/posters/generate.mjs --only 3     # one arena by id
 *
 * Output is deterministic. Files over ~4 MB as truecolor are written as
 * 256-colour indexed PNGs.
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARENAS,
  CARD_PAPER,
  GOLD,
  INK,
  INK_2,
  PINK,
  TEAL,
  colorBar,
  fmt,
  font,
  inkText,
  label,
  layer,
  measure,
  mono,
  paper,
  perforation,
  readArgs,
  regMark,
  render,
  roundRect,
  roundStamp,
  saveSmall,
  stampAt,
  tape,
  ticket,
  wordmark,
  halftone,
  smooth,
} from '../lib/riso.mjs';
import { arenaScene } from '../lib/scenes.mjs';

const OUT = dirname(fileURLToPath(import.meta.url));
const args = readArgs();
const W = 2000;
const H = 2800;

function poster(x, a) {
  paper(x, W, H, 1200 + a.id);
  const textInk = a.id === 3 ? '#885F0D' : a.text;
  // trim marks + registration outside the print area
  const T = 70;
  x.save();
  x.strokeStyle = INK;
  x.lineWidth = 2;
  for (const [px, py, sx, sy] of [
    [T, T, -1, -1],
    [W - T, T, 1, -1],
    [T, H - T, -1, 1],
    [W - T, H - T, 1, 1],
  ]) {
    x.beginPath();
    x.moveTo(px + sx * 12, py);
    x.lineTo(px + sx * 52, py);
    x.moveTo(px, py + sy * 12);
    x.lineTo(px, py + sy * 52);
    x.stroke();
  }
  x.restore();
  for (const [px, py] of [
    [W / 2, 34],
    [W / 2, H - 34],
    [34, H / 2],
    [W - 34, H / 2],
  ]) {
    x.save();
    x.globalCompositeOperation = 'multiply';
    regMark(x, px + 3, py + 2, 16, PINK, 2);
    regMark(x, px - 2, py - 2, 16, TEAL, 2);
    x.restore();
    regMark(x, px, py, 16, INK, 2);
  }
  // ink border (the arena's ink), worn
  layer(
    x,
    W,
    H,
    (l) => {
      l.fillStyle = a.ink;
      l.beginPath();
      l.rect(T, T, W - T * 2, H - T * 2);
      l.rect(T + 34, T + 34, W - T * 2 - 68, H - T * 2 - 68);
      l.fill('evenodd');
    },
    { op: 'multiply', wear: 0.6, seed: 1210 + a.id },
  );
  // soft halftone wash at the top in the arena ink
  layer(
    x,
    W,
    H,
    (l) => {
      halftone(l, T + 34, T + 34, W - T * 2 - 68, 900, 22, a.ink, (px, py) => 0.55 * (1 - smooth(0, 1, (py - T) / 900)));
    },
    { op: 'multiply', alpha: 0.6, wear: 0.4, seed: 1220 + a.id },
  );

  const L = 170;
  const R = W - 170;
  // header
  label(x, 'SLANA ARENA SERIES', L, 210, 28, INK, { spacing: 0.24 });
  label(x, `PRINT 0${a.id} / 04`, R, 210, 28, INK, { align: 'right', spacing: 0.24 });
  x.fillStyle = INK;
  x.fillRect(L, 236, R - L, 4);
  // name, as big as it fits
  const words = a.name.toUpperCase().split(' ');
  const size = Math.min(...words.map((w) => Math.floor((440 * (R - L)) / measure(x, w, 440, { tracking: -0.03 }))), 440);
  let y = 270 + size * 0.86;
  const ghostA = a.id === 2 ? PINK : TEAL;
  for (const w of words) {
    inkText(x, w, L - size * 0.03, y, size, { ghostA, ghostB: a.ink, alphaA: 0.6, tracking: -0.03, offA: [-0.012, -0.012], offB: [0.022, 0.02] });
    y += size * 0.84;
  }
  const nameBottom = y - size * 0.84;
  // the scene
  const sy = nameBottom + 90;
  const sh = 2290 - sy;
  x.save();
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = INK;
  roundRect(x, L + 16, sy + 16, R - L, sh, 18);
  x.fill();
  x.restore();
  roundRect(x, L, sy, R - L, sh, 18);
  x.fillStyle = PAPER_HEX;
  x.fill();
  arenaScene(x, W, H, a.id, L, sy, R - L, sh, { radius: 18, frame: 7, seed: 1300 });
  tape(x, L + 40, sy + 8, 220, 64, -0.65, CARD_PAPER, 1240 + a.id, { op: 'source-over', alpha: 0.82 });
  tape(x, R - 40, sy + 8, 220, 64, 0.65, CARD_PAPER, 1250 + a.id, { op: 'source-over', alpha: 0.82 });
  // the ticket band
  const ty = 2360;
  const th = 250;
  x.save();
  x.translate(L, ty);
  const t = ticket(x, { w: R - L, h: th, stripe: a.ink, shadow: a.ink, perfAt: 0.74, lw: 5, radius: 16, stripeW: 0.02, shadowOff: 2.4 });
  const pad = 70;
  label(x, 'ENTRY', pad, 66, 26, INK_2, { spacing: 0.22 });
  font(x, 120, { weight: 800, wdth: 85 });
  x.letterSpacing = '-2px';
  x.fillStyle = textInk;
  const num = fmt(a.entry);
  x.fillText(num, pad - 4, 186);
  const nw = x.measureText(num).width;
  mono(x, 42, 0.02);
  x.fillStyle = INK;
  x.fillText('$SLANA', pad + nw + 22, 186);
  mono(x, 23, 0.14);
  x.fillStyle = INK;
  const facts = ['5-MINUTE ROUNDS', '5% FEE ON PROFIT', 'PAID AT THE BELL', 'FLOOR LOOT BURNED'];
  facts.forEach((f, i) => x.fillText(f, t.perfX - 470, 62 + i * 46));
  // stub: wordmark + url
  wordmark(x, t.perfX + 70, 140, 96);
  label(x, 'SLANA.IO', t.perfX + 74, 200, 26, INK, { spacing: 0.2 });
  x.restore();
  perforation(x, t.perfX + L - 500, ty + 40, t.perfX + L - 500, ty + th - 40, { lw: 2, dash: 6, alpha: 0.3 });
  // edition seal
  stampAt(
    x,
    W,
    H,
    R - 170,
    nameBottom - size * 0.5,
    0.18,
    (l) => roundStamp(l, 120, `${a.name.toUpperCase()} * ARENA 0${a.id} OF 04 * `, { color: a.id === 3 ? '#C98A00' : a.text, size: 20, lw: 6, center: `0${a.id}`, centerSize: 84 }),
    { seed: 1260 + a.id, wear: 1.1 },
  );
  // footer: colour bar + print note, in the margin under the border
  colorBar(x, L, H - T - 34 - 70, 44, 26, [INK, a.ink, PINK, TEAL, GOLD], { gap: 6 });
  label(x, `RISO · ${[INK, a.ink, PINK, TEAL].map((c) => c.toUpperCase()).join(' · ')}`, L + 280, H - T - 34 - 50, 18, INK_2, { spacing: 0.16 });
  label(x, `NO. 0${a.id} · @SLANAIO · $SLANA ON SOLANA`, R, H - T - 34 - 50, 18, INK_2, { align: 'right', spacing: 0.16 });
}
const PAPER_HEX = '#FCF4DF';

console.log('Slana arena posters');
for (const a of ARENAS) {
  if (args.only && String(a.id) !== String(args.only)) continue;
  const c = render(W, H, (x) => poster(x, a), { ss: 1, seed: 1400 + a.id, grainAmt: 6 });
  saveSmall(c, OUT, `poster-${a.id}-${a.slug}.png`, 4);
}
