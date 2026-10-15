#!/usr/bin/env node
// Take "spill": with a Penny Pond ticket, Daphne picks up some loot (value floats), then runs into a
// bot. Bots carry no value: her tokens spill on the floor as loot coins. The EATEN sheet follows.
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
  await hero.wait(6500);
} catch (e) {
  log('ERROR', e.message);
} finally {
  if (rec) await rec.stop().catch((e) => log('stop failed', e.message));
  await hero.close();
  await browser.close();
}
