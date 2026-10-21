#!/usr/bin/env node
// Deterministic renderer harness: draws fixed, seeded scenes through the real `Renderer` (loaded
// from the Vite dev server, so `pnpm demo` or `pnpm dev:web` must be running) and
//   - saves one PNG per scene (fixed time, fixed seed) for pixel diffs between two builds;
//   - times the draw *including raster*: every frame ends with a 1 px getImageData, which flushes
//     the canvas, so the cost Chromium pays at commit is counted (headless, CPU raster).
//
//   node apps/web/scripts/perf-scene.mjs shots <outDir>            PNGs + timings (timings.json)
//   node apps/web/scripts/perf-scene.mjs diff <dirA> <dirB> [diffDir]   per-scene pixel diff
//
// Options: --url http://localhost:5173  --frames 120  --scenes a,b
//          --gpu  SwiftShader GL (accelerated canvas, emulated on the CPU)  --raf  time rAF intervals
//          --world dump.json[,dump2.json]  adds scenes replaying worlds dumped by `perf.mjs --dump`
//                                          (real game content, drawn at the same fixed time)
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const BASE = opt('--url', 'http://localhost:5173');
const FRAMES = Number(opt('--frames', '120'));
const CHROME = process.env.CHROME_PATH;
const [cmd, a, b, c] = argv.filter((x, i) => !x.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));

/**
 * Scenes: viewport, device scale, camera and world recipe. `zoom` is world → CSS px. The world
 * is built from a seeded PRNG, so every run draws the same thing.
 */
const SCENES = {
  'desktop-play': { w: 1920, h: 1080, dsf: 1, zoom: 0.9, food: 400, cells: 26, theme: 'light', quality: 'high' },
  'desktop-wide': { w: 1920, h: 1080, dsf: 1, zoom: 0.38, food: 1600, cells: 60, theme: 'light', quality: 'high' },
  'desktop-night': { w: 1920, h: 1080, dsf: 1, zoom: 0.7, food: 900, cells: 30, theme: 'dark', quality: 'high' },
  'desktop-low': { w: 1920, h: 1080, dsf: 1, zoom: 0.7, food: 900, cells: 30, theme: 'light', quality: 'low' },
  'desktop-reduced': { w: 1920, h: 1080, dsf: 1, zoom: 0.7, food: 900, cells: 30, theme: 'light', quality: 'high', reduced: true },
  'desktop-edge': { w: 1920, h: 1080, dsf: 1, zoom: 0.6, food: 500, cells: 20, theme: 'light', quality: 'high', cx: 300, cy: 400 },
  'phone-play': { w: 390, h: 844, dsf: 3, mobile: true, zoom: 0.55, food: 700, cells: 26, theme: 'light', quality: 'high' },
};

// --scene-json '{"name":{...}}' replaces the scene list (for experiments)
if (opt('--scene-json', null)) Object.assign(SCENES, Object.fromEntries(Object.keys(SCENES).map((k) => [k, undefined])), JSON.parse(opt('--scene-json')));

for (const f of opt('--world', '').split(',').filter(Boolean)) {
  const d = JSON.parse(readFileSync(f, 'utf8'));
  const name = `world-${f.replace(/^.*world-/, '').replace(/\.json$/, '')}`;
  const mobile = d.camera.w < 700;
  // --kinds 1,2: only these entity kinds (cost bisection)
  const kinds = opt('--kinds', null)?.split(',').map(Number) ?? null;
  SCENES[name] = { w: d.camera.w, h: d.camera.h, dsf: mobile ? 3 : 1, mobile, zoom: d.camera.zoom, theme: 'light', quality: opt('--quality', 'high'), world: d, kinds };
}

async function renderScene(page, name, s) {
  return page.evaluate(
    async ({ name, s, frames, raf }) => {
      const [{ Renderer }, { Camera }, { Particles }, { ClientWorld }] = await Promise.all([
        import('/src/render/renderer.ts'),
        import('/src/game/camera.ts'),
        import('/src/game/particles.ts'),
        import('/src/game/state.ts'),
      ]);
      const { JellyBody } = await import('/src/render/jelly.ts');
      let seed = 1234567;
      const rnd = () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647);
      const world = new ClientWorld();
      world.width = world.height = s.world?.width ?? 5600;
      const cx = s.world ? s.world.camera.x : (s.cx ?? 2800);
      const cy = s.world ? s.world.camera.y : (s.cy ?? 2800);
      const spanX = s.w / s.zoom;
      const spanY = s.h / s.zoom;
      const NAMES = ['mochi_moon', 'bonk_bae', 'lil_lamport', 'rug_ruth', 'pixel_penny', 'Daphne', 'whale.sol', 'gm_gm', 'satoshi_snack', 'coinie'];
      let id = 1;
      const ent = (kind, x, y, r, extra = {}) => {
        const e = {
          id: id++, kind, x, y, r, ox: x, oy: y, or: r, nx: x, ny: y, nr: r, t0: 0, playerId: 0, flags: 0, variant: 0,
          born: -100000, dying: 0, eater: 0, dieX: 0, dieY: 0, dieR: 0, jelly: null, vx: 0, vy: 0, seed: rnd(), expression: 'happy', ...extra,
        };
        world.entities.set(e.id, e);
        return e;
      };
      const inView = () => [cx + (rnd() - 0.5) * spanX * 1.1, cy + (rnd() - 0.5) * spanY * 1.1];
      if (s.world) {
        for (const p of s.world.players) world.players.set(p.id, p);
        for (const x of s.world.ents) if (!s.kinds || s.kinds.includes(x.kind)) world.entities.set(x.id, { ...x, x: x.nx, y: x.ny, r: x.nr, ox: x.nx, oy: x.ny, or: x.nr, t0: 0, born: -100000, jelly: x.jelly ? new JellyBody() : null });
      }
      for (let i = 0; i < (s.food ?? 0); i++) {
        const [x, y] = inView();
        const v = rnd() < 0.04 ? 7 : rnd() < 0.08 ? 6 : Math.floor(rnd() * 6);
        ent(2, x, y, v === 7 ? 14 : v === 6 ? 12 : 10, { variant: v });
      }
      if (s.extras !== false && !s.world) {
      for (let i = 0; i < 12; i++) ent(3, ...inView(), 16, { variant: Math.floor(rnd() * 10) });
      for (let i = 0; i < 6; i++) ent(4, ...inView(), 100);
      for (let i = 0; i < 4; i++) ent(5, ...inView(), 34, { variant: i + 1 });
      for (let i = 0; i < 10; i++) ent(6, ...inView(), 18, { variant: i % 4 });
      }
      const exprs = ['happy', 'hungry', 'scared', 'proud', 'happy', 'love'];
      for (let i = 0; i < (s.cells ?? 0); i++) {
        const pid = i + 1;
        world.players.set(pid, { id: pid, skin: i % 12, flags: i % 7 === 0 ? 1 : 0, name: NAMES[i % NAMES.length], emote: null });
        const r = 18 + Math.pow(rnd(), 2.2) * 230;
        const [x, y] = i === 0 ? [cx, cy] : inView();
        const flags = i === 3 ? 1 : i === 5 ? 4 : i === 8 ? 8 : i === 11 ? 16 : 0;
        const e = ent(1, x, y, r, { playerId: pid, flags, jelly: new JellyBody(), expression: exprs[i % exprs.length], vx: (rnd() - 0.5) * 200, vy: (rnd() - 0.5) * 200 });
        e.seed = rnd();
      }
      world.myPid = s.world ? s.world.myPid : 1;

      document.body.innerHTML = '';
      document.body.style.margin = '0';
      const canvas = document.createElement('canvas');
      document.body.appendChild(canvas);
      const renderer = new Renderer(canvas);
      renderer.resize(s.w, s.h);
      const camera = new Camera();
      camera.resize(s.w, s.h);
      camera.x = cx;
      camera.y = cy;
      camera.zoom = s.zoom;
      const particles = new Particles();
      const settings = { name: 'x', skin: 0, theme: s.theme, quality: s.quality, showNames: true, showMass: true, showFps: false, showMinimap: true, showChat: true };
      let rs = 42;
      const rand = () => ((rs = (rs * 16807) % 2147483647), rs / 2147483647);
      const frame = (now, dt) =>
        renderer.draw({ now, dt, world, camera, particles, settings, reduced: !!s.reduced, aim: { x: cx + 300, y: cy - 100 }, coinRain: false, rand, drop: null });
      const ctx = canvas.getContext('2d');
      // warm the caches, then a fixed still frame for the screenshot
      for (let i = 0; i < 5; i++) frame(10000 + i * 16, 1 / 60);
      rs = 42;
      for (const e of world.entities.values()) if (e.jelly) e.jelly = new JellyBody();
      frame(20000, 1 / 60);
      const png = canvas.toDataURL('image/png');
      // timing: draw + flush (1 px readback forces the raster); with `raf`, the interval
      // between animation frames while drawing one frame per rAF (GPU pipelines)
      const times = [];
      if (raf) {
        await new Promise((done) => {
          let i = 0;
          let last = 0;
          const step = (t) => {
            if (last) times.push(t - last);
            last = t;
            frame(30000 + i * 16.7, 1 / 60);
            if (++i <= frames) requestAnimationFrame(step);
            else done();
          };
          requestAnimationFrame(step);
        });
      } else {
        for (let i = 0; i < frames; i++) {
          const t0 = performance.now();
          frame(30000 + i * 16.7, 1 / 60);
          ctx.getImageData(0, 0, 1, 1);
          times.push(performance.now() - t0);
        }
      }
      times.sort((x, y) => x - y);
      const accel = (() => { try { return canvas.getContext('2d').getContextAttributes?.().willReadFrequently === false && !!document.createElement('canvas').getContext('webgl'); } catch { return false; } })();
      return { accel, png, mean: times.reduce((x, y) => x + y, 0) / times.length, p50: times[Math.floor(times.length / 2)], p95: times[Math.floor(times.length * 0.95)], dpr: canvas.width / s.w };
    },
    { name, s, frames: FRAMES, raf: argv.includes('--raf') },
  );
}

async function shots(outDir) {
  mkdirSync(outDir, { recursive: true });
  const only = opt('--scenes', null)?.split(',');
  // --gpu: SwiftShader GL (accelerated canvas, emulated on the CPU); default: CPU raster
  const browser = await chromium.launch({ executablePath: CHROME, args: argv.includes('--gpu') ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--disable-gpu'] });
  const timings = {};
  try {
    for (const [name, s] of Object.entries(SCENES)) {
      if (!s) continue;
      if (only && !only.includes(name)) continue;
      const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: s.dsf, isMobile: !!s.mobile, hasTouch: !!s.mobile });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      // a same-origin document that is not the app (no engine, no second render loop)
      await page.goto(`${BASE}/src/render/looks.ts`, { waitUntil: 'load' });
      const r = await renderScene(page, name, s);
      writeFileSync(join(outDir, `${name}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
      timings[name] = { mean: +r.mean.toFixed(2), p50: +r.p50.toFixed(2), p95: +r.p95.toFixed(2), dpr: r.dpr };
      console.log(`${name.padEnd(16)} draw+raster mean ${r.mean.toFixed(2)} ms  p50 ${r.p50.toFixed(2)}  p95 ${r.p95.toFixed(2)}  (canvas dpr ${r.dpr}, webgl ${r.accel})${errs.length ? '  errors: ' + errs.join(' | ') : ''}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  writeFileSync(join(outDir, 'timings.json'), JSON.stringify(timings, null, 2));
}

async function diff(dirA, dirB, diffDir) {
  if (diffDir) mkdirSync(diffDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--disable-gpu'] });
  const page = await browser.newPage();
  let worst = 0;
  try {
    for (const f of readdirSync(dirA).filter((f) => f.endsWith('.png'))) {
      if (!existsSync(join(dirB, f))) continue;
      const A = `data:image/png;base64,${readFileSync(join(dirA, f)).toString('base64')}`;
      const B = `data:image/png;base64,${readFileSync(join(dirB, f)).toString('base64')}`;
      const r = await page.evaluate(
        async ({ A, B }) => {
          const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = src; });
          const [ia, ib] = await Promise.all([load(A), load(B)]);
          if (ia.width !== ib.width || ia.height !== ib.height) return { size: true };
          const get = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height); };
          const da = get(ia), db = get(ib);
          const out = new ImageData(ia.width, ia.height);
          let n = 0, big = 0, max = 0, sum = 0;
          for (let i = 0; i < da.data.length; i += 4) {
            const d = Math.max(Math.abs(da.data[i] - db.data[i]), Math.abs(da.data[i + 1] - db.data[i + 1]), Math.abs(da.data[i + 2] - db.data[i + 2]));
            sum += d;
            if (d > max) max = d;
            if (d > 2) n++;
            if (d > 24) big++;
            const g = (da.data[i] + da.data[i + 1] + da.data[i + 2]) / 12 + 170;
            out.data[i] = d > 2 ? 255 : g; out.data[i + 1] = d > 2 ? Math.max(0, 200 - d * 3) : g; out.data[i + 2] = d > 2 ? 0 : g; out.data[i + 3] = 255;
          }
          const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height; c.getContext('2d').putImageData(out, 0, 0);
          const px = ia.width * ia.height;
          return { changed: (100 * n) / px, strong: (100 * big) / px, max, meanDelta: sum / px, png: c.toDataURL('image/png') };
        },
        { A, B },
      );
      if (r.size) { console.log(`${f}: size differs`); worst = 100; continue; }
      if (diffDir) writeFileSync(join(diffDir, f), Buffer.from(r.png.split(',')[1], 'base64'));
      worst = Math.max(worst, r.changed);
      console.log(`${f.padEnd(22)} changed(>2/255) ${r.changed.toFixed(3)} %  strong(>24/255) ${r.strong.toFixed(3)} %  max ${r.max}  mean delta ${r.meanDelta.toFixed(3)}`);
    }
  } finally {
    await browser.close();
  }
  return worst;
}

if (cmd === 'shots' && a) await shots(resolve(a));
else if (cmd === 'diff' && a && b) await diff(resolve(a), resolve(b), c && resolve(c));
else {
  console.log('usage: perf-scene.mjs shots <outDir> | diff <dirA> <dirB> [diffDir]');
  process.exit(2);
}
