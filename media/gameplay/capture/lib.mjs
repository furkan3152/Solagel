// Capture toolkit for the Slana gameplay and how-to-play videos.
//
// Drives the real web app (`pnpm demo`, fake chain) with Playwright and records takes:
//   - video: CDP screencast frames (JPEG) with their timestamps, conformed afterwards to a
//     60 fps CFR mezzanine (`video.mp4`, nearest frame, so time t is frame round(t*60));
//   - audio: the dev audio tap (`window.__slanaAudioTap`, the master bus after the limiter)
//     through MediaRecorder, aligned to the first video frame (`audio.wav`);
//   - telemetry: a 10 Hz log of the HUD and of where things are on screen (my coin, threats,
//     prey, the arena round: ms to the bell and its phase) plus discrete events (value floats,
//     kills, banners, screens, the bell's "Round over" result, a held ticket), in take time
//     (`events.json`). The edit scripts use it to find the moments and to frame them.
// Extra players (other wallets) can join the same room with a small, silent browser: the
// staged rivals of a scene. Nothing here changes the app; it is only played.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, renameSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const CACHE = resolve(ROOT, 'media/gameplay/cache');
export const TAKES = resolve(CACHE, 'takes');
const require = createRequire(resolve(ROOT, 'apps/web/package.json'));
const { chromium } = require('playwright');
const { installDevWallet, loadOrCreateKeypair } = await import(resolve(ROOT, 'scripts/lib/dev-wallet.mjs'));
import { attachJournal } from './journal.mjs';

export const BASE = process.env.SLANA_URL || 'http://localhost:5173/play';
export const CHROME = process.env.CHROME_PATH;
export const FFMPEG = process.env.FFMPEG || '/usr/bin/ffmpeg';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
export const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a);

/** Software raster is faster than SwiftShader GL for this 2D-canvas game (~45 fps at 1080p on 4 cores). */
export async function launch() {
  return chromium.launch({
    executablePath: CHROME,
    args: ['--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--disable-smooth-scrolling', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
}

// ───────────────────────────── in-page helpers (telemetry + steering brain) ─────────────────────────────
export function pageHelpers() {
  const K = { Cell: 1, Food: 2, Eject: 3, Virus: 4, PowerUp: 5, Loot: 6 };
  window.__mouse = { x: 0, y: 0 };
  window.addEventListener('mousemove', (e) => (window.__mouse = { x: e.clientX, y: e.clientY }), true);
  const keys = [];
  window.addEventListener('keydown', (e) => keys.push({ t: Date.now() / 1000, code: e.code }), true);

  function scan() {
    const S = window.__slana;
    if (!S) return null;
    const st = S.useUi.getState();
    if (st.screen !== 'playing') return { screen: st.screen };
    const e = S.engine, w = e.world;
    const mine = w.myCells();
    if (!mine.length) return { screen: st.screen, wait: true };
    let mx = 0, my = 0, mass = 0, big = 0;
    for (const c of mine) { const m = c.r * c.r; mx += c.x * m; my += c.y * m; mass += m; big = Math.max(big, c.r); }
    mx /= mass; my /= mass;
    const ids = new Set(mine.map((c) => c.id));
    const others = [];
    for (const en of w.entities.values()) {
      if (ids.has(en.id) || en.dying) continue;
      const dx = en.x - mx, dy = en.y - my;
      others.push({ en, d: Math.hypot(dx, dy) || 1, dx, dy });
    }
    return { S, st, e, w, mine, mx, my, big, others, K };
  }

  /** Steering: returns a screen point for the mouse (and maybe a split) for the given mode. */
  window.__brain = (o = {}) => {
    const s = scan();
    if (!s) return { wait: true };
    if (!s.w) return { dead: s.screen !== 'playing', screen: s.screen, wait: true };
    const { e, w, mine, mx, my, big, others, K } = s;
    let fx = 0, fy = 0, best = null, bestScore = -Infinity;
    const lootW = o.loot ?? 4, humanW = o.humans ?? 1;
    const avoid = new Set(o.avoidPids || []);
    // threats first: bigger cells, with extra reach when they can split onto me
    const threats = [];
    for (const { en, d } of others) {
      if (en.kind !== K.Cell || en.r <= big * 1.1) continue;
      if ((o.mode === 'bait' && en.playerId === o.pid) || o.mode === 'kamikaze') continue;
      const splitter = en.r > big * 1.6;
      threats.push({ x: en.x, y: en.y, R: en.r * 1.6 + big + (o.margin ?? 160) + (splitter ? (o.splitMargin ?? 380) : 0) });
    }
    const unsafe = (x, y) => threats.some((t) => Math.hypot(t.x - x, t.y - y) < t.R + 80);
    for (const { en, d, dx, dy } of others) {
      if (en.kind === K.Cell) {
        const bot = w.isBot(en.playerId);
        if (en.r > big * 1.1) {
          const splitter = en.r > big * 1.6;
          const danger = en.r * 1.6 + big + (o.margin ?? 160) + (splitter ? (o.splitMargin ?? 380) : 0);
          if (o.mode !== 'kamikaze' && !(o.mode === 'bait' && en.playerId === o.pid) && d < danger) {
            const k = (danger - d) / 120; fx -= (dx / d) * k; fy -= (dy / d) * k;
          }
          continue;
        }
        if (avoid.has(en.playerId)) continue;
        if (en.r < big * 0.86) {
          let value = 6 + en.r / 5;
          if (!bot) value *= 1 + 3 * humanW;
          if (o.pid && en.playerId === o.pid) value *= 50;
          if (o.noCells) value = 0;
          if (value > 0) { const sc = value / (d + 40); if (sc > bestScore) { bestScore = sc; best = { x: en.x, y: en.y, r: en.r, kind: en.kind, d, pid: en.playerId, bot }; } }
        }
        continue;
      }
      if (en.kind === K.Virus) {
        if (big > en.r * 1.1 && d < big + en.r + 60 && !o.hitVirus) { fx -= (dx / d) * 2; fy -= (dy / d) * 2; }
        continue;
      }
      let value = 0;
      if (en.kind === K.Food || en.kind === K.Eject || en.kind === K.PowerUp) value = o.noFood ? 0 : 1 + en.r / 10;
      if (en.kind === K.Loot) value = (1 + en.r / 10) * lootW;
      if (value <= 0) continue;
      if (threats.length && unsafe(en.x, en.y)) continue;
      const edge = Math.min(en.x, en.y, w.width - en.x, w.height - en.y);
      if (edge < 1300) value *= 0.1 + 0.9 * (edge / 1300);
      const sc = value / (d + 40);
      if (sc > bestScore) { bestScore = sc; best = { x: en.x, y: en.y, r: en.r, kind: en.kind, d }; }
    }
    // targets that override the forager
    let tgt = null;
    const cellOf = (pid) => { let b = null; for (const { en, d } of others) if (en.kind === K.Cell && en.playerId === pid && (!b || en.r > b.r)) b = { x: en.x, y: en.y, r: en.r, d, pid }; return b; };
    if ((o.mode === 'hunt' || o.mode === 'bait') && o.pid) tgt = cellOf(o.pid) || (o.wx != null ? { x: o.wx, y: o.wy, d: Math.hypot(o.wx - mx, o.wy - my) } : null);
    if (o.mode === 'goto') tgt = { x: o.wx, y: o.wy, d: Math.hypot(o.wx - mx, o.wy - my) };
    if (o.mode === 'kamikaze') {
      let b = null;
      for (const { en, d } of others) if (en.kind === K.Cell && en.r > big * 1.25 && w.isBot(en.playerId) && (!b || d < b.d)) b = { x: en.x, y: en.y, r: en.r, d };
      tgt = b;
    }
    if (o.mode === 'virus') {
      let b = null;
      for (const { en, d } of others) if (en.kind === K.Virus && (!b || d < b.d)) b = { x: en.x, y: en.y, r: en.r, d };
      tgt = b;
    }
    if (tgt) best = { ...best, ...tgt, kind: 0 };
    // walls
    const m = 600 + big; // walls: keep the camera off the world edge
    if (mx < m) fx += (m - mx) / 120; if (my < m) fy += (m - my) / 120;
    if (mx > w.width - m) fx -= (mx - (w.width - m)) / 120; if (my > w.height - m) fy -= (my - (w.height - m)) / 120;
    let vx = 0, vy = 0;
    if (best) { vx = (best.x - mx) / (best.d || 1); vy = (best.y - my) / (best.d || 1); }
    let flee = o.mode === 'still' ? 0 : Math.hypot(fx, fy);
    // in danger: take the direction with the most room (flee vectors cancel when surrounded)
    const inDanger = o.mode !== 'still' && threats.some((t) => Math.hypot(t.x - mx, t.y - my) < t.R);
    if (inDanger) {
      let bestA = null, bestC = -Infinity;
      const pref = best ? Math.atan2(vy, vx) : null;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const px = mx + Math.cos(a) * 420, py = my + Math.sin(a) * 420;
        let c = Infinity;
        for (const t of threats) c = Math.min(c, Math.hypot(t.x - px, t.y - py) - t.R);
        const wall = Math.min(px - big, py - big, w.width - big - px, w.height - big - py);
        c = Math.min(c, wall * 1.5);
        if (pref !== null) c += Math.cos(a - pref) * 60;
        c -= Math.hypot(px - w.width / 2, py - w.height / 2) * 0.12;
        if (c > bestC) { bestC = c; bestA = a; }
      }
      vx = Math.cos(bestA); vy = Math.sin(bestA);
      flee = 2;
    } else if (flee > 0.3) { const f = Math.min(1, flee); vx = (fx / flee) * f + vx * (1 - f); vy = (fy / flee) * f + vy * (1 - f); }
    if (!best && !inDanger && flee <= 0.3) { const cx = w.width / 2 - mx, cy = w.height / 2 - my, cd = Math.hypot(cx, cy) || 1; vx = cx / cd; vy = cy / cd; }
    // a pull toward open water when near the walls
    const edgeMe = Math.min(mx, my, w.width - mx, w.height - my);
    if (!inDanger && edgeMe < 1500 && o.mode !== 'still') { const k = (1500 - edgeMe) / 1500 * 1.1; const cx = w.width / 2 - mx, cy = w.height / 2 - my, cd = Math.hypot(cx, cy) || 1; vx += (cx / cd) * k; vy += (cy / cd) * k; }
    const vn = Math.hypot(vx, vy) || 1;
    const me = e.camera.toScreen(mx, my);
    const reach = o.reach ?? 340;
    let p = o.mode === 'still' ? me : { x: me.x + (vx / vn) * reach, y: me.y + (vy / vn) * reach };
    if (best && best.d < big * 1.2 && o.mode !== 'still' && !inDanger) p = e.camera.toScreen(best.x, best.y);
    // split at a running human (or the hunted pid) when it is safe and in range
    let split = false;
    if (o.split !== false && best && best.pid && (!best.bot || o.splitBots) && flee < 0.2 && mine.length < (o.maxCells ?? 3)) {
      const half = big / Math.SQRT2;
      if (best.r * 1.13 < half && best.d < big * 2.2 + 330 && best.d > big * 0.9) { split = true; p = e.camera.toScreen(best.x, best.y); }
    }
    return { x: p.x, y: p.y, split, flee, mass: s.st.hud.mass, big, d: best?.d ?? null, wx: mx, wy: my, value: s.st.hud.value };
  };

  /** One telemetry sample: HUD + where my coin, threats and prey sit on screen. */
  window.__sample = () => {
    const S = window.__slana;
    const t = Date.now() / 1000;
    if (!S) return { t };
    const st = S.useUi.getState();
    const out = { t, screen: st.screen, mouse: window.__mouse, hud: st.hud, round: window.__round(), held: st.held ? 1 : 0, lb: (st.lb || []).slice(0, 10).map((r) => [r.name, r.value ?? r.mass ?? r.score ?? 0, r.pid === st.me?.pid ? 1 : 0]) };
    if (st.screen !== 'playing' && st.screen !== 'dead' && st.screen !== 'roundover') return out;
    const s = scan();
    if (!s || !s.w) return out;
    const { e, w, mine, mx, my, big, others, K } = s;
    const me = e.camera.toScreen(mx, my);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of mine) { const p = e.camera.toScreen(c.x, c.y), r = c.r * e.camera.zoom; x0 = Math.min(x0, p.x - r); y0 = Math.min(y0, p.y - r); x1 = Math.max(x1, p.x + r); y1 = Math.max(y1, p.y + r); }
    out.me = { x: me.x, y: me.y, r: big * e.camera.zoom, box: [x0, y0, x1, y1], n: mine.length };
    out.zoom = e.camera.zoom;
    const near = [];
    for (const { en, d } of others) {
      if (en.kind !== K.Cell && en.kind !== K.Virus && en.kind !== K.Loot) continue;
      if (d > 1600) continue;
      const p = e.camera.toScreen(en.x, en.y);
      if (p.x < -200 || p.y < -200 || p.x > e.camera.w + 200 || p.y > e.camera.h + 200) continue;
      const tag = en.kind === K.Virus ? 'v' : en.kind === K.Loot ? 'l' : en.r > big * 1.1 ? 'T' : en.r < big * 0.9 ? 'p' : 'c';
      near.push([tag, Math.round(p.x), Math.round(p.y), Math.round(en.r * e.camera.zoom), en.kind === K.Cell ? (w.isBot(en.playerId) ? 0 : en.playerId) : -1]);
    }
    out.near = near.slice(0, 60);
    return out;
  };

  /**
   * The arena round on screen (or of the Penny Pond room in the lobby): ms to the bell and the
   * phase ('open' | 'closing'). Rounds are wall-clock aligned and the demo server runs on this
   * machine, so the local clock is the server's.
   */
  window.__round = (arenaId) => {
    const S = window.__slana;
    if (!S) return null;
    const st = S.useUi.getState();
    let r = st.room?.mode === 'arena' && (arenaId == null || st.room.arenaId === arenaId) ? st.room.round : null;
    if (!r) r = (st.rooms || []).find((q) => q.mode === 'arena' && q.arenaId === (arenaId ?? 1))?.round;
    if (!r) return null;
    const now = Date.now();
    const len = Math.round(r.endsAt / (r.n + 1)); // round n ends at (n + 1) * roundMs
    let ends = r.endsAt;
    while (ends <= now) ends += len;
    const close = ends - (r.endsAt - r.joinsCloseAt);
    return { left: ends - now, phase: now >= close ? 'closing' : 'open', n: Math.round(ends / len) - 1 };
  };

  /** Discrete events from the store (exact times). */
  window.__events = [];
  const hook = () => {
    const S = window.__slana;
    if (!S || window.__hooked) return;
    window.__hooked = true;
    S.useUi.subscribe((s, p) => {
      const t = Date.now() / 1000, push = (k, v) => window.__events.push({ t, k, v });
      if (s.valueDelta && s.valueDelta !== p.valueDelta) push('value', { ...s.valueDelta, value: s.hud.value });
      if (s.screen !== p.screen) push('screen', s.screen);
      if (s.killfeed.length && s.killfeed[s.killfeed.length - 1] !== p.killfeed[p.killfeed.length - 1]) push('kill', s.killfeed[s.killfeed.length - 1]);
      if (s.banner !== p.banner && s.banner) push('banner', s.banner.kind);
      if (s.hud.rank !== p.hud.rank) push('rank', { rank: s.hud.rank, players: s.hud.players });
      if (s.hud.cells !== p.hud.cells) push('cells', s.hud.cells);
      if (s.roundResult && s.roundResult !== p.roundResult) push('roundResult', s.roundResult);
      if (!!s.held !== !!p.held) push('held', s.held);
      if (s.lastSettlement && s.lastSettlement !== p.lastSettlement) push('settled', s.lastSettlement);
      if (s.death && !p.death) push('death', s.death.killer);
      if (s.chat.length !== p.chat.length && s.chat.length) push('chat', s.chat[s.chat.length - 1]?.text);
    });
  };
  const iv = setInterval(() => { if (window.__slana) { hook(); clearInterval(iv); } }, 200);
  window.__keys = keys;
}

/** The init scripts of a player's context (also used by the replay): settings, wallet, helpers. */
export async function setupContext(ctx, o) {
  const settings = {
    name: o.name, skin: o.skin, theme: o.theme, quality: o.quality, showNames: true, showMass: true, showFps: false, showMinimap: o.minimap, showChat: true,
    announcer: false,
    ...(o.audio === 'off' ? { sound: false, volume: 0 } : { sound: true, volume: 0.8 }),
    ...(o.audio === 'music' ? { musicOn: true, music: 0.9, sfxOn: false, sfx: 0 } : {}),
    ...(o.audio === 'sfx' ? { musicOn: false, music: 0, sfxOn: true, sfx: 0.8 } : {}),
    ...(o.audio === 'mix' ? { musicOn: true, music: 0.35, sfxOn: true, sfx: 0.8 } : {}),
    ...(o.settings || {}),
  };
  await ctx.addInitScript((s) => {
    if (!sessionStorage.getItem('__set')) { localStorage.setItem('slana.settings.v1', JSON.stringify(s)); sessionStorage.setItem('__set', '1'); }
    // captures keep one look: no automatic quality drop
    localStorage.setItem('slana.autoQuality', 'off');
  }, settings);
  const kp = o.keyPath ? loadOrCreateKeypair(o.keyPath) : undefined;
  await installDevWallet(ctx, kp);
  await ctx.addInitScript(pageHelpers);
}

// ───────────────────────────── a player (one browser context) ─────────────────────────────
export class Player {
  constructor(browser, o) {
    this.browser = browser;
    this.o = { name: 'Daphne', skin: 4, w: 1920, h: 1080, audio: 'sfx', quality: 'high', theme: 'light', minimap: true, ...o };
    this.cur = { x: this.o.w / 2, y: this.o.h / 2 };
  }

  async open() {
    const o = this.o;
    this.ctx = await this.browser.newContext({ viewport: { width: o.w, height: o.h }, locale: 'en-US' });
    // a journal take: everything the page receives is logged for the frame-exact replay (journal.mjs)
    if (o.journal) {
      mkdirSync(dirname(o.journal), { recursive: true });
      // the replay needs the same wallet (its address is on screen)
      o.keyPath ||= `${o.journal}.key.json`;
      await attachJournal(this.ctx, o.journal);
    }
    await setupContext(this.ctx, o);
    this.page = await this.ctx.newPage();
    this.problems = [];
    this.page.on('pageerror', (e) => this.problems.push(`[pageerror] ${e.message}`));
    this.page.on('console', (m) => m.type() === 'error' && this.problems.push(`[console.error] ${m.text()}`));
    await this.page.goto(BASE, { waitUntil: 'networkidle' });
    await this.page.waitForFunction(() => !!window.__slana && window.__slana.useUi.getState().connected, null, { timeout: 30000 });
    await this.page.waitForFunction(() => !!window.__slanaChain, null, { timeout: 20000 });
    await this.page.mouse.move(this.cur.x, this.cur.y);
    if (o.noDraw || o.journal) {
      // a staged rival only needs to steer: skip its canvas work (a patch of this page only)
      await this.ui(() => { const e = window.__slana.engine; e.renderer.draw = () => {}; e.renderer.drawMinimap = () => {}; });
    }
    return this;
  }

  ui(fn, arg) { return this.page.evaluate(fn, arg); }
  screen() { return this.ui(() => window.__slana.useUi.getState().screen); }
  wait(ms) { return this.page.waitForTimeout(ms); }

  async moveTo(x, y, speed = 1) {
    const d = Math.hypot(x - this.cur.x, y - this.cur.y);
    const steps = Math.max(8, Math.round(d / 14 / speed));
    const rnd = (a, b) => a + Math.random() * (b - a);
    const mx = (this.cur.x + x) / 2 + rnd(-0.08, 0.08) * d, my = (this.cur.y + y) / 2 + rnd(-0.08, 0.08) * d;
    const sx = this.cur.x, sy = this.cur.y;
    for (let i = 1; i <= steps; i++) {
      const t0 = i / steps;
      const t = t0 < 0.5 ? 2 * t0 * t0 : 1 - Math.pow(-2 * t0 + 2, 2) / 2;
      await this.page.mouse.move((1 - t) * (1 - t) * sx + 2 * (1 - t) * t * mx + t * t * x, (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * my + t * t * y);
      await this.wait(12);
    }
    this.cur = { x, y };
  }
  async box(sel, nth = 0) {
    const loc = typeof sel === 'string' ? this.page.locator(sel).nth(nth) : sel;
    await loc.waitFor({ state: 'visible', timeout: 15000 });
    for (let i = 0; i < 30; i++) {
      const b = await loc.boundingBox();
      if (!b) break;
      if (b.y + Math.min(b.height, 80) > this.o.h - 30) await this.wheel(Math.min(320, b.y + Math.min(b.height, 80) - (this.o.h - 160)), 80, 40);
      else if (b.y < 20) await this.wheel(-Math.min(320, 160 - b.y), 80, 40);
      else break;
      await this.wait(220);
    }
    return loc.boundingBox();
  }
  async hover(sel, { fx = 0.5, fy = 0.5, nth = 0, pause = 700, speed = 1 } = {}) {
    const b = await this.box(sel, nth);
    await this.moveTo(b.x + b.width * fx, b.y + b.height * fy, speed);
    await this.wait(pause);
  }
  async click(sel, opts = {}) {
    await this.hover(sel, { pause: 0, ...opts });
    await this.wait(opts.before ?? 300);
    await this.page.mouse.down();
    await this.wait(70);
    await this.page.mouse.up();
    await this.wait(opts.after ?? 450);
  }
  async wheel(total, step = 80, gap = 45) {
    // a journal take is replayed frame by frame: many small notches scroll smoothly at the same speed
    if (this.o.journal) { const rate = step / gap; step = Math.max(20, Math.abs(total) / 60); gap = Math.max(8, step / rate); }
    const n = Math.max(1, Math.round(Math.abs(total) / step));
    for (let i = 0; i < n; i++) { await this.page.mouse.wheel(0, Math.sign(total) * step); await this.wait(gap); }
  }
  async key(code, holdMs = 60) { await this.page.keyboard.down(code); await this.wait(holdMs); await this.page.keyboard.up(code); }

  async login() {
    await this.click('.kl-wallet');
    await this.page.waitForSelector('.wl-sheet', { timeout: 5000 });
    await this.wait(600);
    await this.click('.wl-item');
    await this.page.waitForFunction(() => !!window.__slana.useUi.getState().auth, null, { timeout: 15000 });
    await this.page.waitForFunction(() => window.__slanaChain?.useChainData.getState().tokenBalance != null, null, { timeout: 15000 });
    await this.wait(800);
  }

  async practice() {
    await this.click('[role="radio"][data-kb-value="practice"]', { fx: 0.4 });
    await this.wait(300);
    await this.click('.kl-cta');
    await this.page.waitForFunction(() => window.__slana.useUi.getState().screen === 'playing', null, { timeout: 20000 });
  }

  /** Buys an arena ticket through the lobby sheet and waits for the room. */
  async buyTicket(arena = 1, { slow = false, signDelay = 900, held = false } = {}) {
    // "Buy back in" on the death sheet opens the ticket sheet by itself
    const open = await this.page.locator('.tf-sheet').isVisible().catch(() => false);
    if (!open) {
      await this.click(`[role="radio"][data-kb-value="arena:${arena}"]`, { fx: 0.45 });
      await this.wait(slow ? 700 : 300);
      await this.click('.kl-cta');
    }
    await this.page.waitForSelector('.tf-sheet', { timeout: 8000 });
    await this.wait(slow ? 1400 : 500);
    if (slow && this.onSheet) await this.onSheet(this);
    await this.ui((ms) => { if (window.__slanaChain?.fakeWallet) window.__slanaChain.fakeWallet.delayMs = ms; }, signDelay);
    await this.click('.tf-sheet .kb-btn--pink', { before: slow ? 600 : 200 });
    if (held) {
      // joins are closed: the lobby holds the ticket and joins by itself at the bell
      await this.page.waitForFunction(() => { const s = window.__slana.useUi.getState(); return s.screen === 'playing' || !!s.held; }, null, { timeout: 15000 });
      return (await this.screen()) === 'playing' ? 'playing' : 'held';
    }
    try {
      const ok = await this.page.waitForFunction(() => window.__slana.useUi.getState().screen === 'playing', null, { timeout: 15000 }).then(() => true, () => false);
      if (!ok) {
        // the ticket is open but the room did not start: the lobby offers "Resume"
        log(`${this.o.name}: resume`);
        await this.click('.kl-cta');
        await this.page.waitForFunction(() => window.__slana.useUi.getState().screen === 'playing', null, { timeout: 20000 });
      }
    } catch (e) {
      mkdirSync(resolve(CACHE, 'debug'), { recursive: true });
      await this.page.screenshot({ path: resolve(CACHE, `debug/buy-${this.o.name}.png`) }).catch(() => {});
      const st = await this.ui(() => { const s = window.__slana.useUi.getState(); return { screen: s.screen, toasts: s.toasts.map((t) => t.text), modal: s.modal }; }).catch(() => null);
      throw new Error(`buyTicket(${this.o.name}) failed: ${JSON.stringify(st)} ${this.problems.slice(-3).join(' | ')}`);
    }
  }

  brain(o) { return this.ui((o) => window.__brain(o), o); }
  /** The round of arena `arenaId` (default: the room on screen, else Penny Pond): {left (ms), phase, n}. */
  round(arenaId) { return this.ui((a) => window.__round(a), arenaId ?? null); }
  /** Waits until pred(round) holds (polls every 250 ms). */
  async untilRound(pred, timeoutMs = 400_000, arenaId) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) { const r = await this.round(arenaId); if (r && pred(r)) return r; await this.wait(250); }
    throw new Error('untilRound timed out');
  }

  /** Steers with the brain for `ms` (or until `until()` is true); presses Space when it says so. */
  async drive(ms, o = {}, until = null) {
    const t0 = Date.now();
    let lastSplit = 0;
    while (Date.now() - t0 < ms) {
      const p = await this.brain(typeof o === 'function' ? o() : o);
      if (p.dead) return 'dead';
      if (until && (await until(p))) return 'until';
      if (p.wait) { await this.wait(120); continue; }
      const x = Math.max(40, Math.min(this.o.w - 40, p.x)), y = Math.max(40, Math.min(this.o.h - 40, p.y));
      const k = this.o.smooth ?? 0.5;
      const nx = this.cur.x + (x - this.cur.x) * k, ny = this.cur.y + (y - this.cur.y) * k;
      await this.page.mouse.move(nx, ny, { steps: 2 });
      this.cur = { x: nx, y: ny };
      const so = typeof o === 'function' ? {} : o;
      if (p.split && so.split !== false && Date.now() - lastSplit > (so.splitGap ?? 4000)) {
        await this.page.mouse.move(x, y);
        this.cur = { x, y };
        await this.wait(40);
        await this.key('Space');
        lastSplit = Date.now();
        this.splits = (this.splits || 0) + 1;
      }
      await this.wait(this.o.tick ?? 60);
    }
    return 'ok';
  }

  async close() { await this.ctx?.close().catch(() => {}); }
}

// ───────────────────────────── recorder (screencast + audio tap + telemetry) ─────────────────────────────
export class Recorder {
  constructor(player, name, { video = true } = {}) {
    this.p = player;
    this.name = name;
    // a player with a journal records no pixels: capture/replay.mjs renders the take afterwards
    this.journal = !!player.o.journal;
    this.video = this.journal ? false : video;
    this.dir = resolve(TAKES, name);
  }

  async start() {
    const { page, ctx } = this.p;
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir + '/frames', { recursive: true });
    this.frames = [];
    this.audio = [];
    this.samples = [];
    this.marks = [];
    if (!this.p.__exposed) {
      await page.exposeFunction('__recAudioChunk', (b64) => void this.p.__rec?.audio.push(Buffer.from(b64, 'base64')));
      this.p.__exposed = true;
    }
    this.p.__rec = this;
    this.audioStart = null;
    if (this.p.o.audio !== 'off') {
      this.audioStart = await page.evaluate(() => new Promise((res) => {
        const stream = window.__slanaAudioTap?.();
        if (!stream || typeof MediaRecorder === 'undefined') return res(null);
        const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 256000 });
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
      }));
      if (this.audioStart == null) log('WARN no audio tap');
    }
    this.cdp = await ctx.newCDPSession(page);
    this.cdp.on('Page.screencastFrame', async (f) => {
      const n = this.frames.length;
      writeFileSync(`${this.dir}/frames/f${String(n).padStart(6, '0')}.jpg`, Buffer.from(f.data, 'base64'));
      this.frames.push(f.metadata.timestamp);
      try { await this.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
    });
    await page.evaluate(() => (window.__events = []));
    this.t0 = Date.now() / 1000;
    if (this.video) await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: Number(process.env.JPEG_Q || 80), maxWidth: this.p.o.w, maxHeight: this.p.o.h, everyNthFrame: 1 });
    this.sampling = true;
    this.sampler = (async () => {
      while (this.sampling) {
        try { this.samples.push(await page.evaluate(() => window.__sample())); } catch {}
        await sleep(100);
      }
    })();
    log(`rec ${this.name} started`);
  }

  /** A named marker on the take timeline (for the edit). */
  mark(label, extra = {}) { this.marks.push({ t: Date.now() / 1000, label, ...extra }); log('mark', label); }

  async stop() {
    const { page } = this.p;
    await this.cdp.send('Page.stopScreencast').catch(() => {});
    const end = Date.now() / 1000;
    this.sampling = false;
    await this.sampler;
    if (this.audioStart != null) {
      await page.evaluate(() => new Promise((res) => { const r = window.__recAudio; r.onstop = () => setTimeout(res, 500); r.stop(); })).catch(() => {});
      await sleep(400);
    }
    const events = await page.evaluate(() => window.__events.splice(0)).catch(() => []);
    const keys = await page.evaluate(() => window.__keys.splice(0)).catch(() => []);
    this.p.__rec = null;
    await this.encode(end, events, keys);
  }

  async encode(end, events, keys) {
    if (this.journal) {
      await this.p.page.evaluate(() => window.__journal.flush()).catch(() => {});
      await sleep(800);
      renameSync(this.p.o.journal, `${this.dir}/journal.jsonl`);
      if (existsSync(`${this.p.o.journal}.key.json`)) { renameSync(`${this.p.o.journal}.key.json`, `${this.dir}/key.json`); this.p.o.keyPath = `${this.dir}/key.json`; }
      rmSync(`${this.dir}/frames`, { recursive: true, force: true });
      this.frames = [this.t0];
    } else if (!this.video) this.frames = [this.audioStart ?? this.t0];
    const fr = this.frames;
    if (fr.length < 2 && this.video) throw new Error('no frames');
    const first = fr[0];
    let concat = '';
    for (let i = 0; i < fr.length; i++) {
      const dur = (i + 1 < fr.length ? fr[i + 1] : end) - fr[i];
      concat += `file 'frames/f${String(i).padStart(6, '0')}.jpg'\nduration ${Math.max(0.001, dur).toFixed(4)}\n`;
    }
    concat += `file 'frames/f${String(fr.length - 1).padStart(6, '0')}.jpg'\n`;
    writeFileSync(`${this.dir}/frames.txt`, concat);
    const rel = (t) => +(t - first).toFixed(4);
    writeFileSync(`${this.dir}/frames.json`, JSON.stringify(fr.map(rel)));
    const meta = {
      name: this.name, w: this.p.o.w, h: this.p.o.h, frames: fr.length, ...(this.journal ? { journal: 'journal.jsonl', t0: this.t0, player: this.p.o } : {}), duration: rel(end), fps: +(fr.length / (end - first)).toFixed(1),
      marks: this.marks.map((m) => ({ ...m, t: rel(m.t) })),
      events: events.map((e) => ({ ...e, t: rel(e.t) })),
      keys: keys.map((k) => ({ ...k, t: rel(k.t) })),
      samples: this.samples.map((s) => ({ ...s, t: rel(s.t) })),
    };
    writeFileSync(`${this.dir}/events.json`, JSON.stringify(meta));
    log(`rec ${this.name}: ${fr.length} frames, ${meta.duration}s, ${meta.fps} fps`);
    // a small proxy for viewing (the edit reads the JPEG frames themselves)
    let r = !this.video ? { status: 0 } : spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${this.dir}/frames.txt`, '-vf', 'fps=30,scale=960:-2,format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', `${this.dir}/proxy.mp4`], { stdio: 'inherit', cwd: this.dir });
    if (r.status !== 0) log('WARN proxy failed');
    if (this.audioStart != null && this.audio.length) {
      writeFileSync(`${this.dir}/audio.webm`, Buffer.concat(this.audio));
      const off = this.audioStart - first;
      const shift = off >= 0 ? `adelay=${Math.round(off * 1000)}:all=1` : `atrim=start=${(-off).toFixed(3)},asetpts=PTS-STARTPTS`;
      r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', `${this.dir}/audio.webm`, '-af', `${shift},aresample=48000`, '-ac', '2', '-c:a', 'pcm_s16le', `${this.dir}/audio.wav`], { stdio: 'inherit' });
      if (r.status !== 0) log('WARN audio decode failed');
      else rmSync(`${this.dir}/audio.webm`);
    }
    if (this.video && !process.env.KEEP_FRAMES) {
      const { pack } = await import('./pack.mjs');
      pack(this.dir);
    }
    log(`rec ${this.name}: done -> ${this.dir}`);
  }
}

export function readTake(name) {
  const p = resolve(TAKES, name, 'events.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}
