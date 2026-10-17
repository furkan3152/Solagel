#!/usr/bin/env node
// Take "lobby": the paper lobby as a new player meets it. Ticket list (Practice, the four arenas),
// connect the wallet, a Penny Pond ticket sheet (entry fee, fee on profit, deposit), the four
// arenas and their entry fees, Ranks (Today / All-time standings) and the Guide (controls table,
// rooms table, value flow, the fee example receipt). Each beat is marked for the edit.
//   node media/gameplay/capture/take-lobby.mjs [--name lobby] [--fresh]
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { CACHE, Player, Recorder, launch, log } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const NAME = opt('--name', 'lobby');
const keyPath = resolve(CACHE, 'keys/lobby.json');
if (argv.includes('--fresh')) rmSync(keyPath, { force: true });

const browser = await launch();
const hero = new Player(browser, { name: 'Daphne', skin: 4, audio: 'sfx', keyPath });
let rec;
const beat = async (name, fn) => {
  rec.mark(name);
  try { await fn(); } catch (e) { log(`beat ${name}:`, e.message.split('\n')[0]); rec.mark(name + '-error'); await hero.page.keyboard.press('Escape').catch(() => {}); }
};
const section = (label) => hero.click(`.kl-sections__item:has-text("${label}")`);
const scrollTo = async (sel, top = 170, maxSteps = 40) => {
  for (let i = 0; i < maxSteps; i++) {
    const y = await hero.ui((s) => document.querySelector(s)?.getBoundingClientRect().top ?? null, sel);
    if (y === null || Math.abs(y - top) < 40) break;
    await hero.wheel(Math.max(-260, Math.min(260, y - top)), 65, 55);
    await hero.wait(160);
  }
};
try {
  await hero.open();
  rec = new Recorder(hero, NAME);
  await rec.start();
  await hero.wait(1200);
  await beat('tickets', async () => {
    await hero.moveTo(900, 420);
    await hero.wait(800);
    for (const v of ['practice', 'arena:1', 'arena:2', 'arena:3', 'arena:4']) await hero.hover(`[role="radio"][data-kb-value="${v}"]`, { fx: 0.42, pause: 1300 });
    await hero.wheel(-600, 120, 30);
    await hero.wait(600);
  });
  await beat('room-preview', async () => {
    await hero.hover('text=Watch the room', { pause: 1500 }).catch(() => hero.moveTo(1000, 500));
    await hero.wait(1500);
  });
  await beat('wallet', async () => {
    await hero.click('.kl-wallet');
    await hero.page.waitForSelector('.wl-sheet', { timeout: 5000 });
    await hero.wait(1400);
    await hero.click('.wl-item');
    await hero.page.waitForFunction(() => !!window.__slana.useUi.getState().auth, null, { timeout: 15000 });
    await hero.page.waitForFunction(() => window.__slanaChain?.useChainData.getState().tokenBalance != null, null, { timeout: 15000 });
    await hero.wait(1800);
    await hero.hover('.kl-wallet', { pause: 1200 });
  });
  await beat('ticket-sheet', async () => {
    await hero.click('[role="radio"][data-kb-value="arena:1"]', { fx: 0.45 });
    await hero.wait(600);
    await hero.hover('.kl-cta', { pause: 700 });
    await hero.click('.kl-cta');
    await hero.page.waitForSelector('.tf-sheet', { timeout: 8000 });
    await hero.wait(2200);
    const b = await hero.box('.tf-sheet .kb-sheet__body');
    await hero.moveTo(b.x + b.width * 0.5, b.y + b.height * 0.45);
    await hero.wait(1200);
    rec.mark('ticket-scroll');
    await hero.wheel(260, 40, 80);
    await hero.wait(2200);
    await hero.wheel(300, 40, 80);
    await hero.wait(2200);
    await hero.hover('.tf-sheet .kb-btn--pink', { pause: 1500 });
    rec.mark('ticket-close');
    await hero.page.keyboard.press('Escape');
    await hero.wait(1200);
  });
  await beat('arenas', async () => {
    for (const v of [2, 3, 4, 1]) {
      await hero.click(`[role="radio"][data-kb-value="arena:${v}"]`, { fx: 0.45 });
      await hero.wait(1100);
    }
    await hero.hover('.kl-cta', { pause: 1200 });
  });
  await beat('ranks', async () => {
    await section('Ranks');
    await hero.wait(2200);
    const rows = hero.page.locator('.nw-table tr, .nw-row');
    const n = Math.min(5, await rows.count());
    for (let i = 1; i < n; i++) await hero.hover(rows.nth(i), { fx: 0.3, pause: 500 }).catch(() => {});
    await hero.wheel(420, 60, 60);
    await hero.wait(2400);
    await hero.wheel(-600, 120, 30);
  });
  await beat('guide', async () => {
    await section('Guide');
    await hero.wait(2200);
    await hero.moveTo(700, 500);
    rec.mark('guide-keys');
    await scrollTo('.dc-keys-fig', 150);
    await hero.wait(3200);
    rec.mark('guide-rooms');
    await scrollTo('#docs-rooms .dc-table-wrap', 200);
    await hero.wait(3000);
    rec.mark('guide-value');
    await scrollTo('#docs-value .dc-flow', 180);
    await hero.wait(3000);
    rec.mark('guide-fee');
    await scrollTo('#docs-payout .dc-fee', 140);
    await hero.wait(4200);
  });
  await beat('home', async () => {
    await hero.wheel(-9000, 600, 15);
    await section('Tickets');
    await hero.wait(2500);
  });
} catch (e) {
  log('ERROR', e.message);
} finally {
  if (rec) await rec.stop().catch((e) => log('stop failed', e.message));
  log('problems', (hero.problems || []).slice(-10));
  await hero.close();
  await browser.close();
}
