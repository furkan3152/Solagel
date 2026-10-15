/* Slana promo: shared drawing library (Paper Ticket / riso print).
 * Everything here is deterministic: no Date, no Math.random. All motion is a
 * pure function of the timeline time t (seconds). */
'use strict';

const W = 1920, H = 1080, TAU = Math.PI * 2;
const C = {
  paper: '#F1EADB', card: '#FFFCF4', ink: '#1E1B2E', ink2: '#5D5870',
  pink: '#FF4F87', pinkInk: '#D6245F', pinkText: '#C21E56',
  teal: '#0E9C9A', tealInk: '#08716F', mustard: '#F2B705', mustardInk: '#8A6500',
  blue: '#3B5BDB', green: '#1F9D61', red: '#E5402B', orange: '#FF7A3D', purple: '#7B4FD6',
  night: '#1B1924', nightCard: '#262331', nightInk: '#F1EADB', nightInk2: '#B3ADC2', nightPink: '#FF7FA6',
  cover: '#08716F', line: 'rgba(30,27,46,0.35)', tape: 'rgba(242,183,5,0.5)',
};
const FONT = { display: '"Brico", sans-serif', mono: '"DMMono", monospace' };

/* ───────────── math & easing ───────────── */
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const prog = (t, a, b) => clamp((t - a) / (b - a));
const E = {
  lin: (x) => x,
  inQuad: (x) => x * x,
  outQuad: (x) => 1 - (1 - x) * (1 - x),
  inCubic: (x) => x * x * x,
  outCubic: (x) => 1 - Math.pow(1 - x, 3),
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outQuart: (x) => 1 - Math.pow(1 - x, 4),
  inQuart: (x) => x * x * x * x,
  inOutQuart: (x) => (x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2),
  outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inExpo: (x) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
  inOutExpo: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2),
  outBack: (x, s = 1.70158) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2),
  inBack: (x, s = 1.70158) => (s + 1) * x * x * x - s * x * x,
};
/** Damped spring from 0 to 1 starting at time 0 (dt in seconds). */
function spring(dt, freq = 2.2, damp = 7) {
  if (dt <= 0) return 0;
  return 1 - Math.exp(-damp * dt) * Math.cos(TAU * freq * dt);
}
/** Eased tween of t over [a,b] with easing fn. */
const tw = (t, a, b, fn = E.outCubic) => fn(prog(t, a, b));

/* deterministic hash noise */
function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function noise1(x, seed = 0) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash(i + seed * 57.3), hash(i + 1 + seed * 57.3), u) * 2 - 1;
}
/** Decaying shake for impacts at times[]; returns {x,y,r}. */
function shake(t, times, amp = 14, dur = 0.45) {
  let x = 0, y = 0, r = 0;
  for (const t0 of times) {
    const d = t - t0;
    if (d < 0 || d > dur) continue;
    const k = Math.pow(1 - d / dur, 2.2) * amp;
    x += noise1(d * 38, t0) * k;
    y += noise1(d * 41 + 9, t0) * k;
    r += noise1(d * 30 + 3, t0) * k * 0.0009;
  }
  return { x, y, r };
}

/* ───────────── canvas helpers ───────────── */
function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function font(ctx, size, weight = 800, fam = 'display', stretch = 'semi-condensed') {
  ctx.font = `${weight} ${size}px ${FONT[fam]}`;
  ctx.fontStretch = fam === 'display' ? stretch : 'normal';
  ctx.letterSpacing = '0px';
  ctx.fontKerning = 'normal';
}
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
/** Ticket outline with half-circle notches at x = stubX (top and bottom). */
function ticketPath(ctx, x, y, w, h, r, stubX, nr) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  if (stubX != null) {
    ctx.lineTo(x + stubX - nr, y);
    ctx.arc(x + stubX, y, nr, Math.PI, 0, true);
  }
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  if (stubX != null) {
    ctx.lineTo(x + stubX + nr, y + h);
    ctx.arc(x + stubX, y + h, nr, 0, Math.PI, true);
  }
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
/** Side-notched frame (notches on left and right edges at mid height). */
function sideTicketPath(ctx, x, y, w, h, r, nr, ny = 0.5) {
  const my = y + h * ny;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, my - nr);
  ctx.arc(x + w, my, nr, -Math.PI / 2, Math.PI / 2, true);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, my + nr);
  ctx.arc(x, my, nr, Math.PI / 2, -Math.PI / 2, true);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
function dashed(ctx, x1, y1, x2, y2, color = C.line, w = 2.5, dash = [7, 7]) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash); ctx.lineCap = 'butt';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.restore();
}
/** Paper drop shadow: a soft ambient one plus the brand's hard 1.5px ink lip. */
function paperShadow(ctx, pathFn, lift = 1, hard = 0.28) {
  ctx.save();
  ctx.shadowColor = `rgba(30,27,46,${0.16 * lift})`;
  ctx.shadowBlur = 30 * lift;
  ctx.shadowOffsetY = 14 * lift;
  ctx.shadowOffsetX = 4 * lift;
  pathFn();
  ctx.fillStyle = 'rgba(30,27,46,1)';
  ctx.fill();
  ctx.restore();
  if (hard > 0) {
    ctx.save();
    ctx.translate(0, 2);
    pathFn();
    ctx.fillStyle = `rgba(30,27,46,${hard})`;
    ctx.fill();
    ctx.restore();
  }
}

/* ───────────── textures (built once) ───────────── */
const TEX = {};
function buildTextures() {
  // paper fibre + mottling, 1024 tile
  const n = 1024;
  const p = mkCanvas(n, n), g = p.getContext('2d');
  const r = rng(7);
  g.clearRect(0, 0, n, n);
  for (let i = 0; i < 260; i++) {
    const x = r() * n, y = r() * n, rad = 40 + r() * 160;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const a = 0.006 + r() * 0.008;
    grd.addColorStop(0, r() < 0.5 ? `rgba(30,27,46,${a})` : `rgba(255,252,244,${a * 2.0})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    for (const ox of [-n, 0, n]) for (const oy of [-n, 0, n]) { g.save(); g.translate(ox, oy); g.fillRect(x - rad, y - rad, rad * 2, rad * 2); g.restore(); }
  }
  for (let i = 0; i < 2600; i++) {
    const x = r() * n, y = r() * n, l = 3 + r() * 12, a = r() * TAU;
    g.strokeStyle = `rgba(30,27,46,${0.02 + r() * 0.035})`;
    g.lineWidth = 0.6 + r() * 0.7;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(30,27,46,${0.04 + r() * 0.08})`;
    g.fillRect(r() * n, r() * n, 1 + r(), 1 + r());
  }
  TEX.fibre = p;

  // artboard dot screen (7px and 11px grids)
  const d = mkCanvas(77, 77), dg = d.getContext('2d');
  dg.fillStyle = 'rgba(30,27,46,0.07)';
  for (let x = 0; x < 77; x += 7) for (let y = 0; y < 77; y += 7) { dg.beginPath(); dg.arc(x + 1, y + 1, 1.1, 0, TAU); dg.fill(); }
  dg.fillStyle = 'rgba(30,27,46,0.045)';
  for (let x = 0; x < 77; x += 11) for (let y = 0; y < 77; y += 11) { dg.beginPath(); dg.arc(x + 4, y + 6, 1.1, 0, TAU); dg.fill(); }
  TEX.dots = d;

  // film grain frames (animated at 30 fps)
  TEX.grain = [];
  for (let k = 0; k < 6; k++) {
    const gc = mkCanvas(512, 512), gg = gc.getContext('2d');
    const id = gg.createImageData(512, 512);
    const rr = rng(100 + k);
    for (let i = 0; i < id.data.length; i += 4) {
      const v = rr();
      const on = v > 0.5;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = on ? 255 : 0;
      id.data[i + 3] = Math.floor(Math.abs(v - 0.5) * 2 * 20);
    }
    gg.putImageData(id, 0, 0);
    TEX.grain.push(gc);
  }

  // ink speckle mask for stamps (knock-outs)
  const s = mkCanvas(512, 512), sg = s.getContext('2d');
  const rs = rng(31);
  for (let i = 0; i < 1400; i++) {
    sg.fillStyle = `rgba(0,0,0,${0.35 + rs() * 0.65})`;
    sg.beginPath(); sg.arc(rs() * 512, rs() * 512, 0.5 + rs() * 2.4, 0, TAU); sg.fill();
  }
  for (let i = 0; i < 40; i++) {
    sg.strokeStyle = `rgba(0,0,0,${0.2 + rs() * 0.4})`;
    sg.lineWidth = 1 + rs() * 3;
    const x = rs() * 512, y = rs() * 512;
    sg.beginPath(); sg.moveTo(x, y); sg.lineTo(x + 30 + rs() * 90, y + (rs() - 0.5) * 20); sg.stroke();
  }
  TEX.speckle = s;
}

/** Paper background with parallax offset (ox, oy). */
function drawPaper(ctx, ox = 0, oy = 0, base = C.paper, dark = false) {
  ctx.fillStyle = base;
  ctx.fillRect(-200, -200, W + 400, H + 400);
  ctx.save();
  if (dark) ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = dark ? 0.35 : 1;
  const pf = ctx.createPattern(TEX.fibre, 'repeat');
  pf.setTransform(new DOMMatrix().translate(ox * 0.6, oy * 0.6));
  ctx.fillStyle = pf;
  ctx.fillRect(-200, -200, W + 400, H + 400);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = dark ? 0.0 : 1;
  const pd = ctx.createPattern(TEX.dots, 'repeat');
  pd.setTransform(new DOMMatrix().translate(ox, oy));
  ctx.fillStyle = pd;
  ctx.fillRect(-200, -200, W + 400, H + 400);
  ctx.restore();
}
function drawGrainAndVignette(ctx, t, dark = false) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const k = Math.floor(t * 15 + 1e-6);
  const g = TEX.grain[k % TEX.grain.length];
  const pat = ctx.createPattern(g, 'repeat');
  pat.setTransform(new DOMMatrix().translate((k * 137) % 512, (k * 251) % 512).scale(2, 2));
  ctx.globalAlpha = dark ? 0.55 : 0.85;
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 1.05);
  v.addColorStop(0, 'rgba(30,27,46,0)');
  v.addColorStop(1, dark ? 'rgba(5,4,10,0.55)' : 'rgba(60,42,20,0.16)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/* ───────────── typography ───────────── */
/** Mono kicker label with decode scramble. */
function kicker(ctx, text, x, y, t, t0, opts = {}) {
  const dt = t - t0;
  if (dt < 0) return;
  const out = opts.out != null ? prog(t, opts.out, opts.out + 0.3) : 0;
  const size = opts.size || 21;
  const col = opts.color || C.ink;
  font(ctx, size, 500, 'mono');
  ctx.letterSpacing = (opts.ls ?? 4.5) + 'px';
  const glyphs = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#$%';
  const n = text.length;
  const per = opts.speed || 0.018;
  let s = '';
  for (let i = 0; i < n; i++) {
    const ti = dt - i * per;
    const ch = text[i];
    if (ti < 0) break;
    if (ti < 0.12 && ch !== ' ') s += glyphs[Math.floor(hash(i * 13 + Math.floor(t * 40)) * glyphs.length)];
    else s += ch;
  }
  ctx.save();
  ctx.globalAlpha = (opts.alpha ?? 1) * (1 - out);
  ctx.textBaseline = 'middle';
  ctx.textAlign = opts.align || 'left';
  let tx = x;
  if (opts.dot !== false && (opts.align || 'left') === 'left') {
    const p = E.outBack(prog(dt, 0, 0.3));
    ctx.fillStyle = opts.dotColor || C.pink;
    ctx.beginPath(); ctx.arc(x + 6, y, 6.5 * p, 0, TAU); ctx.fill();
    tx = x + 26;
  }
  ctx.fillStyle = col;
  ctx.fillText(s, tx, y + 1 - out * 8);
  ctx.restore();
}

/**
 * Kinetic two-line headline. lines: [{text, color, at}] ; words rise out of a
 * mask with stagger and a riso two-ink misregistration that snaps into place.
 */
function headline(ctx, lines, x, y, t, opts = {}) {
  const size = opts.size || 108;
  const lh = size * (opts.lh || 1.0);
  const out = opts.out;
  const align = opts.align || 'left';
  font(ctx, size, 800, 'display');
  ctx.letterSpacing = (-size * 0.016) + 'px';
  ctx.textBaseline = 'alphabetic';
  lines.forEach((ln, li) => {
    const words = ln.text.split(' ');
    const ly = y + li * lh;
    const sp = ctx.measureText(' ').width * 0.9;
    const widths = words.map((w) => ctx.measureText(w).width);
    const total = widths.reduce((a, b) => a + b, 0) + sp * (words.length - 1);
    let wx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    words.forEach((w, wi) => {
      const t0 = ln.at + wi * (opts.stagger ?? 0.07);
      const p = prog(t, t0, t0 + 0.62);
      if (p <= 0) { wx += widths[wi] + sp; return; }
      const e = E.outExpo(p);
      let dy = (1 - e) * size * 0.95;
      let oa = 1;
      if (out != null) {
        const to = out + (li * words.length + wi) * 0.03;
        const po = E.inCubic(prog(t, to, to + 0.32));
        dy -= po * size * 1.05;
        oa = 1 - po;
      }
      const reg = 1 - spring(t - t0, 1.6, 6.5);
      ctx.save();
      // mask: only the line box shows
      ctx.beginPath();
      ctx.rect(wx - 20, ly - size * 0.98, widths[wi] + 40, size * 1.26);
      ctx.clip();
      ctx.globalAlpha = oa;
      const color = ln.color || C.ink;
      if (Math.abs(reg) > 0.01) {
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = ln.color ? C.teal : C.pink;
        ctx.fillText(w, wx + reg * 16, ly + dy + reg * 9);
        ctx.fillStyle = C.mustard;
        ctx.fillText(w, wx - reg * 12, ly + dy - reg * 6);
        ctx.globalCompositeOperation = 'source-over';
      }
      if (ln.shadow) {
        ctx.fillStyle = ln.shadow;
        ctx.fillText(w, wx + 4, ly + dy + 4);
      }
      ctx.fillStyle = color;
      ctx.fillText(w, wx, ly + dy);
      ctx.restore();
      wx += widths[wi] + sp;
    });
  });
}

/* ───────────── props ───────────── */
/** Translucent tape strip with torn ends. p = 0..1 lay-down progress. */
function tape(ctx, x, y, w, h, rot, p = 1, color = C.tape) {
  if (p <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const s = lerp(1.25, 1, E.outCubic(p));
  ctx.scale(s, s);
  ctx.globalAlpha = clamp(p * 1.6);
  ctx.beginPath();
  const teeth = 6;
  ctx.moveTo(-w / 2, -h / 2);
  for (let i = 0; i <= teeth; i++) ctx.lineTo(-w / 2 + (i % 2 ? 4 : 0), -h / 2 + (h * i) / teeth);
  ctx.lineTo(w / 2, h / 2);
  for (let i = teeth; i >= 0; i--) ctx.lineTo(w / 2 - (i % 2 ? 4 : 0), -h / 2 + (h * i) / teeth);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(-w / 2 + 4, -h / 2 + 3, w - 8, h * 0.28);
  ctx.restore();
}

/**
 * Rubber stamp. p = time since the slam (s). Before the slam (p<0) it hovers
 * above (bigger, transparent). Ink texture via the speckle mask.
 */
const STAMP_CACHE = new Map();
function stampImage(text, color, opts) {
  const key = text + color + JSON.stringify(opts);
  if (STAMP_CACHE.has(key)) return STAMP_CACHE.get(key);
  const size = opts.size || 64;
  const c0 = mkCanvas(10, 10).getContext('2d');
  font(c0, size, 800, opts.mono ? 'mono' : 'display', 'condensed');
  c0.letterSpacing = (opts.mono ? 6 : 2) + 'px';
  const tw0 = c0.measureText(text).width;
  const padX = size * 0.45, padY = size * 0.28;
  const w = Math.ceil(tw0 + padX * 2 + 20), h = Math.ceil(size + padY * 2 + 20);
  const round = opts.round;
  const cw = round ? Math.max(w, h) + 20 : w, ch = round ? cw : h;
  const cv = mkCanvas(cw, ch), g = cv.getContext('2d');
  g.translate(cw / 2, ch / 2);
  g.strokeStyle = color; g.fillStyle = color;
  if (round) {
    const R = cw / 2 - 12;
    g.lineWidth = size * 0.09;
    g.beginPath(); g.arc(0, 0, R, 0, TAU); g.stroke();
    g.lineWidth = size * 0.045;
    g.beginPath(); g.arc(0, 0, R - size * 0.18, 0, TAU); g.stroke();
  } else {
    g.lineWidth = size * 0.085;
    g.beginPath(); g.roundRect(-w / 2 + 10, -h / 2 + 10, w - 20, h - 20, size * 0.16); g.stroke();
    g.lineWidth = size * 0.035;
    g.beginPath(); g.roundRect(-w / 2 + 10 + size * 0.14, -h / 2 + 10 + size * 0.14, w - 20 - size * 0.28, h - 20 - size * 0.28, size * 0.1); g.stroke();
  }
  font(g, size, 800, opts.mono ? 'mono' : 'display', 'condensed');
  g.letterSpacing = (opts.mono ? 6 : 2) + 'px';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 3, size * 0.06);
  // knock out speckles
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-out';
  const pat = g.createPattern(TEX.speckle, 'repeat');
  pat.setTransform(new DOMMatrix().translate(hash(text.length * 3) * 400, hash(text.length * 7) * 400));
  g.fillStyle = pat;
  g.fillRect(0, 0, cw, ch);
  STAMP_CACHE.set(key, cv);
  return cv;
}
function stamp(ctx, text, x, y, rot, dt, color, opts = {}) {
  if (dt < -0.18) return;
  const img = stampImage(text, color, opts);
  const scale = opts.scale || 1;
  let s, a;
  if (dt < 0) {
    const k = prog(dt, -0.18, 0);
    s = lerp(1.9, 1.0, E.inQuad(k));
    a = k * 0.5;
  } else {
    s = 1 + 0.07 * Math.exp(-dt * 10) * Math.cos(dt * 40);
    a = 1;
    if (opts.fade != null) a *= 1 - prog(dt, opts.fade, opts.fade + 0.3);
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(s * scale, s * scale);
  ctx.globalAlpha = a * (opts.alpha ?? 0.92);
  ctx.globalCompositeOperation = opts.blend || 'multiply';
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  ctx.restore();
  // ink splash specks at impact
  if (dt >= 0 && dt < 0.5 && opts.specks !== false) {
    const r = rng(Math.floor(x * 7 + y));
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = (1 - dt / 0.5) * 0.8;
    for (let i = 0; i < 14; i++) {
      const a0 = r() * TAU, d0 = (img.width * 0.5 + r() * 60) * scale;
      const dd = d0 + E.outExpo(clamp(dt * 3)) * 30 * r();
      ctx.beginPath();
      ctx.arc(x + Math.cos(a0) * dd, y + Math.sin(a0) * dd * 0.6, 1.5 + r() * 4, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** Halftone floor shadow ellipse. */
function halftoneShadow(ctx, cx, cy, rx, ry, alpha = 0.18, sp = 7) {
  ctx.save();
  ctx.fillStyle = C.ink;
  ctx.globalAlpha = alpha;
  for (let x = -rx; x <= rx; x += sp) {
    for (let y = -ry; y <= ry; y += sp) {
      const k = 1 - (x * x) / (rx * rx) - (y * y) / (ry * ry);
      if (k <= 0) continue;
      ctx.beginPath();
      ctx.arc(cx + x, cy + y, sp * 0.48 * Math.sqrt(k), 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Coin character via the art package. o: {look, r, expr, lookX, lookY, time, sx, sy, rot, alpha} */
function coin(ctx, x, y, o) {
  const A = window.SlanaArt;
  ctx.save();
  ctx.translate(x, y);
  if (o.rot) ctx.rotate(o.rot);
  ctx.scale(o.sx ?? 1, o.sy ?? 1);
  if (o.alpha != null) ctx.globalAlpha = o.alpha;
  A.drawRisoCoin(ctx, o.look, o.r, {
    time: (o.time ?? 0) * 1000,
    lookX: o.lookX ?? 0, lookY: o.lookY ?? 0,
    expression: o.expr || 'happy',
    pxPerUnit: 1, seed: o.seed ?? 0,
    flags: o.flags ?? 0,
  });
  ctx.restore();
}

/** The brand mark: pink disc overprinted on teal, with an ink ring. */
function brandMark(ctx, x, y, r, misreg = 1, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const tx = x + r * 0.2 * misreg, ty = y + r * 0.2 * misreg;
  ctx.fillStyle = C.teal;
  ctx.beginPath(); ctx.arc(tx, ty, r, 0, TAU); ctx.fill();
  ctx.fillStyle = C.pink;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  // overprint: pink x teal where the two inks overlap
  ctx.save();
  ctx.beginPath(); ctx.arc(tx, ty, r, 0, TAU); ctx.clip();
  ctx.fillStyle = '#0E3052';
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(30,27,46,0.5)';
  ctx.lineWidth = r * 0.107;
  ctx.beginPath(); ctx.arc(x, y, r * 0.667, 0, TAU); ctx.stroke();
  ctx.restore();
}

/**
 * The slana wordmark (artboard: 800 weight, 85% stretch, -2px @46px) with
 * the mark at its top right. reg: 0 = in register, 1 = full misregistration.
 * Returns the mark centre in local coords for match cuts.
 */
function wordmarkMetrics(ctx, size) {
  font(ctx, size, 800, 'display', 'semi-condensed');
  ctx.letterSpacing = (-size * 0.045) + 'px';
  const w = ctx.measureText('slana').width;
  const mr = size * 0.29;
  return { w, mr, total: w + mr * 2.1, markX: w + mr * 0.95, markY: -size * 0.74 };
}
function wordmark(ctx, x, y, size, opts = {}) {
  const m = wordmarkMetrics(ctx, size);
  const reg = opts.reg ?? 0;
  const ox = x - (opts.center ? m.total / 2 : 0);
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = opts.alpha ?? 1;
  const layers = opts.layers ?? 1;
  if (opts.ghost !== false) {
    // permanent riso ghost (teal, 5px @ display size) + entry misregistration
    const gx = size * 0.016 + reg * size * 0.12, gy = size * 0.014 + reg * size * 0.06;
    ctx.globalCompositeOperation = opts.dark ? 'source-over' : 'multiply';
    ctx.fillStyle = C.teal;
    ctx.globalAlpha = (opts.alpha ?? 1) * 0.9 * clamp(layers * 3);
    ctx.fillText('slana', ox + gx, y + gy);
    ctx.fillStyle = C.pink;
    ctx.globalAlpha = (opts.alpha ?? 1) * clamp(layers * 3 - 1) * (0.25 + reg * 0.75);
    ctx.fillText('slana', ox - reg * size * 0.09, y - reg * size * 0.05);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.globalAlpha = (opts.alpha ?? 1) * clamp(layers * 3 - 2);
  ctx.fillStyle = opts.color || C.ink;
  ctx.fillText('slana', ox, y);
  ctx.restore();
  if (opts.mark !== false) brandMark(ctx, ox + m.markX, y + m.markY, m.mr, 1, opts.markAlpha ?? opts.alpha ?? 1);
  return { x: ox + m.markX, y: y + m.markY, r: m.mr, w: m.total };
}

/** Number with thousands separators. */
function fmt(n, dec = 0) {
  const s = Math.abs(n).toFixed(dec);
  const [i, d] = s.split('.');
  const ii = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '-' : '') + ii + (d ? '.' + d : '');
}

/** Counter with tabular (fixed-cell) digits so it never jitters while counting. */
function odometer(ctx, value, x, y, size, opts = {}) {
  const dec = opts.dec || 0;
  const s = fmt(value, dec);
  font(ctx, size, opts.weight || 800, opts.mono ? 'mono' : 'display');
  ctx.letterSpacing = '0px';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = opts.color || C.ink;
  ctx.textAlign = 'center';
  const cell = ctx.measureText('0').width * 0.98;
  const sep = ctx.measureText(',').width * 0.9;
  const widths = [...s].map((ch) => (/\d/.test(ch) ? cell : sep));
  const total = widths.reduce((a, b) => a + b, 0);
  let cx = opts.align === 'right' ? x - total : opts.align === 'center' ? x - total / 2 : x;
  [...s].forEach((ch, i) => { ctx.fillText(ch, cx + widths[i] / 2, y); cx += widths[i]; });
  ctx.textAlign = 'left';
  return total;
}

/** Simple confetti/particle burst. Deterministic via seed. */
function burst(ctx, x, y, dt, opts = {}) {
  if (dt < 0 || dt > (opts.life || 1.2)) return;
  const r = rng(opts.seed || 1);
  const n = opts.n || 26;
  const cols = opts.colors || [C.pink, C.teal, C.mustard, C.blue];
  const life = opts.life || 1.2;
  for (let i = 0; i < n; i++) {
    const a = r() * TAU, v = (opts.speed || 700) * (0.35 + r() * 0.65);
    const g = opts.gravity ?? 900;
    const drag = 2.6;
    const k = (1 - Math.exp(-drag * dt)) / drag;
    const px = x + Math.cos(a) * v * k;
    const py = y + Math.sin(a) * v * k + 0.5 * g * dt * dt * 0.6;
    const life_i = life * (0.6 + r() * 0.4);
    const fa = 1 - prog(dt, life_i * 0.6, life_i);
    if (fa <= 0) continue;
    ctx.save();
    ctx.globalAlpha = fa;
    ctx.fillStyle = cols[i % cols.length];
    ctx.translate(px, py);
    ctx.rotate(r() * TAU + dt * (r() - 0.5) * 14);
    const s = (opts.size || 9) * (0.6 + r() * 0.8);
    if (i % 3 === 0) { ctx.beginPath(); ctx.arc(0, 0, s * 0.6, 0, TAU); ctx.fill(); }
    else ctx.fillRect(-s / 2, -s * 0.3, s, s * 0.6 * (1 - Math.abs(Math.sin(dt * 9 + i))) + 1.5);
    ctx.restore();
  }
}

/** Expanding halftone ring shockwave. */
function shockDots(ctx, x, y, dt, color = C.ink, maxR = 900, alpha = 0.22) {
  if (dt < 0 || dt > 0.9) return;
  const p = E.outCubic(dt / 0.9);
  const R = 60 + p * maxR;
  const n = Math.floor(R * 0.11);
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha * (1 - p);
  for (let ring = 0; ring < 3; ring++) {
    const rr = R - ring * 26;
    if (rr <= 0) continue;
    const m = Math.floor(n * (rr / R));
    for (let i = 0; i < m; i++) {
      const a = (i / m) * TAU + ring * 0.2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr, 3.4 - ring, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Barcode. */
function barcode(ctx, x, y, w, h, seed = 3, color = C.ink) {
  const r = rng(seed);
  ctx.fillStyle = color;
  let cx = x;
  while (cx < x + w) {
    const bw = 1.5 + Math.floor(r() * 4) * 1.4;
    if (r() > 0.42) ctx.fillRect(cx, y, bw, h);
    cx += bw + 1.2;
  }
}

/** Noisy organic radius for ink blobs / burn fronts. */
function blobPath(ctx, x, y, R, seed, rough = 0.08, steps = 120, phase = 0) {
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * TAU;
    const nn = noise1(a * 3 + seed, seed) * 0.6 + noise1(a * 9 + seed * 2, seed + 1) * 0.3 + noise1(a * 23 + phase, seed + 2) * 0.1;
    const rr = R * (1 + nn * rough);
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

Object.assign(window, {
  W, H, TAU, C, FONT, clamp, lerp, prog, E, spring, tw, hash, rng, noise1, shake,
  mkCanvas, font, rrect, ticketPath, sideTicketPath, dashed, paperShadow, TEX, buildTextures,
  drawPaper, drawGrainAndVignette, kicker, headline, tape, stamp, stampImage, halftoneShadow,
  coin, brandMark, wordmark, wordmarkMetrics, fmt, odometer, burst, shockDots, barcode, blobPath,
});
