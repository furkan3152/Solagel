#!/usr/bin/env node
// Repeatable client performance benchmark for /play (headless Chromium, Playwright + CDP).
//
//   node apps/web/scripts/perf.mjs [--start] [--label before] [--scenes practice,arena]
//        [--devices desktop,phone] [--secs 20] [--warm 6] [--profile] [--trace] [--out DIR]
//        [--url http://localhost:5173/play] [--gpu]
//
// --prod    measures a production build instead of the Vite dev server (no React dev
//           overhead): builds apps/web with VITE_PERF_HOOK=1 into a temp dir, serves it with
//           `vite preview` on :4173 (proxying the demo's game server) and runs practice only
//           (the fake chain behind the arena scene exists in dev builds only).
// --start   spawns `GAME_PUBLIC=1 pnpm demo` itself (fake chain) with a busy arena
//           (ARENA_BOT_TARGET=ARENA_BOT_MAX=40, long rounds so joins never close mid-run),
//           and stops it at the end. Without it, a demo must already be running.
// Scenes:   practice  joins the free practice room (20 bots);
//           arena     signs in with a Dev Wallet, buys a Penny Pond ticket (fake chain) and plays.
// Devices:  desktop   1920x1080, dpr 1;
//           phone     390x844, dpr 3, touch, with a 4x CPU throttle (CDP Emulation).
// The coin is steered in-page through the virtual stick (food first, away from bigger coins),
// so both devices drive the same code path.
//
// --no-auto  keeps full quality (switches the automatic quality drop off), for like-for-like frames.
// Per run it records: frame intervals (rAF deltas: p50/p95/p99, fps, share over 33 ms), the
// engine frame's JS time and the renderer's draw time, long tasks, JS heap (min/max and an
// allocation-rate proxy from heap growth), canvas draw calls per frame (a short counted window
// after the timed one, so the counters never skew the timings), React commits per second (a
// minimal DevTools hook), and the game server's CPU per tick (its process CPU time over the
// window / 30 ticks per second, read from /proc). --profile adds a CDP CPU profile with the top
// self-time functions; --trace a Chrome trace with the GC totals.
// Output (default out: $TMPDIR/slana-perf): <out>/<label>.json and a Markdown table on stdout.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const PROD = flag('--prod');
const URL_ = opt('--url', PROD ? 'http://localhost:4173/play' : 'http://localhost:5173/play');
const LABEL = opt('--label', 'run');
const OUT = resolve(opt('--out', join(tmpdir(), 'slana-perf')));
const SCENES = opt('--scenes', PROD ? 'practice' : 'practice,arena').split(',');
const DEVICES = opt('--devices', 'desktop,phone').split(',');
const SECS = Number(opt('--secs', '20'));
const WARM = Number(opt('--warm', '6'));
const PROFILE = flag('--profile');
const TRACE = flag('--trace');
const CHROME = process.env.CHROME_PATH;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error('[perf]', ...a);

const DEVICE = {
  desktop: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false, throttle: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, throttle: 4 },
};

// ───────────────────────────── demo (optional) ─────────────────────────────
let demo = null;
async function startDemo() {
  log('starting GAME_PUBLIC=1 pnpm demo');
  demo = spawn('pnpm', ['demo'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, GAME_PUBLIC: '1', ARENA_BOT_TARGET: '40', ARENA_BOT_MAX: '40', ROUND_SECONDS: '1800', ROUND_JOIN_CLOSE_SECONDS: '60' },
  });
  for (let i = 0; i < 120; i++) {
    const ok = await fetch(URL_).then((r) => r.ok, () => false);
    if (ok && serverPid()) return;
    await sleep(1000);
  }
  throw new Error('demo did not come up');
}
function stopDemo() {
  for (const [p, sig] of [[demo, 'SIGINT'], [preview, 'SIGTERM']]) {
    if (!p) continue;
    try {
      process.kill(-p.pid, sig);
    } catch {}
  }
  demo = preview = null;
}

// ───────────────────────────── production build (optional) ─────────────────────────────
let preview = null;
async function startPreview() {
  const dir = join(tmpdir(), 'slana-perf-dist');
  log(`building a production bundle with the perf hook into ${dir}`);
  const web = join(ROOT, 'apps/web');
  const b = spawnSync('pnpm', ['exec', 'vite', 'build', '--outDir', dir, '--emptyOutDir'], { cwd: web, env: { ...process.env, VITE_PERF_HOOK: '1' }, encoding: 'utf8' });
  if (b.status !== 0) throw new Error(`vite build failed:\n${b.stderr || b.stdout}`);
  preview = spawn('pnpm', ['exec', 'vite', 'preview', '--outDir', dir, '--port', '4173', '--strictPort'], { cwd: web, detached: true, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    if (await fetch(URL_).then((r) => r.ok, () => false)) return;
    await sleep(500);
  }
  throw new Error('vite preview did not come up');
}
process.on('SIGINT', () => {
  stopDemo();
  process.exit(130);
});

// ───────────────────────────── server CPU (/proc) ─────────────────────────────
function serverPid() {
  const r = spawnSync('lsof', ['-t', '-iTCP:8787', '-sTCP:LISTEN'], { encoding: 'utf8' });
  const pid = Number((r.stdout ?? '').trim().split('\n')[0]);
  return pid > 0 ? pid : null;
}
function cpuMs(pid) {
  try {
    const f = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const parts = f.slice(f.lastIndexOf(')') + 2).split(' ');
    // utime, stime are fields 14 and 15 (1-based) → index 11, 12 after the comm
    return ((Number(parts[11]) + Number(parts[12])) * 1000) / 100;
  } catch {
    return null;
  }
}

// ───────────────────────────── in-page instrumentation ─────────────────────────────
function instrument() {
  const P = (window.__perf = { on: false, deltas: [], frameMs: [], drawMs: [], longTasks: [], heap: [], commits: 0, calls: null });
  // a minimal React DevTools hook: counts commits (HUD re-renders)
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    isDisabled: false,
    supportsFiber: true,
    renderers: new Map(),
    inject(r) {
      const id = this.renderers.size + 1;
      this.renderers.set(id, r);
      return id;
    },
    onCommitFiberRoot() {
      if (P.on) P.commits++;
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onScheduleFiberRoot() {},
    checkDCE() {},
  };
  let last = 0;
  const tick = (t) => {
    if (P.on && last) P.deltas.push(t - last);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((l) => {
      if (P.on) for (const e of l.getEntries()) P.longTasks.push(e.duration);
    }).observe({ type: 'longtask', buffered: false });
  } catch {}
  setInterval(() => {
    if (P.on && performance.memory) P.heap.push(performance.memory.usedJSHeapSize);
  }, 100);
  // wraps the engine frame and the renderer draw once the engine exists
  const hook = setInterval(() => {
    const S = window.__slana;
    if (!S?.engine) return;
    clearInterval(hook);
    const e = S.engine;
    const frame = e.frame;
    e.frame = function () {
      const t0 = performance.now();
      frame.call(this);
      if (P.on) P.frameMs.push(performance.now() - t0);
    };
    const r = e.renderer;
    const draw = r.draw.bind(r);
    r.draw = (f) => {
      const t0 = performance.now();
      draw(f);
      if (P.on) P.drawMs.push(performance.now() - t0);
    };
  }, 50);
  // canvas call counting, switched on for a short window only
  P.countCalls = (ms) =>
    new Promise((res) => {
      const proto = CanvasRenderingContext2D.prototype;
      const names = ['drawImage', 'fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'clip', 'save', 'restore', 'arc', 'ellipse', 'setLineDash'];
      const orig = {};
      const n = Object.fromEntries(names.map((k) => [k, 0]));
      for (const k of names) {
        orig[k] = proto[k];
        proto[k] = function (...a) {
          n[k]++;
          return orig[k].apply(this, a);
        };
      }
      let frames = 0;
      let stop = false;
      const count = () => {
        if (stop) return;
        frames++;
        requestAnimationFrame(count);
      };
      requestAnimationFrame(count);
      setTimeout(() => {
        stop = true;
        for (const k of names) proto[k] = orig[k];
        const per = {};
        for (const k of names) per[k] = +(n[k] / Math.max(1, frames)).toFixed(1);
        per.draws = +((n.drawImage + n.fill + n.stroke + n.fillRect + n.strokeRect + n.fillText + n.strokeText) / Math.max(1, frames)).toFixed(1);
        res(per);
      }, ms);
    });
  // steering through the virtual stick: food first, away from bigger coins, off the walls
  P.steer = () => {
    const S = window.__slana;
    if (!S?.engine) return;
    const e = S.engine;
    const w = e.world;
    const mine = w.myCells();
    if (!mine.length) return;
    let mx = 0;
    let my = 0;
    let m = 0;
    let big = 0;
    for (const c of mine) {
      const k = c.r * c.r;
      mx += c.x * k;
      my += c.y * k;
      m += k;
      big = Math.max(big, c.r);
    }
    mx /= m;
    my /= m;
    let fx = 0;
    let fy = 0;
    let best = null;
    let bestD = Infinity;
    for (const en of w.entities.values()) {
      if (en.dying || en.playerId === w.myPid) continue;
      const dx = en.x - mx;
      const dy = en.y - my;
      const d = Math.hypot(dx, dy) || 1;
      if (en.kind === 1 && en.r > big * 1.05) {
        const danger = en.r * 2 + big + 250;
        if (d < danger) {
          fx -= (dx / d) * ((danger - d) / 100);
          fy -= (dy / d) * ((danger - d) / 100);
        }
      } else if (en.kind === 4) {
        if (big > en.r && d < big + en.r + 80) {
          fx -= (dx / d) * 2;
          fy -= (dy / d) * 2;
        }
      } else if (en.kind !== 1 || en.r < big * 0.85) {
        if (d < bestD) {
          bestD = d;
          best = { dx, dy, d };
        }
      }
    }
    const edge = 700 + big;
    if (mx < edge) fx += (edge - mx) / 100;
    if (my < edge) fy += (edge - my) / 100;
    if (mx > w.width - edge) fx -= (mx - (w.width - edge)) / 100;
    if (my > w.height - edge) fy -= (my - (w.height - edge)) / 100;
    let vx = fx;
    let vy = fy;
    if (best && Math.hypot(fx, fy) < 1.5) {
      vx += best.dx / best.d;
      vy += best.dy / best.d;
    }
    if (Math.hypot(vx, vy) < 0.05) {
      vx = w.width / 2 - mx;
      vy = w.height / 2 - my;
    }
    const n = Math.hypot(vx, vy) || 1;
    e.input.stick = { x: vx / n, y: vy / n, active: true };
  };
}

// ───────────────────────────── helpers ─────────────────────────────
const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

async function devWallet(ctx) {
  const { installDevWallet } = await import(join(ROOT, 'scripts/lib/dev-wallet.mjs'));
  await installDevWallet(ctx);
}

async function settings(ctx, quality) {
  const s = { name: 'Bench', skin: 4, theme: 'light', quality, showNames: true, showMass: true, showFps: false, showMinimap: true, showChat: true, sound: false, volume: 0, announcer: false };
  await ctx.addInitScript(
    ([s, noAuto]) => {
      if (!sessionStorage.getItem('__perfset')) {
        localStorage.setItem('slana.settings.v1', JSON.stringify(s));
        if (noAuto) localStorage.setItem('slana.autoQuality', 'off');
        sessionStorage.setItem('__perfset', '1');
      }
    },
    [s, flag('--no-auto')],
  );
}

const state = (page) => page.evaluate(() => window.__slana.useUi.getState().screen);

async function joinPractice(page) {
  await page.evaluate(() => {
    window.__perf.room = 'practice';
    window.__slana.engine.play('practice');
  });
  await page.waitForFunction(() => window.__slana.useUi.getState().screen === 'playing', null, { timeout: 20000 });
}

async function joinArena(page) {
  await page.locator('.kl-wallet').first().click();
  await page.waitForSelector('.wl-sheet', { timeout: 8000 });
  await page.locator('.wl-item').first().click();
  await page.waitForFunction(() => !!window.__slana.useUi.getState().auth, null, { timeout: 20000 });
  await page.waitForFunction(() => window.__slanaChain?.useChainData.getState().tokenBalance != null, null, { timeout: 20000 });
  await page.locator('[role="radio"][data-kb-value="arena:1"]').first().click();
  await sleep(300);
  await page.locator('.kl-cta').first().click();
  await page.waitForSelector('.tf-sheet', { timeout: 10000 });
  await page.evaluate(() => {
    if (window.__slanaChain?.fakeWallet) window.__slanaChain.fakeWallet.delayMs = 50;
  });
  await page.locator('.tf-sheet .kb-btn--pink').first().click();
  const ok = await page.waitForFunction(() => window.__slana.useUi.getState().screen === 'playing', null, { timeout: 20000 }).then(() => true, () => false);
  if (!ok) {
    await page.locator('.kl-cta').first().click();
    await page.waitForFunction(() => window.__slana.useUi.getState().screen === 'playing', null, { timeout: 20000 });
  }
}

/** Keeps playing: steers ~10 Hz and rejoins practice after a death (an arena death is just watched). */
async function drive(page, ms, scene) {
  const t0 = Date.now();
  let deaths = 0;
  while (Date.now() - t0 < ms) {
    const s = await page
      .evaluate(() => {
        window.__perf.steer();
        return window.__slana.useUi.getState().screen;
      })
      .catch(() => 'error');
    if (s === 'dead' || s === 'lobby') {
      deaths++;
      if (scene === 'practice') {
        await page.evaluate(() => window.__slana.engine.play(window.__perf.room)).catch(() => {});
        await sleep(500);
      }
    }
    await sleep(100);
  }
  return deaths;
}

function summarizeProfile(profile) {
  const self = new Map();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const dt = new Map();
  for (let i = 0; i < profile.samples.length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i + 1] ?? 0));
  let total = 0;
  for (const [id, us] of dt) {
    const n = byId.get(id);
    const cf = n.callFrame;
    const url = cf.url.replace(/^.*\/(src|node_modules|@fs)\//, '$1/').replace(/\?.*$/, '');
    const key = `${cf.functionName || '(anon)'} ${url}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + us);
    total += us;
  }
  return [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([k, us]) => ({ fn: k, ms: r1(us / 1000), pct: r1((us / total) * 100) }));
}

async function run(browser, scene, device) {
  const d = DEVICE[device];
  const ctx = await browser.newContext({ viewport: d.viewport, deviceScaleFactor: d.deviceScaleFactor, isMobile: d.isMobile, hasTouch: d.hasTouch, locale: 'en-US' });
  await settings(ctx, 'high');
  if (scene === 'arena') await devWallet(ctx);
  await ctx.addInitScript(instrument);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__slana && window.__slana.useUi.getState().connected, null, { timeout: 30000 });
  if (scene === 'arena') await joinArena(page);
  else await joinPractice(page);
  const cdp = await ctx.newCDPSession(page);
  if (d.throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: d.throttle });
  log(`${scene}/${device}: warming up ${WARM}s`);
  await drive(page, WARM * 1000, scene);

  const pid = serverPid();
  const c0 = pid ? cpuMs(pid) : null;
  const w0 = Date.now();
  await page.evaluate(() => (window.__perf.on = true));
  if (PROFILE) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
  }
  if (TRACE) await cdp.send('Tracing.start', { categories: opt('--trace-cats', 'toplevel,blink,cc,devtools.timeline,disabled-by-default-devtools.timeline,v8,disabled-by-default-v8.gc'), transferMode: 'ReturnAsStream' });
  log(`${scene}/${device}: measuring ${SECS}s`);
  const deaths = await drive(page, SECS * 1000, scene);
  await page.evaluate(() => (window.__perf.on = false));
  const wall = Date.now() - w0;
  const c1 = pid ? cpuMs(pid) : null;
  let hot = null;
  if (PROFILE) {
    const { profile } = await cdp.send('Profiler.stop');
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `${LABEL}-${scene}-${device}.cpuprofile`), JSON.stringify(profile));
    hot = summarizeProfile(profile);
  }
  let gc = null;
  if (TRACE) {
    const done = new Promise((res) => cdp.once('Tracing.tracingComplete', res));
    await cdp.send('Tracing.end');
    const { stream } = await done;
    let data = '';
    for (;;) {
      const chunk = await cdp.send('IO.read', { handle: stream });
      data += chunk.data;
      if (chunk.eof) break;
    }
    await cdp.send('IO.close', { handle: stream });
    writeFileSync(join(OUT, `${LABEL}-${scene}-${device}.trace.json`), data);
    const ev = JSON.parse(data).traceEvents ?? [];
    let n = 0;
    let us = 0;
    for (const e of ev) if ((e.name === 'MinorGC' || e.name === 'MajorGC') && e.ph === 'X') (n++, (us += e.dur ?? 0));
    gc = { count: n, ms: r1(us / 1000), perSec: r1(n / (wall / 1000)) };
  }
  const calls = await page.evaluate(() => window.__perf.countCalls(2000));
  const P = await page.evaluate(() => {
    const p = window.__perf;
    return { deltas: p.deltas, frameMs: p.frameMs, drawMs: p.drawMs, longTasks: p.longTasks, heap: p.heap, commits: p.commits };
  });
  if (flag('--dump')) {
    // the world as drawn right now (entities, players, camera), for perf-scene.mjs --world
    const dump = await page.evaluate(() => {
      const e = window.__slana.engine;
      const w = e.world;
      const ents = [...w.entities.values()].filter((x) => !x.dying).map(({ jelly, ...x }) => ({ ...x, jelly: !!jelly }));
      const players = [...w.players.values()].map((p) => ({ ...p, emote: null }));
      const c = e.camera;
      return { width: w.width, height: w.height, myPid: w.myPid, ents, players, camera: { x: c.x, y: c.y, zoom: c.zoom, w: c.w, h: c.h } };
    });
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `world-${scene}-${device}.json`), JSON.stringify(dump));
  }
  const scr = await state(page).catch(() => '?');
  const entities = await page.evaluate(() => window.__slana.engine.world.entities.size).catch(() => null);
  // the automatic quality level reached (0 = full) and the canvas pixel ratio at the end
  const auto = await page
    .evaluate(() => {
      const e = window.__slana.engine;
      const c = document.querySelector('canvas.game-canvas');
      return e.governor ? { level: e.governor.level, dpr: c ? +(c.width / c.clientWidth).toFixed(2) : null } : null;
    })
    .catch(() => null);
  await ctx.close();

  let grow = 0;
  for (let i = 1; i < P.heap.length; i++) if (P.heap[i] > P.heap[i - 1]) grow += P.heap[i] - P.heap[i - 1];
  const secs = wall / 1000;
  return {
    scene,
    device,
    secs: r1(secs),
    frames: P.deltas.length,
    fps: r1(P.deltas.length / secs),
    p50: r1(pct(P.deltas, 50)),
    p95: r1(pct(P.deltas, 95)),
    p99: r1(pct(P.deltas, 99)),
    over33: r1((100 * P.deltas.filter((x) => x > 34).length) / Math.max(1, P.deltas.length)),
    frameJs: { mean: r1(mean(P.frameMs)), p95: r1(pct(P.frameMs, 95)) },
    draw: { mean: r1(mean(P.drawMs)), p95: r1(pct(P.drawMs, 95)) },
    longTasks: { count: P.longTasks.length, ms: r1(P.longTasks.reduce((a, b) => a + b, 0)) },
    heapMB: { min: r1(Math.min(...P.heap) / 1e6), max: r1(Math.max(...P.heap) / 1e6), allocMBs: r1(grow / 1e6 / secs) },
    reactCommitsPerSec: r1(P.commits / secs),
    calls,
    serverMsPerTick: c0 != null && c1 != null ? Math.round(((c1 - c0) / (secs * 30)) * 100) / 100 : null,
    entities,
    auto,
    deaths,
    screenAtEnd: scr,
    gc,
    hot,
    errors: errors.slice(0, 5),
  };
}

function table(results) {
  const rows = [
    '| scene | device | fps | p50 ms | p95 ms | p99 ms | >33ms % | frame JS ms (mean/p95) | draw ms (mean/p95) | long tasks (n/ms) | heap MB (max) | alloc MB/s | draws/frame | React commits/s | server ms/tick | auto level / dpr |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of results) {
    if (r.error) {
      rows.push(`| ${r.scene} | ${r.device} | error: ${r.error} |`);
      continue;
    }
    rows.push(
      `| ${r.scene} | ${r.device} | ${r.fps} | ${r.p50} | ${r.p95} | ${r.p99} | ${r.over33} | ${r.frameJs.mean}/${r.frameJs.p95} | ${r.draw.mean}/${r.draw.p95} | ${r.longTasks.count}/${r.longTasks.ms} | ${r.heapMB.max} | ${r.heapMB.allocMBs} | ${r.calls.draws} | ${r.reactCommitsPerSec} | ${r.serverMsPerTick} | ${r.auto ? `${r.auto.level} / ${r.auto.dpr}` : '-'} |`,
    );
  }
  return rows.join('\n');
}

// ───────────────────────────── main ─────────────────────────────
if (!existsSync(CHROME)) throw new Error(`Chromium not found at ${CHROME} (set CHROME_PATH)`);
if (flag('--start')) await startDemo();
if (PROD) await startPreview();
const browser = await chromium.launch({
  executablePath: CHROME,
  args: [
    ...(flag('--gpu') ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] : ['--disable-gpu']),
    '--enable-precise-memory-info',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const results = [];
try {
  for (const scene of SCENES) {
    for (const device of DEVICES) {
      try {
        results.push(await run(browser, scene, device));
      } catch (e) {
        log(`${scene}/${device} failed: ${e.message}`);
        results.push({ scene, device, error: e.message.split('\n')[0] });
      }
    }
  }
} finally {
  await browser.close();
  stopDemo();
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `${LABEL}.json`), JSON.stringify({ label: LABEL, url: URL_, at: new Date().toISOString(), results }, null, 2));
console.log(`\n### ${LABEL}\n\n${table(results)}\n`);
for (const r of results) {
  if (r.hot) {
    console.log(`\nTop self time, ${r.scene}/${r.device}:`);
    for (const h of r.hot.slice(0, 15)) console.log(`  ${String(h.pct).padStart(5)}%  ${String(h.ms).padStart(8)} ms  ${h.fn}`);
  }
  if (r.gc) console.log(`GC ${r.scene}/${r.device}: ${r.gc.count} (${r.gc.perSec}/s), ${r.gc.ms} ms`);
  if (r.errors?.length) console.log(`errors ${r.scene}/${r.device}: ${r.errors.join(' | ')}`);
}
