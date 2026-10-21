#!/usr/bin/env node
/**
 * Slana sticker / emote pack for Discord and Telegram: 13 coin characters on
 * transparent 512×512 PNGs, die-cut with a paper border, an ink cut line and
 * an off-register riso shadow. Also writes 128×128 copies for Discord emoji.
 *
 *   node brand/stickers/generate.mjs
 *
 * Each sticker is drawn at 2× and downscaled. Output is deterministic.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BLUE,
  CARD_PAPER,
  FACES,
  GOLD,
  INK,
  PINK,
  PINK_TEXT,
  RED,
  RISO,
  TAU,
  TEAL,
  arm,
  bell,
  burstLines,
  canvas,
  coin,
  dieCut,
  downscale,
  flame,
  font,
  grain,
  heartPath,
  heroCoin,
  legs,
  lookForBasicSkin,
  mono,
  pellet,
  roundRect,
  save,
  sparkle,
  speedLines,
  starPath,
  stopwatch,
  wordStamp,
} from '../lib/riso.mjs';

const OUT = dirname(fileURLToPath(import.meta.url));
const S = 1024; // drawing size (2×)

/** Chunky sticker word: teal ghost, ink outline, coloured fill. */
function word(x, text, cx, cy, size, { fill = PINK, rot = -0.06, ghost = TEAL, outline = INK, color = CARD_PAPER } = {}) {
  x.save();
  x.translate(cx, cy);
  x.rotate(rot);
  font(x, size, { weight: 800, wdth: 82 });
  x.letterSpacing = `${-0.01 * size}px`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.lineJoin = 'round';
  x.miterLimit = 2;
  // ghost pass
  x.fillStyle = ghost;
  x.strokeStyle = ghost;
  x.lineWidth = size * 0.26;
  x.strokeText(text, size * 0.07, size * 0.08);
  x.fillText(text, size * 0.07, size * 0.08);
  // ink outline + fill
  x.strokeStyle = outline;
  x.lineWidth = size * 0.26;
  x.strokeText(text, 0, 0);
  x.fillStyle = fill;
  x.fillText(text, 0, 0);
  // paper highlight
  x.save();
  x.globalAlpha = 0.9;
  x.fillStyle = color;
  x.beginPath();
  x.rect(-S, -size * 0.5, S * 2, size * 0.16);
  x.clip();
  x.fillText(text, 0, 0);
  x.restore();
  x.restore();
}

function mug(x, cx, cy, s) {
  x.save();
  x.translate(cx, cy);
  x.rotate(0.12);
  x.lineJoin = 'round';
  x.lineCap = 'round';
  // steam
  x.strokeStyle = INK;
  x.lineWidth = s * 0.07;
  for (const dx of [-0.25, 0.05, 0.35]) {
    x.beginPath();
    x.moveTo(dx * s, -s * 0.75);
    x.bezierCurveTo(dx * s - s * 0.15, -s * 0.95, dx * s + s * 0.15, -s * 1.1, dx * s, -s * 1.3);
    x.stroke();
  }
  // handle
  x.lineWidth = s * 0.11;
  x.beginPath();
  x.arc(s * 0.55, -s * 0.15, s * 0.24, -1.3, 1.3);
  x.stroke();
  x.fillStyle = PINK;
  roundRect(x, -s * 0.55, -s * 0.62, s * 1.1, s * 1.05, s * 0.16);
  x.fill();
  x.lineWidth = s * 0.07;
  x.stroke();
  x.fillStyle = CARD_PAPER;
  roundRect(x, -s * 0.38, -s * 0.36, s * 0.76, s * 0.3, s * 0.08);
  x.fill();
  x.fillStyle = INK;
  mono(x, s * 0.2, 0);
  x.textAlign = 'center';
  x.fillText('GM', 0, -s * 0.15);
  x.textAlign = 'left';
  x.restore();
}

function nightcap(x, r) {
  x.save();
  x.lineJoin = 'round';
  x.beginPath();
  x.moveTo(-r * 0.78, -r * 0.55);
  x.quadraticCurveTo(-r * 0.1, -r * 1.25, r * 0.55, -r * 1.55);
  x.quadraticCurveTo(r * 0.75, -r * 1.05, r * 0.8, -r * 0.5);
  x.quadraticCurveTo(0, -r * 0.95, -r * 0.78, -r * 0.55);
  x.closePath();
  x.fillStyle = BLUE;
  x.fill();
  x.lineWidth = r * 0.06;
  x.strokeStyle = INK;
  x.stroke();
  // stripes
  x.save();
  x.clip();
  x.strokeStyle = CARD_PAPER;
  x.lineWidth = r * 0.09;
  for (let i = -3; i < 6; i++) {
    x.beginPath();
    x.moveTo(-r + i * r * 0.32, -r * 0.4);
    x.lineTo(-r * 0.5 + i * r * 0.32, -r * 1.7);
    x.stroke();
  }
  x.restore();
  // brim
  x.beginPath();
  x.moveTo(-r * 0.86, -r * 0.5);
  x.quadraticCurveTo(0, -r * 0.98, r * 0.86, -r * 0.45);
  x.lineWidth = r * 0.16;
  x.strokeStyle = INK;
  x.stroke();
  x.lineWidth = r * 0.08;
  x.strokeStyle = CARD_PAPER;
  x.stroke();
  // pompom
  x.beginPath();
  x.arc(r * 0.58, -r * 1.58, r * 0.14, 0, TAU);
  x.fillStyle = GOLD;
  x.fill();
  x.lineWidth = r * 0.05;
  x.strokeStyle = INK;
  x.stroke();
  x.restore();
}

function zzz(x, cx, cy, s) {
  x.save();
  font(x, s, { weight: 800, wdth: 80 });
  x.lineJoin = 'round';
  [
    [0, 0, 1],
    [s * 0.6, -s * 0.7, 0.75],
    [s * 1.05, -s * 1.25, 0.55],
  ].forEach(([dx, dy, k]) => {
    font(x, s * k, { weight: 800, wdth: 80 });
    x.lineWidth = s * k * 0.22;
    x.strokeStyle = INK;
    x.strokeText('z', cx + dx, cy + dy);
    x.fillStyle = CARD_PAPER;
    x.fillText('z', cx + dx, cy + dy);
  });
  x.restore();
}

function heart(x, cx, cy, s, fill = PINK, rot = 0) {
  x.save();
  x.translate(cx, cy);
  x.rotate(rot);
  x.save();
  x.translate(s * 0.08, s * 0.08);
  heartPath(x, s);
  x.fillStyle = TEAL;
  x.fill();
  x.restore();
  heartPath(x, s);
  x.fillStyle = fill;
  x.fill();
  x.lineWidth = s * 0.12;
  x.strokeStyle = INK;
  x.lineJoin = 'round';
  x.stroke();
  x.restore();
}

function receiptSmall(x, cx, cy, s, rot) {
  x.save();
  x.translate(cx, cy);
  x.rotate(rot);
  const w = s;
  const h = s * 1.25;
  x.translate(-w / 2, -h / 2);
  x.beginPath();
  x.moveTo(0, 0);
  x.lineTo(w, 0);
  x.lineTo(w, h);
  for (let i = 6; i > 0; i--) {
    x.lineTo((i - 0.5) * (w / 6), h - w * 0.07);
    x.lineTo((i - 1) * (w / 6), h);
  }
  x.closePath();
  x.fillStyle = CARD_PAPER;
  x.fill();
  x.lineWidth = s * 0.04;
  x.strokeStyle = INK;
  x.lineJoin = 'round';
  x.stroke();
  x.fillStyle = INK;
  for (let i = 0; i < 4; i++) {
    x.globalAlpha = 0.8;
    x.fillRect(w * 0.12, h * (0.14 + i * 0.12), w * (i === 3 ? 0.4 : 0.76), s * 0.035);
  }
  x.globalAlpha = 1;
  font(x, s * 0.24, { weight: 800, wdth: 80 });
  x.fillText('+1,950', w * 0.1, h * 0.8);
  x.restore();
}

/** Slana coin with optional limbs. `pose` sets the arms. */
function body(x, cx, cy, r, { face, coinOpts = {}, armsFn, legsOn = true, legOpts = {}, rot = 0, front } = {}) {
  x.save();
  x.translate(cx, cy);
  x.rotate(rot);
  if (legsOn) legs(x, r, { spread: 0.34, len: 0.3, ...legOpts });
  if (armsFn) armsFn(x, r);
  heroCoin(x, r, { face: face ? FACES[face] : null, faceScale: 1.28, faceY: 0.1, symbol: 'star', ...coinOpts });
  if (front) front(x, r);
  x.restore();
}

const STICKERS = {
  gm(x) {
    body(x, 470, 470, 260, {
      face: 'yawn',
      armsFn: (x, r) => {
        arm(x, r, Math.PI * 1.15, [-1.15, -1.05], { bend: -0.2 });
        arm(x, r, 0.35, [1.15, 0.45], { bend: -0.2, handR: 0 });
      },
      front: (x, r) => {
        mug(x, r * 1.2, r * 0.38, r * 0.38);
        x.fillStyle = CARD_PAPER;
        x.strokeStyle = INK;
        x.lineWidth = r * 0.045;
        x.beginPath();
        x.arc(r * 0.98, r * 0.42, r * 0.13, 0, TAU);
        x.fill();
        x.stroke();
      },
    });
    sparkle(x, 170, 170, 44, GOLD, 8);
    sparkle(x, 860, 230, 30, PINK, 7);
    word(x, 'GM!', 520, 845, 230, { fill: GOLD, rot: -0.06 });
  },
  gn(x) {
    body(x, 512, 500, 270, {
      coinOpts: { expression: 'sleep', symbol: null, faceY: 0.14 },
      legsOn: false,
      front: (x, r) => nightcap(x, r),
    });
    zzz(x, 760, 330, 120);
    x.save();
    x.translate(210, 230);
    x.beginPath();
    x.arc(0, 0, 70, 0.3, Math.PI * 1.65);
    x.arc(32, -24, 58, Math.PI * 1.5, 0.45, true);
    x.closePath();
    x.fillStyle = GOLD;
    x.fill();
    x.lineWidth = 10;
    x.strokeStyle = INK;
    x.stroke();
    x.restore();
    word(x, 'GN', 512, 850, 230, { fill: BLUE, color: '#7C93FF', rot: 0.05 });
  },
  wagmi(x) {
    // two coins high-fiving
    x.save();
    x.translate(330, 500);
    x.rotate(-0.1);
    legs(x, 190, { len: 0.28 });
    arm(x, 190, Math.PI * 1.05, [-1.25, 0.1], { bend: 0.2 });
    arm(x, 190, -0.55, [0.95, -1.15], { bend: 0.15 });
    heroCoin(x, 190, { face: FACES.beam, faceScale: 1.28, faceY: 0.1, symbol: 'star' });
    x.restore();
    x.save();
    x.translate(700, 500);
    x.rotate(0.1);
    legs(x, 180, { len: 0.28 });
    arm(x, 180, 0.05, [1.25, 0.15], { bend: -0.2 });
    arm(x, 180, Math.PI + 0.55, [-0.95, -1.2], { bend: -0.15 });
    heroCoin(x, 180, { body: PINK, ghostA: TEAL, ghostB: GOLD, face: FACES.beam, faceScale: 1.28, faceY: 0.1, symbol: 'heart', blush: GOLD });
    x.restore();
    burstLines(x, 515, 245, 70, 120, [-2.6, -2.1, -1.57, -1.05, -0.5], { lw: 14 });
    word(x, 'WAGMI', 512, 860, 190, { fill: TEAL, ghost: PINK, rot: -0.04 });
  },
  lfg(x) {
    speedLines(x, 560, 450, 230, 1, -0.25, PINK, 3, 1.4);
    body(x, 560, 450, 230, {
      face: 'shout',
      rot: 0.15,
      legOpts: { kick: 0.4, len: 0.34 },
      armsFn: (x, r) => {
        arm(x, r, -0.6, [1.0, -1.25], { bend: 0.1 });
        arm(x, r, Math.PI * 0.95, [-1.35, 0.25], { bend: 0.3 });
      },
    });
    sparkle(x, 880, 170, 46, GOLD, 9);
    word(x, 'LFG', 500, 850, 250, { fill: PINK, rot: -0.08 });
  },
  paid(x) {
    body(x, 440, 450, 240, {
      face: 'money',
      armsFn: (x, r) => {
        arm(x, r, -0.3, [1.2, -0.55], { bend: 0.2, handR: 0 });
        arm(x, r, Math.PI * 0.9, [-1.3, 0.1], { bend: 0.25 });
      },
      front: (x, r) => {
        receiptSmall(x, r * 1.45, -r * 0.62, r * 0.7, 0.18);
        x.fillStyle = CARD_PAPER;
        x.strokeStyle = INK;
        x.lineWidth = r * 0.045;
        x.beginPath();
        x.arc(r * 1.2, -r * 0.55, r * 0.13, 0, TAU);
        x.fill();
        x.stroke();
      },
    });
    for (const [px, py, s] of [
      [150, 220, 26],
      [210, 140, 18],
      [860, 560, 22],
    ])
      pellet(x, px, py, s, 'gold', GOLD);
    x.save();
    x.translate(520, 850);
    x.rotate(-0.12);
    // stamp-style word on a paper label
    roundRect(x, -250, -95, 500, 190, 30);
    x.fillStyle = CARD_PAPER;
    x.fill();
    wordStamp(x, 'PAID', { color: PINK_TEXT, size: 150, lw: 14 });
    x.restore();
  },
  eaten(x) {
    // a coin with a bite out of it, crumbs falling
    const [c, l] = canvas(S, S);
    l.translate(500, 470);
    l.rotate(-0.15);
    heroCoin(l, 270, { body: RISO.orange, ghostA: RED, ghostB: null, face: FACES.dizzy, faceScale: 1.25, faceY: 0.08, symbol: 'coin', blush: GOLD });
    const bites = [
      [220, -200, 95],
      [290, -90, 80],
      [150, -275, 70],
    ];
    l.globalCompositeOperation = 'destination-out';
    for (const [bx, by, br] of bites) {
      l.beginPath();
      l.arc(bx, by, br, 0, TAU);
      l.fill();
    }
    l.globalCompositeOperation = 'source-atop';
    l.strokeStyle = INK;
    l.lineWidth = 34;
    for (const [bx, by, br] of bites) {
      l.beginPath();
      l.arc(bx, by, br, 0, TAU);
      l.stroke();
    }
    x.drawImage(c, 0, 0);
    for (const [px, py, s, k, col] of [
      [820, 200, 22, 'tri', RISO.orange],
      [860, 300, 16, 'dot', RISO.orange],
      [760, 120, 14, 'dot', GOLD],
      [900, 140, 18, 'tri', GOLD],
    ])
      pellet(x, px, py, s, k, col);
    word(x, 'EATEN', 512, 860, 200, { fill: RISO.orange, ghost: PINK, rot: 0.05 });
  },
  bell(x) {
    body(x, 512, 560, 210, {
      face: 'beam',
      armsFn: (x, r) => {
        arm(x, r, -1.9, [-0.55, -1.45], { bend: 0.1 });
        arm(x, r, -1.25, [0.55, -1.45], { bend: -0.1 });
      },
    });
    bell(x, 512, 210, 140, { tilt: 0.2 });
    for (const s of [-1, 1]) {
      x.fillStyle = CARD_PAPER;
      x.strokeStyle = INK;
      x.lineWidth = 9;
      x.beginPath();
      x.arc(512 + s * 115, 265, 27, 0, TAU);
      x.fill();
      x.stroke();
    }
    word(x, 'DING!', 512, 880, 200, { fill: GOLD, rot: -0.05 });
  },
  rekt(x) {
    body(x, 512, 450, 260, {
      face: 'dizzy',
      coinOpts: { body: RISO.lilac, ghostA: RISO.purple, ghostB: PINK, symbol: 'diamond' },
      legOpts: { spread: 0.4, len: 0.22 },
      armsFn: (x, r) => {
        arm(x, r, Math.PI * 0.8, [-1.25, 0.75], { bend: 0.2 });
        arm(x, r, Math.PI * 0.2, [1.25, 0.75], { bend: -0.2 });
      },
      front: (x, r) => {
        // the crack
        x.strokeStyle = INK;
        x.lineWidth = r * 0.05;
        x.lineJoin = 'miter';
        x.beginPath();
        x.moveTo(-r * 0.15, -r * 0.98);
        x.lineTo(-r * 0.05, -r * 0.72);
        x.lineTo(-r * 0.22, -r * 0.58);
        x.lineTo(-r * 0.08, -r * 0.36);
        x.stroke();
        // a plaster
        x.save();
        x.translate(r * 0.52, -r * 0.55);
        x.rotate(0.7);
        roundRect(x, -r * 0.3, -r * 0.1, r * 0.6, r * 0.2, r * 0.08);
        x.fillStyle = '#F6C8A8';
        x.fill();
        x.lineWidth = r * 0.03;
        x.stroke();
        x.fillStyle = CARD_PAPER;
        roundRect(x, -r * 0.1, -r * 0.08, r * 0.2, r * 0.16, r * 0.03);
        x.fill();
        x.restore();
      },
    });
    for (const [px, py, s, rot] of [
      [200, 180, 40, 0.2],
      [820, 160, 32, -0.3],
      [870, 380, 24, 0.1],
    ]) {
      x.save();
      x.translate(px, py);
      x.rotate(rot);
      starPath(x, s, s * 0.45);
      x.fillStyle = GOLD;
      x.fill();
      x.lineWidth = 7;
      x.strokeStyle = INK;
      x.stroke();
      x.restore();
    }
    word(x, 'REKT', 512, 850, 240, { fill: RISO.purple, color: RISO.lilac, ghost: PINK, rot: -0.07 });
  },
  gulp(x) {
    // a little coin sweating under a looming big coin with its mouth open
    x.save();
    x.translate(790, 230);
    x.rotate(0.35);
    x.save();
    x.translate(14, 12);
    x.beginPath();
    x.arc(0, 0, 190, 0, TAU);
    x.fillStyle = PINK;
    x.fill();
    x.restore();
    x.beginPath();
    x.arc(0, 0, 190, 0, TAU);
    x.fillStyle = INK;
    x.fill();
    x.lineWidth = 6;
    x.strokeStyle = CARD_PAPER;
    x.setLineDash([16, 12]);
    x.beginPath();
    x.arc(0, 0, 160, 0, TAU);
    x.stroke();
    x.setLineDash([]);
    // eyes (angry slits) and a wide open mouth
    x.fillStyle = CARD_PAPER;
    for (const s of [-1, 1]) {
      x.beginPath();
      x.moveTo(s * 95, -40);
      x.lineTo(s * 30, -15);
      x.lineTo(s * 85, -5);
      x.closePath();
      x.fill();
    }
    x.beginPath();
    x.ellipse(-10, 75, 95, 62, 0, 0, TAU);
    x.fillStyle = PINK;
    x.fill();
    x.lineWidth = 8;
    x.strokeStyle = CARD_PAPER;
    x.stroke();
    x.fillStyle = CARD_PAPER;
    for (const dx of [-60, -20, 20]) {
      x.beginPath();
      x.moveTo(dx - 16, 18);
      x.lineTo(dx + 16, 18);
      x.lineTo(dx, 48);
      x.closePath();
      x.fill();
    }
    x.restore();
    body(x, 400, 540, 220, {
      face: 'gulp',
      legOpts: { spread: 0.28 },
      armsFn: (x, r) => {
        arm(x, r, Math.PI * 0.75, [-0.7, 0.85], { bend: 0.3 });
        arm(x, r, Math.PI * 0.25, [0.7, 0.85], { bend: -0.3 });
      },
      front: (x, r) => {
        for (const [dx, dy, s] of [
          [0.85, -0.55, 0.1],
          [1.0, -0.25, 0.07],
        ]) {
          x.save();
          x.translate(dx * r, dy * r);
          x.beginPath();
          x.moveTo(0, -s * r * 1.4);
          x.quadraticCurveTo(s * r, 0, 0, s * r);
          x.quadraticCurveTo(-s * r, 0, 0, -s * r * 1.4);
          x.closePath();
          x.fillStyle = RISO.aqua;
          x.fill();
          x.lineWidth = r * 0.03;
          x.strokeStyle = INK;
          x.stroke();
          x.restore();
        }
      },
    });
    word(x, 'GULP', 440, 870, 220, { fill: RISO.aqua, color: '#BDF3FC', ghost: PINK, rot: -0.05 });
  },
  cry(x) {
    body(x, 512, 470, 270, {
      face: 'cry',
      coinOpts: { body: RISO.aqua, ghostA: BLUE, ghostB: PINK, symbol: 'moon' },
      legOpts: { spread: 0.3, len: 0.24 },
      armsFn: (x, r) => {
        arm(x, r, Math.PI * 0.9, [-1.3, -0.3], { bend: -0.3 });
        arm(x, r, Math.PI * 0.1, [1.3, -0.3], { bend: 0.3 });
      },
    });
    // the puddle
    x.save();
    x.beginPath();
    x.ellipse(512, 880, 330, 54, 0, 0, TAU);
    x.fillStyle = RISO.aqua;
    x.fill();
    x.lineWidth = 9;
    x.strokeStyle = INK;
    x.stroke();
    x.strokeStyle = CARD_PAPER;
    x.lineWidth = 8;
    x.lineCap = 'round';
    x.beginPath();
    x.ellipse(430, 870, 120, 18, 0, Math.PI * 1.1, Math.PI * 1.6);
    x.stroke();
    x.restore();
    for (const [px, py, s, rot] of [
      [170, 330, 26, -0.4],
      [860, 320, 26, 0.4],
      [120, 470, 18, -0.6],
      [905, 470, 18, 0.6],
    ]) {
      x.save();
      x.translate(px, py);
      x.rotate(rot);
      x.beginPath();
      x.moveTo(0, -s * 1.4);
      x.quadraticCurveTo(s, 0, 0, s);
      x.quadraticCurveTo(-s, 0, 0, -s * 1.4);
      x.closePath();
      x.fillStyle = RISO.aqua;
      x.fill();
      x.lineWidth = 7;
      x.strokeStyle = INK;
      x.stroke();
      x.restore();
    }
  },
  ty(x) {
    body(x, 512, 450, 250, {
      coinOpts: { expression: 'love', eyes: 'heart', mouth: 'grin', symbol: 'heart', body: RISO.fluoPink, ghostA: TEAL, ghostB: GOLD, blush: GOLD, faceY: 0.1 },
      armsFn: (x, r) => {
        arm(x, r, Math.PI * 0.62, [-0.25, 0.75], { bend: 0.2, handR: 0 });
        arm(x, r, Math.PI * 0.38, [0.25, 0.75], { bend: -0.2, handR: 0 });
      },
      front: (x, r) => {
        heart(x, 0, r * 0.82, r * 0.42, RED, 0.05);
        for (const s of [-1, 1]) {
          x.fillStyle = CARD_PAPER;
          x.strokeStyle = INK;
          x.lineWidth = r * 0.045;
          x.beginPath();
          x.arc(s * r * 0.3, r * 0.72, r * 0.13, 0, TAU);
          x.fill();
          x.stroke();
        }
      },
    });
    heart(x, 180, 200, 50, PINK, -0.3);
    heart(x, 850, 170, 40, GOLD, 0.3);
    heart(x, 880, 420, 28, TEAL, 0.2);
    word(x, 'TY', 512, 890, 210, { fill: PINK, ghost: TEAL, rot: -0.05 });
  },
  wen(x) {
    body(x, 470, 470, 250, {
      face: 'wen',
      coinOpts: { body: RISO.mint, ghostA: TEAL, ghostB: PINK, symbol: 'dollar' },
      armsFn: (x, r) => {
        arm(x, r, 0.2, [1.25, -0.05], { bend: -0.1, handR: 0 });
        arm(x, r, Math.PI * 0.9, [-1.3, 0.25], { bend: 0.25 });
      },
      front: (x, r) => {
        stopwatch(x, r * 1.5, -r * 0.3, r * 0.42, { label: null, sweep: 0.62, accent: PINK, ghost: TEAL });
        x.fillStyle = CARD_PAPER;
        x.strokeStyle = INK;
        x.lineWidth = r * 0.045;
        x.beginPath();
        x.arc(r * 1.22, -r * 0.05, r * 0.13, 0, TAU);
        x.fill();
        x.stroke();
      },
    });
    word(x, 'WEN?', 512, 860, 220, { fill: RISO.mint, color: '#C9F7E6', ghost: PINK, rot: 0.05 });
  },
  burn(x) {
    flame(x, 760, 430, 200);
    body(x, 400, 480, 230, {
      coinOpts: { expression: 'happy', eyes: 'sunglasses', mouth: 'grin', symbol: 'bolt' },
      armsFn: (x, r) => {
        arm(x, r, -0.1, [1.3, -0.2], { bend: -0.1 });
        arm(x, r, Math.PI * 0.95, [-1.3, 0.3], { bend: 0.25 });
      },
    });
    for (const [px, py, s] of [
      [840, 170, 12],
      [700, 150, 9],
      [900, 260, 8],
    ]) {
      x.save();
      x.fillStyle = RISO.orange;
      x.strokeStyle = INK;
      x.lineWidth = 5;
      x.beginPath();
      x.arc(px, py, s, 0, TAU);
      x.fill();
      x.stroke();
      x.restore();
    }
    word(x, 'BURNED', 512, 860, 170, { fill: RISO.orange, ghost: PINK, rot: -0.05 });
  },
};

const SHADOW = { gm: TEAL, gn: PINK, wagmi: PINK, lfg: TEAL, paid: TEAL, eaten: TEAL, bell: PINK, rekt: TEAL, gulp: PINK, cry: PINK, ty: TEAL, wen: PINK, burn: TEAL };

console.log('Slana sticker pack');
let i = 0;
for (const [name, draw] of Object.entries(STICKERS)) {
  i++;
  const [c, x] = canvas(S, S);
  // keep the art inside the die-cut margin: draw into a slightly smaller frame
  x.translate(S * 0.06, S * 0.05);
  x.scale(0.88, 0.88);
  draw(x);
  const cut = dieCut(c, { border: 26, line: 10, shadow: SHADOW[name], shadowOff: [12, 14] });
  const out = downscale(cut, 512, 512);
  grain(out.getContext('2d'), 512, 512, 70 + i, 4, 1);
  const n = String(i).padStart(2, '0');
  save(out, OUT, `${n}-${name}.png`);
  save(downscale(out, 128, 128), join(OUT, 'emoji'), `slana_${name}.png`);
}
