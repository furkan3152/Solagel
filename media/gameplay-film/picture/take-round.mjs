#!/usr/bin/env node
// Take "round": the /play lobby, a ticket for Asphodel Meadow, the drop-in, and one paid round to
// the bell with staged rivals (other wallets with real fake-chain tickets, steered from small
// browsers over the same WebSocket). The rivals that are meant to be eaten keep themselves small
// (they spit mass, W, whenever they pass 36), so the beats do not depend on luck:
//   bonk_bae    buys in when the round opens and grows all round; later it turns on Daphne for a
//               few seconds (she runs, the near miss ends in a "phew") and gives up;
//   mochi_moon, pixel_penny, rug_ruth   join as she drops in and come to her: she eats them (the
//               first is the film's first eat, the value flies into the till);
//   lil_wei     joins later, comes close, turns and runs: she splits onto it;
// then she plays safe through the final minute and the last ten seconds to the bell and the
// landing report. Daphne is recorded as a journal (rendered later by replay.mjs).
//   node take-round.mjs [--name round] [--join 262]
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hand, TAKES as FILM_TAKES } from './lib.mjs';
const { FilmPlayer } = await import('./players.mjs');
const { Recorder, TAKES, launch, log, sleep } = await import('../../gameplay/capture/lib.mjs');

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const NAME = opt('--name', 'round');
const ARENA = 1;
const JOIN_S = Number(opt('--join', '262'));
const SAFE_S = 70;
const BEATS = opt('--beats', 'snacks,threat,split').split(',');
const GROW_SPLIT = Number(opt('--grow', '0'));
const T0 = Date.now();
const browser = await launch();
const mk = (name, skin) => new FilmPlayer(browser, { name, skin, w: 1280, h: 720, audio: 'off', quality: 'low', minimap: false, tick: 90 });
const bonk = mk('bonk_bae', 7), lil = mk(opt('--lil', 'lil_wei'), 9);
const snacks = BEATS.includes('snacks') ? [mk('mochi_moon', 2), mk('pixel_penny', 3), mk('rug_ruth', 5)] : [];
const rivals = [...(BEATS.includes('threat') ? [bonk] : []), ...snacks, lil];
for (const r of [...snacks, lil]) r.shrink = true;
const hero = new FilmPlayer(browser, { name: 'Daphne', skin: 4, audio: 'off', keyPath: opt('--key') ? resolve(FILM_TAKES, 'keys', opt('--key') + '.key') : undefined, journal: resolve(FILM_TAKES, `journal-${NAME}.jsonl`) });

let stopAll = false;
const H = { wx: 3200, wy: 3200, big: 30, mass: 20 };
const plan = new Map();
const loops = [];
const pidOf = (p) => p.ui(() => window.__elymum.useUi.getState().me?.pid);
const distTo = (r) => (r.pos && !r.dead ? Math.hypot(r.pos.wx - H.wx, r.pos.wy - H.wy) : Infinity);
const leftS = async () => ((await hero.round(ARENA))?.left ?? 0) / 1000;
let rec;

async function enter(r) {
  await r.page.setViewportSize({ width: 1280, height: 720 }); r.o.w = 1280; r.o.h = 720;
  await r.buyTicket(ARENA, { signDelay: 150 });
  await r.page.setViewportSize({ width: 192, height: 108 }); r.o.w = 192; r.o.h = 108;
  r.pid = await pidOf(r);
  r.dead = false; r.pos = null; r.lastW = 0;
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
    const o = f ? f() : { mode: 'still' };
    const p = await r.brain({ reach: 44, ...o }).catch(() => ({ wait: true }));
    if (p.dead) {
      r.dead = true;
      if (r.done || stopAll || p.screen === 'roundover') return;
      log(`${r.o.name} lost early; buys back in`);
      await sleep(2500);
      try { await buyBack(r); await enter(r); } catch (e) { log('rebuy failed', e.message); await sleep(2000); }
      continue;
    }
    if (!p.wait) {
      r.pos = { wx: p.wx, wy: p.wy, big: p.big, value: p.value, mass: p.mass };
      await r.page.mouse.move(Math.max(4, Math.min(r.o.w - 4, p.x)), Math.max(4, Math.min(r.o.h - 4, p.y))).catch(() => {});
      // the snacks stay snack-sized: spit mass (W) above 36
      if (r.shrink && !r.noShrink && p.mass >= 36 && Date.now() - r.lastW > 260) { r.lastW = Date.now(); await r.page.keyboard.press('KeyW').catch(() => {}); }
    }
    await sleep(r.o.tick);
  }
}
const late = (r) => enter(r).then(() => loops.push(rivalLoop(r))).catch((e) => log('entry failed', r.o.name, e.message));
/** Comes at her once she is clearly bigger; until then waits at a distance. */
const approach = (r, ratio = 1.4) => () => {
  if (!r.pos) return { mode: 'still' };
  if (H.mass > (r.pos.mass || 20) * ratio) {
    return distTo(r) < 650
      ? { mode: 'bait', pid: hero.pid, wx: H.wx, wy: H.wy, noFood: true, noCells: true, margin: -300, splitMargin: 0 }
      : { mode: 'bait', pid: hero.pid, wx: H.wx, wy: H.wy, noFood: true, noCells: true, margin: 60, splitMargin: 160 };
  }
  const a = Math.atan2(r.pos.wy - H.wy, r.pos.wx - H.wx);
  return { mode: 'goto', wx: H.wx + Math.cos(a) * 1000, wy: H.wy + Math.sin(a) * 1000, noFood: true, noCells: true, margin: 120, splitMargin: 200 };
};
const run = () => ({ mode: 'free', noFood: true, noCells: true, loot: 0, margin: 900, splitMargin: 0 });

class Died extends Error {}
class Late extends Error {}
async function heroWhile(ms, o, cond, { late: lateCheck = true } = {}) {
  const t0 = Date.now();
  let lastLog = 0;
  while (Date.now() - t0 < ms) {
    if (cond && !(await cond())) return 'cond';
    if (lateCheck && (await leftS()) < SAFE_S) throw new Late('final minute');
    const oo = typeof o === 'function' ? await o() : o;
    const p = await hero.brain(oo);
    if (p.dead) { if (p.screen === 'roundover') return 'roundover'; throw new Died('Daphne died'); }
    if (!p.wait && p.split && oo.splitBots && Date.now() - (heroWhile.lastSplit || 0) > 5000) {
      heroWhile.lastSplit = Date.now();
      await hero.page.mouse.move(p.x, p.y);
      hero.cur = { x: p.x, y: p.y };
      await sleep(40);
      await hero.key('Space');
      rec.mark('split', { mass: p.mass });
    }
    if (!p.wait) {
      Object.assign(H, { wx: p.wx, wy: p.wy, big: p.big, mass: p.mass });
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
const forage = (extra = {}) => ({ mode: 'free', humans: 0, loot: 3, margin: 620, splitMargin: 700, avoidPids: rivals.map((r) => r.pid), ...extra });
async function guard(name, fn) {
  try { rec.mark(name, { left: await leftS() }); return await fn(); } catch (e) {
    if (!(e instanceof Died)) throw e;
    rec.mark('died', { beat: name });
    log(`Daphne died during ${name}; buys back in`);
    if ((await leftS()) < 64) throw new Late('died in the final minute');
    await hero.wait(3200);
    await buyBack(hero);
    await hero.buyTicket(ARENA, { signDelay: 500 });
    rec.mark('reenter');
    return 'died';
  }
}
const ateLil = () => hero.ui((n) => window.__events.some((e) => e.k === 'kill' && e.v?.killer === 'Daphne' && e.v?.victim === n), lil.o.name);
const screenOf = (pos) => hero.ui((q) => window.__elymum.engine.camera.toScreen(q.wx, q.wy), pos);

try {
  for (const p of [hero, ...rivals]) { await p.open(); await p.login(); }
  const r0 = await hero.round(ARENA);
  log('round left', (r0.left / 1000).toFixed(0), 's');
  if (r0.left < 288_000 && !argv.includes('--now')) { log('waiting for the next round'); await hero.untilRound((r) => r.left > 293_000, 320_000, ARENA); }
  plan.set(bonk, () => ({ mode: 'free', humans: 0, loot: 6, margin: 420, splitMargin: 520, avoidPids: [hero.pid] }));
  if (BEATS.includes('threat')) late(bonk);

  if (!argv.includes('--now')) await hero.untilRound((r) => r.left < JOIN_S * 1000, 300_000, ARENA);

  // ── the lobby: the departures board, a look along the arenas, Asphodel Meadow, the ticket ──
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
    // ── the snacks join and come to her once she is bigger; she eats them ──
    if (BEATS.includes('snacks')) {
    for (const s of snacks) plan.set(s, approach(s));
    for (const s of snacks) late(s);
    let eaten = 0;
    const t0 = Date.now();
    while (eaten < 2 && Date.now() - t0 < 85_000) {
      const r = await guard('snacks', () => heroWhile(85_000, () => {
        const s = snacks.filter((x) => !x.done && !x.dead && x.pos && distTo(x) < 1100 && H.mass > x.pos.mass * 1.3).sort((a, b) => distTo(a) - distTo(b))[0];
        return s ? { mode: 'hunt', pid: s.pid, split: false, margin: 260, splitMargin: 360 } : forage();
      }, async () => {
        for (const s of snacks) if (!s.done && s.dead && s.wasNear) { s.done = true; eaten++; rec.mark('ateSnack', { name: s.o.name }); }
        for (const s of snacks) if (distTo(s) < 700) s.wasNear = true; else if (!s.dead) s.wasNear = false;
        return eaten < 2;
      }));
      if (r !== 'died') break;
    }
    for (const s of snacks) { s.done = true; plan.set(s, run); }
    await guard('after', () => heroWhile(4_000, forage()));
    }

    // ── the threat: a much bigger coin (bonk_bae if it grew, else the nearest big bot) ──
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
    if (BEATS.includes('threat')) await guard('threat', async () => {
      const useBonk = !!(bonk.pos && !bonk.dead && bonk.pos.mass > H.mass * 1.6);
      log('threat by', useBonk ? 'bonk_bae' : 'a bot', bonk.pos?.mass, 'hero', H.mass);
      if (useBonk) plan.set(bonk, () => (distTo(bonk) < 1400 ? { mode: 'hunt', pid: hero.pid, split: false, margin: 100 } : { mode: 'goto', wx: H.wx, wy: H.wy, margin: 100 }));
      let tgt = null;
      await heroWhile(30_000, async () => {
        if (useBonk) return forage();
        tgt = await big();
        return tgt ? { mode: 'goto', wx: tgt.x, wy: tgt.y, margin: -400, splitMargin: 0 } : forage();
      }, async () => (useBonk ? distTo(bonk) > bonk.pos.big + H.big + 520 : !tgt || tgt.d > tgt.r + H.big + 460));
      rec.mark('chase', { by: useBonk ? 'bonk_bae' : 'bot' });
      await heroWhile(4_500, forage({ margin: 780, splitMargin: 880 }));
      if (useBonk) plan.set(bonk, () => ({ mode: 'free', humans: 0, loot: 6, margin: 420, avoidPids: [hero.pid] }));
      rec.mark('givesUp');
      await heroWhile(4_000, forage({ margin: 780, splitMargin: 880 }));
    });

    // ── the split: lil_wei joins, waits until she is far bigger, comes close, turns and runs ──
    if (BEATS.includes('botsplit')) {
      await guard('grow', () => heroWhile(200_000, forage(), async () => H.mass < (GROW_SPLIT || 140)));
      // a smaller coin in split range (nothing big near where the half lands): aim, Space, follow
      const prey = () => hero.ui(() => {
        const e = window.__elymum.engine, w = e.world, mine = w.myCells();
        if (mine.length !== 1) return null;
        const c = mine[0];
        let best = null;
        for (const en of w.entities.values()) {
          if (en.kind !== 1 || en.playerId === c.playerId || en.dying) continue;
          const d = Math.hypot(en.x - c.x, en.y - c.y);
          if (en.r * 1.15 > c.r / Math.SQRT2 || en.r < c.r * 0.18) continue;
          if (d < c.r * 1.1 || d > c.r * 2.0 + 300) continue;
          let safe = true;
          for (const o of w.entities.values()) if (o.kind === 1 && o.playerId !== c.playerId && o.playerId !== en.playerId && o.r > c.r * 0.6 && Math.hypot(o.x - en.x, o.y - en.y) < o.r + 320) safe = false;
          if (safe && (!best || d < best.d)) best = { d, ...e.camera.toScreen(en.x, en.y), pid: en.playerId };
        }
        return best;
      });
      await guard('botsplit', async () => {
        for (let n = 0; n < 12; n++) {
          let q = null;
          await heroWhile(200_000, forage({ split: false }), async () => !(q = await prey().catch(() => null)));
          if (!q) continue;
          await hero.page.mouse.move(q.x, q.y);
          hero.cur = { x: q.x, y: q.y };
          await sleep(40);
          await hero.key('Space');
          const t = Date.now();
          rec.mark('split', { pid: q.pid });
          await heroWhile(2600, { mode: 'hunt', pid: q.pid, split: false, margin: 200 });
          const ate = await hero.ui((t0) => window.__events.some((e) => e.k === 'kill' && e.v?.killer === 'Daphne' && e.t * 1000 >= t0 - 100), t);
          log('split', ate ? 'ate' : 'missed');
          if (ate) return;
          await heroWhile(7000, forage({ split: false }));
        }
      });
      rec.mark('splitAte');
      await guard('after', () => heroWhile(8000, forage({ split: false })));
    }
    if (GROW_SPLIT && !BEATS.includes('botsplit')) await guard('grow', () => heroWhile(150_000, forage(), async () => H.mass < GROW_SPLIT));
    if (BEATS.includes('snacks') || !BEATS.includes('split')) { plan.set(lil, approach(lil, 2.7)); if (BEATS.includes('split')) await late(lil); }
    // split-only takes: lil_wei waits (small, spitting), then edges away slowly as she comes; she
    // closes in and splits onto it
    if (!BEATS.includes('snacks') && BEATS.includes('split')) {
      // lil joins only now (fresh and small), wherever it lands; she goes to it
      plan.set(lil, () => ({ mode: 'still' }));
      await late(lil);
      for (let k = 0; k < 3 && !lil.done; k++) {
        const res = await guard('hunt', async () => {
          let split = 0, fled = false;
          lil.noShrink = false;
          plan.set(lil, () => {
            if (!lil.pos) return { mode: 'still' };
            // it sits (a small coin minding its food) until the lunge comes, then runs
            if (!split) return { mode: 'still' };
            if (!fled) { fled = true; rec.mark('flees'); }
            const a = Math.atan2(lil.pos.wy - H.wy, lil.pos.wx - H.wx);
            return { mode: 'goto', wx: lil.pos.wx + Math.cos(a) * 400, wy: lil.pos.wy + Math.sin(a) * 400, noFood: true, noCells: true, margin: -1000, splitMargin: 0 };
          });
          await heroWhile(150_000, async () => {
            const d = distTo(lil);
            if (!split && lil.pos && H.mass > lil.pos.mass * 2.6 && d < H.big * 1.6 + 220 && d > H.big * 1.05) {
              const s = await screenOf(lil.pos);
              await hero.page.mouse.move(s.x, s.y);
              hero.cur = { x: s.x, y: s.y };
              await sleep(40);
              await hero.key('Space');
              split = Date.now();
              rec.mark('split');
            }
            if (split && Date.now() - split > 6000 && !lil.dead) { split = 0; fled = false; }
            if (H.mass < 90 || !lil.pos) return forage();
            return { mode: 'goto', wx: lil.pos.wx, wy: lil.pos.wy, margin: 160, splitMargin: 240, split: false };
          }, async () => !(await ateLil()));
          lil.done = true; rec.mark('ateSplit');
        });
        if (res !== 'died') break;
      }
    }
    for (let k = 0; k < 2 && !lil.done && BEATS.includes('split') && BEATS.includes('snacks'); k++) {
      const res = await guard('hunt', async () => {
        let fled = false, split = 0;
        await heroWhile(60_000, async () => {
          const d = distTo(lil);
          const ready = lil.pos && H.mass > lil.pos.mass * 2.7;
          if (ready && !fled && d < H.big * 2.2 + 460) { fled = true; lil.noShrink = true; plan.set(lil, run); rec.mark('flees'); }
          if (fled && !split && d < H.big * 2.0 + 300 && lil.pos) {
            const s = await screenOf(lil.pos);
            await hero.page.mouse.move(s.x, s.y);
            hero.cur = { x: s.x, y: s.y };
            await sleep(40);
            await hero.key('Space');
            split = Date.now();
            rec.mark('split');
          }
          if (split && Date.now() - split > 9000) { split = 0; fled = false; plan.set(lil, approach(lil, 2.7)); }
          if (!ready) return forage();
          return d < 1100 ? { mode: 'hunt', pid: lil.pid, split: false, margin: 160, splitMargin: 120 } : { mode: 'goto', wx: lil.pos?.wx ?? H.wx, wy: lil.pos?.wy ?? H.wy, margin: 160, splitMargin: 240 };
        }, async () => !lil.dead);
        if (lil.dead) { lil.done = true; rec.mark('ateSplit'); }
      });
      if (res !== 'died') break;
    }
    await guard('roam', () => heroWhile(150_000, forage({ split: false, margin: 700, splitMargin: 800 })));
  } catch (e) {
    if (!(e instanceof Late)) throw e;
    log('beats end:', e.message);
  }
  for (const r of rivals) { r.done = true; plan.set(r, r === bonk ? () => ({ mode: 'free', humans: 0, loot: 6, margin: 420, avoidPids: [hero.pid] }) : run); }
  rec.mark('safe', { left: await leftS() });
  const safe = forage({ split: false, margin: 950, splitMargin: 900 });
  await heroWhile(Math.max(0, ((await leftS()) - 61) * 1000), safe, null, { late: false });
  await hero.untilRound((r) => r.phase === 'closing', 30_000, ARENA).catch(() => {});
  rec.mark('final', { left: await leftS() });
  await heroWhile(70_000, safe, async () => (await hero.screen()) === 'playing', { late: false });
  stopAll = true;
  await hero.page.waitForFunction(() => !!window.__elymum.useUi.getState().roundResult, null, { timeout: 15000 }).catch(() => log('no round result'));
  rec.mark('bell');
  await hero.page.waitForSelector('.g-roundover__stamp', { timeout: 25000 }).catch(() => log('no PAID stamp'));
  rec.mark('paid');
  await hero.wait(9000);
} catch (e) {
  log('ERROR', e.message);
  rec?.mark('error', { msg: e.message });
} finally {
  stopAll = true;
  if (rec) await rec.stop().catch((e) => log('stop failed', e.message));
  for (const r of rivals) await r.close();
  await hero.close();
  await browser.close();
  const src = resolve(TAKES, NAME), dst = resolve(FILM_TAKES, NAME);
  if (existsSync(src)) {
    rmSync(dst, { recursive: true, force: true });
    renameSync(src, dst);
    const m = JSON.parse(readFileSync(resolve(dst, 'events.json'), 'utf8'));
    m.kind = 'arena';
    copyFileSync(hero.o.keyPath, resolve(dst, 'wallet.key'));
    writeFileSync(resolve(dst, 'events.json'), JSON.stringify(m));
  }
  log('done', ((Date.now() - T0) / 1000).toFixed(0), 's');
}
