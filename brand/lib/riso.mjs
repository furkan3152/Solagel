/**
 * Shared "Paper Ticket" riso toolkit for every brand generator under brand/.
 *
 * The primitives (paper, grain, halftone, worn layers, the hero coin, the
 * wordmark, tickets, tape, stamps, pellets) are the ones brand/x/generate.mjs
 * draws the X profile, banner and OG card with, lifted here unchanged so the
 * whole kit is one family. New pieces (ghosted headlines, coin limbs, drawn
 * icons, registration marks, sealed cards, die-cut stickers, water) are added
 * below them.
 *
 * Dependencies come from the workspace (no new installs): @napi-rs/canvas from
 * packages/art, tsx from apps/server (to load packages/art as TypeScript) and
 * the @fontsource fonts from apps/web. Everything is seeded: same input, same
 * pixels.
 */
import { createRequire } from 'node:module';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../..');
export const BRAND = resolve(HERE, '..');

// ── dependencies from the workspace ─────────────────────────────────────────
const reqArt = createRequire(join(ROOT, 'packages/art/package.json'));
const { createCanvas, GlobalFonts } = reqArt('@napi-rs/canvas');
const tsxApi = createRequire(join(ROOT, 'apps/server/package.json'))
  .resolve('tsx/esm/api')
  .replace(/index\.cjs$/, 'index.mjs');
const { tsImport } = await import(tsxApi);
const A = await tsImport(join(ROOT, 'packages/art/src/index.ts'), import.meta.url);
export const { RISO, INK, PAPER, CARD_PAPER, NIGHT, drawRisoCoin, drawFace, drawHalftoneDots, drawSymbol, lookForBasicSkin, starPath, heartPath } = A;

const reqWeb = createRequire(join(ROOT, 'apps/web/package.json'));
const fontFile = (css, file) => join(dirname(reqWeb.resolve(css)), 'files', file);
GlobalFonts.registerFromPath(fontFile('@fontsource-variable/bricolage-grotesque/standard.css', 'bricolage-grotesque-latin-standard-normal.woff2'), 'Bricolage');
GlobalFonts.registerFromPath(fontFile('@fontsource/dm-mono/500.css', 'dm-mono-latin-500-normal.woff2'), 'DM Mono');

export const TAU = Math.PI * 2;
export const PINK = RISO.fluoPink;
export const TEAL = RISO.teal;
export const GOLD = RISO.mustard;
export const RED = RISO.red;
export const BLUE = RISO.blue;
export const INK_2 = '#5B5577';
export const PINK_TEXT = '#C71466';
export const TEAL_INK = '#0F736E';
export const MUSTARD_TEXT = '#885F0D';
export const RED_INK = '#CB1C0D';

/** The four arenas: on-chain id, name, ink, entry in whole $SLANA (packages/shared/src/arenas.ts). */
export const ARENAS = [
  { id: 1, slug: 'penny-pond', name: 'Penny Pond', ink: RED, text: RED_INK, entry: 1000, onInk: INK, coinBody: RISO.orange, coinGhost: RED },
  { id: 2, slug: 'silver-creek', name: 'Silver Creek', ink: TEAL, text: TEAL_INK, entry: 10000, onInk: INK, coinBody: 'silver', coinGhost: TEAL },
  { id: 3, slug: 'gold-lake', name: 'Gold Lake', ink: GOLD, text: MUSTARD_TEXT, entry: 50000, onInk: INK, coinBody: GOLD, coinGhost: PINK },
  { id: 4, slug: 'whale-bay', name: 'Whale Bay', ink: BLUE, text: BLUE, entry: 250000, onInk: CARD_PAPER, coinBody: BLUE, coinGhost: TEAL },
];

export const fmt = (n) => n.toLocaleString('en-US');

// ── utilities ───────────────────────────────────────────────────────────────
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function canvas(w, h) {
  const c = createCanvas(w, h);
  return [c, c.getContext('2d')];
}

/** Writes a PNG and logs its size. `dir` is absolute. */
export function save(c, dir, name) {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, c.toBuffer('image/png'));
  const kb = statSync(p).size / 1024;
  console.log(`  ${relative(ROOT, p).padEnd(52)} ${String(c.width + 'x' + c.height).padEnd(10)} ${kb >= 1024 ? (kb / 1024).toFixed(2) + ' MB' : Math.round(kb) + ' KB'}`);
  return p;
}

/** High-quality downscale (halving steps, then the remainder). */
export function downscale(src, w, h) {
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

/**
 * Renders a design at `ss`× supersampling in a W×H coordinate space, downscales
 * to the target size and adds the paper grain at the final size.
 */
export function render(W, H, draw, { ss = 2, grainAmt = 5, grainCell = 1, seed = 1, transparent = false } = {}) {
  const [c, x] = canvas(W * ss, H * ss);
  x.scale(ss, ss);
  x.k = ss; // device px per design px, for worn layers
  draw(x, W, H);
  const out = downscale(c, W, H);
  if (grainAmt > 0) grain(out.getContext('2d'), W, H, seed + 991, grainAmt, grainCell);
  return out;
}

export function font(x, size, { weight = 800, wdth = 85, opsz = 96, family = 'Bricolage', spacing = '0px' } = {}) {
  x.font = `${weight} ${size}px "${family}"`;
  x.fontVariationSettings = family === 'Bricolage' ? `'wght' ${weight}, 'wdth' ${wdth}, 'opsz' ${opsz}` : '';
  x.letterSpacing = spacing;
}

export function mono(x, size, spacing = 0.08) {
  x.font = `500 ${size}px "DM Mono"`;
  x.fontVariationSettings = '';
  x.letterSpacing = `${size * spacing}px`;
}

/** Body copy: Bricolage at text optical size. */
export function sans(x, size, weight = 500) {
  x.font = `${weight} ${size}px "Bricolage"`;
  x.fontVariationSettings = `'wght' ${weight}, 'wdth' 92, 'opsz' 18`;
  x.letterSpacing = '0px';
}

/** Runs `fn` on a transparent layer, then composites it (optionally worn like a riso pass). */
export function layer(x, W, H, fn, { op = 'source-over', alpha = 1, wear = 0, seed = 1, wearSize = 1 } = {}) {
  const k = x.k ?? 1;
  const [c, l] = canvas(Math.round(W * k), Math.round(H * k));
  l.setTransform(x.getTransform());
  l.k = k;
  fn(l);
  if (wear > 0) wearOut(l, c.width, c.height, wear, seed, wearSize * k);
  x.save();
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = op;
  x.globalAlpha = alpha;
  x.drawImage(c, 0, 0);
  x.restore();
}

/** Knocks speckles and dry-ink streaks out of a layer (riso coverage is never perfect). */
export function wearOut(l, W, H, amount, seed, size = 1) {
  const r = rng(seed);
  l.save();
  l.setTransform(1, 0, 0, 1, 0, 0);
  l.globalCompositeOperation = 'destination-out';
  const n = Math.round(((W * H) / 900 / (size * size)) * amount);
  for (let i = 0; i < n; i++) {
    const px = r() * W;
    const py = r() * H;
    const rad = (0.4 + r() ** 3 * 2.4) * size;
    l.globalAlpha = 0.35 + r() * 0.65;
    l.beginPath();
    l.arc(px, py, rad, 0, TAU);
    l.fill();
  }
  l.globalAlpha = 0.18 * amount;
  for (let i = 0; i < 6; i++) {
    const y = r() * H;
    l.fillRect(0, y, W, (1 + r() * 4) * size);
  }
  l.restore();
}

/** Paper stock: flat paper, soft cloud mottling and fibres. Works in design units. */
export function paper(x, W, H, seed, base = PAPER, { fibres = true } = {}) {
  x.save();
  x.fillStyle = base;
  x.fillRect(0, 0, W, H);
  const r = rng(seed);
  const k = Math.max(W, H) / 1500;
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
  if (fibres) {
    x.lineCap = 'round';
    const dark = base === NIGHT.paper;
    for (let i = 0; i < (W * H) / 2600; i++) {
      const px = r() * W;
      const py = r() * H;
      const a = r() * TAU;
      const len = (3 + r() * 10) * k;
      x.strokeStyle = dark ? (r() < 0.6 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.2)') : r() < 0.6 ? 'rgba(120,96,60,0.07)' : 'rgba(255,255,255,0.35)';
      x.lineWidth = Math.max(0.6, 0.9 * k);
      x.beginPath();
      x.moveTo(px, py);
      x.quadraticCurveTo(px + Math.cos(a + 0.6) * len * 0.5, py + Math.sin(a + 0.6) * len * 0.5, px + Math.cos(a) * len, py + Math.sin(a) * len);
      x.stroke();
    }
  }
  x.restore();
}

/** Final pass: fine mono grain over everything (device pixels). Skips fully transparent pixels. */
export function grain(x, W, H, seed, amount = 7, cell = 1) {
  const img = x.getImageData(0, 0, W, H);
  const d = img.data;
  const r = rng(seed);
  const cw = Math.ceil(W / cell);
  const row = new Float32Array(cw);
  for (let y = 0; y < H; y++) {
    if (y % cell === 0) for (let i = 0; i < cw; i++) row[i] = Math.round((r() + r() - 1) * amount);
    for (let px = 0; px < W; px++) {
      const i = (y * W + px) * 4;
      if (d[i + 3] === 0) continue;
      const n = row[(px / cell) | 0];
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    }
  }
  x.putImageData(img, 0, 0);
}

/** Graph-paper grid like the arena floor. */
export function grid(x, x0, y0, w, h, step, alpha = 0.07, color = TEAL) {
  x.save();
  x.strokeStyle = color;
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

/** Halftone dot screen (45°) whose dot size follows `tone(px, py)` in 0..1. */
export function halftone(x, x0, y0, w, h, sp, color, tone, angle = Math.PI / 4) {
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

export const smooth = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function roundRect(x, px, py, w, h, r) {
  x.beginPath();
  x.roundRect(px, py, w, h, r);
}

// ── the hero coin ───────────────────────────────────────────────────────────

function coinEdge(x, rr, teeth = 56) {
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
}

/**
 * The hero "Slana coin": a gold coin with a reeded edge, misregistered pink and
 * teal passes, a halftone shade and an oversized face. `body: 'silver'` prints
 * a paper coin with a heavier ink screen. `face` may be a function (x, fr) that
 * replaces the art package face; `afterFace` draws over the face.
 */
export function heroCoin(x, r, o = {}) {
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
    face = null,
    afterFace = null,
    shine = true,
    shade = 0.34,
  } = o;
  const rimW = r * 0.075 * rimScale;
  for (const [ink, off] of [
    [ghostB, offB],
    [ghostA, offA],
  ]) {
    if (!ink) continue;
    x.save();
    x.globalCompositeOperation = ghostOver ? 'source-over' : 'multiply';
    x.fillStyle = ink;
    x.translate(off[0] * r, off[1] * r);
    coinEdge(x, r);
    x.fill();
    x.restore();
  }
  coinEdge(x, r);
  x.fillStyle = CARD_PAPER;
  x.fill();
  const silver = body === 'silver';
  if (!silver) {
    x.save();
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = body;
    x.fill();
    x.restore();
  } else {
    x.save();
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = '#E4E2EA';
    x.fill();
    x.restore();
  }
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
  x.save();
  coinEdge(x, r - rimW * 0.5);
  x.clip();
  x.globalCompositeOperation = 'multiply';
  x.globalAlpha = silver ? 0.5 : shade;
  drawHalftoneDots(x, r, r * 0.06);
  x.restore();
  if (shine) {
    x.save();
    x.strokeStyle = CARD_PAPER;
    x.lineCap = 'round';
    x.globalAlpha = 0.95;
    x.lineWidth = r * 0.075;
    x.beginPath();
    x.arc(0, 0, r * 0.7, Math.PI * 1.08, Math.PI * 1.3);
    x.stroke();
    x.beginPath();
    x.arc(0, 0, r * 0.7, Math.PI * 1.37, Math.PI * 1.42);
    x.stroke();
    x.restore();
  }
  coinEdge(x, r);
  x.lineWidth = rimW;
  x.lineJoin = 'round';
  x.strokeStyle = INK;
  x.stroke();
  if (symbol) {
    x.save();
    x.translate(0, -r * 0.5);
    drawSymbol(x, symbol, r * 0.13, { fill: CARD_PAPER, ink: INK, overprint: ghostB || PINK, lineW: r * 0.028, offX: r * 0.02, offY: r * 0.02 });
    x.restore();
  }
  x.save();
  x.translate(0, r * faceY);
  const fr = r * faceScale;
  if (face) face(x, fr);
  else drawFace(x, fr, { expression, eyes, mouth, lookX, lookY, time: 0, seed: 0, detail: fr, blush });
  if (afterFace) afterFace(x, fr);
  x.restore();
}

/** Small coin from the art package. */
export function coin(x, cx, cy, r, look, state = {}) {
  x.save();
  x.translate(cx, cy);
  drawRisoCoin(x, look, r, { time: 0, lookX: 0, lookY: 0, expression: 'happy', pxPerUnit: 1, ...state });
  x.restore();
}

// ── extra faces (stickers and posters) ──────────────────────────────────────

function inkLine(x, r, w = 0.055) {
  x.strokeStyle = INK;
  x.lineWidth = r * w;
  x.lineCap = 'round';
  x.lineJoin = 'round';
}

function cheeks(x, r, color = PINK, k = 1) {
  x.save();
  x.globalAlpha = 0.85;
  x.fillStyle = color;
  for (const s of [-1, 1]) {
    x.beginPath();
    x.ellipse(s * r * 0.53, r * 0.24, r * 0.1 * k, r * 0.065 * k, 0, 0, TAU);
    x.fill();
  }
  x.restore();
}

function eyeDot(x, cx, cy, er, sparkle = true) {
  x.fillStyle = INK;
  x.beginPath();
  x.ellipse(cx, cy, er, er * 1.2, 0, 0, TAU);
  x.fill();
  if (sparkle) {
    x.fillStyle = CARD_PAPER;
    x.beginPath();
    x.arc(cx - er * 0.3, cy - er * 0.42, er * 0.4, 0, TAU);
    x.fill();
  }
}

function squeezeEyes(x, r) {
  inkLine(x, r, 0.055);
  for (const s of [-1, 1]) {
    const cx = s * r * 0.31;
    const cy = r * 0.03;
    x.beginPath();
    x.moveTo(cx - s * r * 0.09, cy - r * 0.07);
    x.lineTo(cx + s * r * 0.05, cy);
    x.lineTo(cx - s * r * 0.09, cy + r * 0.07);
    x.stroke();
  }
}

function happyArc(x, r, s, y = 0.05) {
  inkLine(x, r, 0.055);
  x.beginPath();
  x.arc(s * r * 0.31, r * y, r * 0.09, Math.PI * 1.1, Math.PI * 1.9);
  x.stroke();
}

function tear(x, px, py, s, color = RISO.aqua) {
  x.save();
  x.translate(px, py);
  x.beginPath();
  x.moveTo(0, -s * 1.4);
  x.quadraticCurveTo(s, 0, 0, s);
  x.quadraticCurveTo(-s, 0, 0, -s * 1.4);
  x.closePath();
  x.fillStyle = color;
  x.fill();
  x.strokeStyle = INK;
  x.lineWidth = s * 0.28;
  x.stroke();
  x.restore();
}

function wailMouth(x, r) {
  const y = r * 0.24;
  x.beginPath();
  x.moveTo(-r * 0.14, y + r * 0.1);
  x.quadraticCurveTo(0, y - r * 0.12, r * 0.14, y + r * 0.1);
  x.quadraticCurveTo(0, y + r * 0.06, -r * 0.14, y + r * 0.1);
  x.closePath();
  x.fillStyle = INK;
  x.fill();
  inkLine(x, r, 0.04);
  x.stroke();
}

function bigOpenMouth(x, r, w = 0.17, h = 0.22, y0 = 0.17) {
  const y = r * y0;
  const path = () => {
    x.beginPath();
    x.ellipse(0, y + r * h * 0.5, r * w, r * h * 0.5, 0, 0, TAU);
  };
  path();
  x.fillStyle = INK;
  x.fill();
  x.save();
  path();
  x.clip();
  x.fillStyle = PINK;
  x.beginPath();
  x.ellipse(0, y + r * h * 0.95, r * w * 0.7, r * h * 0.4, 0, 0, TAU);
  x.fill();
  x.fillStyle = CARD_PAPER;
  x.fillRect(-r * w, y - r * 0.01, r * w * 2, r * h * 0.18);
  x.restore();
}

function coinEyes(x, r) {
  for (const s of [-1, 1]) {
    const cx = s * r * 0.31;
    const cy = r * 0.02;
    x.fillStyle = GOLD;
    x.strokeStyle = INK;
    x.lineWidth = r * 0.035;
    x.beginPath();
    x.arc(cx, cy, r * 0.115, 0, TAU);
    x.fill();
    x.stroke();
    x.beginPath();
    x.arc(cx, cy, r * 0.06, 0, TAU);
    x.lineWidth = r * 0.022;
    x.stroke();
    x.fillStyle = CARD_PAPER;
    x.beginPath();
    x.arc(cx - r * 0.04, cy - r * 0.05, r * 0.025, 0, TAU);
    x.fill();
  }
}

function sideEyes(x, r, dir = 1) {
  for (const s of [-1, 1]) {
    const cx = s * r * 0.31;
    const cy = r * 0.04;
    // flat lid: half-closed
    x.fillStyle = CARD_PAPER;
    x.beginPath();
    x.ellipse(cx, cy, r * 0.11, r * 0.11, 0, 0, TAU);
    x.fill();
    inkLine(x, r, 0.035);
    x.stroke();
    x.save();
    x.beginPath();
    x.ellipse(cx, cy, r * 0.11, r * 0.11, 0, 0, TAU);
    x.clip();
    eyeDot(x, cx + dir * r * 0.05, cy + r * 0.02, r * 0.06, false);
    x.fillStyle = GOLD;
    x.fillRect(cx - r * 0.12, cy - r * 0.12, r * 0.24, r * 0.1);
    x.restore();
    inkLine(x, r, 0.045);
    x.beginPath();
    x.moveTo(cx - r * 0.12, cy - r * 0.02);
    x.lineTo(cx + r * 0.12, cy - r * 0.02);
    x.stroke();
  }
}

function flatMouth(x, r, y = 0.26, w = 0.09) {
  inkLine(x, r, 0.045);
  x.beginPath();
  x.moveTo(-r * w, r * y);
  x.lineTo(r * w, r * y);
  x.stroke();
}

function puffMouth(x, r) {
  // cheeks full of loot: a small pursed mouth and puffed cheeks
  inkLine(x, r, 0.045);
  x.beginPath();
  x.arc(0, r * 0.27, r * 0.035, 0, TAU);
  x.stroke();
  x.save();
  x.fillStyle = PINK;
  x.globalAlpha = 0.9;
  for (const s of [-1, 1]) {
    x.beginPath();
    x.ellipse(s * r * 0.45, r * 0.25, r * 0.14, r * 0.1, 0, 0, TAU);
    x.fill();
  }
  x.restore();
}

/**
 * Extra faces used by the stickers and the posters, drawn in the art
 * package's line language. Each is (x, r) centred on the face.
 */
export const FACES = {
  cry(x, r) {
    cheeks(x, r);
    squeezeEyes(x, r);
    // tear streams
    x.save();
    for (const s of [-1, 1]) {
      x.fillStyle = RISO.aqua;
      x.strokeStyle = INK;
      x.lineWidth = r * 0.025;
      x.beginPath();
      x.moveTo(s * r * 0.24, r * 0.1);
      x.quadraticCurveTo(s * r * 0.33, r * 0.4, s * r * 0.26, r * 0.62);
      x.lineTo(s * r * 0.38, r * 0.62);
      x.quadraticCurveTo(s * r * 0.42, r * 0.38, s * r * 0.36, r * 0.1);
      x.closePath();
      x.fill();
      x.stroke();
    }
    x.restore();
    wailMouth(x, r);
  },
  gulp(x, r) {
    for (const s of [-1, 1]) {
      x.fillStyle = CARD_PAPER;
      x.beginPath();
      x.arc(s * r * 0.31, r * 0.02, r * 0.13, 0, TAU);
      x.fill();
      inkLine(x, r, 0.035);
      x.stroke();
      eyeDot(x, s * r * 0.31 + r * 0.01, r * 0.03, r * 0.05);
    }
    puffMouth(x, r);
  },
  money(x, r) {
    cheeks(x, r);
    coinEyes(x, r);
    // big grin
    const w = r * 0.17;
    const y = r * 0.21;
    x.beginPath();
    x.moveTo(-w, y);
    x.lineTo(w, y);
    x.bezierCurveTo(w, y + w * 1.2, -w, y + w * 1.2, -w, y);
    x.closePath();
    x.fillStyle = INK;
    x.fill();
    x.save();
    x.clip();
    x.fillStyle = CARD_PAPER;
    x.fillRect(-w, y, w * 2, w * 0.32);
    x.fillStyle = PINK;
    x.beginPath();
    x.ellipse(0, y + w * 0.95, w * 0.6, w * 0.4, 0, 0, TAU);
    x.fill();
    x.restore();
  },
  wen(x, r) {
    sideEyes(x, r, 1);
    flatMouth(x, r, 0.27, 0.08);
  },
  shout(x, r) {
    // LFG: determined brows, huge open mouth
    cheeks(x, r);
    inkLine(x, r, 0.06);
    for (const s of [-1, 1]) {
      x.beginPath();
      x.moveTo(s * r * 0.45, -r * 0.16);
      x.lineTo(s * r * 0.17, -r * 0.08);
      x.stroke();
      eyeDot(x, s * r * 0.3, r * 0.03, r * 0.065);
    }
    bigOpenMouth(x, r, 0.17, 0.26, 0.14);
  },
  yawn(x, r) {
    // GM: one eye open, stretched mouth
    cheeks(x, r);
    happyArc(x, r, -1, 0.06);
    inkLine(x, r, 0.055);
    x.beginPath();
    x.moveTo(r * 0.22, r * 0.04);
    x.lineTo(r * 0.4, r * 0.04);
    x.stroke();
    bigOpenMouth(x, r, 0.1, 0.17, 0.17);
  },
  beam(x, r) {
    // eyes closed with joy, wide grin
    cheeks(x, r);
    happyArc(x, r, -1);
    happyArc(x, r, 1);
    const w = r * 0.16;
    const y = r * 0.2;
    x.beginPath();
    x.moveTo(-w, y);
    x.lineTo(w, y);
    x.bezierCurveTo(w, y + w * 1.15, -w, y + w * 1.15, -w, y);
    x.closePath();
    x.fillStyle = INK;
    x.fill();
    x.save();
    x.clip();
    x.fillStyle = PINK;
    x.beginPath();
    x.ellipse(0, y + w * 0.95, w * 0.6, w * 0.42, 0, 0, TAU);
    x.fill();
    x.restore();
  },
  dizzy(x, r) {
    inkLine(x, r, 0.04);
    for (const s of [-1, 1]) {
      const cx = s * r * 0.31;
      const cy = r * 0.03;
      x.beginPath();
      for (let t = 0; t < 3.2 * Math.PI; t += 0.15) {
        const rr = r * 0.012 + t * r * 0.012;
        const px = cx + Math.cos(t * s) * rr;
        const py = cy + Math.sin(t * s) * rr;
        if (t === 0) x.moveTo(px, py);
        else x.lineTo(px, py);
      }
      x.stroke();
    }
    // wobbly mouth with tongue out
    inkLine(x, r, 0.045);
    const y = r * 0.27;
    x.beginPath();
    x.moveTo(-r * 0.13, y);
    x.quadraticCurveTo(-r * 0.065, y - r * 0.05, 0, y);
    x.quadraticCurveTo(r * 0.065, y + r * 0.05, r * 0.13, y);
    x.stroke();
    x.fillStyle = PINK;
    x.beginPath();
    x.ellipse(r * 0.07, y + r * 0.06, r * 0.045, r * 0.06, -0.3, 0, TAU);
    x.fill();
    inkLine(x, r, 0.03);
    x.stroke();
  },
  smug(x, r) {
    cheeks(x, r);
    inkLine(x, r, 0.055);
    for (const s of [-1, 1]) {
      x.beginPath();
      x.moveTo(s * r * 0.42, r * 0.02);
      x.lineTo(s * r * 0.2, r * 0.02);
      x.stroke();
      x.save();
      x.beginPath();
      x.rect(s * r * 0.31 - r * 0.12, r * 0.02, r * 0.24, r * 0.2);
      x.clip();
      eyeDot(x, s * r * 0.31, r * 0.03, r * 0.075, false);
      x.restore();
    }
    x.beginPath();
    x.moveTo(-r * 0.1, r * 0.25);
    x.quadraticCurveTo(r * 0.04, r * 0.32, r * 0.14, r * 0.2);
    x.stroke();
  },
};

/**
 * Stubby ink limbs for the stickers: arms end in round mittens, legs in
 * ovals. Angles in radians from the coin centre; `to` is in units of r.
 */
export function arm(x, r, from, to, { hand = CARD_PAPER, bend = 0.25, w = 0.075, handR = 0.13 } = {}) {
  const fx = Math.cos(from) * r * 0.92;
  const fy = Math.sin(from) * r * 0.92;
  const tx = to[0] * r;
  const ty = to[1] * r;
  const mx = (fx + tx) / 2 - (ty - fy) * bend;
  const my = (fy + ty) / 2 + (tx - fx) * bend;
  x.save();
  x.lineCap = 'round';
  x.strokeStyle = INK;
  x.lineWidth = r * w;
  x.beginPath();
  x.moveTo(fx, fy);
  x.quadraticCurveTo(mx, my, tx, ty);
  x.stroke();
  if (handR > 0) {
    x.fillStyle = hand;
    x.lineWidth = r * w * 0.6;
    x.beginPath();
    x.arc(tx, ty, r * handR, 0, TAU);
    x.fill();
    x.stroke();
  }
  x.restore();
}

export function legs(x, r, { spread = 0.32, len = 0.32, foot = CARD_PAPER, kick = 0 } = {}) {
  x.save();
  x.lineCap = 'round';
  x.strokeStyle = INK;
  for (const s of [-1, 1]) {
    const fx = s * r * spread;
    const fy = r * 0.9;
    const tx = fx + s * r * 0.06 + (s === 1 ? kick * r : 0);
    const ty = fy + r * len - (s === 1 ? Math.abs(kick) * r * 0.4 : 0);
    x.lineWidth = r * 0.075;
    x.beginPath();
    x.moveTo(fx, fy);
    x.lineTo(tx, ty);
    x.stroke();
    x.fillStyle = foot;
    x.lineWidth = r * 0.045;
    x.beginPath();
    x.ellipse(tx + s * r * 0.06, ty + r * 0.02, r * 0.13, r * 0.075, 0, 0, TAU);
    x.fill();
    x.stroke();
  }
  x.restore();
}

// ── type ────────────────────────────────────────────────────────────────────

/**
 * A ghosted riso headline: a teal and a pink pass off register under the ink
 * pass. Returns the measured width. `align` is canvas textAlign.
 */
export function inkText(x, text, px, py, size, o = {}) {
  const {
    color = INK,
    ghostA = TEAL,
    ghostB = PINK,
    offA = [-0.018, -0.016],
    offB = [0.03, 0.028],
    align = 'left',
    weight = 800,
    wdth = 85,
    tracking = -0.025,
    alphaA = 0.75,
    alphaB = 1,
    ghostOp = 'multiply',
  } = o;
  font(x, size, { weight, wdth });
  x.letterSpacing = `${tracking * size}px`;
  x.textAlign = align;
  x.textBaseline = 'alphabetic';
  x.save();
  x.globalCompositeOperation = ghostOp;
  if (ghostA) {
    x.globalAlpha = alphaA;
    x.fillStyle = ghostA;
    x.fillText(text, px + offA[0] * size, py + offA[1] * size);
  }
  if (ghostB) {
    x.globalAlpha = alphaB;
    x.fillStyle = ghostB;
    x.fillText(text, px + offB[0] * size, py + offB[1] * size);
  }
  x.restore();
  x.fillStyle = color;
  x.fillText(text, px, py);
  const w = x.measureText(text).width;
  x.textAlign = 'left';
  return w;
}

/** Sets the font then returns the width of `text`. */
export function measure(x, text, size, o = {}) {
  font(x, size, { weight: o.weight ?? 800, wdth: o.wdth ?? 85 });
  x.letterSpacing = `${(o.tracking ?? -0.04) * size}px`;
  return x.measureText(text).width;
}

/** Largest size ≤ max at which `text` fits in `w`. */
export function fitSize(x, text, w, max, o = {}) {
  const m = measure(x, text, max, o);
  return m <= w ? max : Math.floor((max * w) / m);
}

/** Mono label (upper case by convention). */
export function label(x, text, px, py, size, color = INK, { spacing = 0.14, align = 'left' } = {}) {
  mono(x, size, spacing);
  x.fillStyle = color;
  x.textAlign = align;
  x.fillText(text, px, py);
  const w = x.measureText(text).width;
  x.textAlign = 'left';
  return w;
}

/** Riso wordmark: ink "slana" with a pink pass and a teal ghost off register, plus the ink dot. */
export function wordmark(x, left, baseline, size, { dot = true, onDark = false, color } = {}) {
  font(x, size, { weight: 800, wdth: 85 });
  // tight at display sizes, a little looser small so the letters do not fill in
  const track = size >= 140 ? -0.045 : size >= 90 ? -0.035 : -0.02;
  x.letterSpacing = `${track * size}px`;
  x.textAlign = 'left';
  const text = 'slana';
  const w = x.measureText(text).width;
  x.save();
  x.globalCompositeOperation = onDark ? 'source-over' : 'multiply';
  x.fillStyle = TEAL;
  x.globalAlpha = onDark ? 0.95 : 0.7;
  x.fillText(text, left - 0.018 * size, baseline - 0.016 * size);
  x.globalAlpha = 1;
  x.fillStyle = PINK;
  x.fillText(text, left + 0.032 * size, baseline + 0.03 * size);
  x.restore();
  x.fillStyle = color ?? (onDark ? CARD_PAPER : INK);
  x.fillText(text, left, baseline);
  if (dot) {
    const d = size * 0.2;
    const cx = left + w + d * 0.35;
    const cy = baseline - size * 0.78;
    x.save();
    x.globalCompositeOperation = onDark ? 'source-over' : 'multiply';
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
    x.strokeStyle = onDark ? CARD_PAPER : INK;
    x.globalAlpha = 0.55;
    x.lineWidth = d * 0.11;
    x.beginPath();
    x.arc(cx, cy, d * 0.66, 0, TAU);
    x.stroke();
    x.restore();
  }
  return { width: w + size * 0.35 };
}

export function wordmarkWidth(x, size) {
  font(x, size, { weight: 800, wdth: 85 });
  x.letterSpacing = `${(size >= 140 ? -0.045 : size >= 90 ? -0.035 : -0.02) * size}px`;
  return x.measureText('slana').width + size * 0.35;
}

// ── paper goods ─────────────────────────────────────────────────────────────

/** Ticket outline with the notched perforation (path only). */
export function ticketPath(x, w, h, radius, px, nr) {
  x.beginPath();
  x.moveTo(radius, 0);
  if (px != null) {
    x.lineTo(px - nr, 0);
    x.arc(px, 0, nr, Math.PI, 0, true);
  }
  x.lineTo(w - radius, 0);
  x.arcTo(w, 0, w, radius, radius);
  x.lineTo(w, h - radius);
  x.arcTo(w, h, w - radius, h, radius);
  if (px != null) {
    x.lineTo(px + nr, h);
    x.arc(px, h, nr, 0, Math.PI, true);
  }
  x.lineTo(radius, h);
  x.arcTo(0, h, 0, h - radius, radius);
  x.lineTo(0, radius);
  x.arcTo(0, 0, radius, 0, radius);
  x.closePath();
}

/**
 * A ticket stub: card stock, ink line, riso drop shadow, an arena stripe and a
 * perforation with punched notches. `perfAt: null` gives a plain card.
 * `vertical: true` perforates horizontally at `perfAt` of the height.
 */
export function ticket(x, { w, h, stripe = PINK, shadow = PINK, perfAt = 0.72, radius = 10, lw = 3, fill = CARD_PAPER, stripeW = 0.035, shadowOff = 2.4, notch = 0.075, vertical = false }) {
  if (vertical) {
    // draw rotated: a vertical ticket is a horizontal one turned a quarter
    x.save();
    x.translate(w, 0);
    x.rotate(Math.PI / 2);
    // shadow direction must stay down-right: draw it unrotated first
    x.restore();
    x.save();
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = shadow;
    roundRect(x, lw * shadowOff, lw * shadowOff, w, h, radius);
    x.fill();
    x.restore();
    const py = perfAt == null ? null : h * perfAt;
    const nr = w * notch;
    const shape = () => {
      x.beginPath();
      x.moveTo(radius, 0);
      x.lineTo(w - radius, 0);
      x.arcTo(w, 0, w, radius, radius);
      if (py != null) {
        x.lineTo(w, py - nr);
        x.arc(w, py, nr, -Math.PI / 2, Math.PI / 2, true);
      }
      x.lineTo(w, h - radius);
      x.arcTo(w, h, w - radius, h, radius);
      x.lineTo(radius, h);
      x.arcTo(0, h, 0, h - radius, radius);
      if (py != null) {
        x.lineTo(0, py + nr);
        x.arc(0, py, nr, Math.PI / 2, -Math.PI / 2, true);
      }
      x.lineTo(0, radius);
      x.arcTo(0, 0, radius, 0, radius);
      x.closePath();
    };
    shape();
    x.fillStyle = fill;
    x.fill();
    if (stripe) {
      x.save();
      shape();
      x.clip();
      x.fillStyle = stripe;
      x.fillRect(0, 0, w, h * stripeW);
      x.restore();
    }
    shape();
    x.strokeStyle = INK;
    x.lineWidth = lw;
    x.lineJoin = 'round';
    x.stroke();
    if (py != null) {
      x.save();
      x.strokeStyle = INK;
      x.globalAlpha = 0.55;
      x.lineWidth = lw * 0.8;
      x.setLineDash([lw * 2.2, lw * 2.2]);
      x.beginPath();
      x.moveTo(nr + lw * 2, py);
      x.lineTo(w - nr - lw * 2, py);
      x.stroke();
      x.restore();
    }
    return { perfY: py };
  }
  if (shadow) {
    x.save();
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = shadow;
    roundRect(x, lw * shadowOff, lw * shadowOff, w, h, radius);
    x.fill();
    x.restore();
  }
  const px = perfAt == null ? null : w * perfAt;
  const nr = h * notch;
  ticketPath(x, w, h, radius, px, nr);
  x.fillStyle = fill;
  x.fill();
  if (stripe) {
    x.save();
    ticketPath(x, w, h, radius, px, nr);
    x.clip();
    x.fillStyle = stripe;
    x.fillRect(0, 0, w * stripeW, h);
    x.restore();
  }
  ticketPath(x, w, h, radius, px, nr);
  x.strokeStyle = INK;
  x.lineWidth = lw;
  x.lineJoin = 'round';
  x.stroke();
  if (px != null) {
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
  }
  return { perfX: px };
}

/** Translucent masking tape with torn ends. */
export function tape(x, cx, cy, w, h, rot, color = GOLD, seed = 3, { op = 'multiply', alpha = 0.78 } = {}) {
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
  x.globalCompositeOperation = op;
  x.globalAlpha = alpha;
  x.fillStyle = color;
  x.fill();
  x.globalCompositeOperation = 'multiply';
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
export function pellet(x, px, py, s, kind, color) {
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

/** Scatters pellets in a box, avoiding `avoid(px, py)` zones. Deterministic. */
export function confetti(x, x0, y0, w, h, n, seed, { size = [6, 12], inks = [TEAL, GOLD, PINK, BLUE], avoid = () => false } = {}) {
  const r = rng(seed);
  const kinds = ['dot', 'star', 'tri', 'dot', 'gold'];
  let placed = 0;
  for (let tries = 0; placed < n && tries < n * 30; tries++) {
    const px = x0 + r() * w;
    const py = y0 + r() * h;
    const s = size[0] + r() * (size[1] - size[0]);
    const kind = kinds[Math.floor(r() * kinds.length)];
    const col = kind === 'gold' ? GOLD : inks[Math.floor(r() * inks.length)];
    if (avoid(px, py)) continue;
    pellet(x, px, py, s, kind, col);
    placed++;
  }
}

/** Rubber stamp text block (rectangular), drawn upright at the origin. */
export function rectStamp(x, lines, { color = TEAL, size = 40, pad = 0.45, lw = 4, sub = null, subSize = 0 }) {
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

/** Bold display stamp: a heavy Bricolage word in a double frame. */
export function wordStamp(x, word, { color = PINK, size = 80, lw = 6, padX = 0.4, padY = 0.22, radius = 0.14 } = {}) {
  font(x, size, { weight: 800, wdth: 80 });
  x.letterSpacing = `${-0.01 * size}px`;
  const tw = x.measureText(word).width;
  const w = tw + size * padX * 2;
  const h = size * (0.86 + padY * 2);
  x.strokeStyle = color;
  x.fillStyle = color;
  x.lineWidth = lw;
  roundRect(x, -w / 2, -h / 2, w, h, size * radius);
  x.stroke();
  x.lineWidth = lw * 0.45;
  roundRect(x, -w / 2 + lw * 1.8, -h / 2 + lw * 1.8, w - lw * 3.6, h - lw * 3.6, size * radius * 0.7);
  x.stroke();
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(word, 0, size * 0.04);
  x.textAlign = 'left';
  x.textBaseline = 'alphabetic';
  return { w, h };
}

/** Round seal with text on the ring and a star (or a word) in the middle. */
export function roundStamp(x, R, ring, { color = PINK, size = 22, lw = 4, center = null, centerSize = 0 }) {
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
export function stampAt(x, W, H, cx, cy, rot, fn, { wear = 1.4, seed = 9, alpha = 0.92, op = 'multiply' } = {}) {
  layer(
    x,
    W,
    H,
    (l) => {
      l.translate(cx, cy);
      l.rotate(rot);
      fn(l);
    },
    { op, alpha, wear, seed, wearSize: 1.3 },
  );
}

/** Speed lines behind a moving thing (direction = where it is going). */
export function speedLines(x, cx, cy, r, dx, dy, color, n = 3, lenK = 1) {
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

/** Short action strokes radiating around a point (shake, ring, pop). */
export function burstLines(x, cx, cy, r0, r1, angles, { color = INK, lw = 6 } = {}) {
  x.save();
  x.strokeStyle = color;
  x.lineWidth = lw;
  x.lineCap = 'round';
  for (const a of angles) {
    x.beginPath();
    x.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    x.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    x.stroke();
  }
  x.restore();
}

/** Printer's registration mark (crosshair in a circle). */
export function regMark(x, cx, cy, s, color = INK, lw = 2) {
  x.save();
  x.strokeStyle = color;
  x.lineWidth = lw;
  x.beginPath();
  x.arc(cx, cy, s * 0.55, 0, TAU);
  x.moveTo(cx - s, cy);
  x.lineTo(cx + s, cy);
  x.moveTo(cx, cy - s);
  x.lineTo(cx, cy + s);
  x.stroke();
  x.beginPath();
  x.arc(cx, cy, s * 0.22, 0, TAU);
  x.fillStyle = color;
  x.fill();
  x.restore();
}

/** Corner registration marks for a frame, with optional ghost passes. */
export function regMarks(x, W, H, inset, s, { ghosts = true, lw = 2 } = {}) {
  const pts = [
    [inset, inset],
    [W - inset, inset],
    [inset, H - inset],
    [W - inset, H - inset],
  ];
  for (const [px, py] of pts) {
    if (ghosts) {
      x.save();
      x.globalCompositeOperation = 'multiply';
      regMark(x, px + s * 0.12, py + s * 0.1, s, PINK, lw);
      regMark(x, px - s * 0.08, py - s * 0.1, s, TEAL, lw);
      x.restore();
    }
    regMark(x, px, py, s, INK, lw);
  }
}

/** A printer's colour bar: swatches of the inks used in this print. */
export function colorBar(x, px, py, sw, sh, inks, { gap = 0, outline = true } = {}) {
  inks.forEach((c, i) => {
    x.fillStyle = c;
    x.fillRect(px + i * (sw + gap), py, sw, sh);
    if (outline) {
      x.strokeStyle = INK;
      x.lineWidth = 1.5;
      x.strokeRect(px + i * (sw + gap), py, sw, sh);
    }
  });
}

/** Dashed perforation line. */
export function perforation(x, x0, y0, x1, y1, { lw = 3, dash = 8, color = INK, alpha = 0.55 } = {}) {
  x.save();
  x.strokeStyle = color;
  x.globalAlpha = alpha;
  x.lineWidth = lw;
  x.setLineDash([dash, dash]);
  x.beginPath();
  x.moveTo(x0, y0);
  x.lineTo(x1, y1);
  x.stroke();
  x.restore();
}

/** A sunburst of rays around (cx, cy), filled in `color` (use inside a multiply layer). */
export function sunburst(x, cx, cy, R, rays, color, phase = 0.05) {
  x.save();
  x.translate(cx, cy);
  x.fillStyle = color;
  for (let i = 0; i < rays; i++) {
    const a0 = (i / rays) * TAU + phase;
    const a1 = a0 + (TAU / rays) * 0.5;
    x.beginPath();
    x.moveTo(0, 0);
    x.arc(0, 0, R, a0, a1);
    x.closePath();
    x.fill();
  }
  x.restore();
}

/** A riso flood: an ink rectangle multiplied onto the paper with worn coverage. */
export function flood(x, W, H, rect, color, { seed = 5, wear = 0.5, alpha = 1, radius = 0 } = {}) {
  layer(
    x,
    W,
    H,
    (l) => {
      l.fillStyle = color;
      if (radius) {
        roundRect(l, rect[0], rect[1], rect[2], rect[3], radius);
        l.fill();
      } else l.fillRect(...rect);
    },
    { op: 'multiply', alpha, wear, seed },
  );
}

// ── drawn icons (no emoji, no glyph fonts) ──────────────────────────────────

/** A school bell with a clapper; `ring` adds motion strokes. */
export function bell(x, cx, cy, s, { fill = GOLD, ghost = PINK, ring = true, lw = null, tilt = -0.18 } = {}) {
  const L = lw ?? s * 0.075;
  const shape = () => {
    x.beginPath();
    x.moveTo(-s * 0.08, -s * 0.78);
    x.bezierCurveTo(-s * 0.55, -s * 0.74, -s * 0.6, -s * 0.2, -s * 0.62, s * 0.18);
    x.quadraticCurveTo(-s * 0.68, s * 0.4, -s * 0.86, s * 0.5);
    x.lineTo(s * 0.86, s * 0.5);
    x.quadraticCurveTo(s * 0.68, s * 0.4, s * 0.62, s * 0.18);
    x.bezierCurveTo(s * 0.6, -s * 0.2, s * 0.55, -s * 0.74, s * 0.08, -s * 0.78);
    x.closePath();
  };
  x.save();
  x.translate(cx, cy);
  x.rotate(tilt);
  if (ghost) {
    x.save();
    x.globalCompositeOperation = 'multiply';
    x.translate(s * 0.07, s * 0.06);
    x.fillStyle = ghost;
    shape();
    x.fill();
    x.restore();
  }
  // clapper
  x.fillStyle = INK;
  x.beginPath();
  x.arc(s * 0.05, s * 0.62, s * 0.15, 0, TAU);
  x.fill();
  // handle knob
  x.lineWidth = L;
  x.strokeStyle = INK;
  x.fillStyle = fill;
  x.beginPath();
  x.arc(0, -s * 0.88, s * 0.12, 0, TAU);
  x.fill();
  x.stroke();
  shape();
  x.fillStyle = CARD_PAPER;
  x.fill();
  x.save();
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = fill;
  x.fill();
  x.restore();
  // halftone shade on the right
  x.save();
  shape();
  x.clip();
  x.globalCompositeOperation = 'multiply';
  x.globalAlpha = 0.3;
  halftone(x, -s, -s, s * 2, s * 1.6, s * 0.1, INK, (px) => smooth(0.05, 0.75, px / s));
  x.restore();
  // shine
  x.save();
  x.strokeStyle = CARD_PAPER;
  x.lineCap = 'round';
  x.lineWidth = s * 0.09;
  x.beginPath();
  x.moveTo(-s * 0.32, -s * 0.48);
  x.quadraticCurveTo(-s * 0.42, -s * 0.15, -s * 0.42, s * 0.1);
  x.stroke();
  x.restore();
  shape();
  x.lineWidth = L;
  x.lineJoin = 'round';
  x.stroke();
  // lip band
  x.beginPath();
  x.moveTo(-s * 0.7, s * 0.34);
  x.quadraticCurveTo(0, s * 0.42, s * 0.7, s * 0.34);
  x.lineWidth = L * 0.7;
  x.stroke();
  x.restore();
  if (ring) {
    x.save();
    x.strokeStyle = INK;
    x.lineCap = 'round';
    x.lineWidth = L;
    for (const sd of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        const rr = s * (1.05 + i * 0.24);
        const mid = sd < 0 ? Math.PI + tilt - 0.15 : tilt - 0.15;
        const half = 0.22 - i * 0.04;
        x.beginPath();
        x.arc(cx, cy - s * 0.1, rr, mid - half, mid + half);
        x.stroke();
      }
    }
    x.restore();
  }
}

/** Stopwatch with hands at `minutes` (0..5 maps to a full sweep). */
export function stopwatch(x, cx, cy, s, { fill = CARD_PAPER, ghost = TEAL, label: lab = '5:00', sweep = 0.8, accent = PINK } = {}) {
  const L = s * 0.08;
  x.save();
  x.translate(cx, cy);
  if (ghost) {
    x.save();
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = ghost;
    x.beginPath();
    x.arc(s * 0.07, s * 0.07, s, 0, TAU);
    x.fill();
    x.restore();
  }
  // crown + buttons
  x.fillStyle = INK;
  roundRect(x, -s * 0.16, -s * 1.3, s * 0.32, s * 0.22, s * 0.05);
  x.fill();
  x.fillRect(-s * 0.07, -s * 1.12, s * 0.14, s * 0.16);
  x.save();
  x.rotate(0.75);
  roundRect(x, -s * 0.09, -s * 1.17, s * 0.18, s * 0.16, s * 0.04);
  x.fill();
  x.restore();
  x.beginPath();
  x.arc(0, 0, s, 0, TAU);
  x.fillStyle = fill;
  x.fill();
  x.lineWidth = L;
  x.strokeStyle = INK;
  x.stroke();
  // elapsed wedge
  x.save();
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = accent;
  x.beginPath();
  x.moveTo(0, 0);
  x.arc(0, 0, s * 0.82, -Math.PI / 2, -Math.PI / 2 + TAU * sweep);
  x.closePath();
  x.fill();
  x.restore();
  // ticks
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * TAU;
    const r0 = s * (i % 5 === 0 ? 0.7 : 0.8);
    x.beginPath();
    x.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    x.lineTo(Math.cos(a) * s * 0.9, Math.sin(a) * s * 0.9);
    x.lineWidth = i % 5 === 0 ? L * 0.8 : L * 0.45;
    x.stroke();
  }
  const ha = -Math.PI / 2 + TAU * sweep;
  x.lineCap = 'round';
  x.lineWidth = L;
  x.beginPath();
  x.moveTo(0, 0);
  x.lineTo(Math.cos(ha) * s * 0.66, Math.sin(ha) * s * 0.66);
  x.stroke();
  x.fillStyle = INK;
  x.beginPath();
  x.arc(0, 0, s * 0.1, 0, TAU);
  x.fill();
  if (lab) {
    x.fillStyle = INK;
    mono(x, s * 0.26, 0.02);
    x.textAlign = 'center';
    x.fillText(lab, 0, s * 0.5);
    x.textAlign = 'left';
  }
  x.restore();
}

/** A paper flame (floor loot is burned). */
export function flame(x, cx, cy, s, { outer = RISO.orange, inner = GOLD, lw = null } = {}) {
  const L = lw ?? s * 0.08;
  const path = (k, dy = 0) => {
    x.beginPath();
    x.moveTo(0, s * k + dy);
    x.bezierCurveTo(-s * 0.75 * k, s * k + dy, -s * 0.8 * k, s * 0.1 * k + dy, -s * 0.35 * k, -s * 0.35 * k + dy);
    x.bezierCurveTo(-s * 0.3 * k, -s * 0.1 * k + dy, -s * 0.12 * k, -s * 0.05 * k + dy, -s * 0.12 * k, -s * 0.2 * k + dy);
    x.bezierCurveTo(-s * 0.1 * k, -s * 0.6 * k + dy, s * 0.15 * k, -s * 0.85 * k + dy, s * 0.05 * k, -s * 1.15 * k + dy);
    x.bezierCurveTo(s * 0.55 * k, -s * 0.8 * k + dy, s * 0.85 * k, -s * 0.2 * k + dy, s * 0.7 * k, s * 0.35 * k + dy);
    x.bezierCurveTo(s * 0.6 * k, s * 0.8 * k + dy, s * 0.3 * k, s * k + dy, 0, s * k + dy);
    x.closePath();
  };
  x.save();
  x.translate(cx, cy);
  x.save();
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = PINK;
  x.translate(s * 0.08, s * 0.06);
  path(1);
  x.fill();
  x.restore();
  path(1);
  x.fillStyle = outer;
  x.fill();
  x.lineWidth = L;
  x.strokeStyle = INK;
  x.lineJoin = 'round';
  x.stroke();
  path(0.55, s * 0.4);
  x.fillStyle = inner;
  x.fill();
  x.lineWidth = L * 0.7;
  x.stroke();
  x.restore();
}

/** Simple ink arrow from (x0,y0) to (x1,y1) with a curved shaft. */
export function arrow(x, x0, y0, x1, y1, { lw = 6, color = INK, bend = 0.2, head = 22 } = {}) {
  const mx = (x0 + x1) / 2 - (y1 - y0) * bend;
  const my = (y0 + y1) / 2 + (x1 - x0) * bend;
  x.save();
  x.strokeStyle = color;
  x.fillStyle = color;
  x.lineWidth = lw;
  x.lineCap = 'round';
  x.lineJoin = 'round';
  x.beginPath();
  x.moveTo(x0, y0);
  x.quadraticCurveTo(mx, my, x1, y1);
  x.stroke();
  const a = Math.atan2(y1 - my, x1 - mx);
  x.beginPath();
  x.moveTo(x1 + Math.cos(a) * head * 0.2, y1 + Math.sin(a) * head * 0.2);
  x.lineTo(x1 - Math.cos(a - 0.45) * head, y1 - Math.sin(a - 0.45) * head);
  x.lineTo(x1 - Math.cos(a + 0.45) * head, y1 - Math.sin(a + 0.45) * head);
  x.closePath();
  x.fill();
  x.restore();
}

/** Little sparkle (four-point star). */
export function sparkle(x, cx, cy, s, color = GOLD, lw = null) {
  x.save();
  x.translate(cx, cy);
  x.beginPath();
  x.moveTo(0, -s);
  x.quadraticCurveTo(s * 0.12, -s * 0.12, s, 0);
  x.quadraticCurveTo(s * 0.12, s * 0.12, 0, s);
  x.quadraticCurveTo(-s * 0.12, s * 0.12, -s, 0);
  x.quadraticCurveTo(-s * 0.12, -s * 0.12, 0, -s);
  x.closePath();
  x.fillStyle = color;
  x.fill();
  x.strokeStyle = INK;
  x.lineWidth = lw ?? s * 0.14;
  x.lineJoin = 'round';
  x.stroke();
  x.restore();
}

/** A sealed riso trading card in a glassine sleeve with a wax-style seal. */
export function sealedCard(x, w, h, { ink = PINK, ghost = TEAL, no = '001', seed = 1, sealInk = RED, coinBody = GOLD } = {}) {
  const r = rng(seed);
  const rad = w * 0.06;
  // riso drop shadow
  x.save();
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = ghost;
  roundRect(x, w * 0.035, w * 0.035, w, h, rad);
  x.fill();
  x.restore();
  // card
  roundRect(x, 0, 0, w, h, rad);
  x.fillStyle = CARD_PAPER;
  x.fill();
  x.save();
  roundRect(x, 0, 0, w, h, rad);
  x.clip();
  // the art window: ink flood with a halftone and a mystery coin silhouette
  const m = w * 0.08;
  const aw = w - m * 2;
  const ah = h * 0.62;
  x.save();
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = ink;
  roundRect(x, m, m, aw, ah, rad * 0.5);
  x.fill();
  x.restore();
  x.save();
  roundRect(x, m, m, aw, ah, rad * 0.5);
  x.clip();
  x.globalCompositeOperation = 'multiply';
  halftone(x, m, m, aw, ah, w * 0.045, ghost, (px, py) => 0.15 + 0.7 * smooth(0, 1, (py - m) / ah));
  sunburst(x, w / 2, m + ah * 0.55, aw, 16, 'rgba(255,255,255,0)', 0);
  x.restore();
  // coin silhouette with a question mark
  const cr = aw * 0.3;
  const ccx = w / 2;
  const ccy = m + ah * 0.52;
  x.save();
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = INK;
  x.globalAlpha = 0.85;
  x.beginPath();
  x.arc(ccx, ccy, cr, 0, TAU);
  x.fill();
  x.restore();
  x.fillStyle = CARD_PAPER;
  font(x, cr * 1.3, { weight: 800, wdth: 80 });
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('?', ccx, ccy + cr * 0.08);
  x.textAlign = 'left';
  x.textBaseline = 'alphabetic';
  // text lines (placeholder bars) and number
  x.fillStyle = INK;
  const ty = m + ah + h * 0.07;
  mono(x, w * 0.055, 0.12);
  x.fillText(`NO. ${no}`, m, ty);
  x.globalAlpha = 0.18;
  for (let i = 0; i < 3; i++) {
    roundRect(x, m, ty + h * 0.045 + i * h * 0.045, aw * (0.9 - i * 0.22 - r() * 0.1), h * 0.022, h * 0.011);
    x.fill();
  }
  x.globalAlpha = 1;
  x.restore();
  roundRect(x, 0, 0, w, h, rad);
  x.lineWidth = w * 0.018;
  x.strokeStyle = INK;
  x.stroke();
  // glassine sleeve: milky overlay with a sheen band
  x.save();
  roundRect(x, -w * 0.02, -w * 0.02, w * 1.04, h * 1.02, rad * 1.1);
  x.fillStyle = 'rgba(255,253,246,0.42)';
  x.fill();
  x.clip();
  x.globalAlpha = 0.5;
  x.fillStyle = CARD_PAPER;
  x.beginPath();
  x.moveTo(w * 0.1, -h * 0.1);
  x.lineTo(w * 0.32, -h * 0.1);
  x.lineTo(w * 0.02, h * 1.1);
  x.lineTo(-w * 0.2, h * 1.1);
  x.closePath();
  x.fill();
  x.restore();
  roundRect(x, -w * 0.02, -w * 0.02, w * 1.04, h * 1.02, rad * 1.1);
  x.lineWidth = w * 0.008;
  x.strokeStyle = INK;
  x.globalAlpha = 0.45;
  x.stroke();
  x.globalAlpha = 1;
  // seal across the flap
  const sr = w * 0.15;
  const sx = w / 2;
  const sy = h * 0.82;
  x.save();
  x.translate(sx, sy);
  x.beginPath();
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * TAU;
    const rr = sr * (i % 2 ? 0.9 : 1) * (0.96 + r() * 0.06);
    if (i === 0) x.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  x.closePath();
  x.fillStyle = sealInk;
  x.fill();
  x.lineWidth = w * 0.012;
  x.strokeStyle = INK;
  x.stroke();
  x.beginPath();
  x.arc(0, 0, sr * 0.62, 0, TAU);
  x.lineWidth = w * 0.008;
  x.stroke();
  x.fillStyle = INK;
  starPath(x, sr * 0.4, sr * 0.18);
  x.fill();
  x.restore();
}

// ── water (arena scenes) ────────────────────────────────────────────────────

/** Rows of wavy lines across a box; amplitude and wavelength in px. */
export function waves(x, x0, y0, w, h, { gap = 26, amp = 6, len = 90, color = INK, lw = 3, phase = 0, dash = null, seed = 1, skip = 0 } = {}) {
  const r = rng(seed);
  x.save();
  x.beginPath();
  x.rect(x0, y0, w, h);
  x.clip();
  x.strokeStyle = color;
  x.lineWidth = lw;
  x.lineCap = 'round';
  if (dash) x.setLineDash(dash);
  let row = 0;
  for (let y = y0 + gap * 0.5; y < y0 + h + amp; y += gap, row++) {
    if (skip && r() < skip) continue;
    const ph = phase + row * 1.7 + r() * 2;
    x.beginPath();
    for (let px = x0 - len; px <= x0 + w + len; px += 6) {
      const py = y + Math.sin((px / len) * TAU + ph) * amp;
      if (px === x0 - len) x.moveTo(px, py);
      else x.lineTo(px, py);
    }
    x.stroke();
  }
  x.restore();
}

/** Short wave dashes ("~") scattered for open water. */
export function waveTicks(x, x0, y0, w, h, n, seed, { size = 26, color = INK, lw = 4 } = {}) {
  const r = rng(seed);
  x.save();
  x.strokeStyle = color;
  x.lineWidth = lw;
  x.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const px = x0 + r() * w;
    const py = y0 + r() * h;
    const s = size * (0.7 + r() * 0.6);
    x.beginPath();
    x.moveTo(px - s, py);
    x.quadraticCurveTo(px - s * 0.5, py - s * 0.45, px, py);
    x.quadraticCurveTo(px + s * 0.5, py + s * 0.45, px + s, py);
    x.stroke();
  }
  x.restore();
}

// ── die-cut stickers ────────────────────────────────────────────────────────

function dilate(src, rad, color, steps = 40) {
  const [c, x] = canvas(src.width, src.height);
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TAU;
    x.drawImage(src, Math.cos(a) * rad, Math.sin(a) * rad);
  }
  for (let i = 0; i < steps / 2; i++) {
    const a = (i / (steps / 2)) * TAU;
    x.drawImage(src, Math.cos(a) * rad * 0.5, Math.sin(a) * rad * 0.5);
  }
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

/**
 * Wraps transparent art in a die-cut sticker: a paper border, an ink cut line
 * and an off-register riso shadow, on a transparent background.
 */
export function dieCut(art, { border = 14, line = 5, shadow = TEAL, shadowOff = [7, 8], seed = 1 } = {}) {
  const W = art.width;
  const H = art.height;
  const paperC = dilate(art, border, CARD_PAPER);
  const inkC = dilate(art, border + line, INK);
  const shadowC = dilate(art, border + line, shadow);
  const [c, x] = canvas(W, H);
  if (shadow) x.drawImage(shadowC, shadowOff[0], shadowOff[1]);
  x.drawImage(inkC, 0, 0);
  x.drawImage(paperC, 0, 0);
  x.drawImage(art, 0, 0);
  return c;
}

export function readArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) out[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
      else out[k] = true;
    }
  }
  return out;
}

// ── indexed PNG (keeps feed images small) ───────────────────────────────────

import { deflateSync, crc32 } from 'node:zlib';

/**
 * Median-cut palette (up to `colors`) over a 6-bit-per-channel histogram of
 * an opaque canvas, then an 8-bit indexed PNG. Riso art is a handful of inks
 * and their overprints, so 256 entries hold it; the grain dithers the rest.
 */
export function indexedPng(c, colors = 256) {
  const W = c.width;
  const H = c.height;
  const d = c.getContext('2d').getImageData(0, 0, W, H).data;
  const BITS = 6;
  const SH = 8 - BITS;
  const N = 1 << (BITS * 3);
  const hist = new Uint32Array(N);
  const key = (i) => ((d[i] >> SH) << (BITS * 2)) | ((d[i + 1] >> SH) << BITS) | (d[i + 2] >> SH);
  for (let i = 0; i < d.length; i += 4) hist[key(i)]++;
  const used = [];
  for (let k = 0; k < N; k++) if (hist[k]) used.push(k);
  const ch = (k, a) => (a === 0 ? k >> (BITS * 2) : a === 1 ? (k >> BITS) & ((1 << BITS) - 1) : k & ((1 << BITS) - 1));
  let boxes = [used];
  while (boxes.length < colors) {
    // split the box with the largest (population × range)
    let best = -1;
    let bestScore = -1;
    let bestAxis = 0;
    boxes.forEach((b, bi) => {
      if (b.length < 2) return;
      let pop = 0;
      const lo = [99, 99, 99];
      const hi = [-1, -1, -1];
      for (const k of b) {
        pop += hist[k];
        for (let a = 0; a < 3; a++) {
          const v = ch(k, a);
          if (v < lo[a]) lo[a] = v;
          if (v > hi[a]) hi[a] = v;
        }
      }
      const ranges = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
      const axis = ranges.indexOf(Math.max(...ranges));
      const score = Math.sqrt(pop) * ranges[axis];
      if (score > bestScore) {
        bestScore = score;
        best = bi;
        bestAxis = axis;
      }
    });
    if (best < 0 || bestScore <= 0) break;
    const b = boxes[best].sort((p, q) => ch(p, bestAxis) - ch(q, bestAxis));
    let total = 0;
    for (const k of b) total += hist[k];
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < b.length - 1; i++) {
      acc += hist[b[i]];
      if (acc >= total / 2) {
        cut = i + 1;
        break;
      }
    }
    boxes.splice(best, 1, b.slice(0, cut), b.slice(cut));
  }
  // palette = population-weighted mean of the real pixels in each box
  const boxOf = new Int32Array(N).fill(-1);
  boxes.forEach((b, bi) => b.forEach((k) => (boxOf[k] = bi)));
  const sum = new Float64Array(boxes.length * 4);
  for (let i = 0; i < d.length; i += 4) {
    const bi = boxOf[key(i)];
    sum[bi * 4] += d[i];
    sum[bi * 4 + 1] += d[i + 1];
    sum[bi * 4 + 2] += d[i + 2];
    sum[bi * 4 + 3]++;
  }
  let pal = boxes.map((_, bi) => [0, 1, 2].map((a) => sum[bi * 4 + a] / sum[bi * 4 + 3]));
  // nearest palette entry per 6-bit bin actually used, refined by a few k-means passes over the bins
  const near = new Int16Array(N).fill(-1);
  const binMean = new Float32Array(N * 3);
  for (let i = 0; i < d.length; i += 4) {
    const k = key(i);
    binMean[k * 3] += d[i];
    binMean[k * 3 + 1] += d[i + 1];
    binMean[k * 3 + 2] += d[i + 2];
  }
  for (const k of used) for (let a = 0; a < 3; a++) binMean[k * 3 + a] /= hist[k];
  const assign = () => {
    for (const k of used) {
      const r = binMean[k * 3];
      const g = binMean[k * 3 + 1];
      const b = binMean[k * 3 + 2];
      let bi = 0;
      let bd = Infinity;
      for (let p = 0; p < pal.length; p++) {
        const dr = r - pal[p][0];
        const dg = g - pal[p][1];
        const db = b - pal[p][2];
        const dd = dr * dr * 2 + dg * dg * 4 + db * db * 3;
        if (dd < bd) {
          bd = dd;
          bi = p;
        }
      }
      near[k] = bi;
    }
  };
  for (let it = 0; it < 4; it++) {
    assign();
    const acc = new Float64Array(pal.length * 4);
    for (const k of used) {
      const p = near[k];
      const n = hist[k];
      acc[p * 4] += binMean[k * 3] * n;
      acc[p * 4 + 1] += binMean[k * 3 + 1] * n;
      acc[p * 4 + 2] += binMean[k * 3 + 2] * n;
      acc[p * 4 + 3] += n;
    }
    pal = pal.map((c0, p) => (acc[p * 4 + 3] ? [0, 1, 2].map((a) => acc[p * 4 + a] / acc[p * 4 + 3]) : c0));
  }
  assign();
  pal = pal.map((c0) => c0.map((v) => Math.max(0, Math.min(255, Math.round(v)))));
  const raw = Buffer.alloc((W + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W + 1)] = 0;
    for (let px = 0; px < W; px++) raw[y * (W + 1) + 1 + px] = near[key((y * W + px) * 4)];
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', Buffer.from(pal.flat())),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Saves an opaque design as an indexed PNG when the truecolor one would be over `limitMB`. */
export function saveSmall(c, dir, name, limitMB = 1.9) {
  const full = c.toBuffer('image/png');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  let buf = full;
  let mode = 'rgb';
  if (full.length > limitMB * 1024 * 1024) {
    buf = indexedPng(c);
    mode = 'indexed';
  }
  writeFileSync(p, buf);
  const kb = buf.length / 1024;
  console.log(`  ${relative(ROOT, p).padEnd(52)} ${String(c.width + 'x' + c.height).padEnd(10)} ${kb >= 1024 ? (kb / 1024).toFixed(2) + ' MB' : Math.round(kb) + ' KB'} ${mode}`);
  return p;
}
