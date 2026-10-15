#!/usr/bin/env node
// Take "controls": free Practice, each control shown on its own while Daphne is alive and nothing
// bigger is near: steer (a slow loop of the mouse), Space split, W tip mass (held), stickers 1-8,
// Enter chat. A demo interrupted by a death is done again after the respawn. Each is marked
// <name> ... <name>-end for the edit.
//   node media/gameplay/capture/take-controls.mjs [--name controls]
import { Player, Recorder, launch, log, sleep } from './lib.mjs';

const argv = process.argv.slice(2);
const NAME = argv.includes('--name') ? argv[argv.indexOf('--name') + 1] : 'controls';
const browser = await launch();
const hero = new Player(browser, { name: 'Daphne', skin: 4, audio: 'sfx' });
let rec;
const forage = { mode: 'free', humans: 0, loot: 3, margin: 300 };
const alive = async () => (await hero.screen()) === 'playing' && (await hero.brain({ mode: 'still' })).mass > 0;
const calm = () => hero.ui(() => {
  const w = window.__slana.engine.world, mine = w.myCells();
  if (!mine.length) return false;
  let big = 0, mx = 0, my = 0;
  for (const c of mine) { big = Math.max(big, c.r); mx += c.x / mine.length; my += c.y / mine.length; }
  for (const e of w.entities.values()) if (e.kind === 1 && e.playerId !== mine[0].playerId && e.r > big * 1.05 && Math.hypot(e.x - mx, e.y - my) < e.r + big + 1000) return false;
  return Math.min(mx, my, w.width - mx, w.height - my) > 900;
});
async function revive() {
  if ((await hero.screen()) === 'playing') return false;
  rec.mark('died');
  await hero.wait(2500);
  await hero.click('.g-death .kb-btn--pink').catch(() => {});
  await hero.page.waitForFunction(() => window.__slana.useUi.getState().screen === 'playing', null, { timeout: 15000 }).catch(() => {});
  await hero.wheel(-360, 60, 60);
  rec.mark('respawn');
  return true;
}
/** Forage until calm (and big enough), then run the demo; again if it was interrupted. */
async function demo(name, fn, minMass = 40) {
  for (let i = 0; i < 6; i++) {
    const t0 = Date.now();
    while (Date.now() - t0 < 60_000) {
      await revive();
      const p = await hero.brain(forage);
      if (p.mass >= minMass && (await calm())) break;
      await hero.drive(600, forage);
    }
    rec.mark(name);
    await fn();
    if (await alive()) { rec.mark(name + '-end'); return; }
    rec.mark(name + '-lost');
  }
}
try {
  await hero.open();
  rec = new Recorder(hero, NAME);
  await rec.start();
  rec.mark('lobby');
  await hero.hover('[role="radio"][data-kb-value="practice"]', { fx: 0.4, pause: 1200 });
  await hero.click('[role="radio"][data-kb-value="practice"]', { fx: 0.4 });
  await hero.wait(500);
  await hero.click('.kl-cta');
  await hero.page.waitForFunction(() => window.__slana.useUi.getState().screen === 'playing', null, { timeout: 20000 });
  rec.mark('enter');
  await hero.wait(1500);
  await hero.wheel(-360, 60, 60);
  await demo('steer', async () => {
    for (let i = 0; i <= 100; i++) {
      const a = (i / 100) * Math.PI * 2 - Math.PI / 2;
      const x = 960 + Math.cos(a) * 360, y = 540 + Math.sin(a) * 260;
      await hero.page.mouse.move(x, y);
      hero.cur = { x, y };
      await hero.wait(60);
    }
  }, 30);
  await demo('split', async () => {
    const p = await hero.brain(forage);
    const a = Math.atan2(p.y - 540, p.x - 960);
    await hero.moveTo(960 + Math.cos(a) * 420, 540 + Math.sin(a) * 300, 2);
    await hero.wait(500);
    await hero.key('Space');
    await hero.wait(2200);
  }, 70);
  await hero.drive(9000, forage); // the halves merge back
  await demo('eject', async () => {
    await hero.moveTo(1380, 540, 2);
    await hero.wait(300);
    await hero.page.keyboard.down('KeyW');
    await hero.wait(1300);
    await hero.page.keyboard.up('KeyW');
    await hero.wait(1200);
  }, 70);
  await demo('emotes', async () => {
    for (const k of ['Digit1', 'Digit2', 'Digit4', 'Digit8']) {
      await hero.key(k);
      await hero.drive(1500, { ...forage, margin: 500 });
    }
  });
  await demo('chat', async () => {
    await hero.key('Enter');
    await hero.wait(600);
    await hero.page.keyboard.type('gl hf!', { delay: 150 });
    await hero.wait(500);
    await hero.key('Enter');
    await hero.drive(2200, { ...forage, margin: 500 });
  });
  await demo('eat', async () => { await hero.drive(12_000, { ...forage, humans: 0 }); }, 60);
  rec.mark('end');
} catch (e) {
  log('ERROR', e.message);
} finally {
  if (rec) await rec.stop().catch((e) => log('stop failed', e.message));
  await hero.close();
  await browser.close();
}
