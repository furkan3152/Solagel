#!/usr/bin/env node
// Take "held": the lobby across a round's final minute. The Penny Pond row counts down ("Round ends
// in 1:0x"), turns to "Joins closed · next round in 0:5x" when joins close 60 s before the bell,
// Daphne buys a ticket anyway: the lobby holds it ("Ticket held") and, at the bell, the game joins
// the new round by itself. A few seconds of the new round close the take.
//   node media/gameplay/capture/take-held.mjs [--name held]
import { resolve } from 'node:path';
import { CACHE, Player, Recorder, launch, log } from './lib.mjs';

const argv = process.argv.slice(2);
const NAME = argv.includes('--name') ? argv[argv.indexOf('--name') + 1] : 'held';
const browser = await launch();
const hero = new Player(browser, { name: 'Daphne', skin: 4, audio: 'sfx', keyPath: resolve(CACHE, 'keys/held.json') });
let rec;
try {
  await hero.open();
  await hero.login();
  await hero.click('[role="radio"][data-kb-value="arena:1"]', { fx: 0.45 });
  await hero.untilRound((q) => q.left < 70_000 && q.left > 64_000, 330_000, 1);
  rec = new Recorder(hero, NAME);
  await rec.start();
  rec.mark('lobby');
  await hero.hover('[role="radio"][data-kb-value="arena:1"]', { fx: 0.3, fy: 0.75, pause: 600 });
  await hero.untilRound((q) => q.phase === 'closing', 20_000, 1);
  rec.mark('closed');
  await hero.wait(3500);
  await hero.hover('.kl-cta', { pause: 900 });
  rec.mark('buy');
  const st = await hero.buyTicket(1, { slow: true, signDelay: 1100, held: true });
  rec.mark(st === 'held' ? 'held' : 'joined-early');
  log('ticket', st);
  await hero.wait(2500);
  // the held banner and the row flag; the cursor rests on the banner
  await hero.hover('.kl-held, [class*="held"]', { pause: 800 }).catch(() => {});
  await hero.page.waitForFunction(() => window.__slana.useUi.getState().screen === 'playing', null, { timeout: 75_000 });
  rec.mark('joined', { left: (await hero.round(1))?.left });
  await hero.wait(1200);
  await hero.wheel(-300, 60, 60);
  await hero.drive(7_000, { mode: 'free', humans: 0, loot: 10, margin: 400 });
  rec.mark('end');
} catch (e) {
  log('ERROR', e.message);
  rec?.mark('error', { msg: e.message });
} finally {
  if (rec) await rec.stop().catch((e) => log('stop failed', e.message));
  await hero.close();
  await browser.close();
}
