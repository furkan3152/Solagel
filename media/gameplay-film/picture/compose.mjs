#!/usr/bin/env node
// Lays the rendered frames out in film order and encodes the film with the narrated soundtrack:
// H.264 1920x1080 30 fps CRF 18 + AAC 192k, plus four stills.
//   node compose.mjs [--audio out/work/voice/preview/mix.wav] [--out out/videos/elymum-film-narrated.mp4]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, WORK, log } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const AUDIO = resolve(ROOT, opt('--audio', 'out/work/voice/preview-elymumio/mix.wav'));
const OUT = resolve(ROOT, opt('--out', 'out/videos/elymum-film-narrated.mp4'));
const plan = JSON.parse(readFileSync(resolve(WORK, 'edit/plan.json'), 'utf8'));
const SEQ = resolve(WORK, 'seq');
rmSync(SEQ, { recursive: true, force: true });
mkdirSync(SEQ, { recursive: true });
// frames are looked up by take time (a take's frames may have been rendered for a wider list)
const lists = {};
const idx = (take, t) => {
  const l = (lists[take] ||= JSON.parse(readFileSync(resolve(WORK, 'frames', take, 'times.json'), 'utf8')));
  let lo = 0, hi = l.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (l[m] < t) lo = m + 1; else hi = m; }
  const k = lo > 0 && Math.abs(l[lo - 1] - t) < Math.abs(l[lo] - t) ? lo - 1 : lo;
  if (Math.abs(l[k] - t) > 0.002) throw new Error(`${take}: no frame at ${t}`);
  return k;
};
const src = (fr) => resolve(WORK, 'frames', fr.take, `f${String(idx(fr.take, fr.t)).padStart(5, '0')}.jpg`);
// punch-ins: crop and scale those frames (Lanczos) instead of linking them
const crops = [];
plan.frames.forEach((fr, k) => {
  const out = resolve(SEQ, `f${String(k).padStart(5, '0')}.jpg`);
  if (fr.crop) crops.push([src(fr), out, ...fr.crop]);
  else symlinkSync(src(fr), out);
});
if (crops.length) {
  writeFileSync(resolve(SEQ, 'crops.json'), JSON.stringify(crops));
  execFileSync('python3', ['-c', `import json,sys
from PIL import Image
for a, b, x, y, w, h in json.load(open(sys.argv[1])):
    Image.open(a).crop((x, y, x + w, y + h)).resize((1920, 1080), Image.LANCZOS).save(b, quality=95)`, resolve(SEQ, 'crops.json')], { stdio: 'inherit' });
  log('punch-ins', crops.length);
}
mkdirSync(resolve(OUT, '..'), { recursive: true });
log('encoding', plan.frames.length, 'frames');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(plan.fps), '-i', resolve(SEQ, 'f%05d.jpg'), '-i', AUDIO,
  '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(plan.fps), '-g', String(plan.fps * 2),
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', String(plan.duration), '-movflags', '+faststart', OUT], { stdio: 'inherit' });
// stills: the pond, the mint, the first eat, the PAID report
const stills = [[6.4, 'home'], [35.6, 'mint'], [52.9, 'eat'], [104.5, 'paid']];
stills.forEach(([t, name], i) => {
  const fr = plan.frames[Math.round(t * plan.fps)];
  const png = OUT.replace(/\.mp4$/, `-0${i + 1}-${name}.png`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src(fr), png]);
  log('still', png);
});
log('done', OUT);
