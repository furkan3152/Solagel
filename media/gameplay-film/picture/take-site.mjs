#!/usr/bin/env node
// Take "site": the home page (the pond notices the cursor, a coin is fed a pear), the scroll to
// Plate II (the feast) and Plate III (a round, in orbit), the WL page (two chores stamped done),
// the mint page (the sealed emblem, $1 in HYPE, the hand of cards, a mint and its sticker drop).
// One document from start to end (site pages turn client-side), recorded as a journal.
//   node media/gameplay-film/picture/take-site.mjs [--name site] [--live]   (--live: no journal, screenshots)
import { mkdirSync, rmSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { attachJournal } from '../../gameplay/capture/journal.mjs';
import { H, Hand, Marks, ROOT, TAKES, W, WEB, cursorInit, launch, log, scrollJournalInit, sleep } from './lib.mjs';
import { stageRoutes, startFakeRpc } from './stage.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const NAME = opt('--name', 'site');
const LIVE = argv.includes('--live');
const DIR = resolve(TAKES, NAME);
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
const { installDevWallet, loadOrCreateKey } = await import(resolve(ROOT, 'scripts/lib/dev-wallet.mjs'));

const rpc = await startFakeRpc();
const browser = await launch();
const key = loadOrCreateKey(`${DIR}/wallet.key`);
// sign in once in a scratch context: the take starts signed in (a seeded session; no wallet
// round trips inside the recorded document, so the replay cannot drift on them)
const pre = await browser.newContext({ viewport: { width: W, height: H }, locale: 'en-US' });
await installDevWallet(pre, key, { rpcUrl: rpc.url, chainId: 31337 });
const pp = await pre.newPage();
await pp.goto(WEB + '/', { waitUntil: 'networkidle' });
await pp.click('.st-connect');
await pp.waitForSelector('.sw-opt', { timeout: 10000 });
await pp.click('.sw-opt');
await pp.waitForSelector('.st-connect.is-signed', { timeout: 20000 });
const seed = await pp.evaluate(() => ({ auth: localStorage.getItem('elymum.auth.v1'), wallet: localStorage.getItem('elymum.wallet.v1') }));
await pre.close();
log('seeded session', !!seed.auth, seed.wallet);
const ctx = await browser.newContext({ viewport: { width: W, height: H }, locale: 'en-US' });
await ctx.addInitScript((s) => { if (s.auth) localStorage.setItem('elymum.auth.v1', s.auth); if (s.wallet) localStorage.setItem('elymum.wallet.v1', s.wallet); }, seed);
if (!LIVE) await attachJournal(ctx, `${DIR}/journal.jsonl`);
await ctx.addInitScript(() => { try { localStorage.setItem('elymum.site.sound', 'off'); } catch {} });
await installDevWallet(ctx, key, { rpcUrl: rpc.url, chainId: 31337 });
await stageRoutes(ctx);
await ctx.addInitScript(cursorInit);
await ctx.addInitScript(scrollJournalInit);
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`[console.error] ${m.text()}`));
const hand = new Hand(page);
let shotN = 0;
const shot = async (tag) => { if (LIVE) await page.screenshot({ path: `${DIR}/s${String(shotN++).padStart(2, '0')}-${tag}.png` }); };

let marks, t0;
try {
  marks = new Marks();
  t0 = marks.t0;
  await page.goto(WEB + '/', { waitUntil: 'networkidle' });
  await sleep(1500);
  await page.mouse.move(hand.x, hand.y);
  await hand.move(1250, 470, 600);
  await sleep(1500);
  await shot('hero0');

  // ── 0-10 s: the hero ──
  marks.mark('hero');
  await sleep(400);
  // drift down across the plain to the pond: the coins look up at the pointer
  await hand.move(1480, 780, 1300);
  await sleep(250);
  // close to the shy little cyan one: it edges away, sweating
  const shy = await hand.box('.ld-pond__c--shy');
  await hand.move(shy.x + shy.width * 0.5 - 150, shy.y + shy.height * 0.2, 1100);
  await sleep(900);
  await shot('shy');
  // across to the big teal one (hungry: it chews at the pointer)
  const big = await hand.box('.ld-pond__c--hungry');
  await hand.move(big.x + big.width * 0.62, big.y + big.height * 0.35, 1700, { curve: 0.08 });
  await sleep(450);
  marks.mark('feed');
  await hand.click(null, null, 0, { before: 0 });
  await sleep(500);
  await shot('feed');
  await sleep(900);
  await hand.click(big.x + big.width * 0.6, big.y + big.height * 0.4, 260, { before: 60 });
  await sleep(400);
  await shot('fed');
  await hand.move(980, 560, 600);
  await sleep(100);

  // ── 10 s: Plate II, the feast ──
  marks.mark('toFeast');
  await hand.scrollTo('.ld-feast', 74, 850);
  marks.mark('feast');
  await sleep(600);
  await hand.move(1240, 300, 1200);
  await sleep(700);
  await hand.move(1210, 520, 1400, { curve: 0.05 });
  await sleep(600);
  await hand.move(600, 650, 1300);
  await sleep(800);
  await shot('feast');

  // ── 17.5 s: Plate III, a round in orbit ──
  marks.mark('toRound');
  await hand.scrollTo('.ld-round', 74, 900);
  marks.mark('round');
  await sleep(500);
  await shot('round');
  const steps = page.locator('.ld-round li, .ld-round [class*="stop"]');
  log('round stops', await steps.count());
  // the orbit plays by itself; the pointer reads the four stops
  await hand.move(1300, 360, 1300);
  await sleep(1400);
  await hand.move(1310, 540, 1100, { curve: 0.04 });
  await sleep(1500);
  await hand.move(1320, 700, 1100, { curve: 0.04 });
  await sleep(1200);
  await shot('round2');
  // ── 27.5 s: /wl ──
  await hand.hoverEl('.st-nav a[href="/wl"]', { ms: 900 });
  await sleep(150);
  marks.mark('toWl');
  await hand.click(null, null, 0, { before: 0 });
  await page.waitForSelector('.wl-step', { timeout: 10000 });
  marks.mark('wl');
  await sleep(1400);
  await shot('wl');
  // chore 1: the handle (typed here; the cut joins after)
  await hand.clickEl('.wl-step.is-active input', { ms: 600 });
  await hand.type('daphne', 90);
  await sleep(700);
  await shot('typed');
  const nextBtn = '.wl-step.is-active .wl-step__actions button';
  const nb = await hand.box(nextBtn);
  await hand.move(nb.x + nb.width * 0.45, nb.y + nb.height * 0.5, 700);
  await sleep(250);
  marks.mark('chore1');
  await hand.click(null, null, 0, { before: 0, hold: 80 });
  await sleep(250);
  await shot('stamp1');
  // chore 2: follow @elymum (a tick), then Next
  const tick = page.locator('.wl-step.is-active .wl-tick').first();
  if (await tick.count()) {
    const tb = await tick.boundingBox();
    await hand.click(tb.x + 26, tb.y + tb.height / 2, 400, { before: 50, hold: 70 });
    await sleep(80);
  }
  const nb2 = await hand.box(nextBtn);
  await hand.move(nb2.x + nb2.width * 0.45, nb2.y + nb2.height * 0.5, 350);
  await sleep(50);
  marks.mark('chore2');
  await hand.click(null, null, 0, { before: 0, hold: 80 });
  await sleep(1300);
  await shot('stamp2');
  // ── 31 s: /mint ──
  await hand.hoverEl('.st-nav a[href="/mint"]', { ms: 650 });
  await sleep(100);
  marks.mark('toMint');
  await hand.click(null, null, 0, { before: 0 });
  await page.waitForSelector('.mt-mintbtn', { timeout: 15000 });
  marks.mark('mint');
  await sleep(450);
  await shot('mint');
  // two emblems: the hand fans out a second card
  const plus = page.locator('[data-testid="mt-qty"] button').last();
  const pb = await plus.boundingBox();
  await hand.click(pb.x + pb.width / 2, pb.y + pb.height / 2, 600, { before: 80 });
  marks.mark('qty2');
  await sleep(450);
  await shot('qty2');
  await page.evaluate(() => window.__devWallet && (window.__devWallet.slow = 1));
  const mb = await hand.box('.mt-mintbtn');
  await hand.move(mb.x + mb.width * 0.5, mb.y + mb.height * 0.5, 480);
  await sleep(100);
  marks.mark('mintClick');
  await hand.click(null, null, 0, { before: 0 });
  await page.waitForSelector('[data-testid="mt-done"]', { timeout: 20000 });
  marks.mark('minted');
  await hand.move(1500, 760, 900);
  await sleep(2600);
  await shot('done');
  const play = page.locator('.mt-play');
  if (await play.count()) { await hand.hoverEl('.mt-play', { ms: 800 }); marks.mark('playHover'); }
  await sleep(1500);
  marks.mark('end');
} catch (e) {
  log('ERROR', e.message);
  await page.screenshot({ path: `${DIR}/error.png` }).catch(() => {});
} finally {
  if (!LIVE) { await page.evaluate(() => window.__journal?.flush()).catch(() => {}); await sleep(900); }
  writeFileSync(`${DIR}/events.json`, JSON.stringify({ name: NAME, w: W, h: H, t0, journal: LIVE ? null : 'journal.jsonl', start: WEB + '/', seed, marks: marks.list, problems }, null, 1));
  log(problems.slice(0, 12).join('\n'));
  await browser.close();
  rpc.close();
}
