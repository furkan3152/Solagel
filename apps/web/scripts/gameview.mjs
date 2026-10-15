// In-game view tour (Task 13): screenshots of the game, the death and round-over sheets, and fps.
// Needs a dev server (pnpm dev) whose game server runs with NODE_ENV=development DEV_FAKE_CHAIN=1 (arena steps).
// Usage: node scripts/gameview.mjs <baseUrl> <outDir> [desktop|mobile|night|arena|mobiledeath|fps|fps2|reduced ...]
// Shots are saved as <outDir>/t13-*.png; results (fps, settlement) are printed as JSON.
// Death sheets are driven by injecting a "death" message (a real death cannot be scripted).
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

// tweetnacl + bs58 come from the server package (wallet sign-in against /api/auth/nonce)
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const nacl = require('tweetnacl');
const bs58 = require('bs58').default ?? require('bs58');

const [base, out, ...which] = process.argv.slice(2);
const want = (k) => which.length === 0 || which.includes(k);
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', process.env.CHROME_PATH].filter(Boolean).find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
const logs = [];
const results = {};

async function newPage(viewport, mobile, settings = {}, extra = {}) {
  const ctx = await browser.newContext({ ...extra, viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, locale: 'en-US' });
  await ctx.addInitScript((s) => {
    const def = { name: 'Daphne', skin: 4, theme: 'light', quality: 'high', sound: false, volume: 0.6, showNames: true, showMass: true, showFps: false, showMinimap: true, showChat: true };
    localStorage.setItem('slana.settings.v1', JSON.stringify({ ...def, ...s }));
  }, settings);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && logs.push(`[console.error] ${m.text()}`));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__slana && window.__slana.useUi.getState().connected, null, { timeout: 15000 });
  await page.waitForTimeout(600);
  return { ctx, page };
}

const ev = (page, fn, arg) => page.evaluate(fn, arg);
const play = (page, room) => ev(page, (r) => window.__slana.engine.play(r), room);
const waitScreen = (page, s, timeout = 15000) => page.waitForFunction((x) => window.__slana.useUi.getState().screen === x, s, { timeout });

async function wander(page, ms, W, H, mouse = true) {
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < ms) {
    const a = i / 10;
    if (mouse) await page.mouse.move(W / 2 + Math.cos(a) * W * 0.3, H / 2 + Math.sin(a * 0.7) * H * 0.25);
    await page.waitForTimeout(100);
    i++;
  }
}

async function measureFps(page, ms = 5000) {
  return page.evaluate(async (dur) => {
    const frames = [];
    let last = performance.now();
    const t0 = last;
    await new Promise((resolve) => {
      const tick = (now) => {
        frames.push(now - last);
        last = now;
        if (now - t0 < dur) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    const e = window.__slana.engine;
    const cam = e.camera;
    const v = cam.visibleRect(0);
    let visible = 0;
    let total = 0;
    for (const ent of e.world.entities.values()) {
      total++;
      if (ent.x > v.x0 && ent.x < v.x1 && ent.y > v.y0 && ent.y < v.y1) visible++;
    }
    frames.shift();
    const sorted = [...frames].sort((a, b) => a - b);
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
    return { fps: +(1000 / avg).toFixed(1), p95ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1), frames: frames.length, visible, total };
  }, ms);
}

async function signIn(page) {
  const kp = nacl.sign.keyPair();
  const pubkey = bs58.encode(kp.publicKey);
  const res = await fetch(`${base.replace(/\/$/, '')}/api/auth/nonce?pubkey=${pubkey}`);
  const { message } = await res.json();
  const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
  await ev(page, ([p, m, s]) => window.__slana.engine.authSignature(p, m, s), [pubkey, message, sig]);
  await page.waitForFunction(() => !!window.__slana.useUi.getState().auth, null, { timeout: 10000 });
  return pubkey;
}

// ── desktop practice game + fps ──
if (want('desktop')) {
  const { ctx, page } = await newPage({ width: 1440, height: 900 }, false);
  await play(page, 'practice');
  await waitScreen(page, 'playing');
  await wander(page, 7000, 1440, 900);
  await page.keyboard.press('Digit2');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/t13-desktop-game.png` });
  results.desktopFps = await measureFps(page, 5000);
  // death sheet (practice; the death message is injected with this game's own stats)
  await ev(page, () =>
    window.__slana.engine['onMessage']({ t: 'death', stats: { aliveMs: 151_000, finalMass: 0, maxMass: 1204, foodEaten: 212, cellsEaten: 3, playersEaten: 2, bestRank: 3 }, killer: 'Nakamoto', killerSkin: 1 }),
  );
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${out}/t13-death-practice.png` });
  await ctx.close();
}

// ── mobile practice ──
if (want('mobile')) {
  const { ctx, page } = await newPage({ width: 390, height: 844 }, true);
  await play(page, 'practice');
  await waitScreen(page, 'playing');
  // hold the joystick to the right for a bit
  const stick = await page.locator('.g-stick').boundingBox();
  if (stick) {
    const cx = stick.x + stick.width / 2;
    const cy = stick.y + stick.height / 2;
    await page.touchscreen.tap(cx, cy).catch(() => {});
    await ev(page, () => window.__slana.engine.input.setStick(40, -20, 68));
  }
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(500);
    const dead = await ev(page, () => window.__slana.useUi.getState().screen !== 'playing');
    if (dead) {
      await ev(page, () => window.__slana.engine.backToLobby());
      await play(page, 'practice');
      await waitScreen(page, 'playing');
      await ev(page, () => window.__slana.engine.input.setStick(40, -20, 68));
    }
  }
  await ev(page, () => window.__slana.engine.emote(5));
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/t13-mobile-game.png` });
  results.mobileFps = await measureFps(page, 3000);
  await ctx.close();
}

// ── night theme ──
if (want('night')) {
  const { ctx, page } = await newPage({ width: 1440, height: 900 }, false, { theme: 'dark' });
  await play(page, 'practice');
  await waitScreen(page, 'playing');
  await wander(page, 5000, 1440, 900);
  await page.screenshot({ path: `${out}/t13-night-game.png` });
  await ctx.close();
}

// ── arena: the round-over sheet (DEV_FAKE_CHAIN) ──
if (want('arena')) {
  const { ctx, page } = await newPage({ width: 1440, height: 900 }, false);
  await signIn(page);
  await play(page, 'arena:1');
  await waitScreen(page, 'playing');
  await wander(page, 2500, 1440, 900);
  if (await ev(page, () => window.__slana.useUi.getState().screen !== 'playing')) {
    await ev(page, () => window.__slana.engine.backToLobby());
    await page.waitForTimeout(3500); // the fake chain settles the old ticket first
    await play(page, 'arena:1');
    await waitScreen(page, 'playing');
    await page.waitForTimeout(800);
  }
  // loot on the floor around me (client-side injection to show the sprites; a real spill needs a bot kill)
  await ev(page, () => {
    const e = window.__slana.engine;
    const me = e.world.myStats();
    if (!me) return;
    const now = performance.now();
    const ups = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      ups.push({ id: 900000 + i, kind: 6, x: me.x + Math.cos(a) * (me.maxR + 90 + (i % 3) * 40), y: me.y + Math.sin(a) * (me.maxR + 70 + (i % 2) * 50), r: 14, variant: i % 4 });
    }
    e.world.apply({ tick: 0, view: { x: me.x, y: me.y, h: 1200 }, players: [], upserts: ups, removals: [] }, now);
    e.particles.coinBurst(me.x + 240, me.y - 60, 60, 16);
  });
  await page.waitForTimeout(500);
  await ev(page, () => window.__slana.engine['onMessage']({ t: 'value', value: 2_450_000_000, delta: 1_450_000_000, reason: 'loot' }));
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${out}/t13-arena-game.png` });
  await ev(page, () => {
    const e = window.__slana.engine;
    e.world.apply({ tick: 0, view: { x: 0, y: 0, h: 1200 }, players: [], upserts: [], removals: Array.from({ length: 9 }, (_, i) => ({ id: 900000 + i, eaterId: 0 })) }, performance.now());
    window.__slana.engine['onMessage']({ t: 'value', value: 1_000_000_000, delta: -1_450_000_000, reason: 'eaten' });
  });
  await page.waitForTimeout(600);
  // arena death by a bot (injected): tokens spilled
  await ev(page, () =>
    window.__slana.engine['onMessage']({
      t: 'death',
      stats: { aliveMs: 94_000, finalMass: 0, maxMass: 640, foodEaten: 88, cellsEaten: 1, playersEaten: 1, bestRank: 5, payout: 0, valueLost: 1_450_000_000, byBot: true, lootSpilled: 1_450_000_000 },
      killer: 'Bot Rocky',
      killerSkin: 6,
    }),
  );
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${out}/t13-death-arena.png` });
  // paid arenas have no cash-out: the round ends at the bell and everyone alive is paid.
  // The roundOver message is injected here; against a stack with a short ROUND_SECONDS a real bell works too.
  await ev(page, () =>
    window.__slana.engine['onMessage']({
      t: 'roundOver',
      round: Math.floor(Date.now() / 300_000),
      payout: 1_000_000_000,
      stats: { aliveMs: 212_000, finalMass: 520, maxMass: 640, foodEaten: 88, cellsEaten: 1, playersEaten: 1, bestRank: 2, payout: 1_000_000_000 },
      standings: [
        { name: 'Nakamoto', value: 2_100_000_000 },
        { name: 'Daphne', value: 1_000_000_000, you: true },
        { name: 'Rocky', value: 640_000_000 },
        { name: 'Pixel', value: 420_000_000 },
        { name: 'Moss', value: 310_000_000 },
      ],
    }),
  );
  await waitScreen(page, 'roundover', 8000);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/t13-round-over.png` });
  results.settlement = await ev(page, () => window.__slana.useUi.getState().lastSettlement);
  await ctx.close();
}

// ── mobile death sheet (bottom sheet) ──
if (want('mobiledeath')) {
  const { ctx, page } = await newPage({ width: 390, height: 844 }, true);
  await play(page, 'practice');
  await waitScreen(page, 'playing');
  await page.waitForTimeout(1500);
  await ev(page, () =>
    window.__slana.engine['onMessage']({ t: 'death', stats: { aliveMs: 61_000, finalMass: 0, maxMass: 380, foodEaten: 40, cellsEaten: 0, playersEaten: 0, bestRank: 9 }, killer: 'Nakamoto', killerSkin: 1 }),
  );
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/t13-mobile-death.png` });
  await ctx.close();
}

// ── fps: practice room, 1440×900, ≥120 entities on screen, 3 × 5 s ──
if (want('fps')) {
  const { ctx, page } = await newPage({ width: 1440, height: 900 }, false);
  await play(page, 'practice');
  await waitScreen(page, 'playing');
  await page.mouse.move(720, 450);
  await page.waitForTimeout(2500);
  await ev(page, () => { window.__slana.engine.camera.userZoom = 0.88; });
  await page.waitForTimeout(1200);
  results.fps = [];
  for (let i = 0; i < 3; i++) {
    if (await ev(page, () => window.__slana.useUi.getState().screen !== 'playing')) {
      await ev(page, () => window.__slana.engine.backToLobby());
      await play(page, 'practice');
      await waitScreen(page, 'playing');
      await page.waitForTimeout(1500);
    }
    results.fps.push(await measureFps(page, 5000));
  }
  await ctx.close();
}

// ── fps under load: spectator camera over a practice room (200+ entities on screen) ──
if (want('fps2')) {
  const { ctx, page } = await newPage({ width: 1440, height: 900 }, false);
  // the lobby already spectates the busiest practice room: show it with the spectator camera
  await ev(page, () => window.__slana.useUi.setState({ screen: 'spectating' }));
  await page.waitForTimeout(3000);
  results.fpsSpectate = [];
  for (let i = 0; i < 3; i++) results.fpsSpectate.push(await measureFps(page, 5000));
  await page.screenshot({ path: `${out}/t13-fps-spectate.png` });
  await ctx.close();
}

// ── reduced motion: particles fade only, sheets fade ──
if (want('reduced')) {
  const { ctx, page } = await newPage({ width: 1440, height: 900 }, false, {}, { reducedMotion: 'reduce' });
  await play(page, 'practice');
  await waitScreen(page, 'playing');
  await wander(page, 2500, 1440, 900);
  results.reducedParticles = await ev(page, () => window.__slana.engine.particles.reduced);
  await ev(page, () =>
    window.__slana.engine['onMessage']({ t: 'death', stats: { aliveMs: 31_000, finalMass: 0, maxMass: 120, foodEaten: 20, cellsEaten: 0, playersEaten: 0, bestRank: 12 }, killer: 'Nakamoto', killerSkin: 1 }),
  );
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/t13-reduced-death.png` });
  await ctx.close();
}

console.log(JSON.stringify(results, null, 2));
console.log(logs.slice(-30).join('\n') || 'no page errors');
await browser.close();
