#!/usr/bin/env node
// Records the Elymum walkthrough video from a normal player's point of view (real mouse moves and
// clicks) against the fake-chain stack, and encodes it with ffmpeg. Run it with `pnpm demo:record`.
//
//   pnpm demo:record [-- --quick] [-- --url http://localhost:5173/] [-- --out out/videos]
//
//   --quick        a short clip (about a minute on a slow machine): lobby, wallet, one Asphodel Meadow
//                  ticket, a short arena run, end card (no bell)
//   --url <url>    record this running stack (it must be `pnpm demo`'s fake chain); by default
//                  the stack is started for the recording (scripts/demo.mjs) and stopped afterwards
//   --out <dir>    output folder (default out/videos, which is gitignored)
//   --keep-frames  keep the raw screencast frames
//   --no-audio     record without sound (the old silent videos)
// Rounds: arenas have no cash-out. The full run plays until the round bell and shows the "Round over" receipt.
//   ROUND_SECONDS=<n>  round length of the stack this script starts (default 90, so the bell comes soon)
// Audio: the game's WebAudio output is captured through the dev-only master tap
// (`window.__elymumAudioTap()`, a MediaStream after the limiter) with MediaRecorder (webm/opus),
// pulled out of the page in one-second chunks, aligned to the first video frame and muxed as AAC.
// The announcer is not in the capture: speechSynthesis plays through the OS, outside WebAudio
// (headless Chromium usually has no speech voices at all, so it stays silent there anyway).
// Needs: Chromium (Playwright's, or CHROME_PATH=<binary>) and ffmpeg on the PATH (FFMPEG=<binary> to override).
// Writes <out>/elymum-walkthrough.mp4 (or elymum-quick.mp4), a highlights reel for full runs,
// chapters.json and check-*.png screenshots.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, requireFrom, resolveChromium, waitForHttp } from './lib/common.mjs';
import { installDevWallet } from './lib/dev-wallet.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const QUICK = flag('--quick');
const AUDIO = !flag('--no-audio');
const EXTERNAL = flag('--url');
const base = opt('--url', 'http://localhost:5173/');
const out = resolve(ROOT, opt('--out', 'out/videos'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
// Paid arenas play wall-clock rounds (no cash-out): the walkthrough plays until the bell. When this script
// starts the stack it runs short rounds (ROUND_SECONDS, default 90) so the bell comes soon; with --url the
// stack's own ROUND_SECONDS applies (the default round is 300 s).
const ROUND_SECONDS = Number(process.env.ROUND_SECONDS) || (EXTERNAL ? 300 : 90);
// two bells' worth: a bot can eat the autopilot before the first one, and an eaten player gets no receipt
const ROUND_WAIT_MS = (2 * ROUND_SECONDS + 30) * 1000;

// ── preflight: ffmpeg and a browser, before anything is started ──
const ff = spawnSync(FFMPEG, ['-version'], { encoding: 'utf8' });
if (ff.error || ff.status !== 0) {
  console.error(
    `ffmpeg was not found (looked for "${FFMPEG}").\n` +
      'Install it (Debian/Ubuntu: sudo apt install ffmpeg; macOS: brew install ffmpeg) or set FFMPEG=/path/to/ffmpeg.',
  );
  process.exit(2);
}
const { chromium } = requireFrom('apps/web')('playwright');
let chrome;
try {
  chrome = resolveChromium(chromium);
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

// ── the stack: use the running one, or start `pnpm demo` for the length of the recording ──
let stack = null;
async function stopStack() {
  if (!stack) return;
  const s = stack;
  stack = null;
  try {
    process.kill(-s.pid, 'SIGINT');
  } catch {}
  await new Promise((r) => {
    const t = setTimeout(r, 15000);
    s.on('exit', () => (clearTimeout(t), r()));
    if (s.exitCode !== null) r();
  });
}
for (const evt of ['uncaughtException', 'unhandledRejection']) {
  process.on(evt, (e) => {
    console.error(e);
    void stopStack().then(() => process.exit(1));
  });
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => void stopStack().then(() => process.exit(130)));
if (!EXTERNAL) {
  console.log('starting the fake-chain stack (scripts/demo.mjs)...');
  stack = spawn('node', [resolve(ROOT, 'scripts/demo.mjs')], { cwd: ROOT, env: { ...process.env, ROUND_SECONDS: String(ROUND_SECONDS) }, detached: true, stdio: ['ignore', 'inherit', 'inherit'] });
  stack.on('exit', (c) => {
    if (stack) {
      console.error(`the demo stack exited early (code ${c}); see its output above`);
      process.exit(1);
    }
  });
}
if (!(await waitForHttp(new URL('/api/health', base).href, 120_000))) {
  console.error(`Nothing answers at ${base}. Start the stack with \`pnpm demo\` (fake chain) or drop --url.`);
  await stopStack();
  process.exit(1);
}
await waitForHttp(base, 60_000);

const W = 1280, H = 720;
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a);

const browser = await chromium.launch({
  executablePath: chrome.executablePath,
  // the audio tap runs from the start of the capture; the game itself still waits for a click
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...(AUDIO ? ['--autoplay-policy=no-user-gesture-required'] : [])],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, locale: 'en-US' });

// ── settings: paper theme, default sound levels (or none with --no-audio), name Daphne ──
await ctx.addInitScript((audio) => {
  const sound = audio ? { sound: true } : { sound: false, volume: 0 };
  localStorage.setItem('elymum.settings.v1', JSON.stringify({ name: 'Daphne', skin: 4, theme: 'light', quality: 'high', ...sound, showNames: true, showMass: true, showFps: false, showMinimap: true, showChat: true }));
}, AUDIO);

// ── Dev Wallet: an EIP-6963 wallet whose key lives in this script (signs the free SIWE sign-in message) ──
await installDevWallet(ctx);

// ── visible cursor, click ripple and chapter captions (DOM overlays, pointer-events: none) ──
await ctx.addInitScript(() => {
  const install = () => {
    if (document.getElementById('__rec-cursor')) return;
    const css = document.createElement('style');
    css.textContent = `
      #__rec-cursor{position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);will-change:transform;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.35))}
      .__rec-ripple{position:fixed;z-index:2147483646;pointer-events:none;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2.5px solid #fb2f85;animation:__rec-rip .55s ease-out forwards}
      @keyframes __rec-rip{from{transform:scale(.3);opacity:.95}to{transform:scale(1.5);opacity:0}}
      #__rec-cap{position:fixed;left:22px;bottom:22px;z-index:2147483645;pointer-events:none;font:600 15px/1 "Space Mono","IBM Plex Mono",ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:#1b1732;background:#fffaf0;border:2px solid #1b1732;border-radius:6px;padding:9px 13px 8px;box-shadow:3px 3px 0 #1b1732;opacity:0;transform:translateY(8px);transition:opacity .45s ease,transform .45s ease}
      #__rec-cap.on{opacity:1;transform:none}
      #__rec-cap.big{left:50%;bottom:50%;transform:translate(-50%,50%) scale(.96);font:800 64px/1 "Bricolage Grotesque",system-ui,sans-serif;text-transform:none;letter-spacing:-.03em;padding:18px 34px 22px;box-shadow:6px 6px 0 #fb2f85}
      #__rec-cap.big.on{transform:translate(-50%,50%) scale(1)}`;
    document.documentElement.appendChild(css);
    const c = document.createElement('div');
    c.id = '__rec-cursor';
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.6 13.8 L10.6 20.4 L13.4 19.1 L10.5 12.6 L16.8 12.6 Z" fill="#1b1732" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    const cap = document.createElement('div');
    cap.id = '__rec-cap';
    document.documentElement.appendChild(cap);
    const pos = window.__recPos || { x: -100, y: -100 };
    c.style.transform = `translate(${pos.x - 3}px,${pos.y - 2}px)`;
    window.addEventListener('mousemove', (e) => { window.__recPos = { x: e.clientX, y: e.clientY }; c.style.transform = `translate(${e.clientX - 3}px,${e.clientY - 2}px)`; }, true);
    window.addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      r.className = '__rec-ripple';
      r.style.left = e.clientX + 'px';
      r.style.top = e.clientY + 'px';
      document.documentElement.appendChild(r);
      setTimeout(() => r.remove(), 700);
    }, true);
    let timer = 0;
    window.__caption = (text, ms = 3200, big = false) => {
      clearTimeout(timer);
      cap.textContent = text;
      cap.classList.toggle('big', big);
      requestAnimationFrame(() => cap.classList.add('on'));
      if (ms > 0) timer = setTimeout(() => cap.classList.remove('on'), ms);
    };
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
});

const page = await ctx.newPage();
const problems = [];
const audioChunks = [];
if (AUDIO) await page.exposeFunction('__recAudioChunk', (b64) => void audioChunks.push(Buffer.from(b64, 'base64')));
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`[console.error] ${m.text()}`));

// ── screencast ──
rmSync(out + '/frames', { recursive: true, force: true });
mkdirSync(out + '/frames', { recursive: true });
mkdirSync(out + '/checks', { recursive: true });
const cdp = await ctx.newCDPSession(page);
const frames = [];
cdp.on('Page.screencastFrame', async (f) => {
  const n = frames.length;
  writeFileSync(`${out}/frames/f${String(n).padStart(5, '0')}.jpg`, Buffer.from(f.data, 'base64'));
  frames.push(f.metadata.timestamp);
  try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
});

// ── human-like input helpers ──
let cur = { x: W / 2, y: H / 2 };
const wait = (ms) => page.waitForTimeout(ms);
const rnd = (a, b) => a + Math.random() * (b - a);
async function moveTo(x, y, speed = 1) {
  const d = Math.hypot(x - cur.x, y - cur.y);
  const steps = Math.max(8, Math.round((d / 14) / speed));
  // a slight arc, like a hand
  const mx = (cur.x + x) / 2 + rnd(-0.08, 0.08) * d, my = (cur.y + y) / 2 + rnd(-0.08, 0.08) * d;
  const sx = cur.x, sy = cur.y;
  for (let i = 1; i <= steps; i++) {
    const t0 = i / steps;
    const t = t0 < 0.5 ? 2 * t0 * t0 : 1 - Math.pow(-2 * t0 + 2, 2) / 2; // ease in-out
    const px = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * mx + t * t * x;
    const py = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * my + t * t * y;
    await page.mouse.move(px, py);
    await wait(12);
  }
  cur = { x, y };
}
async function boxOf(sel, nth = 0) {
  const loc = typeof sel === 'string' ? page.locator(sel).nth(nth) : sel;
  await loc.waitFor({ state: 'visible', timeout: 15000 });
  // out of view: scroll there with the wheel, as a person would
  for (let i = 0; i < 30; i++) {
    const b = await loc.boundingBox();
    if (!b) break;
    if (b.y + Math.min(b.height, 80) > H - 30) await wheel(Math.min(320, b.y + Math.min(b.height, 80) - (H - 140)), 80, 40);
    else if (b.y < 20) await wheel(-Math.min(320, 140 - b.y), 80, 40);
    else break;
    await wait(220);
  }
  return loc.boundingBox();
}
async function hover(sel, { fx = 0.5, fy = 0.5, nth = 0, pause = 700 } = {}) {
  const b = await boxOf(sel, nth);
  await moveTo(b.x + b.width * fx + rnd(-4, 4), b.y + b.height * fy + rnd(-3, 3));
  await wait(pause);
}
async function click(sel, opts = {}) {
  await hover(sel, { pause: 0, ...opts });
  await wait(opts.before ?? 320);
  await page.mouse.down();
  await wait(70);
  await page.mouse.up();
  await wait(opts.after ?? 450);
}
async function wheel(total, step = 80, gap = 45) {
  const n = Math.max(1, Math.round(Math.abs(total) / step));
  for (let i = 0; i < n; i++) { await page.mouse.wheel(0, Math.sign(total) * step); await wait(gap); }
}
const ui = (fn, arg) => page.evaluate(fn, arg);
const screen = () => ui(() => window.__elymum.useUi.getState().screen);
const chapters = [];
async function chapter(label, ms = 3200) {
  chapters.push({ label, at: Date.now() / 1000 });
  log('chapter', label);
  await ui(([l, m]) => window.__caption?.(l, m), [label, ms]);
}
const snap = (name) => page.screenshot({ path: `${out}/checks/${name}.png` }).catch(() => {});

// ── in-game autopilot: food and smaller cells, flee bigger ones, stay off the walls ──
async function autopilot(ms, { onDead = 'stop', splits = true } = {}) {
  const t0 = Date.now();
  let lastSplit = 0;
  while (Date.now() - t0 < ms) {
    const plan = await ui(() => {
      const e = window.__elymum.engine;
      if (window.__elymum.useUi.getState().screen !== 'playing') return { dead: true };
      const w = e.world;
      const mine = [...w.myCells()];
      if (mine.length === 0) return { wait: true };
      let mx = 0, my = 0, mass = 0, big = 0;
      for (const c of mine) { const m = c.r * c.r; mx += c.x * m; my += c.y * m; mass += m; big = Math.max(big, c.r); }
      mx /= mass; my /= mass;
      const mineIds = new Set(mine.map((c) => c.id));
      let fx = 0, fy = 0, best = null, bestScore = -Infinity;
      for (const en of w.entities.values()) {
        if (mineIds.has(en.id) || en.dying) continue;
        const dx = en.x - mx, dy = en.y - my;
        const d = Math.hypot(dx, dy) || 1;
        if (en.kind === 1 && en.r > big * 1.1) { if (d < en.r * 1.6 + big + 160) { const k = (en.r * 1.6 + big + 160 - d) / 120; fx -= (dx / d) * k; fy -= (dy / d) * k; } continue; }
        if (en.kind === 4 && big > en.r * 1.1 && d < big + en.r + 60) { fx -= (dx / d) * 2; fy -= (dy / d) * 2; continue; }
        let value = 0;
        if (en.kind === 2 || en.kind === 3 || en.kind === 5 || en.kind === 6) value = 1 + en.r / 10 + (en.kind === 6 ? 4 : 0);
        else if (en.kind === 1 && en.r < big * 0.85) value = 6 + en.r / 5;
        if (value <= 0) continue;
        const score = value / (d + 40);
        if (score > bestScore) { bestScore = score; best = { x: en.x, y: en.y, r: en.r, kind: en.kind, d }; }
      }
      const m = 250 + big;
      if (mx < m) fx += (m - mx) / 120; if (my < m) fy += (m - my) / 120;
      if (mx > w.width - m) fx -= (mx - (w.width - m)) / 120; if (my > w.height - m) fy -= (my - (w.height - m)) / 120;
      let tx = mx, ty = my;
      if (best) { tx = best.x; ty = best.y; }
      const flee = Math.hypot(fx, fy);
      if (flee > 0.3) { const ax = best ? (best.x - mx) / best.d : 0, ay = best ? (best.y - my) / best.d : 0; const vx = fx / flee * Math.min(1, flee) + ax * (1 - Math.min(1, flee)), vy = fy / flee * Math.min(1, flee) + ay * (1 - Math.min(1, flee)); const vn = Math.hypot(vx, vy) || 1; tx = mx + vx / vn * 600; ty = my + vy / vn * 600; }
      const s = e.camera.toScreen(tx, ty);
      const split = !!best && best.kind === 1 && flee < 0.2 && best.d < big * 4 && best.r < big * 0.4 && mine.length < 4;
      return { x: s.x, y: s.y, split };
    });
    if (plan.dead) { if (onDead === 'stop') return 'dead'; }
    if (plan.wait || plan.dead) { await wait(150); continue; }
    const x = Math.max(60, Math.min(W - 60, plan.x)), y = Math.max(60, Math.min(H - 60, plan.y));
    // ease the cursor toward the plan (a hand does not teleport)
    const nx = cur.x + (x - cur.x) * 0.55, ny = cur.y + (y - cur.y) * 0.55;
    await page.mouse.move(nx, ny, { steps: 3 });
    cur = { x: nx, y: ny };
    if (splits && plan.split && Date.now() - lastSplit > 5000) { await page.keyboard.press('Space'); lastSplit = Date.now(); }
    await wait(70);
  }
  return 'ok';
}

// ════════════════════════════════════ the walkthrough ════════════════════════════════════
await page.goto(base, { waitUntil: 'networkidle' });
if (!(await page.waitForFunction(() => !!window.__elymumChain, null, { timeout: 20000 }).then(() => true, () => false))) {
  console.error('The page has no fake chain (window.__elymumChain). Record against `pnpm demo` (NODE_ENV=development DEV_FAKE_CHAIN=1), not a real chain.');
  await browser.close();
  await stopStack();
  process.exit(1);
}
await page.waitForFunction(() => !!window.__elymum && window.__elymum.useUi.getState().connected, null, { timeout: 20000 });
await page.waitForFunction(() => !!window.__elymumChain, null, { timeout: 20000 }).catch(() => {});
await wait(1200);
await page.mouse.move(cur.x, cur.y);
// game audio: MediaRecorder on the dev master tap; `audioStart` (wall clock) aligns it to the video
let audioStart = null;
if (AUDIO) {
  audioStart = await ui(
    () =>
      new Promise((res) => {
        const stream = window.__elymumAudioTap?.();
        if (!stream || typeof MediaRecorder === 'undefined') return res(null);
        const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 160000 });
        rec.ondataavailable = async (e) => {
          if (!e.data.size) return;
          const buf = new Uint8Array(await e.data.arrayBuffer());
          let s = '';
          for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          await window.__recAudioChunk(btoa(s));
        };
        rec.onstart = () => res(Date.now() / 1000);
        window.__recAudio = rec;
        rec.start(1000);
      }),
  );
  if (audioStart === null) problems.push('audio: no dev audio tap (window.__elymumAudioTap); recording without sound');
}
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 82, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
const recStart = Date.now() / 1000;
await wait(600);

// 1 · Lobby (guest)
await chapter('1 · Lobby');
await moveTo(640, 300);
await wait(700);
await hover('[role="radio"][data-kb-value="practice"]', { fx: 0.4, pause: 1200 });
await hover('[role="radio"][data-kb-value="arena:1"]', { fx: 0.45, pause: 1300 });
if (!QUICK) {
  await hover('[role="radio"][data-kb-value="arena:2"]', { fx: 0.45, pause: 1100 });
  await wheel(320);
  await wait(500);
  await hover('[role="radio"][data-kb-value="arena:3"]', { fx: 0.45, pause: 1100 });
  await hover('[role="radio"][data-kb-value="arena:4"]', { fx: 0.45, pause: 1100 });
  await hover('.kl-cta', { fx: 0.5, pause: 900 });
  await wheel(-400);
  await wait(600);
  await hover('.kl-apply', { fx: 0.4, pause: 900 });
}
await snap('1-lobby');

// 2 · Connect wallet
await chapter('2 · Connect wallet');
await click('.kl-wallet');
await page.waitForSelector('.wl-sheet', { timeout: 5000 });
await wait(1100);
await snap('2-sheet');
await click('.wl-item');
await page.waitForFunction(() => !!window.__elymum.useUi.getState().auth, null, { timeout: 15000 });
await page.waitForFunction(() => window.__elymumChain?.useChainData.getState().tokenBalance != null, null, { timeout: 15000 });
await wait(1600);
if (!QUICK) {
  await hover('.kl-wallet', { pause: 600 });
  await click('.kl-wallet');
  await page.waitForSelector('.wl-sheet .wl-bal', { timeout: 5000 });
  await wait(2600);
  await snap('2-wallet');
  await click('.wl-sheet .kb-sheet__head .kb-iconbtn');
  await wait(700);
}
await hover('.kl-ticket', { fx: 0.45, pause: QUICK ? 500 : 1800 }).catch(() => {});
await snap('2-lobby');

// 3 · Free practice
let r;
if (!QUICK) {
  await chapter('3 · Free practice');
  await click('[role="radio"][data-kb-value="practice"]', { fx: 0.4 });
  await wait(400);
  await click('.kl-cta');
  await page.waitForFunction(() => window.__elymum.useUi.getState().screen === 'playing', null, { timeout: 15000 });
  await wait(800);
  r = await autopilot(40_000);
  await snap('3-practice');
  if (r === 'dead' || (await screen()) !== 'playing') {
    log('practice: eaten');
    await wait(3500);
    await snap('3-eaten');
    // back to the lobby from the EATEN sheet
    await page.keyboard.press('Escape');
    await wait(800);
    if ((await screen()) !== 'lobby') await click('.g-death .kb-sheet__head .kb-iconbtn').catch(() => {});
  } else {
    await wait(300);
    // the autopilot can be eaten between its last frame and this click: then leave by the EATEN sheet
    if ((await screen()) === 'playing') await click('.g-topbar__btn[aria-label="Menu"]').catch(() => {});
    if ((await screen()) === 'dead') {
      await wait(3500);
      await page.keyboard.press('Escape');
    }
  }
  await page.waitForFunction(() => window.__elymum.useUi.getState().screen === 'lobby', null, { timeout: 10000 }).catch(async () => {
    problems.push('practice: did not get back to the lobby by the UI; screen=' + (await screen()));
    await ui(() => window.__elymum.engine.backToLobby());
  });
  await wait(1500);
}

// 4 · Buy a ticket (Asphodel Meadow)
async function buyTicket(first) {
  await click('[role="radio"][data-kb-value="arena:1"]', { fx: 0.45 });
  await wait(500);
  await click('.kl-cta');
  await page.waitForSelector('.tf-sheet', { timeout: 6000 });
  await wait(1300);
  if (first) {
    await snap('4-sheet');
    const b = await boxOf('.tf-sheet .kb-sheet__body');
    await moveTo(b.x + b.width * 0.55, b.y + b.height * 0.55);
    await wait(500);
    await wheel(240, 40, 70);
    await wait(1800);
    await snap('4-sheet-scrolled');
    await wheel(400, 60, 50);
    await wait(1200);
  }
  await ui(() => { if (window.__elymumChain?.fakeWallet) window.__elymumChain.fakeWallet.delayMs = 1300; });
  await click('.tf-sheet .kb-btn--pink', { before: 600 });
  await wait(600);
  if (first) await snap('4-signing');
  await page.waitForSelector('.tf-ticket__stamp', { timeout: 10000 }).catch(() => problems.push('no ticket stamp'));
  await wait(400);
  if (first) await snap('4-stamp');
  await page.waitForFunction(() => window.__elymum.useUi.getState().screen === 'playing', null, { timeout: 70000 }); // a ticket bought while joins are closed is held until the next round
}
await chapter('4 · Buy a ticket');
await buyTicket(true);
await wait(600);

// 5 · Arena
await chapter('5 · Asphodel Meadow arena');
let arenaMs = QUICK ? 7_000 : 52_000;
const tA = Date.now();
r = await autopilot(arenaMs);
await snap('5-arena');
if (r === 'dead') {
  log('arena: eaten after', (Date.now() - tA) / 1000, 's');
  await wait(3800);
  await snap('5-eaten');
  // "New ticket" from the EATEN sheet, then a fresh ticket
  await click('.g-death .kb-btn--pink');
  await page.waitForFunction(() => window.__elymum.useUi.getState().screen === 'lobby', null, { timeout: 8000 });
  await wait(1200);
  // the fake chain settles the old ticket first
  await page.waitForFunction(() => !document.querySelector('.kl-cta')?.disabled, null, { timeout: 15000 }).catch(() => {});
  await wait(800);
  await buyTicket(false);
  r = await autopilot(Math.max(QUICK ? 5_000 : 22_000, arenaMs - (Date.now() - tA)));
}

// 6 · The bell: paid arenas have no cash-out, so play on until the round ends, then show the receipt
if (QUICK) {
  await wait(500);
} else {
  await chapter('6 · The bell');
  const deadline = Date.now() + ROUND_WAIT_MS;
  let sc = await screen();
  while (Date.now() < deadline && sc !== 'roundover') {
    if (sc === 'playing') {
      await autopilot(4000);
    } else if (sc === 'dead') {
      // eaten: buy back in while joins are open, else wait for the next round
      await wait(3800);
      await snap('6-eaten');
      const again = page.locator('.g-death .kb-btn--pink:not([disabled])');
      if ((await again.count()) > 0) {
        await click('.g-death .kb-btn--pink');
        await page.waitForFunction(() => window.__elymum.useUi.getState().screen === 'lobby', null, { timeout: 8000 }).catch(() => {});
        await page.waitForFunction(() => !document.querySelector('.kl-cta')?.disabled, null, { timeout: 15000 }).catch(() => {});
        await wait(800);
        await buyTicket(false).catch(() => problems.push('could not buy back in before the bell'));
      } else {
        await wait(1500);
      }
    } else {
      await wait(500);
    }
    sc = await screen();
  }
  if (sc === 'roundover') {
    await wait(1400);
    await snap('6-bell');
    await page.waitForFunction(() => !!window.__elymum.useUi.getState().lastSettlement, null, { timeout: 15000 }).catch(() => problems.push('no settlement'));
    await wait(1200);
    const s = await page.locator('.g-roundover__slip').boundingBox().catch(() => null);
    if (s) await moveTo(s.x + s.width * 0.6, s.y + s.height * 0.7);
    await wait(2800);
    await snap('6-paid');
    await click('.g-roundover .kb-btn--paper');
    await page.waitForFunction(() => window.__elymum.useUi.getState().screen === 'lobby', null, { timeout: 8000 }).catch(async () => {
      problems.push('round-over sheet close did not return to the lobby; screen=' + (await screen()));
      await page.keyboard.press('Escape');
    });
    await wait(1800);
    await snap('6-lobby');
  } else {
    problems.push(`no round-over sheet within ${ROUND_WAIT_MS / 1000} s (screen=${sc}); is ROUND_SECONDS set on the stack?`);
    await wait(1000);
    await page.keyboard.press('Escape');
    await wait(500);
    if ((await screen()) !== 'lobby') await ui(() => window.__elymum.engine.backToLobby());
    await wait(1500);
  }
}

if (!QUICK) {
  // 7 · Standings
  await chapter('7 · Standings');
  await wheel(-1400, 120, 30);
  await click('.kl-sections__item:has-text("Ranks")');
  await wait(1600);
  await snap('7-ranks');
  const rows = page.locator('.nw-table tr, .nw-table li, .nw-row');
  const nrows = Math.min(4, await rows.count());
  for (let i = 1; i < nrows; i++) await hover(rows.nth(i), { fx: 0.3, pause: 450 }).catch(() => {});
  // Today / All time (the server's off-chain standings; no prizes)
  const tabs = page.locator('.nw-tabs [role="tab"]');
  if ((await tabs.count()) >= 2) {
    await click(tabs.nth(1));
    await wait(1700);
    await snap('7-alltime');
    await click(tabs.nth(0));
    await wait(900);
  }
  await wheel(400, 60, 50);
  await wait(1500);

  // 8 · Profile
  await chapter('8 · Profile');
  await wheel(-1200, 120, 30);
  await click('.kl-sections__item:has-text("Profile")');
  await wait(1800);
  await snap('8-profile');
  await hover('.pf-card', { fx: 0.5, fy: 0.4, pause: 800 }).catch(() => {});
  await wheel(450, 60, 60);
  await wait(1800);
  await wheel(-450, 90, 30);

  // 9 · Guide
  await chapter('9 · Guide');
  await click('.kl-sections__item:has-text("Guide")');
  await wait(1800);
  await snap('9-guide');
  await moveTo(700, 450);
  for (let i = 0; i < 6; i++) { await wheel(260, 65, 70); await wait(900); }
  // scroll the fee-example receipts into view, by wheel
  for (let i = 0; i < 40; i++) {
    const top = await ui(() => document.querySelector('#docs-payout .dc-fee')?.getBoundingClientRect().top ?? null);
    if (top === null || top < 160) break;
    await wheel(Math.min(260, top - 120), 65, 60);
    await wait(250);
  }
  await wait(2600);
  await snap('9-fees');
  await wheel(380, 65, 70);
  await wait(2400);
}

// 10 · back to the lobby, end card
if (!QUICK) {
  await wheel(-6000, 400, 20);
  await click('.kl-sections__item:has-text("Tickets")');
}
await wait(1400);
await moveTo(820, 380);
await wait(800);
chapters.push({ label: 'End · Elymum', at: Date.now() / 1000 });
await ui(() => window.__caption?.('Elymum', 0, true));
await wait(2800);
await snap('10-end');

await cdp.send('Page.stopScreencast');
const end = Date.now() / 1000;
if (audioStart !== null) {
  // the last chunk arrives after `stop`; give it a moment to cross into Node
  await ui(() => new Promise((res) => {
    const rec = window.__recAudio;
    rec.onstop = () => setTimeout(res, 400);
    rec.stop();
  })).catch(() => {});
}
await wait(300);
await ctx.close();
await browser.close();
await stopStack();

if (frames.length < 2) {
  console.error('The screencast produced no frames; nothing to encode.');
  process.exit(1);
}
let concat = '';
for (let i = 0; i < frames.length; i++) {
  const dur = (i + 1 < frames.length ? frames[i + 1] : end) - frames[i];
  concat += `file 'frames/f${String(i).padStart(5, '0')}.jpg'\nduration ${Math.max(0.001, dur).toFixed(4)}\n`;
}
concat += `file 'frames/f${String(frames.length - 1).padStart(5, '0')}.jpg'\n`;
writeFileSync(`${out}/frames.txt`, concat);
const first = frames[0];
const chaptersOut = chapters.map((c) => ({ ...c, t: +(c.at - first).toFixed(2) }));
writeFileSync(`${out}/chapters.json`, JSON.stringify({ start: first, recStart, audioStart, end, chapters: chaptersOut }, null, 2));
log('frames', frames.length, 'duration', (end - first).toFixed(1));

const video = `${out}/${QUICK ? 'elymum-quick' : 'elymum-walkthrough'}.mp4`;
// audio: shift the capture onto the video's clock (positive: it started after the first frame)
const audioFile = `${out}/audio.webm`;
const hasAudio = audioStart !== null && audioChunks.length > 0;
let audioArgs = [];
if (hasAudio) {
  writeFileSync(audioFile, Buffer.concat(audioChunks));
  const offset = audioStart - first;
  const shift = offset >= 0 ? `adelay=${Math.round(offset * 1000)}:all=1` : `atrim=start=${(-offset).toFixed(3)},asetpts=PTS-STARTPTS`;
  audioArgs = ['-i', audioFile, '-map', '0:v', '-map', '1:a', '-af', `${shift},apad`, '-shortest', '-c:a', 'aac', '-b:a', '160k'];
  log('audio', `${(Buffer.concat(audioChunks).length / 1024).toFixed(0)} KB`, `offset ${offset.toFixed(3)} s`);
} else if (AUDIO) {
  problems.push('audio: nothing was captured; the video is silent');
}
const enc = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${out}/frames.txt`, ...audioArgs, '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-movflags', '+faststart', video], { stdio: 'inherit' });
if (enc.status !== 0) {
  console.error('ffmpeg failed to encode the video.');
  process.exit(1);
}
console.log('video:', video);

// Highlights reel (full runs): the first ~6.5 s of every chapter.
if (!QUICK) {
  const segs = chaptersOut.filter((c) => c.t >= 0).map((c) => [Math.max(0, c.t + 1), c.t + 7.5]);
  const range = (a, b) => `start=${a.toFixed(2)}:end=${b.toFixed(2)}`;
  const f = segs.map(([a, b], i) => `[0:v]trim=${range(a, b)},setpts=PTS-STARTPTS[v${i}];` + (hasAudio ? `[0:a]atrim=${range(a, b)},asetpts=PTS-STARTPTS[a${i}];` : '')).join('');
  const l = segs.map((_, i) => `[v${i}]` + (hasAudio ? `[a${i}]` : '')).join('');
  const hl = `${out}/elymum-highlights.mp4`;
  const graph = hasAudio ? `${f}${l}concat=n=${segs.length}:v=1:a=1[cv][out_a];[cv]fps=30,format=yuv420p[out]` : `${f}${l}concat=n=${segs.length}:v=1:a=0,fps=30,format=yuv420p[out]`;
  const maps = hasAudio ? ['-map', '[out]', '-map', '[out_a]', '-c:a', 'aac', '-b:a', '160k'] : ['-map', '[out]'];
  const r2 = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', video, '-filter_complex', graph, ...maps, '-c:v', 'libx264', '-preset', 'medium', '-crf', '26', '-movflags', '+faststart', hl], { stdio: 'inherit' });
  if (r2.status === 0) console.log('highlights:', hl);
}
if (!flag('--keep-frames')) {
  rmSync(`${out}/frames`, { recursive: true, force: true });
  rmSync(`${out}/frames.txt`, { force: true });
  rmSync(audioFile, { force: true });
}
console.log(JSON.stringify(chaptersOut.map((c) => [c.label, c.t])));
console.log('problems:\n' + (problems.slice(-40).join('\n') || 'none'));
process.exit(0);
