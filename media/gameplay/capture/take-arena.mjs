#!/usr/bin/env node
// Take "arena": one whole paid round in Penny Pond, from a mid-round join to the bell. Daphne
// (recorded, 1920x1080, effects-only audio) plays with staged rivals: other wallets holding real
// (fake-chain) tickets, played from tiny browsers. Rounds are wall-clock aligned (5 minutes by
// default), so the script waits for a round to open and times every beat by the round clock:
//   0. a round opens: four rivals buy in; the fourth runs into a bot at once, so its tokens spill
//      as loot and the other three sweep it up (they now carry more than a fresh 1,000 ticket);
//   1. about 4:00 before the bell Daphne buys a ticket in the lobby ("Round ends in 4:0x") and
//      drops in mid-round, low in the standings; she forages and grows;
//   2. rival 1 runs into her: eaten head-on (+value, she climbs the standings);
//   3. rival 2 comes close and turns to run: she splits onto it;
//   4. rival 3 runs into a bot near her: its tokens spill as loot and she collects them;
//   5. she plays safe through the final minute (joins closed) and the 10 s countdown;
//   6. the bell: the world freezes, the "Round over" receipt, the PAID stamp once settled.
// If Daphne is eaten before the final minute she buys back in from the death sheet (the same
// round, the same fee) and the beat is tried again. A rival eaten too early buys back in as well.
//   node media/gameplay/capture/take-arena.mjs [--name arena] [--arena 1] [--grow 90] [--join 240]
import { resolve } from 'node:path';
import { CACHE, Player, Recorder, launch, log, sleep } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const NAME = opt('--name', 'arena');
const ARENA = Number(opt('--arena', '1'));
const GROW = Number(opt('--grow', '90'));
/** Seconds before the bell at which Daphne's recording starts (she joins ~12 s later). */
const JOIN_S = Number(opt('--join', '252'));
/** Beats stop this many seconds before the bell; from here on she only plays safe. */
const SAFE_S = 72;
const T0 = Date.now();

const browser = await launch();
const rivals = [
  { name: 'mochi_moon', skin: 2 },
  { name: 'bonk_bae', skin: 7 },
  { name: 'lil_lamport', skin: 9 },
  { name: 'rug_ruth', skin: 5, spiller: true },
].map((r) => new Player(browser, { ...r, w: 480, h: 270, audio: 'off', quality: 'low', minimap: false, tick: 90 }));
const hero = new Player(browser, { name: 'Daphne', skin: 4, keyPath: resolve(CACHE, 'keys/daphne.json'), audio: 'sfx' });

let stopAll = false;
const heroPos = { wx: 3200, wy: 3200, big: 30, mass: 0 };
const plan = new Map();
const pidOf = (p) => p.ui(() => window.__slana.useUi.getState().me?.pid);
const distTo = (r) => (r.pos && !r.dead ? Math.hypot(r.pos.wx - heroPos.wx, r.pos.wy - heroPos.wy) : Infinity);
const leftS = async () => ((await hero.round(ARENA))?.left ?? 0) / 1000;
let rec;

async function enter(r) {
  await r.page.setViewportSize({ width: 480, height: 270 });
  r.o.w = 480; r.o.h = 270;
  await r.buyTicket(ARENA, { signDelay: 150 });
  // from now on the rival only steers: a tiny window costs almost nothing to draw
  await r.page.setViewportSize({ width: 192, height: 108 });
  r.o.w = 192; r.o.h = 108;
  r.pid = await pidOf(r);
  r.dead = false;
  r.pos = null;
  log(`${r.o.name} in as ${r.pid}`);
}
/** Death sheet -> "Buy back in" (opens the ticket sheet for the same arena) -> sign. */
async function buyBack(p, o = {}) {
  await p.page.waitForSelector('.g-death .kb-btn--pink', { timeout: 8000 });
  await p.wait(o.pause ?? 400);
  await p.click('.g-death .kb-btn--pink', { before: o.before ?? 200 });
  await p.page.waitForFunction(() => window.__slana.useUi.getState().screen === 'lobby', null, { timeout: 10000 }).catch(() => {});
  await p.page.waitForFunction(() => !!document.querySelector('.tf-sheet') || !document.querySelector('.kl-cta')?.disabled, null, { timeout: 25000 }).catch(() => {});
}
async function rivalLoop(r) {
  while (!stopAll) {
    const f = plan.get(r);
    const o = f ? f() : { mode: 'free', noFood: true, noCells: true, loot: 12, margin: 320 };
    const p = await r.brain({ reach: 44, ...o }).catch(() => ({ wait: true }));
    if (p.dead) {
      r.dead = true;
      if (r.eaten || stopAll || p.screen === 'roundover') return; // its beat is done
      log(`${r.o.name} lost early; buys back in`);
      await sleep(2500);
      try {
        await buyBack(r);
        await enter(r);
      } catch (e) { log('rebuy failed', e.message); await sleep(2000); }
      continue;
    }
    if (!p.wait) {
      r.pos = { wx: p.wx, wy: p.wy, big: p.big, value: p.value };
      await r.page.mouse.move(Math.max(4, Math.min(r.o.w - 4, p.x)), Math.max(4, Math.min(r.o.h - 4, p.y))).catch(() => {});
    }
    await sleep(r.o.tick);
  }
}
const bait = (r) => () => (distTo(r) < 650
  ? { mode: 'bait', pid: hero.pid, wx: heroPos.wx, wy: heroPos.wy, noFood: true, noCells: true, margin: -300, splitMargin: 0 }
  : { mode: 'bait', pid: hero.pid, wx: heroPos.wx, wy: heroPos.wy, noFood: true, noCells: true, margin: 40, splitMargin: 120 });
const run = () => ({ mode: 'free', noFood: true, noCells: true, loot: 0, margin: 700, splitMargin: 0 });
const goTo = (r) => ({ mode: 'goto', wx: r.pos?.wx ?? heroPos.wx, wy: r.pos?.wy ?? heroPos.wy, margin: 120, splitMargin: 200 });

class Died extends Error {}
class Late extends Error {}
/** Drives Daphne while cond() holds, at most ms. o may be a (async) function, re-read every tick. */
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
    if (Date.now() - lastLog > 4000) { lastLog = Date.now(); log('left', (await leftS()).toFixed(0), 'mass', p.mass, 'value', p.value, 'dist', rivals.map((r) => (r.dead ? 'x' : Math.round(distTo(r)))).join(' ')); }
    await sleep(55);
  }
  return 'time';
}
const forage = () => ({ mode: 'free', humans: 0, loot: 3, margin: 260, avoidPids: rivals.filter((r) => !r.eaten).map((r) => r.pid) });
/** A beat; if Daphne is eaten, keep the footage, buy back in, grow again and retry. */
async function beat(name, fn, tries = 3) {
  if ((await leftS()) < SAFE_S) throw new Late(name);
  for (let i = 0; i < tries; i++) {
    try { rec.mark(name); return await fn(); } catch (e) {
      if (!(e instanceof Died)) throw e;
      rec.mark('died', { beat: name });
      log(`Daphne died during ${name}; buys back in`);
      if ((await leftS()) < 64) throw new Late('died in the final minute');
      await hero.wait(3200);
      rec.mark('buyback');
      await buyBack(hero, { pause: 900, before: 500 });
      await hero.buyTicket(ARENA, { signDelay: 600 });
      await hero.wait(1200);
      await hero.wheel(-300, 60, 60);
      rec.mark('reenter');
      await heroWhile(60_000, forage, async () => heroPos.mass < GROW);
    }
  }
  throw new Error(`beat ${name} failed`);
}
const screenOf = (pos) => hero.ui((q) => window.__slana.engine.camera.toScreen(q.wx, q.wy), pos);

try {
  // every browser signs in first; then a fresh round (the next bell if this one is under way)
  for (const p of [hero, ...rivals]) { await p.open(); await p.login(); }
  let r0 = await hero.round(ARENA);
  log('round left', (r0.left / 1000).toFixed(0), 's');
  if (r0.left < 285_000) {
    log('waiting for the next round');
    await hero.untilRound((r) => r.left > 293_000, 320_000, ARENA);
  }
  // 0. rivals buy in together; the spiller feeds the floor with loot, the others sweep it up
  await Promise.all(rivals.map((r) => enter(r)));
  const spiller = rivals[3];
  spiller.eaten = true;
  plan.set(spiller, () => ({ mode: 'kamikaze' }));
  const loops = rivals.map((r) => rivalLoop(r));
  log('rivals collecting loot');
  await hero.untilRound((r) => r.left < JOIN_S * 1000, 300_000, ARENA);
  log('rival values', rivals.map((r) => r.pos?.value));

  // 1. Daphne, mid-round
  rec = new Recorder(hero, NAME);
  await rec.start();
  await hero.wait(800);
  rec.mark('lobby');
  await hero.hover(`[role="radio"][data-kb-value="arena:${ARENA}"]`, { fx: 0.45, pause: 1400 });
  rec.mark('buy');
  await hero.buyTicket(ARENA, { slow: true, signDelay: 1300 });
  rec.mark('enter', { left: await leftS() });
  await hero.wait(1500);
  await hero.wheel(-300, 60, 60);
  hero.pid = await pidOf(hero);
  const [r1, r2, r3] = rivals;
  try {
    await beat('grow', () => heroWhile(70_000, forage, async () => heroPos.mass < GROW));

    // 2. rival 1 comes at Daphne and is eaten head-on
    await beat('hunt1', async () => {
      plan.set(r1, bait(r1));
      await heroWhile(40_000, () => (distTo(r1) < 900 ? { mode: 'hunt', pid: r1.pid, split: false, margin: 200 } : goTo(r1)), async () => !r1.dead);
    });
    r1.eaten = true;
    rec.mark('ate1');
    await beat('after1', () => heroWhile(4_000, forage));

    // 3. rival 2 comes close, turns and runs: Daphne splits onto it
    await beat('hunt2', async () => {
      plan.set(r2, bait(r2));
      let fled = false, split = 0;
      await heroWhile(45_000, async () => {
        const d = distTo(r2);
        if (!fled && d < heroPos.big * 2.2 + 460) { fled = true; plan.set(r2, run); rec.mark('r2flees'); }
        if (fled && !split && heroPos.mass >= 60 && d < heroPos.big * 2.0 + 300 && r2.pos) {
          const s = await screenOf(r2.pos);
          await hero.page.mouse.move(s.x, s.y);
          hero.cur = { x: s.x, y: s.y };
          await sleep(40);
          await hero.key('Space');
          split = Date.now();
          rec.mark('split');
        }
        return d < 1100 ? { mode: 'hunt', pid: r2.pid, split: false, margin: 160, splitMargin: 120 } : goTo(r2);
      }, async () => !r2.dead);
    });
    r2.eaten = true;
    rec.mark('ate2');
    await beat('after2', () => heroWhile(4_000, forage));

    // 4. rival 3 comes near, then runs into a bot: its tokens spill as loot
    await beat('spill', async () => {
      plan.set(r3, bait(r3));
      await heroWhile(35_000, () => ({ ...forage(), noCells: true }), async () => distTo(r3) > 750 && !r3.dead);
      r3.eaten = true;
      plan.set(r3, () => ({ mode: 'kamikaze' }));
      rec.mark('kamikaze');
      await heroWhile(25_000, () => ({ ...goTo(r3), noCells: true, margin: 300, avoidPids: [r3.pid] }), async () => !r3.dead);
    });
    rec.mark('spilled');
    await beat('loot', () => heroWhile(12_000, { mode: 'free', loot: 40, humans: 0, margin: 420 }));
    rec.mark('looted');
    await beat('emote', async () => {
      await hero.key('Digit2');
      await heroWhile(1_800, { mode: 'free', margin: 500, humans: 0 });
    });
    // more play until the beats run out of time
    await beat('roam', () => heroWhile(120_000, { mode: 'free', loot: 8, humans: 0.3, margin: 420 }));
  } catch (e) {
    if (!(e instanceof Late)) throw e;
    log('beats end:', e.message);
  }

  // 5. the final minute: joins close, the chip turns mustard; play safe to the bell
  rec.mark('safe', { left: await leftS() });
  const safe = { mode: 'free', loot: 6, humans: 0, margin: 700, splitMargin: 600, split: false };
  let res = await heroWhile(SAFE_S * 1000 - 61_000, safe, null, { late: false });
  await hero.untilRound((r) => r.phase === 'closing', 30_000, ARENA).catch(() => {});
  rec.mark('final', { left: await leftS() });
  res = await heroWhile(48_000, safe, async () => (await leftS()) > 11.2, { late: false });
  rec.mark('count', { left: await leftS() });
  stopAll = true; // rivals stop steering; their coins stay in the room until the bell
  res = await heroWhile(16_000, safe, async () => (await hero.screen()) === 'playing', { late: false });
  // 6. the bell, the frozen world, the receipt
  await hero.page.waitForFunction(() => !!window.__slana.useUi.getState().roundResult, null, { timeout: 15000 }).catch(() => log('no round result'));
  rec.mark('bell');
  await hero.page.waitForFunction(() => window.__slana.useUi.getState().screen === 'roundover', null, { timeout: 15000 }).catch(() => log('no roundover screen'));
  rec.mark('receipt');
  await hero.page.waitForSelector('.g-roundover__stamp', { timeout: 25000 }).catch(() => log('no PAID stamp'));
  rec.mark('paid');
  await hero.wait(6500);
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
  log('done', ((Date.now() - T0) / 1000).toFixed(0), 's');
}
