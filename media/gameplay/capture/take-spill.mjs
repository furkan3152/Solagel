#!/usr/bin/env node
// Take "spill": with a Penny Pond ticket, Daphne picks up some loot (value floats), then runs into a
// bot. Bots carry no value: her tokens spill on the floor as loot coins. The EATEN sheet follows,
// and she buys back in: "Buy back in" opens the ticket sheet for the same arena at the same fee,
// she signs and drops into the same round again (the round chip keeps counting).
// Needs an open round with time to spare, so it waits for one (joins close 60 s before the bell).
//   node media/gameplay/capture/take-spill.mjs [--name spill]
import { resolve } from 'node:path';
import { CACHE, Player, Recorder, launch, log } from './lib.mjs';

const argv = process.argv.slice(2);
const NAME = argv.includes('--name') ? argv[argv.indexOf('--name') + 1] : 'spill';
const browser = await launch();
const hero = new Player(browser, { name: 'Daphne', skin: 4, audio: 'sfx', keyPath: resolve(CACHE, 'keys/spill.json') });
let rec;
try {
  await hero.open();
  await hero.login();
  const r = await hero.round(1);
  if (r.left < 150_000 || r.left > 285_000) {
    log('waiting for a fresh round; left', (r.left / 1000).toFixed(0));
    await hero.untilRound((q) => q.left > 270_000 && q.left < 285_000, 330_000, 1);
  }
  await hero.buyTicket(1, { signDelay: 200 });
  rec = new Recorder(hero, NAME);
  await rec.start();
  rec.mark('play');
  await hero.drive(35_000, { mode: 'free', humans: 0, loot: 25, margin: 260 }, async (p) => p.value >= 1.6e9 && p.mass > 60);
  rec.mark('kamikaze');
  // zoom in a little for the close-up
  await hero.page.mouse.wheel(0, -240);
  await hero.drive(20_000, { mode: 'kamikaze' });
  rec.mark('eaten');
  await hero.page.waitForSelector('.g-death .kb-btn--pink', { timeout: 10000 });
  await hero.wait(2600);
  rec.mark('sheet');
  await hero.hover('.g-death .kb-btn--pink', { pause: 1300, speed: 0.7 });
  rec.mark('buyback');
  await hero.click('.g-death .kb-btn--pink', { before: 200 });
  await hero.page.waitForSelector('.tf-sheet', { timeout: 20000 });
  rec.mark('ticket-sheet');
  await hero.wait(1500);
  await hero.buyTicket(1, { slow: true, signDelay: 900 });
  rec.mark('reenter');
  await hero.wait(800);
  await hero.wheel(-300, 60, 60);
  await hero.drive(9_000, { mode: 'free', humans: 0, loot: 25, margin: 400 });
  rec.mark('end');
} catch (e) {
  log('ERROR', e.message);
  rec?.mark('error', { msg: e.message });
} finally {
  if (rec) await rec.stop().catch((e) => log('stop failed', e.message));
  await hero.close();
  await browser.close();
}
