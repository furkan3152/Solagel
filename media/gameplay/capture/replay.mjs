#!/usr/bin/env node
// Deterministic capture, part 2: renders a journal take (capture/journal.mjs) frame by frame.
//
// A fresh page gets the take's WebSockets, fetch answers and input events on a virtual clock. The
// clock only moves when this script steps it, so every frame is rendered at an exact time (1/60 s
// apart, or 1/240 s inside slow-motion windows) however long the frame takes to draw and
// screenshot. Fast-forward (between the wanted ranges) runs at 20 Hz without drawing.
//
// Output, in the take folder (the same shape as a screencast take, so the edit kit reads it):
//   video.mkv   the frames in order (H.264, CRF 14, one frame per captured time)
//   frames.json take time of each frame (seconds from the take's t0)
//   pts.json    each frame's PTS in video.mkv
//   fsamples.json  per-frame telemetry (my coin on screen, the camera, nearby coins)
//   events.json  gains `scale` (pixels per CSS px of the frames)
//
//   node replay.mjs <take> --ranges 12.5-20@60,30-31.5@240 [--scale 1.5] [--q 90]
//   node replay.mjs <take> --edit a.json[,b.json] [--pad 0.6] [--slow 240]
// With --edit the ranges are every source span of this take an edit uses (padded, merged), at
// 60 fps, and at --slow fps where a shot plays slower than 0.75x.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { BASE, CHROME, FFMPEG, ROOT, TAKES, log, setupContext } from './lib.mjs';
import { replayShim } from './journal.mjs';

const require = createRequire(resolve(ROOT, 'apps/web/package.json'));
const { chromium } = require('playwright');
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const NAME = argv[0];
const DIR = resolve(TAKES, NAME);
const SCALE = Number(opt('--scale', '1.5'));
const Q = Number(opt('--q', '90'));
const meta = JSON.parse(readFileSync(resolve(DIR, 'events.json'), 'utf8'));
if (!meta.journal) throw new Error(`${NAME} is not a journal take`);

// ── ranges (take seconds) ──
let ranges = [];
if (opt('--ranges')) {
  ranges = opt('--ranges').split(',').map((r) => { const [span, fps = '60'] = r.split('@'); const [a, b] = span.split('-').map(Number); return { a, b, fps: Number(fps) }; });
} else if (opt('--edit')) {
  const pad = Number(opt('--pad', '0.6')), slow = Number(opt('--slow', '240'));
  var exactTimes = [];
  const spans = [];
  for (const p of opt('--edit').split(',')) {
    const ed = JSON.parse(readFileSync(p, 'utf8'));
    for (const s of ed.audioShots) {
      if (s.take !== NAME || !s.map.length) continue;
      const src = s.map.map((m) => m[1]);
      // slow stretches (source advancing slower than 0.75x output) get the fine grid
      for (let i = 0; i + 1 < s.map.length; ) {
        const rate = (s.map[i + 1][1] - s.map[i][1]) / Math.max(1e-6, s.map[i + 1][0] - s.map[i][0]);
        let j = i + 1;
        const isSlow = rate < 0.75;
        while (j + 1 < s.map.length && (((s.map[j + 1][1] - s.map[j][1]) / Math.max(1e-6, s.map[j + 1][0] - s.map[j][0])) < 0.75) === isSlow) j++;
        spans.push({ a: Math.min(s.map[i][1], s.map[j][1]), b: Math.max(s.map[i][1], s.map[j][1]), fps: isSlow ? slow : 60 });
        i = j;
      }
      spans.push({ a: Math.min(...src) - pad, b: Math.max(...src) + pad, fps: 60 });
      // and the exact source time of every output frame (speed ramps land on real frames)
      for (const x of src) exactTimes.push(x);
    }
  }
  // the 60 fps cover first, merged; then the fine windows split into it
  const cover = spans.filter((s) => s.fps === 60).sort((x, y) => x.a - y.a);
  const merged = [];
  for (const s of cover) { const l = merged[merged.length - 1]; if (l && s.a <= l.b + 2.5) l.b = Math.max(l.b, s.b); else merged.push({ ...s }); }
  ranges = merged;
  const fine = spans.filter((s) => s.fps !== 60).map((s) => ({ ...s, a: s.a - 0.05, b: s.b + 0.05 }));
  ranges.fine = fine;
}
if (!ranges.length) throw new Error('no ranges');

// ── journal ──
const T0 = meta.t0 * 1000; // Date ms of take time 0
const ws = {}; const msgs = []; const fetches = []; const inputs = [];
let clock = null;
const rl = createInterface({ input: createReadStream(resolve(DIR, meta.journal)), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  const e = JSON.parse(line);
  if (e.k === 'clock') { if (clock) log('WARN second document in the journal'); clock ||= e; }
  else if (e.k === 'ws') ws[e.key] = { t: e.t };
  else if (e.k === 'wsopen') (ws[e.key] ||= {}).open = e.t;
  else if (e.k === 'wsclose') msgs.push(e);
  else if (e.k === 'm') msgs.push(e);
  else if (e.k === 'fetch') fetches.push(e);
  else if (e.k === 'in') inputs.push(e);
}
msgs.sort((a, b) => a.t - b.t);
inputs.sort((a, b) => a.t - b.t);
const E = clock.date - clock.perf;
const vOf = (t) => T0 + t * 1000 - E; // take seconds -> virtual ms
const tOf = (v) => (v + E - T0) / 1000;
log(`${NAME}: ${msgs.length} messages, ${fetches.length} fetches, ${inputs.length} inputs; journal ${tOf(clock.perf).toFixed(1)}s..`);

// the capture schedule: [virtual ms, capture?] in order
const times = [];
for (const r of ranges) {
  const step = 1000 / r.fps;
  for (let v = vOf(r.a); v <= vOf(r.b) + 1e-6; v += step) times.push(v);
}
for (const r of ranges.fine || []) {
  const step = 1000 / r.fps;
  for (let v = vOf(r.a); v <= vOf(r.b) + 1e-6; v += step) times.push(v);
}
for (const t of (typeof exactTimes !== 'undefined' ? exactTimes : [])) times.push(vOf(t));
// exact grid: round each time to the take's 1/240 s lattice
const lat = (v) => vOf(Math.round(tOf(v) * 240) / 240);
const want = [...new Set(times.map((v) => +lat(v).toFixed(3)))].sort((a, b) => a - b);
log(`${NAME}: ${want.length} frames to capture in ${ranges.length} ranges (+${(ranges.fine || []).length} slow windows)`);

// ── page ──
const browser = await chromium.launch({ executablePath: CHROME, args: ['--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--disable-smooth-scrolling', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--force-color-profile=srgb', '--font-render-hinting=none'] });
const po = meta.player;
const ctx = await browser.newContext({ viewport: { width: meta.w, height: meta.h }, deviceScaleFactor: SCALE, locale: 'en-US' });
const wsMeta = {};
for (const [k, v] of Object.entries(ws)) wsMeta[k] = { open: v.open ?? null };
await ctx.addInitScript(replayShim, { V0: clock.perf, E, ws: wsMeta, fetches: fetches.map((f) => ({ ...f })) });
await setupContext(ctx, po);
const page = await ctx.newPage();
let pageErrors = 0;
page.on('pageerror', (e) => { if (pageErrors++ < 8) log('[pageerror]', e.message); });
await page.goto(BASE, { waitUntil: 'load' });
const cdp = await ctx.newCDPSession(page);

let mi = 0, ii = 0, V = clock.perf, drawing = true;
const due = (toV) => { const out = []; while (mi < msgs.length && msgs[mi].t <= toV) out.push(msgs[mi++]); return out; };
async function dispatch(e) {
  const m = page.mouse;
  if (e.type === 'mousemove') await m.move(e.x, e.y);
  else if (e.type === 'mousedown') { await m.move(e.x, e.y); await m.down({ button: ['left', 'middle', 'right'][e.b] || 'left' }); }
  else if (e.type === 'mouseup') { await m.move(e.x, e.y); await m.up({ button: ['left', 'middle', 'right'][e.b] || 'left' }); }
  else if (e.type === 'wheel') { await m.move(e.x, e.y); await m.wheel(e.dx, e.dy); }
  else if (e.type === 'keydown' && !e.rep) await page.keyboard.down(e.code || e.key).catch(() => {});
  else if (e.type === 'keyup') await page.keyboard.up(e.code || e.key).catch(() => {});
}
async function setDraw(on) {
  if (on === drawing) return;
  const ok = await page.evaluate((on) => {
    const e = window.__elymum?.engine;
    if (!e) return false;
    const r = e.renderer;
    if (!r.__draw) { r.__draw = r.draw; r.__mm = r.drawMinimap; }
    r.draw = on ? r.__draw : () => {};
    r.drawMinimap = on ? r.__mm : () => {};
    return true;
  }, on);
  if (ok) drawing = on;
}
/** Moves the virtual clock to toV (inputs at their own times), then runs one display frame. */
async function step(toV) {
  while (ii < inputs.length && inputs[ii].t <= toV) {
    const e = inputs[ii++];
    await page.evaluate(([v, m]) => window.__replay.advance(v, m), [e.t, due(e.t)]);
    await dispatch(e);
  }
  await page.evaluate(([v, m]) => window.__replay.advance(v, m), [toV, due(toV)]);
  await page.evaluate(() => window.__replay.frame());
  V = toV;
}

const enc = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', '-',
  '-c:v', 'libx264', '-preset', 'faster', '-crf', '14', '-pix_fmt', 'yuv420p', '-g', '30', '-r', '30', resolve(DIR, 'video.mkv')], { stdio: ['pipe', 'inherit', 'inherit'] });
const frameTimes = [], fsamples = [];
const tStart = Date.now();
const PRE = 1500; // ms drawn before a range starts (the renderer's own easing settles)
for (let k = 0; k < want.length; k++) {
  const target = want[k];
  // fast-forward (no drawing) up to the pre-roll, then 60 Hz with drawing
  if (target - V > PRE + 100) {
    await setDraw(false);
    // in-page stepping between input events (one round trip per stretch, not per frame)
    const goal = target - PRE;
    while (goal - V > 1) {
      const nextIn = ii < inputs.length ? inputs[ii].t : Infinity;
      const to = Math.min(goal, nextIn);
      if (to > V) { await page.evaluate(([v, m]) => window.__replay.ffwd(v, m, 50), [to, due(to)]); V = to; }
      if (nextIn <= goal) { const ev = inputs[ii++]; await dispatch(ev); }
    }
  }
  await setDraw(true);
  while (target - V > 1000 / 60 + 0.5) await step(V + 1000 / 60);
  await step(target);
  await page.evaluate(() => window.__replay.paint());
  const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: Q, optimizeForSpeed: true, clip: { x: 0, y: 0, width: meta.w, height: meta.h, scale: SCALE } });
  const buf = Buffer.from(shot.data, 'base64');
  if (!enc.stdin.write(buf)) await new Promise((r) => enc.stdin.once('drain', r));
  frameTimes.push(+tOf(target).toFixed(5));
  fsamples.push(await page.evaluate(() => {
    const s = window.__sample ? window.__sample() : {};
    const c = window.__elymum?.engine?.camera, w = window.__elymum?.engine?.world;
    return { me: s.me, screen: s.screen, near: s.near, cam: c ? [c.x, c.y, c.zoom] : null, world: w ? [w.width, w.height] : null, hud: s.hud ? { value: s.hud.value, rank: s.hud.rank } : null };
  }));
  if (k % 120 === 0) {
    const el = (Date.now() - tStart) / 1000;
    log(`${NAME}: frame ${k}/${want.length} t=${tOf(target).toFixed(2)}s  ${(k / Math.max(1, el)).toFixed(1)} fps  eta ${((want.length - k) / Math.max(0.1, k / Math.max(1, el)) / 60).toFixed(1)} min`);
  }
}
enc.stdin.end();
await new Promise((r) => enc.on('close', r));
const errs = await page.evaluate(() => window.__replay.errors);
await browser.close();
writeFileSync(resolve(DIR, 'frames.json'), JSON.stringify(frameTimes));
writeFileSync(resolve(DIR, 'pts.json'), JSON.stringify(frameTimes.map((_, i) => +(i / 30).toFixed(5))));
writeFileSync(resolve(DIR, 'fsamples.json'), JSON.stringify(fsamples));
writeFileSync(resolve(DIR, 'events.json'), JSON.stringify({ ...meta, scale: SCALE, replayed: { ranges, frames: frameTimes.length } }));
log(`${NAME}: ${frameTimes.length} frames in ${((Date.now() - tStart) / 60000).toFixed(1)} min; page errors ${pageErrors}, callback errors ${errs}`);
