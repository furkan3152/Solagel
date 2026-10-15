#!/usr/bin/env node
// Take "split": free Practice; Daphne grows, then hunts smaller coins and splits onto them when one
// is in range (aim at it, Space). Each split is marked; a catch shows up as a kill in the events.
//   node media/gameplay/capture/take-split.mjs [--name split] [--grow 140] [--secs 150]
import { Player, Recorder, launch, log, sleep } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const NAME = opt('--name', 'split');
const GROW = Number(opt('--grow', '140'));
const SECS = Number(opt('--secs', '150'));
const browser = await launch();
const hero = new Player(browser, { name: 'Daphne', skin: 4, audio: 'sfx' });
let rec;
const forage = { mode: 'free', humans: 0, loot: 3, margin: 260 };
async function revive() {
  if ((await hero.screen()) === 'playing') return false;
  rec.mark('died');
  await hero.wait(3000);
  await hero.click('.g-death .kb-btn--pink').catch(() => {});
  await hero.page.waitForFunction(() => window.__slana.useUi.getState().screen === 'playing', null, { timeout: 15000 }).catch(() => {});
  await hero.wheel(-360, 60, 60);
  rec.mark('respawn');
  return true;
}
/** A smaller coin in split range, in screen pixels, or null. */
const prey = () => hero.ui(() => {
  const e = window.__slana.engine, w = e.world, mine = w.myCells();
  if (mine.length !== 1) return null;
  const c = mine[0];
  let best = null;
  for (const en of w.entities.values()) {
    if (en.kind !== 1 || en.playerId === c.playerId || en.dying) continue;
    const d = Math.hypot(en.x - c.x, en.y - c.y);
    if (en.r * 1.18 > c.r / Math.SQRT2 || en.r < c.r * 0.18) continue;
    if (d < c.r * 1.05 || d > c.r * 2.1 + 330) continue;
    // nothing bigger than a half near the landing spot
    let safe = true;
    for (const o of w.entities.values()) if (o.kind === 1 && o.playerId !== c.playerId && o.r > c.r * 0.6 && Math.hypot(o.x - en.x, o.y - en.y) < o.r + 380) safe = false;
    if (safe && (!best || d < best.d)) best = { d, ...e.camera.toScreen(en.x, en.y), pid: en.playerId };
  }
  return best;
});
try {
  await hero.open();
  await hero.practice();
  await hero.wait(1500);
  await hero.wheel(-360, 60, 60);
  rec = new Recorder(hero, NAME);
  await rec.start();
  rec.mark('grow');
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    const r = await hero.drive(3000, forage, async (p) => p.mass >= GROW);
    if (r === 'until') break;
    await revive();
  }
  rec.mark('hunt');
  let splits = 0;
  const t1 = Date.now();
  while (Date.now() - t1 < SECS * 1000) {
    const q = await prey().catch(() => null);
    if (q) {
      await hero.page.mouse.move(q.x, q.y, { steps: 2 });
      hero.cur = { x: q.x, y: q.y };
      await sleep(60);
      await hero.key('Space');
      splits++;
      rec.mark('split', { pid: q.pid });
      log('split', splits, 'at', q.pid);
      await hero.drive(2500, { mode: 'hunt', pid: q.pid, split: false, margin: 200 });
      await hero.drive(9000, forage); // let the halves merge back
    } else {
      await hero.drive(400, { ...forage, humans: 0 });
    }
    await revive();
  }
  rec.mark('end');
} catch (e) {
  log('ERROR', e.message);
} finally {
  if (rec) await rec.stop().catch((e) => log('stop failed', e.message));
  await hero.close();
  await browser.close();
}
