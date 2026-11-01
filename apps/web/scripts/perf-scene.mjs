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
//          --throttle N   CDP CPU throttling (a weak phone's main thread: 4 or 6)
//          --profile      the draw's JS self time by function
//          --budget phone-busy-d3=110,world-practice=90   fail (exit 1) when a scene's draw+raster p50 (ms) is over
//          --alloc-budget 40   fail when a scene allocates more JS than this many KB per frame (sampled)
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
  // a busy arena on a low-end phone: 40 coins, lots of food, DPR 2 and 3 (the canvas caps itself)
  'phone-busy-d2': { w: 390, h: 844, dsf: 2, mobile: true, zoom: 0.42, food: 900, cells: 40, theme: 'light', quality: 'high' },
  'phone-busy-d3': { w: 390, h: 844, dsf: 3, mobile: true, zoom: 0.42, food: 900, cells: 40, theme: 'light', quality: 'high' },
  'phone-busy-fx': { w: 390, h: 844, dsf: 3, mobile: true, zoom: 0.42, food: 900, cells: 40, theme: 'light', quality: 'high', fx: true },
};
/** --throttle N: CDP CPU throttling (a weak phone's main thread); --budget scene=ms,...: fail when a scene's p50 is over. */
const THROTTLE = Number(opt('--throttle', '1'));

// --scene-json '{"name":{...}}' replaces the scene list (for experiments)
if (opt('--scene-json', null)) Object.assign(SCENES, Object.fromEntries(Object.keys(SCENES).map((k) => [k, undefined])), JSON.parse(opt('--scene-json')));

for (const f of opt('--world', '').split(',').filter(Boolean)) {
  const d = JSON.parse(readFileSync(f, 'utf8'));
  const name = `world-${f.replace(/^.*world-/, '').replace(/^.*\//, '').replace(/\.json$/, '')}`;
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
      const NAMES = ['mochi_moon', 'bonk_bae', 'lil_gwei', 'rug_ruth', 'pixel_penny', 'Daphne', 'whale.hype', 'gm_gm', 'satoshi_snack', 'coinie'];
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
      // `level`: an automatic quality level (governor.ts `qualityLevels`) to draw at
      if (s.level) renderer.setLevel(s.level);
      const camera = new Camera();
      camera.resize(s.w, s.h);
      camera.x = cx;
      camera.y = cy;
      camera.zoom = s.zoom;
      const particles = new Particles();
      const settings = { name: 'x', skin: 0, theme: s.theme, quality: s.quality, showNames: !s.noNames, showMass: true, showFps: false, showMinimap: true, showChat: true };
      let rs = 42;
      const rand = () => ((rs = (rs * 16807) % 2147483647), rs / 2147483647);
      if (s.fx) {
        // a busy moment: eat pops, confetti, coin bursts, rings and value stickers on screen
        for (let i = 0; i < 12; i++) {
          const [x, y] = [cx + (rand() - 0.5) * spanX * 0.8, cy + (rand() - 0.5) * spanY * 0.8];
          particles.splat(x, y, '#F2B8C6', 7);
          particles.scraps(x, y, 40, 16);
          if (i % 3 === 0) particles.coinBurst(x, y, 40, 14);
          if (i % 4 === 0) particles.ring(x, y, 50, '#F7C948');
          if (i % 4 === 1) particles.text(x, y, '+' + (i * 37), undefined, 24);
        }
      }
      // one frame input reused (the engine reuses its own too)
      const input = { now: 0, dt: 1 / 60, world, camera, particles, settings, reduced: !!s.reduced, aim: { x: cx + 300, y: cy - 100 }, coinRain: !!s.fx, rand, drop: null };
      const frame = (now, dt) => {
        input.now = now;
        input.dt = dt;
        if (s.fx) particles.update(0);
        renderer.draw(input);
      };
      const ctx = canvas.getContext('2d');
      // warm the caches, then a fixed still frame for the screenshot
      for (let i = 0; i < 5; i++) frame(10000 + i * 16, 1 / 60);
      rs = 42;
      for (const e of world.entities.values()) if (e.jelly) e.jelly = new JellyBody();
      frame(20000, 1 / 60);
      const png = canvas.toDataURL('image/png');
      // timing: draw + flush (1 px readback forces the raster); with `raf`, the interval
      // between animation frames while drawing one frame per rAF (GPU pipelines)
      // frames for the allocation sampler (driven from Node through CDP: see `allocPerFrame`)
      window.__sceneFrames = (n) => {
        for (let i = 0; i < n; i++) frame(40000 + i * 16.7, 1 / 60);
      };
      const allocPerFrame = null;
      const times = [];
      const jsTimes = [];
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
          const t1 = performance.now();
          ctx.getImageData(0, 0, 1, 1);
          times.push(performance.now() - t0);
          jsTimes.push(t1 - t0);
        }
      }
      times.sort((x, y) => x - y);
      jsTimes.sort((x, y) => x - y);
      const accel = (() => { try { return canvas.getContext('2d').getContextAttributes?.().willReadFrequently === false && !!document.createElement('canvas').getContext('webgl'); } catch { return false; } })();
      return { accel, png, mean: times.reduce((x, y) => x + y, 0) / times.length, p50: times[Math.floor(times.length / 2)], p95: times[Math.floor(times.length * 0.95)], js50: jsTimes.length ? jsTimes[Math.floor(jsTimes.length / 2)] : null, allocPerFrame, dpr: canvas.width / s.w };
    },
    { name, s, frames: FRAMES, raf: argv.includes('--raf') },
  );
}

async function shots(outDir) {
  mkdirSync(outDir, { recursive: true });
  const only = opt('--scenes', null)?.split(',');
  // --gpu: SwiftShader GL (accelerated canvas, emulated on the CPU); default: CPU raster
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: [...(argv.includes('--gpu') ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--disable-gpu']), '--enable-precise-memory-info', '--js-flags=--expose-gc'],
  });
  const timings = {};
  try {
    for (const [name, s] of Object.entries(SCENES)) {
      if (!s) continue;
      if (only && !only.includes(name)) continue;
      const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: s.dsf, isMobile: !!s.mobile, hasTouch: !!s.mobile });
      const page = await ctx.newPage();
      if (THROTTLE > 1) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      // a same-origin document that is not the app (no engine, no second render loop)
      await page.goto(`${BASE}/src/render/looks.ts`, { waitUntil: 'load' });
      const r = await renderScene(page, name, s);
      // JS allocation per frame: the sampling heap profiler over 120 more frames (every allocation,
      // collected or not, sampled every 256 bytes on average); a warm-up first so compilation is done
      {
        const cdp = await ctx.newCDPSession(page);
        await page.evaluate(() => window.__sceneFrames(60));
        await cdp.send('HeapProfiler.enable');
        await cdp.send('HeapProfiler.startSampling', { samplingInterval: 256, includeObjectsCollectedByMinorGC: true, includeObjectsCollectedByMajorGC: true });
        await page.evaluate(() => window.__sceneFrames(120));
        const { profile } = await cdp.send('HeapProfiler.stopSampling');
        let bytes = 0;
        const walk = (n) => {
          const f = n.callFrame;
          // the page's own frames only (not the profiler, the compiler or the idle loop)
          if (f.url || f.functionName === 'hypot' || f.functionName === 'random') bytes += n.selfSize;
          for (const c of n.children) walk(c);
        };
        walk(profile.head);
        r.allocPerFrame = bytes / 120;
        // --profile: the draw's JS self time by function (CDP CPU profile over 200 frames)
        if (argv.includes('--profile')) {
          await cdp.send('Profiler.enable');
          await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
          await cdp.send('Profiler.start');
          await page.evaluate(() => window.__sceneFrames(200));
          const { profile: prof } = await cdp.send('Profiler.stop');
          const self = new Map();
          const byId = new Map(prof.nodes.map((n) => [n.id, n]));
          for (let i = 0; i < prof.samples.length; i++) {
            const n = byId.get(prof.samples[i]);
            const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.replace(/^.*\/(src)\//, '$1/').replace(/\?.*$/, '')}:${n.callFrame.lineNumber + 1}`;
            self.set(k, (self.get(k) ?? 0) + (prof.timeDeltas[i + 1] ?? 0));
          }
          const tot = [...self.values()].reduce((a, b) => a + b, 0);
          r.hot = [...self].sort((a, b) => b[1] - a[1]).slice(0, 22).map(([k, us]) => `${((100 * us) / tot).toFixed(1).padStart(5)}%  ${k}`);
        }
      }
      writeFileSync(join(outDir, `${name}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
      if (r.hot) console.log(r.hot.join('\n'));
      timings[name] = { mean: +r.mean.toFixed(2), p50: +r.p50.toFixed(2), p95: +r.p95.toFixed(2), jsP50: r.js50 == null ? null : +r.js50.toFixed(2), allocKBPerFrame: r.allocPerFrame == null ? null : +(r.allocPerFrame / 1024).toFixed(1), dpr: r.dpr, throttle: THROTTLE };
      console.log(`${name.padEnd(16)} draw+raster mean ${r.mean.toFixed(2)} ms  p50 ${r.p50.toFixed(2)}  p95 ${r.p95.toFixed(2)}  draw JS p50 ${r.js50?.toFixed(2)}  alloc ${r.allocPerFrame == null ? '-' : (r.allocPerFrame / 1024).toFixed(1) + ' KB'}/frame  (canvas dpr ${r.dpr}, webgl ${r.accel})${errs.length ? '  errors: ' + errs.join(' | ') : ''}`);
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

/** Budgets (perf regression check): exit 1 when a scene is over its p50 or the allocation budget. */
function checkBudgets(dir) {
  const timings = JSON.parse(readFileSync(join(dir, 'timings.json'), 'utf8'));
  const over = [];
  for (const kv of opt('--budget', '').split(',').filter(Boolean)) {
    const [name, ms] = kv.split('=');
    const t = timings[name];
    if (!t) over.push(`${name}: not measured`);
    else if (t.p50 > Number(ms)) over.push(`${name}: p50 ${t.p50} ms > budget ${ms} ms`);
  }
  const kb = opt('--alloc-budget', null);
  if (kb !== null) for (const [name, t] of Object.entries(timings)) if (t.allocKBPerFrame != null && t.allocKBPerFrame > Number(kb)) over.push(`${name}: ${t.allocKBPerFrame} KB/frame > budget ${kb} KB`);
  if (over.length) {
    console.error(`over budget:\n  ${over.join('\n  ')}`);
    process.exit(1);
  }
  if (opt('--budget', null) || kb !== null) console.log('within budget');
}

if (cmd === 'shots' && a) {
  await shots(resolve(a));
  checkBudgets(resolve(a));
}
else if (cmd === 'diff' && a && b) await diff(resolve(a), resolve(b), c && resolve(c));
else {
  console.log('usage: perf-scene.mjs shots <outDir> | diff <dirA> <dirB> [diffDir]');
  process.exit(2);
}
