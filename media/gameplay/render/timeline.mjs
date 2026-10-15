// Edit-decision toolkit shared by the gameplay and how-to-play edits.
//
// An edit script builds a timeline of shots (pieces of recorded takes) and graphics, then
// `build()` resolves every output frame to {take, source time, crop} and writes edit.json for
// render/overlays.mjs (graphics), render/compose.py (picture) and render/audio.py (sound).
//
// Shots
//   take   take folder name in media/gameplay/cache/takes
//   from   source second the shot starts at
//   dur    output seconds
//   speed  1 | number | [[u, speed], ...] keyframes over output time u (smoothstep between);
//          source time is the integral, so ramps are continuous. 0 = freeze.
//   zoom   base reframing zoom (1 = the full recorded frame)
//   cam    'auto' (follow Daphne, lean toward nearby prey, threats and loot) | 'center' |
//          {x, y} (fixed source point) | [[u, x, y, zoom], ...] keyframes (eased)
//   punch  [[u, zoom, attack, hold, release], ...] punch-ins multiplied onto the zoom
//   shake  [[u, amp], ...] decaying camera shake (output px)
//   blend  true: blend neighbouring source frames (smooth slow motion)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../../..');
export const TAKES = resolve(ROOT, 'media/gameplay/cache/takes');

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (t) => t * t * (3 - 2 * t);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const takeCache = new Map();
export function take(name) {
  if (!takeCache.has(name)) {
    const ev = JSON.parse(readFileSync(resolve(TAKES, name, 'events.json'), 'utf8'));
    let frames = [];
    try { frames = JSON.parse(readFileSync(resolve(TAKES, name, 'frames.json'), 'utf8')); } catch {}
    takeCache.set(name, { ...ev, frameTimes: frames });
  }
  return takeCache.get(name);
}
/** Time of a mark (label) in a take. */
export function mark(name, label, nth = 0) {
  const m = take(name).marks.filter((x) => x.label === label)[nth];
  if (!m) throw new Error(`no mark ${label} in ${name}`);
  return m.t;
}
/** Events of a kind (and an optional predicate on the value). */
export function events(name, k, pred = () => true) {
  return take(name).events.filter((e) => e.k === k && pred(e.v));
}
/** The telemetry sample at source time t (linear between samples). */
export function sampleAt(name, t) {
  const ss = take(name).samples;
  let lo = 0, hi = ss.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ss[mid].t <= t) lo = mid; else hi = mid; }
  const a = ss[lo], b = ss[hi];
  if (!a) return null;
  if (!b || !a.me || !b.me || b.t === a.t) return a;
  const k = clamp((t - a.t) / (b.t - a.t), 0, 1);
  const me = { ...a.me, x: a.me.x + (b.me.x - a.me.x) * k, y: a.me.y + (b.me.y - a.me.y) * k, r: a.me.r + (b.me.r - a.me.r) * k };
  return { ...a, me, mouse: a.mouse && b.mouse ? { x: a.mouse.x + (b.mouse.x - a.mouse.x) * k, y: a.mouse.y + (b.mouse.y - a.mouse.y) * k } : a.mouse };
}

function speedAt(sp, u) {
  if (typeof sp === 'number') return sp;
  if (!sp || !sp.length) return 1;
  if (u <= sp[0][0]) return sp[0][1];
  for (let i = 1; i < sp.length; i++) {
    if (u <= sp[i][0]) { const k = smooth((u - sp[i - 1][0]) / (sp[i][0] - sp[i - 1][0] || 1)); return sp[i - 1][1] + (sp[i][1] - sp[i - 1][1]) * k; }
  }
  return sp[sp.length - 1][1];
}
function punchAt(pu, u) {
  let z = 1;
  for (const [u0, zoom, a = 0.18, h = 0.6, r = 0.45] of pu || []) {
    const d = u - u0;
    if (d < 0 || d > a + h + r) continue;
    const k = d < a ? ease(d / a) : d < a + h ? 1 : 1 - ease((d - a - h) / r);
    z *= 1 + (zoom - 1) * k;
  }
  return z;
}
function shakeAt(sh, u) {
  let x = 0, y = 0;
  for (const [u0, amp = 14] of sh || []) {
    const d = u - u0;
    if (d < 0 || d > 0.6) continue;
    const k = amp * Math.exp(-d / 0.14);
    x += k * Math.sin(d * 91 + u0 * 7);
    y += k * Math.cos(d * 77 + u0 * 3);
  }
  return [x, y];
}

export class Edit {
  constructor({ name, fps = 30, w = 1920, h = 1080 } = {}) {
    Object.assign(this, { name, fps, w, h });
    this.t = 0;
    this.shots = [];
    this.items = [];
    this.sfx = [];
    this.vo = [];
    this.music = [];
    this.notes = [];
    this.n = 0;
  }
  /** Moves the cursor. */
  at(t) { this.t = t; return this; }
  gap(d) { this.t += d; return this; }
  /** Adds a shot at the cursor and advances it. */
  shot(o) {
    const s = { zoom: 1.0, cam: 'auto', speed: 1, ...o, start: o.start ?? this.t };
    s.end = s.start + s.dur;
    if (o.start == null) this.t = s.end;
    this.shots.push(s);
    this.resolveShot(s);
    return s;
  }
  /** An overlay graphic. */
  add(type, start, dur, props = {}, z = 10) {
    this.items.push({ id: `${type}${this.n++}`, type, start: +start.toFixed(4), dur, z, props });
    return this;
  }
  /** A sound cue: type is a synth name in render/sfx.py, or {file}. */
  cue(type, t, gain = 1, extra = {}) { this.sfx.push({ type, at: +t.toFixed(4), gain, ...extra }); return this; }
  voice(id, t, gain = 1) { this.vo.push({ id, at: +t.toFixed(4), gain }); return this; }
  note(t, text) { this.notes.push([+t.toFixed(2), text]); return this; }

  /** Per-frame source time and crop for one shot. */
  resolveShot(s) {
    const n = Math.round(s.dur * this.fps);
    const T = take(s.take);
    const W = T.w || this.w, H = T.h || this.h;
    s.frames = [];
    let src = s.from;
    let cx = null, cy = null, vx = 0, vy = 0;
    const dt = 1 / this.fps;
    for (let k = 0; k < n; k++) {
      const u = k / this.fps;
      // target framing
      let tx = W / 2, ty = H / 2, zoom = s.zoom;
      if (Array.isArray(s.cam)) {
        const ks = s.cam;
        let a = ks[0], b = ks[ks.length - 1];
        for (let i = 1; i < ks.length; i++) if (u <= ks[i][0]) { a = ks[i - 1]; b = ks[i]; break; }
        const kk = b[0] === a[0] ? 1 : ease(clamp((u - a[0]) / (b[0] - a[0]), 0, 1));
        tx = a[1] + (b[1] - a[1]) * kk; ty = a[2] + (b[2] - a[2]) * kk; zoom = a[3] + (b[3] - a[3]) * kk;
      } else if (s.cam && typeof s.cam === 'object') {
        tx = s.cam.x; ty = s.cam.y;
      } else if (s.cam === 'auto') {
        const sm = sampleAt(s.take, src);
        if (sm && sm.me && (sm.screen === 'playing' || sm.screen === 'cashedout')) {
          tx = sm.me.x; ty = sm.me.y;
          const near = (sm.near || []).filter((q) => (q[0] === 'p' && q[4] > 0) || q[0] === 'T' || q[0] === 'l').filter((q) => Math.hypot(q[1] - sm.me.x, q[2] - sm.me.y) < 420 + sm.me.r);
          if (near.length) {
            const ax = near.reduce((a, q) => a + q[1], 0) / near.length, ay = near.reduce((a, q) => a + q[2], 0) / near.length;
            tx = tx * 0.65 + ax * 0.35; ty = ty * 0.65 + ay * 0.35;
          }
          tx += s.lead?.[0] || 0; ty += s.lead?.[1] || 0;
        }
      }
      zoom *= punchAt(s.punch, u);
      // critically damped follow (auto only); keyframed and fixed cams are exact
      if (s.cam === 'auto') {
        if (cx === null) { cx = tx; cy = ty; }
        const w0 = 2 * Math.PI / (s.lag ?? 0.9);
        const ax = w0 * w0 * (tx - cx) - 2 * w0 * vx, ay = w0 * w0 * (ty - cy) - 2 * w0 * vy;
        vx += ax * dt; vy += ay * dt; cx += vx * dt; cy += vy * dt;
      } else { cx = tx; cy = ty; }
      const [sx, sy] = shakeAt(s.shake, u);
      const cw = W / zoom, ch = H / zoom;
      const fx = clamp(cx, cw / 2, W - cw / 2) - sx / zoom, fy = clamp(cy, ch / 2, H - ch / 2) - sy / zoom;
      s.frames.push([+src.toFixed(4), +fx.toFixed(2), +fy.toFixed(2), +zoom.toFixed(4)]);
      src += speedAt(s.speed, u + dt / 2) * dt;
    }
    s.srcEnd = src;
    return s;
  }

  /** Output-pixel position of a source-pixel point during a shot at output time t. */
  project(s, t, x, y) {
    const k = clamp(Math.round((t - s.start) * this.fps), 0, s.frames.length - 1);
    const [, cx, cy, z] = s.frames[k];
    return [(x - cx) * z + this.w / 2, (y - cy) * z + this.h / 2, z];
  }
  /** A ring track on Daphne for an overlay item starting at t0 (output time), dur seconds. */
  trackMe(s, t0, dur, step = 1 / 15) {
    const out = [];
    for (let lt = 0; lt <= dur + 1e-6; lt += step) {
      const t = t0 + lt;
      const k = clamp(Math.round((t - s.start) * this.fps), 0, s.frames.length - 1);
      const src = s.frames[k][0];
      const sm = sampleAt(s.take, src);
      if (!sm || !sm.me) continue;
      const [x, y, z] = this.project(s, t, sm.me.x, sm.me.y);
      out.push([+lt.toFixed(3), +x.toFixed(1), +y.toFixed(1), +(sm.me.r * z).toFixed(1)]);
    }
    return out;
  }
  /** Output time at which a shot reaches source time `src` (first frame at or after it). */
  timeOf(s, src) {
    for (let k = 0; k < s.frames.length; k++) if (s.frames[k][0] >= src) return s.start + k / this.fps;
    return s.end;
  }

  build(out) {
    const N = Math.round(Math.max(this.t, ...this.shots.map((s) => s.end), ...this.items.map((i) => i.start + i.dur)) * this.fps);
    const takes = [...new Set(this.shots.map((s) => s.take))];
    const map = new Array(N).fill(null);
    for (const s of this.shots) {
      const f0 = Math.round(s.start * this.fps);
      s.frames.forEach((fr, k) => { if (f0 + k < N) map[f0 + k] = [takes.indexOf(s.take), ...fr, s.blend ? 1 : 0]; });
    }
    const audioShots = this.shots.map((s) => ({
      take: s.take, start: s.start, end: s.end, gain: s.gain ?? 1, mute: !!s.mute,
      // the time map at frame resolution: [output t, source t]
      map: s.frames.map((fr, k) => [+(s.start + k / this.fps).toFixed(4), fr[0]]).concat([[+s.end.toFixed(4), +s.srcEnd.toFixed(4)]]),
    }));
    const data = { name: this.name, fps: this.fps, w: this.w, h: this.h, frames: N, duration: N / this.fps, takes, map, items: this.items, sfx: this.sfx, vo: this.vo, music: this.music, audioShots, notes: this.notes };
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(data));
    return data;
  }
}
