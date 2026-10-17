#!/usr/bin/env node
/**
 * Slana X (Twitter) brand kit generator: profile picture, banner, safe-area
 * previews and the slana.io OG card, drawn procedurally in the "Paper Ticket"
 * riso style.
 *
 *   node brand/x/generate.mjs            # from the repo root, after `pnpm install`
 *
 * The coins come from `packages/art` (loaded as TypeScript through the repo's
 * tsx), the inks from `packages/shared/src/palette.ts`, the type is the web
 * app's Bricolage Grotesque (variable) and DM Mono from @fontsource. Output is
 * deterministic (seeded noise), so re-running only changes files when the art,
 * the palette or this script changes.
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

// ── dependencies from the workspace (no new installs) ───────────────────────
const reqArt = createRequire(join(ROOT, 'packages/art/package.json'));
const { createCanvas, GlobalFonts } = reqArt('@napi-rs/canvas');
const tsxApi = createRequire(join(ROOT, 'apps/server/package.json'))
  .resolve('tsx/esm/api')
  .replace(/index\.cjs$/, 'index.mjs');
const { tsImport } = await import(tsxApi);
const A = await tsImport(join(ROOT, 'packages/art/src/index.ts'), import.meta.url);
const { RISO, INK, PAPER, CARD_PAPER, drawRisoCoin, drawFace, drawHalftoneDots, drawSymbol, lookForBasicSkin, starPath } = A;

const reqWeb = createRequire(join(ROOT, 'apps/web/package.json'));
const fontFile = (css, file) => join(dirname(reqWeb.resolve(css)), 'files', file);
GlobalFonts.registerFromPath(fontFile('@fontsource-variable/bricolage-grotesque/standard.css', 'bricolage-grotesque-latin-standard-normal.woff2'), 'Bricolage');
GlobalFonts.registerFromPath(fontFile('@fontsource/dm-mono/500.css', 'dm-mono-latin-500-normal.woff2'), 'DM Mono');

const TAU = Math.PI * 2;
const PINK = RISO.fluoPink;
const TEAL = RISO.teal;
const GOLD = RISO.mustard;
const RED = RISO.red;
const BLUE = RISO.blue;
const PINK_TEXT = '#C71466';
const TEAL_INK = '#0F736E';

// ── utilities ───────────────────────────────────────────────────────────────
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function canvas(w, h) {
  const c = createCanvas(w, h);
  return [c, c.getContext('2d')];
}

function save(c, name) {
  const p = join(HERE, name);
  writeFileSync(p, c.toBuffer('image/png'));
  console.log(`  ${name}  ${c.width}x${c.height}`);
}

/** High-quality downscale (halving steps, then the remainder). */
function downscale(src, w, h) {
  let cur = src;
  while (cur.width / 2 >= w) {
    const [c, x] = canvas(Math.round(cur.width / 2), Math.round(cur.height / 2));
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, c.width, c.height);
    cur = c;
  }
  if (cur.width === w && cur.height === h) return cur;
  const [c, x] = canvas(w, h);
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  x.drawImage(cur, 0, 0, w, h);
  return c;
}

function font(x, size, { weight = 800, wdth = 85, opsz = 96, family = 'Bricolage', spacing = '0px' } = {}) {
  x.font = `${weight} ${size}px "${family}"`;
  x.fontVariationSettings = family === 'Bricolage' ? `'wght' ${weight}, 'wdth' ${wdth}, 'opsz' ${opsz}` : '';
  x.letterSpacing = spacing;
}

function mono(x, size, spacing = 0.08) {
  x.font = `500 ${size}px "DM Mono"`;
  x.fontVariationSettings = '';
  x.letterSpacing = `${size * spacing}px`;
}

/** Runs `fn` on a transparent layer, then composites it (optionally worn like a riso pass). */
function layer(x, W, H, fn, { op = 'source-over', alpha = 1, wear = 0, seed = 1, wearSize = 1 } = {}) {
  const [c, l] = canvas(W, H);
  l.setTransform(x.getTransform());
  fn(l);
  if (wear > 0) wearOut(l, W, H, wear, seed, wearSize);
  x.save();
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = op;
  x.globalAlpha = alpha;
  x.drawImage(c, 0, 0);
  x.restore();
}

/** Knocks speckles and dry-ink streaks out of a layer (riso coverage is never perfect). */
function wearOut(l, W, H, amount, seed, size = 1) {
  const r = rng(seed);
  l.save();
  l.setTransform(1, 0, 0, 1, 0, 0);
  l.globalCompositeOperation = 'destination-out';
  const n = Math.round((W * H) / 900 * amount);
  for (let i = 0; i < n; i++) {
    const px = r() * W;
    const py = r() * H;
    const rad = (0.4 + r() ** 3 * 2.4) * size;
    l.globalAlpha = 0.35 + r() * 0.65;
    l.beginPath();
    l.arc(px, py, rad, 0, TAU);
    l.fill();
  }
  // a few dry streaks
  l.globalAlpha = 0.18 * amount;
  for (let i = 0; i < 6; i++) {
    const y = r() * H;
    l.fillRect(0, y, W, (1 + r() * 4) * size);
  }
  l.restore();
}

/** Paper stock: flat paper, soft cloud mottling and fibres. */
function paper(x, W, H, seed, base = PAPER) {
  x.save();
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.fillStyle = base;
  x.fillRect(0, 0, W, H);
  const r = rng(seed);
  const k = W / 1500;
  // mottling
  for (let i = 0; i < 26; i++) {
    const cx = r() * W;
    const cy = r() * H;
    const rad = (120 + r() * 320) * k;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, r() < 0.5 ? 'rgba(160,120,60,0.035)' : 'rgba(255,255,255,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }
  // fibres
  x.lineCap = 'round';
  for (let i = 0; i < (W * H) / 2600; i++) {
    const px = r() * W;
    const py = r() * H;
    const a = r() * TAU;
    const len = (3 + r() * 10) * k;
    x.strokeStyle = r() < 0.6 ? 'rgba(120,96,60,0.07)' : 'rgba(255,255,255,0.35)';
    x.lineWidth = Math.max(0.6, 0.9 * k);
    x.beginPath();
    x.moveTo(px, py);
    x.quadraticCurveTo(px + Math.cos(a + 0.6) * len * 0.5, py + Math.sin(a + 0.6) * len * 0.5, px + Math.cos(a) * len, py + Math.sin(a) * len);
    x.stroke();
  }
  x.restore();
}

/** Final pass: fine grain over everything (keeps flat inks from looking digital). */
function grain(x, W, H, seed, amount = 7, cell = 1) {
  // noise in cell×cell blocks: at 2x the grain keeps its 1x size (and the PNG stays smaller)
  const img = x.getImageData(0, 0, W, H);
  const d = img.data;
  const r = rng(seed);
  const cw = Math.ceil(W / cell);
  const row = new Float32Array(cw);
  for (let y = 0; y < H; y++) {
    if (y % cell === 0) for (let i = 0; i < cw; i++) row[i] = (r() + r() - 1) * amount;
    for (let px = 0; px < W; px++) {
      const n = row[(px / cell) | 0];
      const i = (y * W + px) * 4;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    }
  }
  x.putImageData(img, 0, 0);
}

/** Graph-paper grid like the arena floor. */
function grid(x, x0, y0, w, h, step, alpha = 0.07) {
  x.save();
  x.strokeStyle = TEAL;
  x.globalAlpha = alpha;
  x.lineWidth = 1.2;
  x.beginPath();
  for (let gx = x0; gx <= x0 + w + 0.1; gx += step) {
    x.moveTo(gx, y0);
    x.lineTo(gx, y0 + h);
  }
  for (let gy = y0; gy <= y0 + h + 0.1; gy += step) {
    x.moveTo(x0, gy);
    x.lineTo(x0 + w, gy);
  }
  x.stroke();
  x.restore();
}

/**
 * Halftone dot screen (45°) whose dot size follows `tone(px, py)` in 0..1.
 * Draw it in a layer with `multiply` for a riso screen.
 */
function halftone(x, x0, y0, w, h, sp, color, tone, angle = Math.PI / 4) {
  x.save();
  x.fillStyle = color;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  const n = Math.ceil(Math.hypot(w, h) / sp / 2) + 1;
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const px = cx + (i * c - j * s) * sp;
      const py = cy + (i * s + j * c) * sp;
      if (px < x0 - sp || px > x0 + w + sp || py < y0 - sp || py > y0 + h + sp) continue;
      const t = tone(px, py);
      if (t <= 0.02) continue;
      const rad = sp * 0.5 * Math.sqrt(Math.min(1, t)) * 1.08;
      x.beginPath();
      x.arc(px, py, rad, 0, TAU);
      x.fill();
    }
  }
  x.restore();
}

const smooth = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ── brand pieces ────────────────────────────────────────────────────────────

/**
 * The hero "Slana coin": a gold coin with a reeded edge, misregistered pink
 * and teal passes, the art package's halftone shade and an oversized face so
 * it still reads at 48 px.
 */
function heroCoin(x, r, o = {}) {
  const {
    body = GOLD,
    ghostA = TEAL,
    ghostB = PINK,
    offA = [0.075, 0.065],
    offB = [-0.05, -0.04],
    expression = 'hungry',
    eyes = 'round',
    mouth = 'grin',
    lookX = 0,
    lookY = 0,
    faceScale = 1.32,
    faceY = 0.1,
    symbol = 'star',
    blush = PINK,
    rimScale = 1,
    ghostOver = false,
  } = o;
  const rimW = r * 0.075 * rimScale;
  const edge = (rr) => {
    // reeded edge: a 56-tooth coin outline
    const teeth = 56;
    x.beginPath();
    for (let i = 0; i <= teeth * 2; i++) {
      const a = (i / (teeth * 2)) * TAU;
      const rad = i % 2 === 0 ? rr : rr * 0.975;
      const px = Math.cos(a) * rad;
      const py = Math.sin(a) * rad;
      if (i === 0) x.moveTo(px, py);
      else x.lineTo(px, py);
    }
    x.closePath();
  };
  // misregistered passes, multiplied under the body (or laid over a dark flood)
  for (const [ink, off] of [
    [ghostB, offB],
    [ghostA, offA],
  ]) {
    if (!ink) continue;
    x.save();
    x.globalCompositeOperation = ghostOver ? 'source-over' : 'multiply';
    x.fillStyle = ink;
    x.translate(off[0] * r, off[1] * r);
    edge(r);
    x.fill();
    x.restore();
  }
  // body: paper then gold ink
  edge(r);
  x.fillStyle = CARD_PAPER;
  x.fill();
  x.save();
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = body;
  x.fill();
  x.restore();
  // inner face of the coin (raised rim ring)
  x.save();
  x.beginPath();
  x.arc(0, 0, r * 0.84, 0, TAU);
  x.strokeStyle = INK;
  x.globalAlpha = 0.85;
  x.lineWidth = r * 0.028;
  x.stroke();
  x.globalAlpha = 0.5;
  x.setLineDash([r * 0.075, r * 0.05]);
  x.lineWidth = r * 0.022;
  x.beginPath();
  x.arc(0, 0, r * 0.915, 0, TAU);
  x.stroke();
  x.restore();
  // halftone shade from the art package
  x.save();
  edge(r - rimW * 0.5);
  x.clip();
  x.globalCompositeOperation = 'multiply';
  x.globalAlpha = 0.34;
  drawHalftoneDots(x, r, r * 0.06);
  x.restore();
  // shine: a paper knock-out on the upper left
  x.save();
  x.strokeStyle = CARD_PAPER;
  x.lineCap = 'round';
  x.globalAlpha = 0.95;
  x.lineWidth = r * 0.075;
  x.beginPath();
  x.arc(0, 0, r * 0.7, Math.PI * 1.08, Math.PI * 1.3);
  x.stroke();
  x.lineWidth = r * 0.075;
  x.beginPath();
  x.arc(0, 0, r * 0.7, Math.PI * 1.37, Math.PI * 1.42);
  x.stroke();
  x.restore();
  // rim
  edge(r);
  x.lineWidth = rimW;
  x.lineJoin = 'round';
  x.strokeStyle = INK;
  x.stroke();
  // symbol on the forehead
  if (symbol) {
    x.save();
    x.translate(0, -r * 0.5);
    drawSymbol(x, symbol, r * 0.13, { fill: CARD_PAPER, ink: INK, overprint: ghostB, lineW: r * 0.028, offX: r * 0.02, offY: r * 0.02 });
    x.restore();
  }
  // face, oversized
  x.save();
  x.translate(0, r * faceY);
  const fr = r * faceScale;
  drawFace(x, fr, { expression, eyes, mouth, lookX, lookY, time: 0, seed: 0, detail: fr, blush });
  x.restore();
}

/** Small coin from the art package. */
function coin(x, cx, cy, r, look, state = {}) {
  x.save();
  x.translate(cx, cy);
  drawRisoCoin(x, look, r, { time: 0, lookX: 0, lookY: 0, expression: 'happy', pxPerUnit: 1, ...state });
  x.restore();
}

/** Riso wordmark: ink "slana" with a pink pass and a teal ghost off register, plus the ink dot. */
function wordmark(x, left, baseline, size, { dot = true, onDark = false } = {}) {
  font(x, size, { weight: 800, wdth: 85 });
  x.letterSpacing = `${-0.045 * size}px`;
  const text = 'slana';
  const w = x.measureText(text).width;
  x.save();
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = TEAL;
  x.globalAlpha = 0.7;
  x.fillText(text, left - 0.018 * size, baseline - 0.016 * size);
  x.globalAlpha = 1;
  x.fillStyle = PINK;
  x.fillText(text, left + 0.032 * size, baseline + 0.03 * size);
  x.restore();
  x.fillStyle = onDark ? CARD_PAPER : INK;
  x.fillText(text, left, baseline);
  if (dot) {
    // the ink dot (CoinMark): teal under pink, multiplied, with a thin ring
    const d = size * 0.2;
    const cx = left + w + d * 0.35;
    const cy = baseline - size * 0.78;
    x.save();
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = TEAL;
    x.beginPath();
    x.arc(cx + d * 0.15, cy + d * 0.15, d, 0, TAU);
    x.fill();
    x.fillStyle = PINK;
    x.beginPath();
    x.arc(cx, cy, d, 0, TAU);
    x.fill();
    x.restore();
    x.save();
    x.strokeStyle = INK;
    x.globalAlpha = 0.55;
    x.lineWidth = d * 0.11;
    x.beginPath();
    x.arc(cx, cy, d * 0.66, 0, TAU);
    x.stroke();
    x.restore();
  }
  return { width: w + size * 0.35 };
}

function roundRect(x, px, py, w, h, r) {
  x.beginPath();
  x.roundRect(px, py, w, h, r);
}

/**
 * A ticket stub: card stock, ink line, riso drop shadow, arena stripe,
 * a perforation with punched notches.
 */
function ticket(x, { w, h, stripe = PINK, shadow = PINK, perfAt = 0.72, radius = 10, lw = 3, fill = CARD_PAPER }) {
  // drop shadow pass
  x.save();
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = shadow;
  roundRect(x, lw * 2.4, lw * 2.4, w, h, radius);
  x.fill();
  x.restore();
  const px = w * perfAt;
  const nr = h * 0.075;
  const shape = () => {
    x.beginPath();
    x.moveTo(radius, 0);
    x.lineTo(px - nr, 0);
    x.arc(px, 0, nr, Math.PI, 0, true);
    x.lineTo(w - radius, 0);
    x.arcTo(w, 0, w, radius, radius);
    x.lineTo(w, h - radius);
    x.arcTo(w, h, w - radius, h, radius);
    x.lineTo(px + nr, h);
    x.arc(px, h, nr, 0, Math.PI, true);
    x.lineTo(radius, h);
    x.arcTo(0, h, 0, h - radius, radius);
    x.lineTo(0, radius);
    x.arcTo(0, 0, radius, 0, radius);
    x.closePath();
  };
  shape();
  x.fillStyle = fill;
  x.fill();
  // stripe
  x.save();
  shape();
  x.clip();
  x.fillStyle = stripe;
  x.fillRect(0, 0, w * 0.035, h);
  x.restore();
  shape();
  x.strokeStyle = INK;
  x.lineWidth = lw;
  x.lineJoin = 'round';
  x.stroke();
  // perforation
  x.save();
  x.strokeStyle = INK;
  x.globalAlpha = 0.55;
  x.lineWidth = lw * 0.8;
  x.setLineDash([lw * 2.2, lw * 2.2]);
  x.beginPath();
  x.moveTo(px, nr + lw * 2);
  x.lineTo(px, h - nr - lw * 2);
  x.stroke();
  x.restore();
  return { perfX: px };
}

/** Translucent gold masking tape with torn ends. */
function tape(x, cx, cy, w, h, rot, color = GOLD, seed = 3) {
  const r = rng(seed);
  x.save();
  x.translate(cx, cy);
  x.rotate(rot);
  x.beginPath();
  const teeth = 7;
  x.moveTo(-w / 2, -h / 2);
  x.lineTo(w / 2, -h / 2);
  for (let i = 1; i <= teeth; i++) x.lineTo(w / 2 + (i % 2 ? 1 : -1) * h * 0.05 * (0.5 + r()), -h / 2 + (h * i) / teeth);
  x.lineTo(-w / 2, h / 2);
  for (let i = teeth - 1; i >= 0; i--) x.lineTo(-w / 2 + (i % 2 ? 1 : -1) * h * 0.05 * (0.5 + r()), -h / 2 + (h * i) / teeth);
  x.closePath();
  x.globalCompositeOperation = 'multiply';
  x.globalAlpha = 0.78;
  x.fillStyle = color;
  x.fill();
  // fibre lines
  x.globalAlpha = 0.12;
  x.strokeStyle = INK;
  x.lineWidth = h * 0.02;
  for (let i = 0; i < 5; i++) {
    const yy = -h / 2 + h * (0.15 + r() * 0.7);
    x.beginPath();
    x.moveTo(-w / 2, yy);
    x.lineTo(w / 2, yy + (r() - 0.5) * h * 0.1);
    x.stroke();
  }
  x.restore();
}

/** Food pellets as in the arena: dots, stars and triangles in riso inks. */
function pellet(x, px, py, s, kind, color) {
  x.save();
  x.translate(px, py);
  x.fillStyle = color;
  x.strokeStyle = INK;
  x.lineWidth = s * 0.28;
  x.lineJoin = 'round';
  if (kind === 'dot') {
    x.beginPath();
    x.arc(0, 0, s, 0, TAU);
    x.fill();
  } else if (kind === 'star') {
    starPath(x, s * 1.35, s * 0.6);
    x.fill();
    x.lineWidth = s * 0.2;
    x.stroke();
  } else if (kind === 'tri') {
    x.rotate(s * 7);
    x.beginPath();
    x.moveTo(0, -s);
    x.lineTo(s * 0.95, s * 0.7);
    x.lineTo(-s * 0.95, s * 0.7);
    x.closePath();
    x.fill();
    x.lineWidth = s * 0.2;
    x.stroke();
  } else if (kind === 'gold') {
    x.beginPath();
    x.arc(0, 0, s, 0, TAU);
    x.fill();
    x.lineWidth = s * 0.16;
    x.stroke();
    x.globalAlpha = 0.7;
    x.lineWidth = s * 0.1;
    x.beginPath();
    x.arc(0, 0, s * 0.62, 0, TAU);
    x.stroke();
  }
  x.restore();
}

/** Rubber stamp text block (rectangular), drawn upright at the origin. */
function rectStamp(x, lines, { color = TEAL, size = 40, pad = 0.45, lw = 4, sub = null, subSize = 0 }) {
  mono(x, size, 0.06);
  const w = Math.max(...lines.map((t) => x.measureText(t).width)) + size * pad * 2;
  let h = size * 1.15 * lines.length + size * pad * 1.6;
  if (sub) h += subSize * 1.6;
  x.strokeStyle = color;
  x.fillStyle = color;
  x.lineWidth = lw;
  roundRect(x, -w / 2, -h / 2, w, h, size * 0.18);
  x.stroke();
  roundRect(x, -w / 2 + lw * 2, -h / 2 + lw * 2, w - lw * 4, h - lw * 4, size * 0.12);
  x.lineWidth = lw * 0.5;
  x.stroke();
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  let y = -h / 2 + size * pad * 0.8 + size * 0.62;
  for (const t of lines) {
    mono(x, size, 0.06);
    x.fillText(t, 0, y);
    y += size * 1.15;
  }
  if (sub) {
    mono(x, subSize, 0.18);
    x.fillText(sub, 0, y - size * 0.2 + subSize * 0.5);
  }
  x.textAlign = 'left';
  x.textBaseline = 'alphabetic';
  return { w, h };
}

/** Round seal with text on the ring and a star in the middle. */
function roundStamp(x, R, ring, { color = PINK, size = 22, lw = 4, center = null, centerSize = 0 }) {
  x.strokeStyle = color;
  x.fillStyle = color;
  x.lineWidth = lw;
  x.beginPath();
  x.arc(0, 0, R, 0, TAU);
  x.stroke();
  x.lineWidth = lw * 0.5;
  x.beginPath();
  x.arc(0, 0, R - lw * 2, 0, TAU);
  x.stroke();
  x.beginPath();
  x.arc(0, 0, R * 0.62, 0, TAU);
  x.lineWidth = lw * 0.7;
  x.stroke();
  mono(x, size, 0);
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const chars = [...ring];
  const step = TAU / chars.length;
  chars.forEach((ch, i) => {
    x.save();
    x.rotate(-Math.PI / 2 + i * step);
    x.translate(R * 0.81, 0);
    x.rotate(Math.PI / 2);
    x.fillText(ch, 0, 0);
    x.restore();
  });
  if (center) {
    font(x, centerSize, { weight: 800, wdth: 80 });
    x.fillText(center, 0, centerSize * 0.06);
  } else {
    starPath(x, R * 0.36, R * 0.16);
    x.fill();
  }
  x.textAlign = 'left';
  x.textBaseline = 'alphabetic';
}

/** Draws `fn` (upright, at the origin) as a worn stamp multiplied into the page. */
function stampAt(x, W, H, cx, cy, rot, fn, { wear = 1.4, seed = 9, alpha = 0.92, k = 1 } = {}) {
  layer(
    x,
    W,
    H,
    (l) => {
      l.translate(cx, cy);
      l.rotate(rot);
      fn(l);
    },
    { op: 'multiply', alpha, wear, seed, wearSize: k * 1.3 },
  );
}

/** Speed lines behind a moving thing (direction = where it is going). */
function speedLines(x, cx, cy, r, dx, dy, color, n = 3, lenK = 1) {
  const len = Math.hypot(dx, dy);
  const bx = -dx / len;
  const by = -dy / len;
  x.save();
  x.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * r * 0.5;
    const px = cx - by * off;
    const py = cy + bx * off;
    const l0 = r * (1.15 + Math.abs(i - (n - 1) / 2) * 0.15);
    const l1 = l0 + r * (0.55 + (i % 2) * 0.3) * lenK;
    x.beginPath();
    x.moveTo(px + bx * l0, py + by * l0);
    x.lineTo(px + bx * l1, py + by * l1);
    x.strokeStyle = INK;
    x.lineWidth = r * 0.085;
    x.stroke();
    x.strokeStyle = color;
    x.lineWidth = r * 0.04;
    x.stroke();
  }
  x.restore();
}

// ── profile picture ─────────────────────────────────────────────────────────

function drawPfp(S) {
  const [c, x] = canvas(S, S);
  const k = S / 1000;
  x.scale(k, k);
  // stock: riso pink flood on paper
  paper(x, S, S, 11);
  layer(x, S, S, (l) => {
    l.fillStyle = PINK;
    l.fillRect(0, 0, 1000, 1000);
  }, { op: 'multiply', wear: 0.5, seed: 12, wearSize: k });
  // sunburst in a second pink pass (darker where it overprints)
  layer(
    x,
    S,
    S,
    (l) => {
      l.translate(500, 540);
      l.fillStyle = PINK;
      const rays = 20;
      for (let i = 0; i < rays; i++) {
        const a0 = (i / rays) * TAU + 0.05;
        const a1 = a0 + (TAU / rays) * 0.5;
        l.beginPath();
        l.moveTo(0, 0);
        l.arc(0, 0, 900, a0, a1);
        l.closePath();
        l.fill();
      }
    },
    { op: 'multiply', alpha: 0.32, wear: 0.4, seed: 13, wearSize: k },
  );
  // teal halftone screen, heaviest in the corners (stays outside the circle crop mostly)
  layer(
    x,
    S,
    S,
    (l) => {
      halftone(l, 0, 0, 1000, 1000, 26, TEAL, (px, py) => {
        const d = Math.hypot(px - 500, py - 500) / 500;
        return smooth(0.74, 1.3, d);
      });
    },
    { op: 'multiply', alpha: 0.7, wear: 0.25, seed: 14, wearSize: k },
  );
  // a ring of paper "bite" crumbs and pellets orbiting the coin
  const crumbs = [
    [205, 300, 16, 'star', GOLD],
    [790, 250, 13, 'dot', CARD_PAPER],
    [835, 690, 15, 'tri', GOLD],
    [170, 640, 12, 'dot', TEAL],
    [250, 205, 9, 'dot', CARD_PAPER],
    [755, 830, 10, 'dot', CARD_PAPER],
    [880, 470, 9, 'star', CARD_PAPER],
  ];
  for (const [px, py, s, kind, col] of crumbs) pellet(x, px, py, s, kind, col);
  // the hero coin
  x.save();
  x.translate(492, 512);
  x.rotate(-0.06);
  heroCoin(x, 335, {
    expression: 'hungry',
    mouth: 'grin',
    eyes: 'round',
    faceScale: 1.34,
    faceY: 0.12,
    symbol: 'star',
    lookX: 0.2,
    lookY: 0.1,
    ghostA: TEAL,
    ghostB: null,
    offA: [0.085, 0.075],
    ghostOver: true,
  });
  x.restore();
  grain(x, S, S, 15, 5, Math.max(1, Math.round(S / 500)));
  return c;
}

// ── banner ──────────────────────────────────────────────────────────────────

function drawBanner(W, H) {
  const [c, x] = canvas(W, H);
  const k = W / 1500;
  x.scale(k, k);
  paper(x, W, H, 21);
  grid(x, -10, -10, 1520, 520, 36, 0.09);

  // big pink halftone sun behind the chaser
  layer(
    x,
    W,
    H,
    (l) => {
      halftone(l, 880, -40, 640, 580, 15, PINK, (px, py) => {
        const d = Math.hypot(px - 1290, py - 300) / 290;
        return d < 1 ? 1 - smooth(0.35, 1, d) * 0.92 : 0;
      });
    },
    { op: 'multiply', alpha: 0.9, wear: 0.4, seed: 22, wearSize: k },
  );
  // teal halftone wash in the top-left corner (behind the ticket)
  layer(
    x,
    W,
    H,
    (l) => {
      halftone(l, -20, -20, 520, 330, 13, TEAL, (px, py) => {
        const d = Math.hypot(px - 40, py - 20) / 430;
        return 1 - smooth(0.2, 1, d);
      });
    },
    { op: 'multiply', alpha: 0.75, wear: 0.4, seed: 23, wearSize: k },
  );

  // ── left: an admit-one ticket, taped down above the avatar ──
  x.save();
  x.translate(84, 92);
  x.rotate(-0.075);
  const { perfX } = ticket(x, { w: 300, h: 132, stripe: RED, shadow: TEAL, perfAt: 0.7, lw: 3 });
  x.fillStyle = INK;
  mono(x, 13, 0.14);
  x.fillText('ADMIT ONE', 26, 32);
  font(x, 34, { weight: 800, wdth: 80 });
  x.letterSpacing = '-0.5px';
  x.fillText('Penny Pond', 24, 74);
  mono(x, 12, 0.1);
  x.fillStyle = '#5B5577';
  x.fillText('5-MIN ROUND', 26, 104);
  coin(x, perfX + 46, 66, 30, lookForBasicSkin(2), { expression: 'happy' });
  x.restore();
  tape(x, 112, 94, 96, 30, -0.62, GOLD, 31);

  // ── the chase ──
  const CX = 1296;
  const CY = 322;
  const CR = 150;
  const trail = [
    [1150, 200, 7, 'dot', TEAL],
    [1186, 160, 9, 'star', GOLD],
    [1232, 128, 6, 'dot', PINK],
    [1160, 112, 7, 'tri', BLUE],
    [1455, 70, 7, 'dot', TEAL],
    [1350, 60, 9, 'star', TEAL],
    [1290, 92, 6, 'tri', PINK],
    [1410, 120, 6, 'dot', BLUE],
    [950, 40, 6, 'dot', BLUE],
    [1180, 40, 6, 'dot', GOLD],
    [470, 452, 6, 'dot', TEAL],
    [560, 440, 8, 'star', GOLD],
    [700, 462, 6, 'tri', BLUE],
    [840, 430, 7, 'dot', PINK],
    [1100, 445, 7, 'tri', TEAL],
  ];
  for (const [px, py, s, kind, col] of trail) pellet(x, px, py, s, kind, col);
  pellet(x, 1112, 236, 11, 'gold', GOLD);
  pellet(x, 1158, 260, 8, 'gold', GOLD);

  // fleeing coins (scared, running up-left) with speed lines
  speedLines(x, 1080, 112, 48, -1, -0.28, PINK, 3, 1);
  coin(x, 1080, 112, 48, lookForBasicSkin(4), { expression: 'scared', lookX: 0.9, lookY: 0.4 });
  speedLines(x, 1018, 196, 23, -1, 0.05, TEAL, 2, 1.1);
  coin(x, 1018, 196, 23, lookForBasicSkin(5), { expression: 'scared', lookX: 0.8 });

  // the chaser: the Slana coin, mouth open
  x.save();
  x.translate(CX, CY);
  x.rotate(-0.08);
  heroCoin(x, CR, { expression: 'hungry', mouth: 'grin', lookX: -1, lookY: -0.6, faceScale: 1.18, faceY: 0.1, symbol: 'star' });
  x.restore();
  x.save();
  x.strokeStyle = INK;
  x.lineWidth = 5;
  x.lineCap = 'round';
  for (const [r0, a0, a1] of [
    [CR + 24, -0.55, 0.05],
    [CR + 42, -0.4, -0.1],
  ]) {
    x.beginPath();
    x.arc(CX, CY, r0, a0, a1);
    x.stroke();
  }
  x.restore();

  // ── centre: wordmark, then a ticket that carries the tagline and, on its stub, the url ──
  wordmark(x, 468, 246, 200);
  x.save();
  x.translate(478, 290);
  x.rotate(-0.012);
  const TW = 650;
  const stub = 176;
  const t = ticket(x, { w: TW, h: 76, stripe: PINK, shadow: PINK, perfAt: (TW - stub) / TW, lw: 3, radius: 8 });
  x.fillStyle = INK;
  font(x, 42, { weight: 800, wdth: 85, opsz: 48 });
  x.letterSpacing = '-0.8px';
  x.fillText('Eat. Grow. Last the round.', 30, 52);
  mono(x, 30, 0.02);
  x.fillStyle = PINK_TEXT;
  x.textAlign = 'center';
  x.fillText('slana.io', t.perfX + stub / 2, 49);
  x.textAlign = 'left';
  x.restore();
  tape(x, 476, 304, 70, 26, 0.9, GOLD, 37);

  // round seal, stamped low between the ticket and the chaser
  stampAt(
    x,
    W,
    H,
    1012,
    428,
    0.22,
    (l) => {
      roundStamp(l, 48, 'ON SOLANA * 5-MIN ROUNDS * ', { color: TEAL_INK, size: 11, lw: 3 });
    },
    { seed: 43, k, wear: 1.1, alpha: 0.9 },
  );

  grain(x, W, H, 29, 4, Math.max(1, Math.round(k)));
  return c;
}

// ── OG / social card ────────────────────────────────────────────────────────

function drawOg(W, H) {
  const [c, x] = canvas(W, H);
  const k = W / 1200;
  x.scale(k, k);
  paper(x, W, H, 51);
  grid(x, -10, -10, 1220, 650, 38, 0.09);
  layer(
    x,
    W,
    H,
    (l) => {
      halftone(l, 600, -40, 640, 720, 16, PINK, (px, py) => {
        const d = Math.hypot(px - 975, py - 345) / 330;
        return d < 1 ? 1 - smooth(0.35, 1, d) * 0.92 : 0;
      });
    },
    { op: 'multiply', alpha: 0.9, wear: 0.4, seed: 52, wearSize: k },
  );
  layer(
    x,
    W,
    H,
    (l) => {
      halftone(l, -20, 380, 520, 280, 13, TEAL, (px, py) => {
        const d = Math.hypot(px - 0, py - 660) / 420;
        return 1 - smooth(0.2, 1, d);
      });
    },
    { op: 'multiply', alpha: 0.75, wear: 0.4, seed: 53, wearSize: k },
  );
  mono(x, 18, 0.16);
  x.fillStyle = INK;
  x.fillText('A COIN-EAT-COIN GAME ON SOLANA', 80, 84);
  x.fillRect(80, 100, 440, 3);
  wordmark(x, 72, 302, 196);
  x.save();
  x.translate(84, 344);
  x.rotate(-0.012);
  const TW = 680;
  const stub = 182;
  const t = ticket(x, { w: TW, h: 80, stripe: PINK, shadow: PINK, perfAt: (TW - stub) / TW, lw: 3, radius: 8 });
  x.fillStyle = INK;
  font(x, 43, { weight: 800, wdth: 85, opsz: 48 });
  x.letterSpacing = '-0.8px';
  x.fillText('Eat. Grow. Last the round.', 30, 54);
  mono(x, 31, 0.02);
  x.fillStyle = PINK_TEXT;
  x.textAlign = 'center';
  x.fillText('slana.io', t.perfX + stub / 2, 51);
  x.textAlign = 'left';
  x.restore();
  tape(x, 84, 352, 74, 28, 0.9, GOLD, 58);
  stampAt(x, W, H, 196, 528, -0.18, (l) => roundStamp(l, 54, 'ON SOLANA * 5-MIN ROUNDS * ', { color: PINK_TEXT, size: 12.5, lw: 3.2 }), { seed: 55, k });
  // chase
  const trail = [
    [800, 300, 8, 'dot', TEAL],
    [770, 260, 10, 'star', GOLD],
    [830, 220, 7, 'tri', BLUE],
    [640, 470, 8, 'dot', PINK],
    [450, 560, 10, 'star', TEAL],
    [1120, 90, 8, 'dot', TEAL],
    [1150, 590, 10, 'star', PINK],
    [600, 60, 7, 'dot', PINK],
    [880, 70, 9, 'star', TEAL],
    [760, 580, 7, 'tri', GOLD],
  ];
  for (const [px, py, s, kind, col] of trail) pellet(x, px, py, s, kind, col);
  pellet(x, 790, 335, 12, 'gold', GOLD);
  speedLines(x, 715, 180, 60, -1, -0.3, PINK, 3, 1);
  coin(x, 715, 180, 60, lookForBasicSkin(4), { expression: 'scared', lookX: 0.9, lookY: 0.4 });
  speedLines(x, 560, 520, 28, -1, 0.15, TEAL, 2, 1.1);
  coin(x, 560, 520, 28, lookForBasicSkin(5), { expression: 'scared', lookX: 0.9 });
  x.save();
  x.translate(985, 365);
  x.rotate(-0.08);
  heroCoin(x, 180, { expression: 'hungry', mouth: 'grin', lookX: -1, lookY: -0.5, faceScale: 1.18, faceY: 0.1 });
  x.restore();
  tape(x, 1150, 40, 120, 34, 0.6, GOLD, 56);
  grain(x, W, H, 57, 5, Math.max(1, Math.round(k)));
  return c;
}

// ── safe-area previews (mock X layouts) ─────────────────────────────────────

function circleImage(x, img, cx, cy, d, ring, ringW) {
  x.save();
  x.beginPath();
  x.arc(cx, cy, d / 2 + ringW, 0, TAU);
  x.fillStyle = ring;
  x.fill();
  x.beginPath();
  x.arc(cx, cy, d / 2, 0, TAU);
  x.clip();
  x.imageSmoothingQuality = 'high';
  x.drawImage(img, cx - d / 2, cy - d / 2, d, d);
  x.restore();
}

function sans(x, size, weight = 400) {
  x.font = `${weight} ${size}px "Bricolage"`;
  x.fontVariationSettings = `'wght' ${weight}, 'wdth' 100, 'opsz' 14`;
  x.letterSpacing = '0px';
}

function pill(x, px, py, w, h, fill, stroke, text, tc, size) {
  roundRect(x, px, py, w, h, h / 2);
  if (fill) {
    x.fillStyle = fill;
    x.fill();
  }
  if (stroke) {
    x.strokeStyle = stroke;
    x.lineWidth = 2;
    x.stroke();
  }
  if (text) {
    sans(x, size, 700);
    x.fillStyle = tc;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(text, px + w / 2, py + h / 2 + 1);
    x.textAlign = 'left';
    x.textBaseline = 'alphabetic';
  }
}

/** Simple UI icons for the mock-ups (vector, no glyph fonts). */
function icon(x, kind, cx, cy, size, color) {
  x.save();
  x.translate(cx, cy);
  x.strokeStyle = color;
  x.fillStyle = color;
  x.lineWidth = size * 0.11;
  x.lineCap = 'round';
  x.lineJoin = 'round';
  const h = size / 2;
  if (kind === 'back') {
    x.beginPath();
    x.moveTo(h * 0.8, 0);
    x.lineTo(-h * 0.8, 0);
    x.moveTo(-h * 0.15, -h * 0.65);
    x.lineTo(-h * 0.8, 0);
    x.lineTo(-h * 0.15, h * 0.65);
    x.stroke();
  } else if (kind === 'search') {
    x.beginPath();
    x.arc(-h * 0.12, -h * 0.12, h * 0.5, 0, TAU);
    x.moveTo(h * 0.25, h * 0.25);
    x.lineTo(h * 0.72, h * 0.72);
    x.stroke();
  } else if (kind === 'more') {
    for (const dx of [-1, 0, 1]) {
      x.beginPath();
      x.arc(dx * h * 0.5, 0, h * 0.12, 0, TAU);
      x.fill();
    }
  }
  x.restore();
}

function skeleton(x, px, py, w, h, color) {
  roundRect(x, px, py, w, h, h / 2);
  x.fillStyle = color;
  x.fill();
}

/** Desktop: the 600 px profile column at 2x, light theme. */
function drawPreviewDesktop(banner, pfp) {
  const s = 2;
  const colW = 600 * s;
  const sideL = 90 * s;
  const W = colW + sideL + 40 * s;
  const H = 640 * s;
  const [c, x] = canvas(W, H);
  x.fillStyle = '#FFFFFF';
  x.fillRect(0, 0, W, H);
  // left nav rail
  for (let i = 0; i < 7; i++) {
    x.beginPath();
    x.arc(sideL / 2, (40 + i * 58) * s, 13 * s, 0, TAU);
    x.fillStyle = '#E7E9EA';
    x.fill();
  }
  const ox = sideL;
  x.strokeStyle = '#EFF3F4';
  x.lineWidth = 2;
  x.beginPath();
  x.moveTo(ox, 0);
  x.lineTo(ox, H);
  x.moveTo(ox + colW, 0);
  x.lineTo(ox + colW, H);
  x.stroke();
  // header bar
  sans(x, 20 * s, 800);
  x.fillStyle = '#0F1419';
  x.fillText('Slana', ox + 70 * s, 26 * s);
  sans(x, 13 * s, 400);
  x.fillStyle = '#536471';
  x.fillText('412 posts', ox + 70 * s, 45 * s);
  icon(x, 'back', ox + 30 * s, 30 * s, 20 * s, '#0F1419');
  const by = 53 * s;
  x.drawImage(banner, ox, by, colW, 200 * s);
  // avatar: 133.5 px, 4 px white ring, left 16, overlapping the banner bottom
  const d = 133.5 * s;
  const acx = ox + 16 * s + d / 2;
  const acy = by + 200 * s - 67 * s + d / 2 - 4 * s;
  circleImage(x, pfp, acx, acy, d, '#FFFFFF', 4 * s);
  pill(x, ox + colW - 130 * s, by + 212 * s, 112 * s, 36 * s, '#0F1419', null, 'Follow', '#FFFFFF', 15 * s);
  const ty = by + 200 * s + 90 * s;
  sans(x, 20 * s, 800);
  x.fillStyle = '#0F1419';
  x.fillText('Slana', ox + 16 * s, ty);
  sans(x, 15 * s, 400);
  x.fillStyle = '#536471';
  x.fillText('@slanaio', ox + 16 * s, ty + 22 * s);
  sans(x, 15 * s, 400);
  x.fillStyle = '#0F1419';
  x.fillText('Eat. Grow. Last the round. A coin-eat-coin game on Solana.', ox + 16 * s, ty + 54 * s);
  x.fillStyle = '#1D9BF0';
  x.fillText('slana.io', ox + 16 * s, ty + 82 * s);
  // tabs
  const tabY = ty + 116 * s;
  sans(x, 15 * s, 700);
  ['Posts', 'Replies', 'Highlights', 'Media', 'Likes'].forEach((t, i) => {
    x.fillStyle = i === 0 ? '#0F1419' : '#536471';
    x.textAlign = 'center';
    x.fillText(t, ox + (60 + i * 120) * s, tabY);
  });
  x.textAlign = 'left';
  x.fillStyle = '#1D9BF0';
  roundRect(x, ox + 32 * s, tabY + 14 * s, 56 * s, 4 * s, 2 * s);
  x.fill();
  x.fillStyle = '#EFF3F4';
  x.fillRect(ox, tabY + 18 * s, colW, 2);
  // a post
  const py = tabY + 36 * s;
  circleImage(x, pfp, ox + 36 * s, py + 20 * s, 40 * s, '#FFFFFF', 0);
  sans(x, 15 * s, 800);
  x.fillStyle = '#0F1419';
  x.fillText('Slana', ox + 66 * s, py + 14 * s);
  sans(x, 15 * s, 400);
  x.fillStyle = '#536471';
  x.fillText('@slanaio · 2h', ox + 112 * s, py + 14 * s);
  x.fillStyle = '#0F1419';
  x.fillText('Penny Pond is open. Five minutes, one till, last coin standing.', ox + 66 * s, py + 36 * s);
  skeleton(x, ox + 66 * s, py + 50 * s, 360 * s, 10 * s, '#EFF3F4');
  // label
  mono(x, 11 * s, 0.1);
  x.fillStyle = '#8B98A5';
  x.fillText('PREVIEW · X DESKTOP, LIGHT · 600 PX COLUMN AT 2X · APPROXIMATE LAYOUT', ox + 16 * s, H - 16 * s);
  return c;
}

/** Mobile: an iPhone-width profile (390 pt at 2x), dark theme, nav buttons over the banner. */
function drawPreviewMobile(banner, pfp) {
  const s = 2;
  const PW = 390 * s;
  const PH = 640 * s;
  const M = 30 * s;
  const W = PW + M * 2;
  const H = PH + M * 2;
  const [c, x] = canvas(W, H);
  x.fillStyle = '#E9E4D6';
  x.fillRect(0, 0, W, H);
  // phone body
  roundRect(x, M - 8 * s, M - 8 * s, PW + 16 * s, PH + 16 * s, 52 * s);
  x.fillStyle = '#1B1732';
  x.fill();
  x.save();
  roundRect(x, M, M, PW, PH, 44 * s);
  x.clip();
  x.fillStyle = '#000000';
  x.fillRect(M, M, PW, PH);
  x.translate(M, M);
  // banner: the app fills a slightly wider-than-3:1 header, so the top and bottom get cropped
  const bh = 120 * s;
  const sc = PW / banner.width;
  const sh = bh / sc;
  x.drawImage(banner, 0, (banner.height - sh) / 2, banner.width, sh, 0, 0, PW, bh);
  // status bar + nav buttons floating over the banner
  sans(x, 16 * s, 700);
  x.fillStyle = '#FFFFFF';
  x.fillText('9:41', 30 * s, 24 * s);
  roundRect(x, PW - 62 * s, 13 * s, 24 * s, 11 * s, 3 * s);
  x.strokeStyle = '#FFFFFF';
  x.lineWidth = 1.5 * s;
  x.stroke();
  roundRect(x, PW - 60 * s, 15 * s, 17 * s, 7 * s, 1.5 * s);
  x.fill();
  for (const [bx, kind] of [
    [16 * s, 'back'],
    [PW - 52 * s, 'more'],
    [PW - 94 * s, 'search'],
  ]) {
    x.beginPath();
    x.arc(bx + 17 * s, 62 * s, 16 * s, 0, TAU);
    x.fillStyle = 'rgba(15,20,25,0.72)';
    x.fill();
    icon(x, kind, bx + 17 * s, 62 * s, 17 * s, '#FFFFFF');
  }
  // avatar ~80 pt, black ring, overlapping the banner
  const d = 80 * s;
  circleImage(x, pfp, 16 * s + d / 2, bh + 8 * s, d, '#000000', 4 * s);
  pill(x, PW - 112 * s, bh + 12 * s, 96 * s, 34 * s, '#EFF3F4', null, 'Follow', '#0F1419', 14 * s);
  const ty = bh + 74 * s;
  sans(x, 22 * s, 800);
  x.fillStyle = '#E7E9EA';
  x.fillText('Slana', 16 * s, ty);
  sans(x, 15 * s, 400);
  x.fillStyle = '#71767B';
  x.fillText('@slanaio', 16 * s, ty + 22 * s);
  x.fillStyle = '#E7E9EA';
  x.fillText('Eat. Grow. Last the round.', 16 * s, ty + 52 * s);
  x.fillText('A coin-eat-coin game on Solana.', 16 * s, ty + 72 * s);
  x.fillStyle = '#1D9BF0';
  x.fillText('slana.io', 16 * s, ty + 100 * s);
  const tabY = ty + 140 * s;
  sans(x, 15 * s, 700);
  ['Posts', 'Replies', 'Media', 'Likes'].forEach((t, i) => {
    x.fillStyle = i === 0 ? '#E7E9EA' : '#71767B';
    x.textAlign = 'center';
    x.fillText(t, (49 + i * 97) * s, tabY);
  });
  x.textAlign = 'left';
  x.fillStyle = '#1D9BF0';
  roundRect(x, 24 * s, tabY + 14 * s, 50 * s, 4 * s, 2 * s);
  x.fill();
  x.fillStyle = '#2F3336';
  x.fillRect(0, tabY + 18 * s, PW, 2);
  const py = tabY + 40 * s;
  circleImage(x, pfp, 36 * s, py + 20 * s, 40 * s, '#000', 0);
  sans(x, 15 * s, 800);
  x.fillStyle = '#E7E9EA';
  x.fillText('Slana', 66 * s, py + 14 * s);
  sans(x, 15 * s, 400);
  x.fillStyle = '#71767B';
  x.fillText('@slanaio · 2h', 112 * s, py + 14 * s);
  skeleton(x, 66 * s, py + 30 * s, 290 * s, 10 * s, '#2F3336');
  skeleton(x, 66 * s, py + 48 * s, 220 * s, 10 * s, '#2F3336');
  // reply-row avatars to check the 48 px read
  x.restore();
  mono(x, 11 * s, 0.1);
  x.fillStyle = '#5B5577';
  x.fillText('PREVIEW · X MOBILE, DARK · 390 PT AT 2X · APPROXIMATE', M, H - 9 * s);
  return c;
}

/** Banner with the crop guides drawn on, for checking the crops. */
function drawSafeAreas(banner, pfp) {
  const [c, x] = canvas(1500, 760);
  x.fillStyle = '#F4F1EA';
  x.fillRect(0, 0, 1500, 760);
  x.drawImage(banner, 0, 0, 1500, 500);
  x.save();
  // avatar (desktop)
  x.globalAlpha = 0.95;
  circleImage(x, pfp, 40 + 167, 500 - 40, 334, '#FFFFFF', 10);
  x.restore();
  x.save();
  x.setLineDash([14, 10]);
  x.lineWidth = 4;
  x.strokeStyle = BLUE;
  x.strokeRect(0, 280, 420, 220);
  x.strokeStyle = RED;
  x.strokeRect(2, 60, 1496, 380);
  x.strokeStyle = TEAL_INK;
  x.strokeRect(440, 60, 1040, 380);
  x.restore();
  mono(x, 20, 0.08);
  x.fillStyle = INK;
  x.fillText('BLUE   avatar zone (desktop), keep calm: x 0-420, y 280-500', 440, 560);
  x.fillText('RED    mobile safe band: y 60-440 (top and bottom may crop)', 440, 600);
  x.fillText('TEAL   key content: x 440-1480, y 60-440', 440, 640);
  x.fillStyle = '#5B5577';
  x.fillText('Guides only. Upload banner.png or banner@2x.png.', 440, 700);
  return c;
}

// ── main ────────────────────────────────────────────────────────────────────

console.log('Slana X brand kit');
const pfpBig = drawPfp(1000);
save(pfpBig, 'pfp-1000.png');
const pfp400 = downscale(pfpBig, 400, 400);
save(pfp400, 'pfp.png');
const banner2x = drawBanner(3000, 1000);
save(banner2x, 'banner@2x.png');
const banner = downscale(banner2x, 1500, 500);
save(banner, 'banner.png');
const og2x = drawOg(2400, 1260);
save(downscale(og2x, 1200, 630), 'og.png');
save(drawPreviewDesktop(banner2x, pfpBig), 'preview-desktop.png');
save(drawPreviewMobile(banner2x, pfpBig), 'preview-mobile.png');
save(drawSafeAreas(banner, pfpBig), 'safe-areas.png');
