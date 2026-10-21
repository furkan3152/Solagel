/**
 * The four arena illustrations (Penny Pond, Silver Creek, Gold Lake, Whale
 * Bay), drawn into a box so the reveal cards, the stories and the posters all
 * share one picture per arena. Local coordinates: (0,0) is the box's top-left
 * corner; `u` is the box's short side / 1000 so the art scales with the box.
 */
import {
  ARENAS,
  BLUE,
  CARD_PAPER,
  GOLD,
  INK,
  PINK,
  RED,
  RISO,
  TAU,
  TEAL,
  arm,
  burstLines,
  coin,
  confetti,
  halftone,
  heroCoin,
  layer,
  lookForBasicSkin,
  pellet,
  rng,
  smooth,
  sparkle,
  speedLines,
  sunburst,
  waveTicks,
  waves,
} from './riso.mjs';

function clipBox(x, w, h, radius = 0) {
  x.beginPath();
  if (radius) x.roundRect(0, 0, w, h, radius);
  else x.rect(0, 0, w, h);
  x.clip();
}

/** Worn ink pass clipped to the box. */
function pass(x, W, H, w, h, radius, fn, { op = 'multiply', alpha = 1, wear = 0.45, seed = 1 } = {}) {
  layer(
    x,
    W,
    H,
    (l) => {
      clipBox(l, w, h, radius);
      fn(l);
    },
    { op, alpha, wear, seed },
  );
}

function lilyPad(x, cx, cy, r, rot, { fill = RISO.green, lw }) {
  x.save();
  x.translate(cx, cy);
  x.rotate(rot);
  x.beginPath();
  x.moveTo(0, 0);
  x.arc(0, 0, r, 0.32, TAU - 0.05);
  x.closePath();
  x.fillStyle = fill;
  x.fill();
  x.strokeStyle = INK;
  x.lineWidth = lw;
  x.lineJoin = 'round';
  x.stroke();
  // veins
  x.globalAlpha = 0.5;
  x.lineWidth = lw * 0.55;
  for (let i = 1; i < 6; i++) {
    const a = 0.32 + (i / 6) * (TAU - 0.37);
    x.beginPath();
    x.moveTo(0, 0);
    x.lineTo(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82);
    x.stroke();
  }
  x.restore();
}

function stone(x, cx, cy, rx, ry, rot, lw, seed) {
  const r = rng(seed);
  x.save();
  x.translate(cx, cy);
  x.rotate(rot);
  x.beginPath();
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU;
    const k = 0.9 + r() * 0.15;
    const px = Math.cos(a) * rx * k;
    const py = Math.sin(a) * ry * k;
    if (i === 0) x.moveTo(px, py);
    else x.lineTo(px, py);
  }
  x.closePath();
  x.fillStyle = CARD_PAPER;
  x.fill();
  x.save();
  x.clip();
  x.globalCompositeOperation = 'multiply';
  x.globalAlpha = 0.35;
  halftone(x, -rx, -ry, rx * 2, ry * 2, Math.max(4, rx * 0.12), INK, (px, py) => smooth(-0.2, 1, (px / rx + py / ry) * 0.6));
  x.restore();
  x.strokeStyle = INK;
  x.lineWidth = lw;
  x.lineJoin = 'round';
  x.stroke();
  x.restore();
}

function droplet(x, cx, cy, s, lw, color = CARD_PAPER, rot = 0) {
  x.save();
  x.translate(cx, cy);
  x.rotate(rot);
  x.beginPath();
  x.moveTo(0, -s * 1.5);
  x.quadraticCurveTo(s, 0, 0, s);
  x.quadraticCurveTo(-s, 0, 0, -s * 1.5);
  x.closePath();
  x.fillStyle = color;
  x.fill();
  x.strokeStyle = INK;
  x.lineWidth = lw;
  x.stroke();
  x.restore();
}

function bird(x, cx, cy, s, lw) {
  x.save();
  x.strokeStyle = INK;
  x.lineWidth = lw;
  x.lineCap = 'round';
  x.beginPath();
  x.moveTo(cx - s, cy - s * 0.2);
  x.quadraticCurveTo(cx - s * 0.5, cy - s * 0.6, cx, cy);
  x.quadraticCurveTo(cx + s * 0.5, cy - s * 0.6, cx + s, cy - s * 0.2);
  x.stroke();
  x.restore();
}

/** Penny Pond: a red pond from above, lily pads, a penny coin lounging on the biggest pad. */
function pennyPond(x, W, H, w, h, u, o) {
  const radius = o.radius;
  pass(x, W, H, w, h, radius, (l) => {
    l.fillStyle = RED;
    l.fillRect(0, 0, w, h);
  }, { seed: o.seed + 1, wear: 0.35 });
  // darker overprint pools (pink over red) as halftone
  pass(x, W, H, w, h, radius, (l) => {
    halftone(l, 0, 0, w, h, 22 * u, PINK, (px, py) => 0.85 * smooth(0.25, 1.1, Math.hypot(px - w * 0.95, py - h * 0.95) / Math.max(w, h)));
  }, { seed: o.seed + 2, wear: 0.3, alpha: 0.9 });
  x.save();
  clipBox(x, w, h, radius);
  const cx = w * 0.5;
  const cy = h * 0.56;
  // ripple rings in paper
  x.strokeStyle = CARD_PAPER;
  x.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const rr = (190 + i * 95) * u;
    x.globalAlpha = 0.75 - i * 0.08;
    x.lineWidth = (9 - i * 0.6) * u;
    x.setLineDash([rr * 0.5, rr * 0.16]);
    x.lineDashOffset = i * 40;
    x.beginPath();
    x.ellipse(cx, cy, rr, rr * 0.82, 0, 0, TAU);
    x.stroke();
  }
  x.setLineDash([]);
  x.globalAlpha = 1;
  const lw = 7 * u;
  // pads around
  const pads = [
    [0.12, 0.18, 120, 0.4],
    [0.88, 0.2, 150, 2.2],
    [0.1, 0.86, 140, 4.1],
    [0.9, 0.9, 110, 1.3],
    [0.72, 0.08, 70, 3.1],
    [0.3, 0.06, 60, 5.2],
  ];
  for (const [px, py, r, rot] of pads) lilyPad(x, px * w, py * h, r * u, rot, { lw });
  // lotus flower on a pad
  x.save();
  x.translate(0.12 * w, 0.18 * h);
  for (let i = 0; i < 6; i++) {
    x.save();
    x.rotate((i / 6) * TAU);
    x.beginPath();
    x.ellipse(0, -26 * u, 14 * u, 28 * u, 0, 0, TAU);
    x.fillStyle = CARD_PAPER;
    x.fill();
    x.strokeStyle = INK;
    x.lineWidth = lw * 0.6;
    x.stroke();
    x.restore();
  }
  x.beginPath();
  x.arc(0, 0, 14 * u, 0, TAU);
  x.fillStyle = GOLD;
  x.fill();
  x.stroke();
  x.restore();
  // the big pad under the hero
  lilyPad(x, cx, cy + 40 * u, 300 * u, 0.9, { lw: lw * 1.2 });
  // pellets floating
  confetti(x, 30 * u, 30 * u, w - 60 * u, h - 60 * u, 18, o.seed + 9, {
    size: [7 * u, 14 * u],
    inks: [GOLD, CARD_PAPER, TEAL],
    avoid: (px, py) => Math.hypot(px - cx, (py - cy) / 0.85) < 340 * u || pads.some(([a, b, r]) => Math.hypot(px - a * w, py - b * h) < r * u + 20 * u),
  });
  // small coins paddling away
  coin(x, w * 0.24, h * 0.5, 46 * u, lookForBasicSkin(3), { expression: 'happy', lookX: -0.6 });
  speedLines(x, w * 0.24, h * 0.5, 46 * u, -1, 0.1, CARD_PAPER, 2, 0.8);
  coin(x, w * 0.8, h * 0.66, 38 * u, lookForBasicSkin(5), { expression: 'sleep' });
  // hero: the penny
  x.save();
  x.translate(cx, cy - 10 * u);
  x.rotate(-0.08);
  heroCoin(x, 190 * u, { body: RISO.orange, ghostA: GOLD, ghostB: null, offA: [0.07, 0.06], expression: 'happy', eyes: 'round', mouth: 'grin', faceScale: 1.25, symbol: 'coin', blush: GOLD, ghostOver: true });
  x.restore();
  x.restore();
}

/** Silver Creek: a teal creek running corner to corner, stones, a silver coin leaping. */
function silverCreek(x, W, H, w, h, u, o) {
  const radius = o.radius;
  // banks: paper with a teal halftone grass texture
  pass(x, W, H, w, h, radius, (l) => {
    halftone(l, 0, 0, w, h, 20 * u, TEAL, () => 0.22);
  }, { seed: o.seed + 1, wear: 0.4, alpha: 0.8 });
  // the creek: a curving band
  const band = (l, grow = 0) => {
    l.beginPath();
    l.moveTo(-50 * u, h * 0.25 - grow);
    l.bezierCurveTo(w * 0.35, h * 0.12 - grow, w * 0.45, h * 0.62 - grow, w + 50 * u, h * 0.5 - grow);
    l.lineTo(w + 50 * u, h * 0.98 + grow);
    l.bezierCurveTo(w * 0.45, h * 1.05 + grow, w * 0.3, h * 0.55 + grow, -50 * u, h * 0.72 + grow);
    l.closePath();
  };
  pass(x, W, H, w, h, radius, (l) => {
    band(l);
    l.fillStyle = TEAL;
    l.fill();
  }, { seed: o.seed + 2, wear: 0.35 });
  pass(x, W, H, w, h, radius, (l) => {
    band(l);
    l.clip();
    halftone(l, 0, 0, w, h, 18 * u, BLUE, (px, py) => 0.55 * smooth(0.2, 1, py / h));
  }, { seed: o.seed + 3, wear: 0.3, alpha: 0.7 });
  x.save();
  clipBox(x, w, h, radius);
  // current lines inside the band
  x.save();
  band(x);
  x.clip();
  x.strokeStyle = CARD_PAPER;
  x.lineCap = 'round';
  x.lineWidth = 7 * u;
  const r = rng(o.seed + 4);
  for (let i = 0; i < 26; i++) {
    const t = r();
    const px = t * w;
    const mid = 0.25 + 0.48 * smooth(0, 1, t) + (r() - 0.5) * 0.22;
    const py = (mid + 0.12) * h;
    const L = (80 + r() * 120) * u;
    x.globalAlpha = 0.6 + r() * 0.4;
    x.beginPath();
    x.moveTo(px, py);
    x.quadraticCurveTo(px + L * 0.5, py + L * 0.12, px + L, py + L * 0.08);
    x.stroke();
  }
  x.restore();
  // bank outline
  x.save();
  band(x);
  x.strokeStyle = INK;
  x.lineWidth = 7 * u;
  x.stroke();
  x.restore();
  // stones
  const lw = 6 * u;
  stone(x, w * 0.18, h * 0.62, 70 * u, 46 * u, 0.2, lw, 3);
  stone(x, w * 0.72, h * 0.8, 90 * u, 56 * u, -0.3, lw, 4);
  stone(x, w * 0.88, h * 0.62, 50 * u, 34 * u, 0.5, lw, 5);
  stone(x, w * 0.42, h * 0.86, 56 * u, 36 * u, 0.1, lw, 6);
  // reeds on the banks
  x.strokeStyle = INK;
  x.lineCap = 'round';
  for (const [bx, by, n] of [
    [0.08, 0.12, 4],
    [0.9, 0.24, 5],
    [0.62, 0.12, 3],
  ]) {
    for (let i = 0; i < n; i++) {
      const px = bx * w + i * 18 * u;
      const py = by * h + (i % 2) * 14 * u;
      x.lineWidth = 6 * u;
      x.beginPath();
      x.moveTo(px, py + 70 * u);
      x.quadraticCurveTo(px + 8 * u, py + 20 * u, px + (i - n / 2) * 8 * u, py - 30 * u);
      x.stroke();
      x.fillStyle = RISO.brown;
      x.beginPath();
      x.ellipse(px + (i - n / 2) * 6 * u, py - 10 * u, 8 * u, 22 * u, 0.1, 0, TAU);
      x.fill();
      x.lineWidth = 4 * u;
      x.stroke();
    }
  }
  // leap arc
  const cx = w * 0.52;
  const cy = h * 0.4;
  x.save();
  x.strokeStyle = INK;
  x.lineWidth = 6 * u;
  x.setLineDash([18 * u, 16 * u]);
  x.lineCap = 'round';
  x.beginPath();
  x.moveTo(w * 0.18, h * 0.5);
  x.quadraticCurveTo(w * 0.3, h * 0.1, cx - 150 * u, cy - 60 * u);
  x.stroke();
  x.restore();
  // splash drops
  for (const [dx, dy, s, rot] of [
    [0.16, 0.44, 16, -0.6],
    [0.2, 0.4, 12, -0.2],
    [0.12, 0.48, 10, -1],
    [0.66, 0.6, 12, 0.5],
  ]) {
    droplet(x, dx * w, dy * h, s * u, 4 * u, CARD_PAPER, rot);
  }
  // little fish-coins in the water
  coin(x, w * 0.3, h * 0.66, 34 * u, lookForBasicSkin(3), { expression: 'scared', lookX: -0.8 });
  coin(x, w * 0.86, h * 0.47, 30 * u, lookForBasicSkin(7), { expression: 'happy', lookX: 0.8 });
  // hero: the silver coin mid-leap
  x.save();
  x.translate(cx, cy);
  x.rotate(0.22);
  heroCoin(x, 205 * u, { body: 'silver', ghostA: TEAL, ghostB: PINK, offA: [0.07, 0.06], offB: [-0.05, -0.04], expression: 'happy', eyes: 'star', mouth: 'grin', faceScale: 1.25, symbol: 'moon', lookX: 0.6, lookY: -0.4 });
  x.restore();
  burstLines(x, cx, cy, 240 * u, 290 * u, [-2.5, -2.2, -1.9, 0.9, 0.6], { lw: 7 * u });
  sparkle(x, cx + 240 * u, cy - 170 * u, 26 * u, GOLD, 4 * u);
  sparkle(x, cx - 210 * u, cy - 210 * u, 18 * u, CARD_PAPER, 4 * u);
  x.restore();
}

/** Gold Lake: a gold coin rising like the sun over a still lake, mountains in teal, a broken reflection. */
function goldLake(x, W, H, w, h, u, o) {
  const radius = o.radius;
  const horizon = h * 0.6;
  const cx = w * 0.5;
  const R = Math.min(w, h) * 0.27;
  // sky: gold sunburst rays
  pass(x, W, H, w, h, radius, (l) => {
    l.beginPath();
    l.rect(0, 0, w, horizon);
    l.clip();
    sunburst(l, cx, horizon - R * 0.5, Math.hypot(w, h), 28, GOLD, 0.03);
  }, { seed: o.seed + 1, wear: 0.4, alpha: 0.55 });
  pass(x, W, H, w, h, radius, (l) => {
    l.beginPath();
    l.rect(0, 0, w, horizon);
    l.clip();
    halftone(l, 0, 0, w, horizon, 16 * u, PINK, (px, py) => 0.75 * smooth(0.45, 1, 1 - py / horizon) * smooth(0.1, 0.9, Math.abs(px - cx) / (w * 0.5)));
  }, { seed: o.seed + 2, wear: 0.35, alpha: 0.75 });
  // mountains: teal ridges with halftone
  const ridge = (l, pts, base) => {
    l.beginPath();
    l.moveTo(-20 * u, base);
    for (const [px, py] of pts) l.lineTo(px * w, py * h);
    l.lineTo(w + 20 * u, base);
    l.closePath();
  };
  const backRidge = [
    [0, 0.42],
    [0.12, 0.33],
    [0.2, 0.4],
    [0.3, 0.3],
    [0.38, 0.52],
    [0.62, 0.52],
    [0.7, 0.32],
    [0.8, 0.4],
    [0.9, 0.3],
    [1, 0.38],
  ];
  const frontRidge = [
    [0, 0.5],
    [0.08, 0.44],
    [0.18, 0.52],
    [0.26, 0.47],
    [0.36, 0.6],
    [0.64, 0.6],
    [0.74, 0.46],
    [0.86, 0.53],
    [1, 0.45],
  ];
  pass(x, W, H, w, h, radius, (l) => {
    ridge(l, backRidge, horizon);
    l.fillStyle = TEAL;
    l.globalAlpha = 0.55;
    l.fill();
    l.globalAlpha = 1;
    ridge(l, frontRidge, horizon);
    l.fillStyle = TEAL;
    l.fill();
  }, { seed: o.seed + 3, wear: 0.45 });
  x.save();
  clipBox(x, w, h, radius);
  x.lineJoin = 'round';
  x.strokeStyle = INK;
  x.lineWidth = 6 * u;
  ridge(x, frontRidge, horizon);
  x.stroke();
  // snow caps
  x.fillStyle = CARD_PAPER;
  for (const [px, py] of [
    [0.08, 0.44],
    [0.74, 0.46],
  ]) {
    x.beginPath();
    x.moveTo(px * w, py * h);
    x.lineTo(px * w - 26 * u, py * h + 30 * u);
    x.lineTo(px * w - 8 * u, py * h + 24 * u);
    x.lineTo(px * w + 6 * u, py * h + 34 * u);
    x.lineTo(px * w + 24 * u, py * h + 22 * u);
    x.closePath();
    x.fill();
    x.lineWidth = 4 * u;
    x.stroke();
  }
  x.restore();
  // the coin sun, rising out of the lake in front of the ridges
  x.save();
  clipBox(x, w, h, radius);
  x.beginPath();
  x.rect(0, 0, w, horizon);
  x.clip();
  x.translate(cx, horizon - R * 0.5);
  heroCoin(x, R, { body: GOLD, expression: 'proud', mouth: 'grin', faceScale: 1.25, faceY: -0.02, symbol: 'star' });
  x.restore();
  // the lake: gold flood with paper reflection strokes
  pass(x, W, H, w, h, radius, (l) => {
    l.fillStyle = GOLD;
    l.fillRect(0, horizon, w, h - horizon);
  }, { seed: o.seed + 4, wear: 0.35 });
  pass(x, W, H, w, h, radius, (l) => {
    halftone(l, 0, horizon, w, h - horizon, 18 * u, TEAL, (px, py) => 0.5 * smooth(0, 1, (py - horizon) / (h - horizon)));
  }, { seed: o.seed + 5, wear: 0.3, alpha: 0.7 });
  x.save();
  clipBox(x, w, h, radius);
  x.strokeStyle = INK;
  x.lineWidth = 6 * u;
  x.beginPath();
  x.moveTo(0, horizon);
  x.lineTo(w, horizon);
  x.stroke();
  // reflection: stacked paper dashes narrowing downward, plus a pink pass
  const rr = rng(o.seed + 6);
  for (let i = 0; i < 9; i++) {
    const y = horizon + (22 + i * 30) * u;
    if (y > h - 10 * u) break;
    const half = R * (0.95 - i * 0.075) * (0.85 + rr() * 0.2);
    x.lineCap = 'round';
    x.lineWidth = (12 - i * 0.6) * u;
    x.strokeStyle = CARD_PAPER;
    const gap = (14 + rr() * 30) * u;
    const off = (rr() - 0.5) * 30 * u;
    x.beginPath();
    x.moveTo(cx - half + off, y);
    x.lineTo(cx - gap + off, y);
    x.moveTo(cx + gap * 0.6 + off, y);
    x.lineTo(cx + half + off, y);
    x.stroke();
  }
  // a paper boat
  x.save();
  x.translate(w * 0.8, horizon + (h - horizon) * 0.52);
  x.rotate(-0.05);
  x.beginPath();
  x.moveTo(-70 * u, 0);
  x.lineTo(70 * u, 0);
  x.lineTo(46 * u, 30 * u);
  x.lineTo(-46 * u, 30 * u);
  x.closePath();
  x.fillStyle = CARD_PAPER;
  x.fill();
  x.lineWidth = 5 * u;
  x.strokeStyle = INK;
  x.lineJoin = 'round';
  x.stroke();
  x.beginPath();
  x.moveTo(0, 0);
  x.lineTo(0, -90 * u);
  x.lineTo(54 * u, -14 * u);
  x.closePath();
  x.fillStyle = PINK;
  x.fill();
  x.stroke();
  x.restore();
  waveTicks(x, 40 * u, horizon + 30 * u, w * 0.28, h - horizon - 60 * u, 6, o.seed + 7, { size: 22 * u, color: INK, lw: 5 * u });
  for (const [bx, by, s] of [
    [0.18, 0.16, 26],
    [0.25, 0.12, 18],
    [0.82, 0.18, 22],
  ])
    bird(x, bx * w, by * h, s * u, 5 * u);
  x.restore();
}

/** Whale Bay: a giant coin breaching from a blue sea with a spout; small coins scatter. */
function whaleBay(x, W, H, w, h, u, o) {
  const radius = o.radius;
  const sea = h * 0.58;
  // sky: blue halftone fading up
  pass(x, W, H, w, h, radius, (l) => {
    halftone(l, 0, 0, w, sea, 18 * u, BLUE, (px, py) => 0.55 * smooth(0, 1, py / sea));
  }, { seed: o.seed + 1, wear: 0.4, alpha: 0.75 });
  const cx = w * 0.5;
  const R = Math.min(w, h) * 0.34;
  const cy = sea - R * 0.2;
  x.save();
  clipBox(x, w, h, radius);
  // spout: a fountain of drops above the coin
  x.save();
  x.translate(cx, cy - R * 1.02);
  x.strokeStyle = INK;
  x.lineWidth = 6 * u;
  x.lineCap = 'round';
  x.fillStyle = CARD_PAPER;
  for (const s of [-1, 1]) {
    x.beginPath();
    x.moveTo(0, 0);
    x.bezierCurveTo(s * 20 * u, -120 * u, s * 90 * u, -170 * u, s * 160 * u, -110 * u);
    x.stroke();
    x.beginPath();
    x.moveTo(0, -10 * u);
    x.bezierCurveTo(s * 10 * u, -90 * u, s * 50 * u, -150 * u, s * 100 * u, -150 * u);
    x.stroke();
  }
  x.beginPath();
  x.moveTo(0, 0);
  x.lineTo(0, -150 * u);
  x.stroke();
  for (const [dx, dy, s, rot] of [
    [-170, -90, 16, 2.6],
    [170, -90, 16, -2.6],
    [-120, -40, 12, 2.9],
    [120, -40, 12, -2.9],
    [0, -175, 14, 0],
    [-60, -190, 10, 0.4],
    [60, -190, 10, -0.4],
  ]) {
    x.save();
    x.translate(dx * u, dy * u);
    x.rotate(rot);
    x.beginPath();
    x.moveTo(0, -s * 1.5 * u);
    x.quadraticCurveTo(s * u, 0, 0, s * u);
    x.quadraticCurveTo(-s * u, 0, 0, -s * 1.5 * u);
    x.closePath();
    x.fillStyle = RISO.aqua;
    x.fill();
    x.lineWidth = 4 * u;
    x.stroke();
    x.restore();
  }
  x.restore();
  // the whale coin
  x.save();
  x.translate(cx, cy);
  x.rotate(-0.05);
  heroCoin(x, R, { body: RISO.aqua, ghostA: BLUE, ghostB: PINK, offA: [0.06, 0.05], expression: 'happy', eyes: 'round', mouth: 'grin', faceScale: 1.05, faceY: -0.3, symbol: null, lookX: 0.3 });
  x.restore();
  x.restore();
  // sea in front: blue flood with wave crests
  const seaPath = (l) => {
    l.beginPath();
    l.moveTo(0, h);
    l.lineTo(0, sea);
    const n = 9;
    for (let i = 0; i < n; i++) {
      const x0 = (i / n) * w;
      const x1 = ((i + 1) / n) * w;
      l.quadraticCurveTo((x0 + x1) / 2, sea - 34 * u * (i % 2 ? 1 : 0.6), x1, sea);
    }
    l.lineTo(w, h);
    l.closePath();
  };
  pass(x, W, H, w, h, radius, (l) => {
    seaPath(l);
    l.fillStyle = BLUE;
    l.fill();
  }, { seed: o.seed + 2, wear: 0.35, op: 'source-over' });
  pass(x, W, H, w, h, radius, (l) => {
    seaPath(l);
    l.clip();
    halftone(l, 0, sea, w, h - sea, 18 * u, INK, (px, py) => 0.4 * smooth(0, 1, (py - sea) / (h - sea)));
  }, { seed: o.seed + 3, wear: 0.3, alpha: 0.5 });
  x.save();
  clipBox(x, w, h, radius);
  seaPath(x);
  x.strokeStyle = INK;
  x.lineWidth = 7 * u;
  x.stroke();
  // crest scallops in paper
  x.save();
  seaPath(x);
  x.clip();
  waves(x, 0, sea + 40 * u, w, h - sea, { gap: 62 * u, amp: 10 * u, len: 120 * u, color: CARD_PAPER, lw: 6 * u, seed: o.seed + 4, dash: [70 * u, 40 * u] });
  x.restore();
  // little coins fleeing on the surface
  for (const [px, s, look, dir] of [
    [0.14, 40, 2, -1],
    [0.86, 34, 4, 1],
    [0.25, 26, 6, -1],
  ]) {
    const py = sea + 6 * u;
    speedLines(x, px * w, py, s * u, dir, -0.15, CARD_PAPER, 2, 0.9);
    coin(x, px * w, py, s * u, lookForBasicSkin(look), { expression: 'scared', lookX: dir * 0.9 });
  }
  x.restore();
}

const DRAW = { 1: pennyPond, 2: silverCreek, 3: goldLake, 4: whaleBay };

/**
 * Draws arena `id`'s illustration into the box (bx, by, bw, bh) of a W×H
 * design. Options: radius (corner), seed, frame (ink border width or 0).
 */
export function arenaScene(x, W, H, id, bx, by, bw, bh, { radius = 0, seed = 100, frame = 0 } = {}) {
  const u = Math.min(bw, bh) / 1000;
  x.save();
  x.translate(bx, by);
  DRAW[id](x, W, H, bw, bh, u, { radius, seed: seed + id * 17 });
  if (frame) {
    x.beginPath();
    if (radius) x.roundRect(0, 0, bw, bh, radius);
    else x.rect(0, 0, bw, bh);
    x.strokeStyle = INK;
    x.lineWidth = frame;
    x.stroke();
  }
  x.restore();
}

export { ARENAS };
