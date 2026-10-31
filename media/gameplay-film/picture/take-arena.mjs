#!/usr/bin/env node
// Take "arena": the /play lobby, a ticket for Asphodel Meadow, the drop-in, and one paid round to
// the bell with staged rivals (other wallets with real fake-chain tickets, steered from tiny
// browsers over the same WebSocket):
//   mochi_moon  small; comes at Daphne head-on and is eaten (the first eat, the value flies);
//   bonk_bae    forages from the round's start until it is much bigger, then turns on Daphne for a
//               few seconds (she runs; the near miss ends in a "phew") and gives up;
//   lil_wei     small; comes close, turns and runs: Daphne splits onto it;
// then she plays safe through the final minute and the last ten seconds to the bell and the
// landing report. Daphne is recorded as a journal (rendered later by replay.mjs).
//   node take-arena.mjs [--name arena] [--join 262] [--grow 64]
import { copyFileSync, renameSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hand, TAKES as FILM_TAKES, WEB } from './lib.mjs';
process.env.ELYMUM_URL ||= `${WEB}/play`;
const { Player, Recorder, TAKES, launch, log, sleep } = await import('../../gameplay/capture/lib.mjs');
const { FilmPlayer } = await import('./players.mjs');

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const NAME = opt('--name', 'arena');
const ARENA = 1;
const JOIN_S = Number(opt('--join', '245'));
const GROW = Number(opt('--grow', '64'));
const SAFE_S = 72;
/** Which beats to play (a take for one beat: --beats split --short). */
const BEATS = opt('--beats', 'eat,threat,split').split(',');
const SHORT = argv.includes('--short');
const T0 = Date.now();

const browser = await launch();
const mk = (name, skin) => new FilmPlayer(browser, { name, skin, w: 480, h: 270, audio: 'off', quality: 'low', minimap: false, tick: 90 });
const r1 = mk('mochi_moon', 2), r2 = mk('bonk_bae', 7), r3 = mk('lil_wei', 9);
const feeders = [mk('pixel_penny', 3), mk('rug_ruth', 5), mk('tofu_tess', 6)];
const rivals = [r1, r2, r3, ...feeders];
r1.cap = 24; r3.cap = 21; r2.cap = 100000;
const hero = new FilmPlayer(browser, { name: 'Daphne', skin: 4, audio: 'off', journal: resolve(FILM_TAKES, `journal-${NAME}.jsonl`) });

let stopAll = false;
const heroPos = { wx: 3200, wy: 3200, big: 30, mass: 0 };
const plan = new Map();
const pidOf = (p) => p.ui(() => window.__elymum.useUi.getState().me?.pid);
const distTo = (r) => (r.pos && !r.dead ? Math.hypot(r.pos.wx - heroPos.wx, r.pos.wy - heroPos.wy) : Infinity);
const leftS = async () => ((await hero.round(ARENA))?.left ?? 0) / 1000;
let rec;

async function enter(r) {
  await r.buyTicket(ARENA, { signDelay: 150 });
  await r.page.setViewportSize({ width: 192, height: 108 });
  r.o.w = 192; r.o.h = 108;
  r.pid = await pidOf(r);
  r.dead = false; r.pos = null;
  log(`${r.o.name} in as ${r.pid}`);
}
async function buyBack(p) {
  if (p !== hero) { await p.page.setViewportSize({ width: 1280, height: 720 }); p.o.w = 1280; p.o.h = 720; }
  const btn = p.page.locator('.g-death .kb-btn--primary').first();
  await btn.waitFor({ timeout: 8000 });
  await p.wait(400);
  await btn.click();
  await p.page.waitForSelector('.tf-sheet .tf-pay', { timeout: 15000 }).catch(() => {});
}
async function rivalLoop(r) {
  while (!stopAll) {
    const f = plan.get(r);
    const big = r === r2;
    const o = f ? f() : big
      ? { mode: 'free', humans: 0, loot: 6, margin: 420, splitMargin: 520, avoidPids: [hero.pid] }
      : { mode: 'free', noFood: (r.pos?.mass ?? 0) >= r.cap, noCells: true, loot: 0, margin: 380, avoidPids: [hero.pid] };
    const p = await r.brain({ reach: 44, ...o }).catch(() => ({ wait: true }));
    if (p.dead) {
      r.dead = true;
      if (r.eaten || r.beat || stopAll || p.screen === 'roundover') return;
      log(`${r.o.name} lost early; buys back in`);
      await sleep(2500);
      try { await buyBack(r); r.o.w = 1280; r.o.h = 720; await r.page.setViewportSize({ width: 1280, height: 720 }); await enter(r); } catch (e) { log('rebuy failed', e.message); await sleep(2000); }
      continue;
    }
    if (!p.wait) {
      r.pos = { wx: p.wx, wy: p.wy, big: p.big, value: p.value, mass: p.mass };
      await r.page.mouse.move(Math.max(4, Math.min(r.o.w - 4, p.x)), Math.max(4, Math.min(r.o.h - 4, p.y))).catch(() => {});
    }
    await sleep(r.o.tick);
  }
}
const bait = (r) => () => (distTo(r) < 650
  ? { mode: 'bait', pid: hero.pid, wx: heroPos.wx, wy: heroPos.wy, noFood: true, noCells: true, margin: -300, splitMargin: 0 }
  : { mode: 'bait', pid: hero.pid, wx: heroPos.wx, wy: heroPos.wy, noFood: true, noCells: true, margin: 60, splitMargin: 160 });
const run = () => ({ mode: 'free', noFood: true, noCells: true, loot: 0, margin: 900, splitMargin: 0 });
const goTo = (r) => ({ mode: 'goto', wx: r.pos?.wx ?? heroPos.wx, wy: r.pos?.wy ?? heroPos.wy, margin: 160, splitMargin: 240 });

class Died extends Error {}
class Late extends Error {}
async function heroWhile(ms, o, cond, { late = true } = {}) {
  const t0 = Date.now();
  let lastLog = 0;
  while (Date.now() - t0 < ms) {
    if (cond && !(await cond())) return 'cond';
    if (late && (await leftS()) < SAFE_S) throw new Late('final minute');
    const oo = typeof o === 'function' ? await o() : o;
    const p = await hero.brain(oo);
    if (p.dead) { if (p.screen === 'roundover') return 'roundover'; throw new Died('Daphne died'); }
    if (!p.wait) {
      Object.assign(heroPos, { wx: p.wx, wy: p.wy, big: p.big, mass: p.mass });
      const x = Math.max(40, Math.min(1880, p.x)), y = Math.max(40, Math.min(1040, p.y));
      const nx = hero.cur.x + (x - hero.cur.x) * 0.5, ny = hero.cur.y + (y - hero.cur.y) * 0.5;
      await hero.page.mouse.move(nx, ny, { steps: 2 });
      hero.cur = { x: nx, y: ny };
    }
    if (Date.now() - lastLog > 4000) { lastLog = Date.now(); log('left', (await leftS()).toFixed(0), 'mass', p.mass, 'value', p.value, 'rivals', rivals.map((r) => (r.dead ? 'x' : `${Math.round(distTo(r))}/${Math.round(r.pos?.mass ?? 0)}`)).join(' ')); }
    await sleep(55);
  }
  return 'time';
}
const forage = () => ({ mode: 'free', humans: 0, loot: 3, margin: 620, splitMargin: 700, avoidPids: rivals.filter((r) => !r.eaten).map((r) => r.pid) });
async function beat(name, fn, tries = 3) {
  if ((await leftS()) < SAFE_S) throw new Late(name);
  for (let i = 0; i < tries; i++) {
    try { rec.mark(name, { left: await leftS() }); return await fn(); } catch (e) {
      if (!(e instanceof Died)) throw e;
      rec.mark('died', { beat: name });
      log(`Daphne died during ${name}; buys back in`);
      if ((await leftS()) < 64) throw new Late('died in the final minute');
      await hero.wait(3200);
      rec.mark('buyback');
      await buyBack(hero);
      await hero.buyTicket(ARENA, { signDelay: 600 });
      rec.mark('reenter');
      await heroWhile(50_000, forage, async () => heroPos.mass < GROW);
    }
  }
  throw new Error(`beat ${name} failed`);
}
const screenOf = (pos) => hero.ui((q) => window.__elymum.engine.camera.toScreen(q.wx, q.wy), pos);

try {
  for (const p of [hero, ...rivals]) { await p.open(); await p.login(); }
  hero.pid = null;
  const r0 = await hero.round(ARENA);
  log('round left', (r0.left / 1000).toFixed(0), 's');
  if (r0.left < 288_000) { log('waiting for the next round'); await hero.untilRound((r) => r.left > 293_000, 320_000, ARENA); }
  for (const r of rivals) { await r.page.setViewportSize({ width: 1280, height: 720 }); r.o.w = 1280; r.o.h = 720; }
  // bonk_bae buys in at once and grows all round; the two snacks join late (fresh, small)
  // bonk_bae and three feeders buy in together; bonk_bae eats the feeders (and food) to grow big
  // (not awaited: the hero's lobby keeps its time whatever the rivals' sheets do)
  const loops = [];
  const entering = Promise.all([r2, ...feeders].map((r) => enter(r).then(() => loops.push(rivalLoop(r))).catch((e) => log('entry failed', r.o.name, e.message))));
  for (const f of feeders) { f.beat = true; plan.set(f, () => (r2.pos && !r2.dead ? { mode: 'goto', wx: r2.pos.wx, wy: r2.pos.wy, noFood: true, noCells: true, margin: -400, splitMargin: 0 } : { mode: 'still' })); }
  const nextFeeder = () => feeders.filter((f) => !f.dead && f.pos).sort((a, b) => Math.hypot(a.pos.wx - r2.pos.wx, a.pos.wy - r2.pos.wy) - Math.hypot(b.pos.wx - r2.pos.wx, b.pos.wy - r2.pos.wy))[0];
  plan.set(r2, () => { const f = r2.pos && nextFeeder(); return f ? { mode: 'hunt', pid: f.pid, wx: f.pos.wx, wy: f.pos.wy, split: false, margin: 200 } : { mode: 'free', humans: 0, loot: 6, margin: 420, splitMargin: 520, avoidPids: [hero.pid] }; });

  const late = (r) => enter(r).then(() => loops.push(rivalLoop(r))).catch((e) => log('late entry failed', r.o.name, e.message));
  await hero.untilRound((r) => r.left < JOIN_S * 1000, 300_000, ARENA);
  log('rival masses', rivals.map((r) => r.pos?.mass));

  // the lobby: the departures board, a look along the arenas, then Asphodel Meadow
  rec = new Recorder(hero, NAME);
  await rec.start();
  const hand = new Hand(hero.page, hero.cur.x, hero.cur.y);
  const row = async (k, fx = 0.34) => { const bb = await hand.box(`[role="radio"][data-kb-value="arena:${k}"]`); return [bb.x + bb.width * fx, bb.y + bb.height * 0.5]; };
  await hand.move(1300, 640, 600);
  await hero.wait(600);
  rec.mark('lobby', { left: await leftS() });
  await hand.move(...(await row(4, 0.3)), 900);
  await hero.wait(350);
  await hand.move(...(await row(3, 0.31)), 500);
  await hero.wait(300);
  await hand.move(...(await row(2, 0.33)), 450);
  await hero.wait(300);
  rec.mark('pick');
  await hand.click(...(await row(1, 0.34)), 500, { before: 120 });
  await hero.wait(450);
  rec.mark('board');
  const cta = await hand.box('.kl-cta');
  await hand.click(cta.x + cta.width * 0.4, cta.y + cta.height * 0.5, 650, { before: 100 });
  await hero.page.waitForSelector('.tf-sheet .tf-pay', { timeout: 10000 });
  rec.mark('sheet');
  await hero.wait(700);
  await hero.ui((ms) => { if (window.__elymumChain?.fakeWallet) window.__elymumChain.fakeWallet.delayMs = ms; }, 450);
  const payB = await hand.box('.tf-sheet .tf-pay');
  await hand.move(payB.x + payB.width * 0.45, payB.y + payB.height * 0.5, 700);
  await hero.wait(150);
  rec.mark('pay');
  await hand.click(null, null, 0, { before: 0 });
  hero.cur = { x: hand.x, y: hand.y };
  await hero.page.waitForFunction(() => window.__elymum.useUi.getState().screen === 'playing', null, { timeout: 25000 });
  rec.mark('enter', { left: await leftS() });
  hero.pid = await pidOf(hero);
  try {
    // mochi_moon joins now and heads for her at once (a sitting coin is a bot's snack)
    r1.beat = true;
    plan.set(r1, bait(r1));
    const in1 = BEATS.includes('eat') ? late(r1) : null;
    await beat('grow', () => heroWhile(40_000, forage, async () => heroPos.mass < GROW && !(distTo(r1) < 1300)));
    if (in1) await in1;
    if (BEATS.includes('eat')) {
    // the first eat: mochi_moon comes at her head-on
    await beat('hunt1', async () => {
      r1.beat = true;
      plan.set(r1, bait(r1));
      await heroWhile(40_000, () => (distTo(r1) < 900 ? { mode: 'hunt', pid: r1.pid, split: false, margin: 200 } : goTo(r1)), async () => !r1.dead);
    });
    r1.eaten = true;
    rec.mark('ate1');
    await beat('after1', () => heroWhile(5_000, forage));
    }
    // the threat: a much bigger coin (bonk_bae if it grew, else the biggest bot near) and her escape
    if (BEATS.includes('threat')) await beat('threat', async () => {
      await heroWhile(25_000, forage, async () => !(r2.pos && !r2.dead && r2.pos.mass > heroPos.mass * 1.6));
      const useR2 = !!(r2.pos && !r2.dead && r2.pos.mass > heroPos.mass * 1.45);
      log('threat by', useR2 ? 'bonk_bae' : 'a bot', 'r2 mass', r2.pos?.mass, 'hero', heroPos.mass);
      const big = () => hero.ui((k) => {
        const e = window.__elymum.engine, w = e.world, mine = w.myCells();
        if (!mine.length) return null;
        const c = mine.reduce((a, b) => (b.r > a.r ? b : a));
        let best = null;
        for (const en of w.entities.values()) {
          if (en.kind !== 1 || en.playerId === c.playerId || en.dying || en.r < c.r * k) continue;
          const d = Math.hypot(en.x - c.x, en.y - c.y);
          if (!best || d < best.d) best = { x: en.x, y: en.y, r: en.r, d, pid: en.playerId };
        }
        return best;
      }, 1.45);
      if (useR2) plan.set(r2, () => (distTo(r2) < 1400 ? { mode: 'hunt', pid: hero.pid, split: false, margin: 100 } : { mode: 'goto', wx: heroPos.wx, wy: heroPos.wy, margin: 100 }));
      // she drifts toward it, unaware, until it is close
      let tgt = null;
      await heroWhile(30_000, async () => {
        if (useR2) return forage();
        tgt = await big();
        return tgt ? { mode: 'goto', wx: tgt.x, wy: tgt.y, margin: -400, splitMargin: 0 } : forage();
      }, async () => {
        if (useR2) return distTo(r2) > r2.pos.big + heroPos.big + 520;
        return !tgt || tgt.d > tgt.r + heroPos.big + 420;
      });
      rec.mark('chase', { by: useR2 ? 'bonk_bae' : 'bot' });
      await heroWhile(4_500, { ...forage(), margin: 760, splitMargin: 860 });
      if (useR2) plan.set(r2, () => ({ mode: 'free', humans: 0, loot: 6, margin: 420, avoidPids: [hero.pid] }));
      rec.mark('givesUp');
      await heroWhile(5_000, { ...forage(), margin: 760, splitMargin: 860 });
    });
    // the split: lil_wei comes close, turns and runs; she splits onto it
    if (BEATS.includes('split')) {
    // lil_wei joins now (fresh and small) and comes straight at her
    r3.beat = true;
    plan.set(r3, bait(r3));
    await late(r3);
    await beat('hunt3', async () => {
      await heroWhile(40_000, () => (r3.pos && distTo(r3) < 3000 ? goTo(r3) : forage()), async () => heroPos.mass < Math.max(GROW, 58) && !(distTo(r3) < 1300));
      r3.beat = true;
      plan.set(r3, bait(r3));
      let fled = false, split = 0;
      await heroWhile(45_000, async () => {
        const d = distTo(r3);
        if (!fled && d < heroPos.big * 2.2 + 460) { fled = true; plan.set(r3, run); rec.mark('r3flees'); }
        if (fled && !split && heroPos.mass >= 55 && d < heroPos.big * 2.0 + 300 && r3.pos) {
          const s = await screenOf(r3.pos);
          await hero.page.mouse.move(s.x, s.y);
          hero.cur = { x: s.x, y: s.y };
          await sleep(40);
          await hero.key('Space');
          split = Date.now();
          rec.mark('split');
        }
        return d < 1100 ? { mode: 'hunt', pid: r3.pid, split: false, margin: 160, splitMargin: 120 } : goTo(r3);
      }, async () => !r3.dead);
    });
    r3.eaten = true;
    rec.mark('ate3');
    }
    if (SHORT) { await heroWhile(12_000, forage); throw new Late('short take'); }
    await beat('roam', () => heroWhile(150_000, { mode: 'free', loot: 8, humans: 0, margin: 650, splitMargin: 750, split: false }));
  } catch (e) {
    if (!(e instanceof Late)) throw e;
    log('beats end:', e.message);
  }
  if (SHORT) throw new Error('short take: done');
  rec.mark('safe', { left: await leftS() });
  const safe = { mode: 'free', loot: 6, humans: 0, margin: 950, splitMargin: 900, split: false };
  plan.set(r2, () => ({ mode: 'free', humans: 0, loot: 6, margin: 260, avoidPids: [hero.pid] }));
  await heroWhile(Math.max(0, ((await leftS()) - 61) * 1000), safe, null, { late: false });
  await hero.untilRound((r) => r.phase === 'closing', 30_000, ARENA).catch(() => {});
  rec.mark('final', { left: await leftS() });
  await heroWhile(70_000, safe, async () => (await hero.screen()) === 'playing', { late: false });
  stopAll = true;
  await hero.page.waitForFunction(() => !!window.__elymum.useUi.getState().roundResult, null, { timeout: 15000 }).catch(() => log('no round result'));
  rec.mark('bell');
  await hero.page.waitForFunction(() => window.__elymum.useUi.getState().screen === 'roundover', null, { timeout: 15000 }).catch(() => log('no roundover screen'));
  rec.mark('receipt');
  await hero.page.waitForSelector('.g-roundover__stamp', { timeout: 25000 }).catch(() => log('no PAID stamp'));
  rec.mark('paid');
  await hero.wait(9000);
  await Promise.race([Promise.all(loops), sleep(3000)]);
} catch (e) {
  log('ERROR', e.message);
  rec?.mark('error', { msg: e.message });
} finally {
  stopAll = true;
  if (rec) await rec.stop().catch((e) => log('stop failed', e.message));
  for (const r of rivals) await r.close();
  await hero.close();
  await browser.close();
  // into the film's takes, tagged for replay.mjs
  const src = resolve(TAKES, NAME), dst = resolve(FILM_TAKES, NAME);
  if (existsSync(src)) {
    rmSync(dst, { recursive: true, force: true });
    renameSync(src, dst);
    const m = JSON.parse(readFileSync(resolve(dst, 'events.json'), 'utf8'));
    m.kind = 'arena';
    copyFileSync(hero.o.keyPath, resolve(dst, 'wallet.key'));
    m.start = process.env.ELYMUM_URL;
    writeFileSync(resolve(dst, 'events.json'), JSON.stringify(m));
  }
  log('done', ((Date.now() - T0) / 1000).toFixed(0), 's');
}
