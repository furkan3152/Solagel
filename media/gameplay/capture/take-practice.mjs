#!/usr/bin/env node
// Take "practice": a guest (no wallet) starts free Practice from the lobby and shows the controls
// one by one, then plays: steer (mouse), Space split, W tip mass (held), stickers 1-8, Enter chat,
// eats smaller coins, runs from bigger ones, gets popped by a rug cactus, and waits for a coin rain.
//   node media/gameplay/capture/take-practice.mjs [--name practice] [--rain 1]
import { resolve } from 'node:path';
import { CACHE, Player, Recorder, launch, log } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const NAME = opt('--name', 'practice');
const RAIN = opt('--rain', '1') === '1';

const browser = await launch();
const hero = new Player(browser, { name: 'Daphne', skin: 4, audio: 'sfx', journal: resolve(CACHE, `journal-${NAME}.jsonl`) });
let rec;
const forage = { mode: 'free', humans: 0, loot: 3, margin: 260 };
const massNow = async () => (await hero.brain({ mode: 'still' })).mass || 0;
async function safe(fn) {
  try { return await fn(); } catch (e) { log('beat error', e.message); }
}
/** Drives toward the middle of the map while the coin is near an edge (keeps the world edge out of frame). */
async function recenter(ms = 9000) {
  const room = await hero.ui(() => { const w = window.__slana.engine.world; return { w: w.width, h: w.height }; });
  const far = (p) => Math.min(p.wx, p.wy, room.w - p.wx, room.h - p.wy) > 1700;
  const p = await hero.brain({ mode: 'still' });
  if (p.wait || far(p)) return;
  await safe(() => hero.drive(ms, { mode: 'goto', wx: room.w / 2, wy: room.h / 2, margin: 300 }, async (q) => far(q)));
}
async function revive() {
  if ((await hero.screen()) === 'playing') return;
  rec.mark('died');
  await hero.wait(3500);
  await hero.click('.g-death .kb-btn--pink').catch(() => {}); // Practice again
  await hero.page.waitForFunction(() => window.__slana.useUi.getState().screen === 'playing', null, { timeout: 15000 }).catch(() => {});
  await hero.wheel(-Number(opt('--zoom', '460')), 60, 60);
  rec.mark('respawn');
}
try {
  await hero.open();
  rec = new Recorder(hero, NAME);
  await rec.start();
  await hero.wait(900);
  rec.mark('lobby');
  await hero.hover('[role="radio"][data-kb-value="practice"]', { fx: 0.4, pause: 1500 });
  rec.mark('practice-ticket');
  await hero.click('[role="radio"][data-kb-value="practice"]', { fx: 0.4 });
  await hero.wait(700);
  await hero.hover('.kl-cta', { pause: 900 });
  rec.mark('quickplay');
  await hero.click('.kl-cta');
  await hero.page.waitForFunction(() => window.__slana.useUi.getState().screen === 'playing', null, { timeout: 20000 });
  rec.mark('enter');
  await hero.wait(1600);
  // zoom the camera in a notch: the coins read bigger on screen
  await hero.wheel(-Number(opt('--zoom', '460')), 60, 60);
  await hero.wait(600);
  // steer: a slow loop of the mouse around the coin
  await recenter();
  rec.mark('steer');
  for (let i = 0; i <= 90; i++) {
    const a = (i / 90) * Math.PI * 2.2 - Math.PI / 2;
    await hero.page.mouse.move(960 + Math.cos(a) * 330, 540 + Math.sin(a) * 250);
    hero.cur = { x: 960 + Math.cos(a) * 330, y: 540 + Math.sin(a) * 250 };
    await hero.wait(70);
  }
  rec.mark('steer-end');
  await safe(() => hero.drive(40_000, forage, async (p) => p.mass >= 90));
  await revive();
  // split: aim ahead and press Space
  await recenter();
  rec.mark('split');
  const p0 = await hero.brain(forage);
  const ang = Math.atan2(p0.y - 540, p0.x - 960);
  await hero.moveTo(960 + Math.cos(ang) * 420, 540 + Math.sin(ang) * 300, 2);
  await hero.wait(350);
  await hero.key('Space');
  await hero.wait(1800);
  rec.mark('split-end');
  await safe(() => hero.drive(4000, forage));
  // eject: hold W for a moment
  await recenter();
  rec.mark('eject');
  await hero.page.keyboard.down('KeyW');
  await safe(() => hero.drive(1400, { ...forage, mode: 'still' }));
  await hero.page.keyboard.up('KeyW');
  await hero.wait(900);
  rec.mark('eject-end');
  await safe(() => hero.drive(3000, forage));
  // stickers
  await recenter();
  rec.mark('emotes');
  for (const k of ['Digit1', 'Digit4', 'Digit8']) {
    await hero.key(k);
    await safe(() => hero.drive(1400, forage));
  }
  rec.mark('emotes-end');
  // chat
  await recenter();
  rec.mark('chat');
  await hero.key('Enter');
  await hero.wait(500);
  await hero.page.keyboard.type('gl hf!', { delay: 140 });
  await hero.wait(400);
  await hero.key('Enter');
  await hero.wait(1200);
  rec.mark('chat-end');
  await revive();
  // grow for the cactus
  rec.mark('hunt-split');
  await safe(() => hero.drive(70_000, { ...forage, splitBots: true, maxCells: 2, splitGap: 6000 }, async (p) => p.mass >= 220));
  await revive();
  await recenter();
  rec.mark('cactus');
  const cells0 = await hero.ui(() => window.__slana.useUi.getState().hud.cells);
  await safe(() => hero.drive(15_000, { mode: 'virus', hitVirus: true, margin: 200 }, async () => (await hero.ui(() => window.__slana.useUi.getState().hud.cells)) > cells0 + 2));
  rec.mark('popped');
  await safe(() => hero.drive(6000, { ...forage, margin: 400 }));
  await revive();
  // play on; wait for a coin rain (practice rooms rain every few minutes)
  rec.mark('play');
  const t0 = Date.now();
  let rain = false;
  while (Date.now() - t0 < (RAIN ? 200_000 : 30_000)) {
    await safe(() => hero.drive(3000, forage));
    await revive();
    const b = await hero.ui(() => window.__slana.useUi.getState().banner?.kind);
    if (b === 'coinrain' && !rain) { rain = true; rec.mark('coinrain'); }
    if (rain && Date.now() - t0 > 5000) { await safe(() => hero.drive(14_000, { ...forage, loot: 3 })); break; }
  }
  rec.mark('end', { mass: await massNow() });
} catch (e) {
  log('ERROR', e.message);
  rec?.mark('error', { msg: e.message });
} finally {
  if (rec) await rec.stop().catch((e) => log('stop failed', e.message));
  log('problems', (hero.problems || []).slice(-10));
  await hero.close();
  await browser.close();
}
