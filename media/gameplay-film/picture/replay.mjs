#!/usr/bin/env node
// Renders a film take's journal at exact take times (the gameplay kit's deterministic replay,
// media/gameplay/capture/journal.mjs, on a virtual clock) and writes one JPEG per wanted time.
//   node replay.mjs <take> <times.json> <outdir> [--q 92]
// times.json: take seconds, ascending (repeats allowed). Frame k of the output is time k.
// Besides the kit's inputs it replays `scrollto` (page scroll positions the take recorded) and
// stands the same staging up again (the Dev Wallet's fake NFT chain, the emblem images).
import { copyFileSync, createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { replayShim } from '../../gameplay/capture/journal.mjs';
import { ARGS, CHROME, ROOT, TAKES, chromium, cursorInit, log } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const [NAME, TIMES, OUT] = argv;
const Q = Number(opt('--q', '92'));
const DIR = resolve(TAKES, NAME);
const meta = JSON.parse(readFileSync(resolve(DIR, 'events.json'), 'utf8'));
const times = JSON.parse(readFileSync(TIMES, 'utf8'));
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/times.json`, JSON.stringify(times));

const ws = {}, msgs = [], fetches = [], inputs = [];
let clock = null;
for await (const line of createInterface({ input: createReadStream(resolve(DIR, meta.journal)), crlfDelay: Infinity })) {
  if (!line) continue;
  const e = JSON.parse(line);
  if (e.k === 'clock') { if (clock) log('WARN second document in the journal'); clock ||= e; }
  else if (e.k === 'ws') ws[e.key] = { t: e.t };
  else if (e.k === 'wsopen') (ws[e.key] ||= {}).open = e.t;
  else if (e.k === 'wsclose' || e.k === 'm') msgs.push(e);
  else if (e.k === 'fetch') fetches.push(e);
  else if (e.k === 'in') inputs.push(e);
}
msgs.sort((a, b) => a.t - b.t);
inputs.sort((a, b) => a.t - b.t);
const T0 = meta.t0 * 1000;
const E = clock.date - clock.perf;
const vOf = (t) => T0 + t * 1000 - E;
log(`${NAME}: ${msgs.length} messages, ${fetches.length} fetches, ${inputs.length} inputs, ${times.length} frames`);

const browser = await chromium.launch({ executablePath: CHROME, args: ARGS });
const ctx = await browser.newContext({ viewport: { width: meta.w, height: meta.h }, deviceScaleFactor: 1, locale: 'en-US' });
const wsMeta = {};
for (const [k, v] of Object.entries(ws)) wsMeta[k] = { open: v.open ?? null };
await ctx.addInitScript(replayShim, { V0: clock.perf, E, ws: wsMeta, fetches });
let rpc = null;
if (meta.kind === 'card') {
  // the end card: no wallet, no staging
} else if (meta.kind === 'arena') {
  const { setupContext } = await import('../../gameplay/capture/lib.mjs');
  await ctx.addInitScript(() => localStorage.setItem('elymum.wallet.v1', 'dev.elymum.wallet'));
  await setupContext(ctx, { ...meta.player, keyPath: resolve(DIR, 'wallet.key') });
} else {
  const { installDevWallet, loadOrCreateKey } = await import(resolve(ROOT, 'scripts/lib/dev-wallet.mjs'));
  const { stageRoutes, startFakeRpc } = await import('./stage.mjs');
  rpc = await startFakeRpc();
  if (meta.seed) await ctx.addInitScript((s) => { if (s.auth) localStorage.setItem('elymum.auth.v1', s.auth); if (s.wallet) localStorage.setItem('elymum.wallet.v1', s.wallet); }, meta.seed);
  await ctx.addInitScript(() => { try { localStorage.setItem('elymum.site.sound', 'off'); } catch {} });
  await installDevWallet(ctx, loadOrCreateKey(resolve(DIR, 'wallet.key')), { rpcUrl: rpc.url, chainId: 31337 });
  await stageRoutes(ctx);
}
await ctx.addInitScript(cursorInit);
const page = await ctx.newPage();
let pageErrors = 0;
page.on('pageerror', (e) => { if (pageErrors++ < 8) log('[pageerror]', e.message); });
await page.goto(clock.href, { waitUntil: 'load' });
const cdp = await ctx.newCDPSession(page);
await page.evaluate(() => {
  window.__walletPending = 0;
  const orig = window.__devWalletRequest;
  if (orig) window.__devWalletRequest = async (...a) => { window.__walletPending++; try { return await orig(...a); } finally { window.__walletPending--; } };
});

let mi = 0, ii = 0, V = clock.perf, drawing = true;
const due = (toV) => { const out = []; while (mi < msgs.length && msgs[mi].t <= toV) out.push(msgs[mi++]); return out; };
async function dispatch(e) {
  const m = page.mouse;
  if (e.type === 'mousemove') await m.move(e.x, e.y);
  else if (e.type === 'mousedown') { await m.move(e.x, e.y); await m.down({ button: ['left', 'middle', 'right'][e.b] || 'left' }); }
  else if (e.type === 'mouseup') { await m.move(e.x, e.y); await m.up({ button: ['left', 'middle', 'right'][e.b] || 'left' }); }
  else if (e.type === 'wheel') { await m.move(e.x, e.y); await m.wheel(e.dx, e.dy); }
  else if (e.type === 'scrollanim') {}
  else if (e.type === 'scrollto' && animAt(e.t) && e.t < animAt(e.t).t + animAt(e.t).ms) {}
  else if (e.type === 'scrollto') await page.evaluate(([x, y]) => window.scrollTo(x, y), [e.x, e.y]);
  else if (e.type === 'keydown' && !e.rep) await page.keyboard.down(e.key?.length === 1 ? e.key : e.code || e.key).catch(() => {});
  else if (e.type === 'keyup') await page.keyboard.up(e.key?.length === 1 ? e.key : e.code || e.key).catch(() => {});
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
const anims = inputs.filter((e) => e.type === 'scrollanim');
const animAt = (v) => anims.find((a) => v >= a.t && v <= a.t + a.ms + 40);
async function settle() {
  // the Dev Wallet answers from Node in real time: the virtual clock waits for it
  for (let i = 0; i < 400; i++) { if (!(await page.evaluate(() => window.__walletPending || 0))) return; await new Promise((r) => setTimeout(r, 10)); }
}
async function step(toV) {
  await settle();
  while (ii < inputs.length && inputs[ii].t <= toV) {
    const e = inputs[ii++];
    await page.evaluate(([v, m]) => window.__replay.advance(v, m), [e.t, due(e.t)]);
    await dispatch(e);
  }
  await page.evaluate(([v, m]) => window.__replay.advance(v, m), [toV, due(toV)]);
  const a = animAt(toV);
  if (a) {
    const u = Math.min(1, (toV - a.t) / a.ms);
    const t = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    await page.evaluate((y) => window.scrollTo(0, y), a.y0 + a.dy * t);
  }
  await page.evaluate(() => window.__replay.frame());
  V = toV;
}
const PRE = 1500;
const t1 = Date.now();
let last = null;
for (let k = 0; k < times.length; k++) {
  const file = `${OUT}/f${String(k).padStart(5, '0')}.jpg`;
  if (last && Math.abs(times[k] - last.t) < 1e-6) { copyFileSync(last.file, file); continue; }
  const target = vOf(times[k]);
  if (target < V - 1) throw new Error(`times go backwards at ${k}`);
  if (target - V > PRE + 100) {
    await setDraw(false);
    const goal = target - PRE;
    while (goal - V > 1) {
      const nextIn = ii < inputs.length ? inputs[ii].t : Infinity;
      const to = Math.min(goal, nextIn, V + 250);
      if (to > V) { await settle(); await page.evaluate(([v, m]) => window.__replay.ffwd(v, m, 50), [to, due(to)]); V = to; }
      if (nextIn <= to) await dispatch(inputs[ii++]);
    }
  }
  await setDraw(true);
  while (target - V > 1000 / 60 + 0.5) await step(V + 1000 / 60);
  await step(target);
  await page.evaluate(() => window.__replay.paint());
  const sc = await page.evaluate(() => [scrollX, scrollY]);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: Q, clip: { x: sc[0], y: sc[1], width: meta.w, height: meta.h, scale: 1 } });
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  last = { t: times[k], file };
  if (process.env.DEBUG_EVAL) log('eval', JSON.stringify(await page.evaluate(process.env.DEBUG_EVAL).catch((e) => e.message)));
  if (process.env.DEBUG_SCROLL) log('t', times[k].toFixed(2), 'scrollY', await page.evaluate(() => scrollY));
  if (k % 60 === 0) { const el = (Date.now() - t1) / 1000; log(`${NAME}: frame ${k}/${times.length} t=${times[k].toFixed(2)} ${(k / Math.max(1, el)).toFixed(1)} fps`); }
}
const errs = await page.evaluate(() => window.__replay.errors);
await browser.close();
rpc?.close();
log(`${NAME}: done in ${((Date.now() - t1) / 60000).toFixed(1)} min; page errors ${pageErrors}, callback errors ${errs}`);
