#!/usr/bin/env node
// Take "arena": Daphne (recorded, 1920x1080, effects-only audio) in Penny Pond with staged rivals:
// other wallets holding real tickets, played from tiny browsers. The director gives the scene beats:
//   0. the rivals buy in first and pick up loot, so they carry more than Daphne's 1,000;
//   1. lobby -> ticket -> arena (Daphne starts low in the standings); she forages and grows;
//   2. rival 1 runs into her: eaten head-on (+value, she climbs the standings);
//   3. rival 2 comes close and turns to run: she splits onto it;
//   4. rival 3 runs into a bot near her: its tokens spill as loot and she collects them;
//   5. a brush with a big coin and an escape; an emote; cash-out, receipt, PAID stamp.
// A rival that is eaten by a bot before its beat buys a new ticket and comes back.
//   node media/gameplay/capture/take-arena.mjs [--name arena] [--arena 1] [--grow 90] [--loot 50]
import { resolve } from 'node:path';
import { CACHE, Player, Recorder, launch, log, sleep } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const NAME = opt('--name', 'arena');
const ARENA = Number(opt('--arena', '1'));
const GROW = Number(opt('--grow', '90'));
const LOOT_S = Number(opt('--loot', '50'));
const T0 = Date.now();

const browser = await launch();
const rivals = [
  { name: 'mochi_moon', skin: 2 },
  { name: 'bonk_bae', skin: 7 },
  { name: 'lil_lamport', skin: 9 },
].map((r) => new Player(browser, { ...r, w: 480, h: 270, audio: 'off', quality: 'low', minimap: false, tick: 90 }));
const hero = new Player(browser, { name: 'Daphne', skin: 4, keyPath: resolve(CACHE, 'keys/daphne.json'), audio: 'sfx' });

let stopAll = false;
const heroPos = { wx: 3200, wy: 3200, big: 30, mass: 0 };
const plan = new Map();
const pidOf = (p) => p.ui(() => window.__slana.useUi.getState().me?.pid);
const distTo = (r) => (r.pos && !r.dead ? Math.hypot(r.pos.wx - heroPos.wx, r.pos.wy - heroPos.wy) : Infinity);
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
async function rivalLoop(r) {
  while (!stopAll) {
    const f = plan.get(r);
    const o = f ? f() : { mode: 'free', noFood: true, noCells: true, loot: 12, margin: 320 };
    const p = await r.brain({ reach: 44, ...o }).catch(() => ({ wait: true }));
    if (p.dead) {
      r.dead = true;
      if (r.eaten || stopAll) return; // its beat is done
      log(`${r.o.name} lost early; new ticket`);
      await sleep(2500);
      await r.click('.g-death .kb-btn--pink').catch(() => r.page.keyboard.press('Escape'));
      await r.page.waitForFunction(() => window.__slana.useUi.getState().screen === 'lobby', null, { timeout: 10000 }).catch(() => {});
      await r.page.waitForFunction(() => !document.querySelector('.kl-cta')?.disabled, null, { timeout: 25000 }).catch(() => {});
      await enter(r).catch((e) => log('rebuy failed', e.message));
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
/** Drives Daphne while cond() holds, at most ms. o may be a (async) function, re-read every tick. */
async function heroWhile(ms, o, cond) {
  const t0 = Date.now();
  let lastLog = 0;
  while (Date.now() - t0 < ms) {
    if (cond && !(await cond())) return 'cond';
    const oo = typeof o === 'function' ? await o() : o;
    const p = await hero.brain(oo);
    if (p.dead) { if (p.screen === 'cashedout') return 'cashedout'; throw new Died('Daphne died'); }
    if (!p.wait) {
      Object.assign(heroPos, { wx: p.wx, wy: p.wy, big: p.big, mass: p.mass });
      const x = Math.max(40, Math.min(1880, p.x)), y = Math.max(40, Math.min(1040, p.y));
      const nx = hero.cur.x + (x - hero.cur.x) * 0.5, ny = hero.cur.y + (y - hero.cur.y) * 0.5;
      await hero.page.mouse.move(nx, ny, { steps: 2 });
      hero.cur = { x: nx, y: ny };
    }
    if (Date.now() - lastLog > 4000) { lastLog = Date.now(); log('mass', p.mass, 'value', p.value, 'dist', rivals.map((r) => (r.dead ? 'x' : Math.round(distTo(r)))).join(' ')); }
    await sleep(55);
  }
  return 'time';
}
const forage = () => ({ mode: 'free', humans: 0, loot: 3, margin: 260, avoidPids: rivals.filter((r) => !r.eaten).map((r) => r.pid) });
/** A beat; if Daphne dies, keep the footage, buy a new ticket, grow again and retry. */
async function beat(name, fn, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { rec.mark(name); return await fn(); } catch (e) {
      if (!(e instanceof Died)) throw e;
      rec.mark('died', { beat: name });
      log(`Daphne died during ${name}; new ticket`);
      await hero.wait(4500);
      await hero.click('.g-death .kb-btn--pink').catch(() => {});
      await hero.page.waitForFunction(() => window.__slana.useUi.getState().screen === 'lobby', null, { timeout: 10000 }).catch(() => {});
      await hero.page.waitForFunction(() => !document.querySelector('.kl-cta')?.disabled, null, { timeout: 25000 }).catch(() => {});
      await hero.wait(600);
      await hero.buyTicket(ARENA, { signDelay: 600 });
      await hero.wait(1200);
      await hero.wheel(-300, 60, 60);
      rec.mark('reenter');
      await heroWhile(80_000, forage, async () => heroPos.mass < GROW).catch(() => {});
    }
  }
  throw new Error(`beat ${name} failed`);
}
const screenOf = (pos) => hero.ui((q) => window.__slana.engine.camera.toScreen(q.wx, q.wy), pos);

try {
  // 0. rivals buy in and collect loot before Daphne arrives
  for (const r of rivals) { await r.open(); await r.login(); await enter(r); }
  const loops = rivals.map((r) => rivalLoop(r));
  log('rivals collecting loot');
  await sleep(LOOT_S * 1000);
  log('rival values', rivals.map((r) => r.pos?.value));

  // 1. Daphne
  await hero.open();
  await hero.login();
  rec = new Recorder(hero, NAME);
  await rec.start();
  await hero.wait(800);
  rec.mark('lobby');
  await hero.hover(`[role="radio"][data-kb-value="arena:${ARENA}"]`, { fx: 0.45, pause: 900 });
  rec.mark('buy');
  await hero.buyTicket(ARENA, { slow: true, signDelay: 1300 });
  rec.mark('enter');
  await hero.wait(1500);
  await hero.wheel(-300, 60, 60);
  hero.pid = await pidOf(hero);
  await beat('grow', () => heroWhile(80_000, forage, async () => heroPos.mass < GROW));
  const [r1, r2, r3] = rivals;

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
  await beat('loot', () => heroWhile(10_000, { mode: 'free', loot: 40, humans: 0, margin: 420 }));
  rec.mark('looted');

  // 5. a brush with a big coin, then away
  await beat('dodge', async () => {
    await heroWhile(8_000, { mode: 'kamikaze' }, async () => hero.ui(() => {
      const w = window.__slana.engine.world, mine = w.myCells();
      if (!mine.length) return false;
      let big = mine[0];
      for (const c of mine) if (c.r > big.r) big = c;
      for (const e of w.entities.values()) if (e.kind === 1 && e.playerId !== big.playerId && e.r > big.r * 1.15 && Math.hypot(e.x - big.x, e.y - big.y) < e.r + big.r + 260) return false;
      return true;
    }));
    rec.mark('flee');
    await heroWhile(6_000, { mode: 'free', margin: 600, humans: 0 });
  });
  await beat('emote', async () => {
    await hero.key('Digit2');
    await heroWhile(1_800, { mode: 'free', margin: 500, humans: 0 });
  });
  rec.mark('cashout');
  await hero.key('KeyC');
  await heroWhile(5_000, { mode: 'free', margin: 600, humans: 0 }).catch((e) => log(e.message));
  await hero.page.waitForFunction(() => window.__slana.useUi.getState().screen === 'cashedout', null, { timeout: 15000 }).catch(() => log('no cashedout'));
  rec.mark('receipt');
  await hero.page.waitForFunction(() => !!window.__slana.useUi.getState().lastSettlement, null, { timeout: 20000 }).catch(() => log('no settlement'));
  rec.mark('paid');
  await hero.wait(5500);
  stopAll = true;
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
