// In-game HUD screenshots at every phone / tablet / desktop size class against a DEV_FAKE_CHAIN demo
// (`pnpm demo`): power-up buttons (one wallet buys a few packs on the fake chain), chat lines, the
// minimap, the touch controls, and (when the build has it) the full standings sheet.
//   node scripts/hud-shots.mjs http://127.0.0.1:5173 ./out/hud [--only 390x844,1280x800] [--no-sheet]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { installEvmWallet, newDevKey, signInGame } from './evm-wallet.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const [base = 'http://127.0.0.1:5173', out = 'out/hud'] = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--only'));
const only = opt('--only', '')
  .split(',')
  .filter(Boolean);
const SHEET = !argv.includes('--no-sheet');
mkdirSync(out, { recursive: true });

/** Size classes: touch devices are emulated with touch + coarse pointer (`isMobile`). */
const SIZES = [
  { name: 'phone-360x640', w: 360, h: 640, touch: true, dpr: 2 },
  { name: 'phone-390x844', w: 390, h: 844, touch: true, dpr: 2 },
  { name: 'phone-414x896', w: 414, h: 896, touch: true, dpr: 2 },
  { name: 'phone-land-844x390', w: 844, h: 390, touch: true, dpr: 2 },
  { name: 'phone-land-932x430', w: 932, h: 430, touch: true, dpr: 2 },
  { name: 'tablet-768x1024', w: 768, h: 1024, touch: true, dpr: 1 },
  { name: 'tablet-820x1180', w: 820, h: 1180, touch: true, dpr: 1 },
  { name: 'tablet-land-1024x768', w: 1024, h: 768, touch: true, dpr: 1 },
  { name: 'tablet-land-1180x820', w: 1180, h: 820, touch: true, dpr: 1 },
  { name: 'desktop-1280x800', w: 1280, h: 800, touch: false, dpr: 1 },
].filter((s) => only.length === 0 || only.some((o) => s.name.endsWith(o)));

const browser = await chromium.launch();
const logs = [];
const key = newDevKey();
let bought = false;

async function newPage(size) {
  const ctx = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: size.dpr,
    isMobile: size.touch,
    hasTouch: size.touch,
    locale: 'en-US',
  });
  await ctx.addInitScript(() => {
    localStorage.setItem('elymum.settings.v1', JSON.stringify({ name: 'Daphne', skin: 4, theme: 'light', quality: 'high', sound: false, showMinimap: true, showChat: true }));
    localStorage.setItem('elymum.brief', '1');
    localStorage.setItem('elymum.autoQuality', 'off');
  });
  const { account } = await installEvmWallet(ctx, { privateKey: key, autoConnect: true, allowTransactions: false });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => logs.push(`[${size.name}] [pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && logs.push(`[${size.name}] [console.error] ${m.text()}`));
  await page.goto(`${base}/play`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__elymum && window.__elymum.useUi.getState().connected, null, { timeout: 20000 });
  await signInGame(page, base, account);
  await page.evaluate(() => window.__elymumChain && (window.__elymumChain.fakeWallet.delayMs = 50));
  return { ctx, page };
}

async function buyAll(page) {
  await page.evaluate(() => window.__elymum.useUi.setState({ modal: 'shop' }));
  for (const k of ['magnet', 'shock', 'speed']) {
    await page.waitForSelector(`[data-testid="shop-buy-${k}"]`);
    await page.getByTestId(`shop-buy-${k}`).click();
    await page.waitForFunction((x) => (document.querySelector(`[data-testid="shop-buy-${x}"]`)?.getAttribute('aria-busy') ?? 'false') !== 'true', k, { timeout: 20000 });
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => window.__elymum.useUi.setState({ modal: null }));
}

/** A few chat and kill lines so the feed has its usual load. */
async function fillFeed(page) {
  await page.evaluate(() => {
    const ui = window.__elymum.useUi;
    const chat = [
      { id: 9001, pid: 2, from: 'Mossy', skin: 2, text: 'gg, nice split' },
      { id: 9002, pid: 3, from: 'Pip', skin: 6, text: 'who has the magnet' },
      { id: 9003, pid: 0, from: 'Elymum', skin: 1, text: 'COIN RAIN!', system: true },
      { id: 9004, pid: 4, from: 'Quill', skin: 9, text: 'stay off the cacti' },
    ];
    const kills = [
      { id: 9101, killer: 'Mossy', killerSkin: 2, victim: 'Pip', victimSkin: 6, cause: 'eat' },
      { id: 9102, killer: 'Quill', killerSkin: 9, victim: 'Bramble', victimSkin: 3, cause: 'eat', victimIsBot: true },
    ];
    const at = Date.now() + 20000;
    ui.setState((s) => ({ chat: [...s.chat, ...chat.map((c) => ({ ...c, at }))], killfeed: [...s.killfeed, ...kills.map((k) => ({ ...k, at }))] }));
  });
}

for (const size of SIZES) {
  const { ctx, page } = await newPage(size);
  if (!bought) {
    await buyAll(page);
    bought = true;
  }
  await page.evaluate(() => window.__elymum.engine.play('practice'));
  await page.waitForFunction(() => window.__elymum.useUi.getState().screen === 'playing', null, { timeout: 15000 });
  await page.waitForFunction(() => !!window.__elymum.useUi.getState().boosts, null, { timeout: 10000 });
  await fillFeed(page);
  // past the round intro card
  await page.waitForTimeout(5200);
  await page.screenshot({ path: join(out, `${size.name}.png`) });
  if (SHEET) {
    const lb = page.locator('[data-testid="standings-open"]');
    if ((await lb.count()) > 0) {
      await lb.first().click();
      await page.waitForSelector('[data-testid="standings-sheet"]', { timeout: 5000 }).catch(() => null);
      await page.waitForTimeout(1600);
      await page.screenshot({ path: join(out, `${size.name}-standings.png`) });
    }
  }
  await ctx.close();
}

await browser.close();
if (logs.length) console.log(logs.join('\n'));
console.log(`screenshots in ${out}`);
