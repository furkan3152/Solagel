#!/usr/bin/env node
// Take "loot": loot on the floor and the sweep. A staged rival (rug_ruth, a real fake-chain ticket
// from a tiny browser) runs into a bot: bots carry no value, so its whole till spills as loot
// coins; Daphne heads for the spot and sweeps them up (value floats, the till climbs). Needs open joins with
// time to spare (it waits for them).
//   node media/gameplay/capture/take-loot.mjs [--name loot]
import { resolve } from 'node:path';
import { CACHE, Player, Recorder, launch, log, sleep } from './lib.mjs';

const argv = process.argv.slice(2);
const NAME = argv.includes('--name') ? argv[argv.indexOf('--name') + 1] : 'loot';
const browser = await launch();
const hero = new Player(browser, { name: 'Daphne', skin: 4, audio: 'sfx', keyPath: resolve(CACHE, 'keys/daphne.json') });
const rival = new Player(browser, { name: 'rug_ruth', skin: 5, w: 480, h: 270, audio: 'off', quality: 'low', minimap: false });
let rec, stop = false;
try {
  for (const p of [hero, rival]) { await p.open(); await p.login(); }
  await hero.untilRound((q) => q.phase === 'open' && q.left > 150_000, 330_000, 1);
  await rival.buyTicket(1, { signDelay: 150 });
  await rival.page.setViewportSize({ width: 192, height: 108 });
  rival.o.w = 192; rival.o.h = 108;
  await hero.buyTicket(1, { signDelay: 200 });
  await hero.wheel(-200, 60, 60);
  rec = new Recorder(hero, NAME);
  await rec.start();
  rec.mark('play');
  // the rival dives into the nearest big bot; Daphne heads for the spot and sweeps the loot
  const spot = { wx: null, wy: null };
  const rivalLoop = (async () => {
    rec.mark('kamikaze');
    while (!stop) {
      const p = await rival.brain({ reach: 44, mode: 'kamikaze' }).catch(() => ({ wait: true }));
      if (p.dead) { log('rival eaten'); return; }
      if (!p.wait) {
        spot.wx = p.wx; spot.wy = p.wy;
        await rival.page.mouse.move(Math.max(4, Math.min(rival.o.w - 4, p.x)), Math.max(4, Math.min(rival.o.h - 4, p.y))).catch(() => {});
      }
      await sleep(80);
    }
  })();
  const t0 = Date.now();
  let spilled = 0, near = 0;
  while (Date.now() - t0 < 120_000) {
    const dead = await rival.screen().then((s) => s !== 'playing').catch(() => true);
    if (dead && !spilled) { spilled = Date.now(); rec.mark('spilled'); }
    if (near && Date.now() - near > 14_000) break;
    let o = { mode: 'free', loot: 3, humans: 0, margin: 380 };
    if (spilled && !near && spot.wx != null) o = { mode: 'goto', wx: spot.wx, wy: spot.wy, loot: 60, margin: 380 };
    if (near) o = { mode: 'free', loot: 60, humans: 0, margin: 420 };
    const p = await hero.brain(o);
    if (p.dead) throw new Error('Daphne died');
    if (!p.wait) {
      if (spilled && !near && Math.hypot(p.wx - spot.wx, p.wy - spot.wy) < 700) { near = Date.now(); rec.mark('sweep'); }
      const nx = hero.cur.x + (Math.max(40, Math.min(1880, p.x)) - hero.cur.x) * 0.5, ny = hero.cur.y + (Math.max(40, Math.min(1040, p.y)) - hero.cur.y) * 0.5;
      await hero.page.mouse.move(nx, ny, { steps: 2 });
      hero.cur = { x: nx, y: ny };
    }
    await sleep(55);
  }
  rec.mark('end');
  stop = true;
  await Promise.race([rivalLoop, sleep(2000)]);
} catch (e) {
  log('ERROR', e.message);
  rec?.mark('error', { msg: e.message });
} finally {
  stop = true;
  if (rec) await rec.stop().catch((e) => log('stop failed', e.message));
  await rival.close();
  await hero.close();
  await browser.close();
}
