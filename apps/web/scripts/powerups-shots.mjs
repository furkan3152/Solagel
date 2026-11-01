// Screenshots of the power-up shop, the HUD buttons and the shockwave against a DEV_FAKE_CHAIN server.
//   node scripts/powerups-shots.mjs http://127.0.0.1:5173 ./out
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { installEvmWallet, newDevKey, signInGame } from './evm-wallet.mjs';

const [base = 'http://127.0.0.1:5173', out = 'out'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const logs = [];

async function newPage({ viewport, mobile = false }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, locale: 'en-US' });
  await ctx.addInitScript(() => {
    localStorage.setItem('elymum.settings.v1', JSON.stringify({ name: 'Daphne', skin: 4, theme: 'light', quality: 'high', sound: false, showMinimap: true, showChat: true }));
    localStorage.setItem('elymum.brief', '1');
    localStorage.setItem('elymum.autoQuality', 'off');
  });
  const { account } = await installEvmWallet(ctx, { privateKey: newDevKey(), autoConnect: true, allowTransactions: false });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && logs.push(`[console.error] ${m.text()}`));
  await page.goto(`${base}/play`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__elymum && window.__elymum.useUi.getState().connected, null, { timeout: 20000 });
  await signInGame(page, base, account);
  await page.evaluate(() => window.__elymumChain && (window.__elymumChain.fakeWallet.delayMs = 250));
  return { ctx, page };
}

const ev = (page, fn, arg) => page.evaluate(fn, arg);

async function buy(page, kind) {
  await page.getByTestId(`shop-buy-${kind}`).click();
  await page.waitForFunction((k) => (document.querySelector(`[data-testid="shop-buy-${k}"]`)?.getAttribute('aria-busy') ?? 'false') !== 'true', kind, { timeout: 20000 });
  await page.waitForTimeout(400);
}

// ── desktop: shop from the lobby, buy, then the HUD and a shockwave ──
{
  const { ctx, page } = await newPage({ viewport: { width: 1440, height: 900 } });
  await page.getByTestId('lobby-shop').click();
  await page.waitForSelector('[data-testid="shop-buy-magnet"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, 'shop-lobby-desktop.png') });
  for (const k of ['magnet', 'shock', 'speed']) await buy(page, k);
  await page.screenshot({ path: join(out, 'shop-after-buy-desktop.png') });
  await page.keyboard.press('Escape');
  await ev(page, () => window.__elymum.engine.play('practice'));
  await page.waitForFunction(() => window.__elymum.useUi.getState().screen === 'playing', null, { timeout: 15000 });
  await page.waitForFunction(() => !!window.__elymum.useUi.getState().boosts, null, { timeout: 10000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(out, 'hud-desktop.png') });
  // magnet and speed, then a shockwave caught mid-ring
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyG');
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(out, 'hud-magnet-speed-desktop.png') });
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(230);
  await page.screenshot({ path: join(out, 'shockwave-desktop.png') });
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(out, 'hud-cooldowns-desktop.png') });
  // the shop over the game (HUD + button)
  await page.locator('.g-boosts__shop').click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(out, 'shop-hud-desktop.png') });
  await ctx.close();
}

// ── phone: HUD buttons by Split, a shockwave, the shop as a bottom sheet ──
{
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, mobile: true });
  await ev(page, () => window.__elymum.useUi.setState({ modal: 'shop' }));
  await page.waitForSelector('[data-testid="shop-buy-shock"]');
  await buy(page, 'shock');
  await buy(page, 'magnet');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, 'shop-phone.png') });
  await ev(page, () => window.__elymum.useUi.setState({ modal: null }));
  await ev(page, () => window.__elymum.engine.play('practice'));
  await page.waitForFunction(() => window.__elymum.useUi.getState().screen === 'playing', null, { timeout: 15000 });
  await page.waitForFunction(() => !!window.__elymum.useUi.getState().boosts, null, { timeout: 10000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(out, 'hud-phone.png') });
  await page.locator('.g-boost--shock').dispatchEvent('pointerdown');
  await page.waitForTimeout(230);
  await page.screenshot({ path: join(out, 'shockwave-phone.png') });
  await ctx.close();
}

await browser.close();
if (logs.length) console.log(logs.join('\n'));
console.log(`screenshots in ${out}`);
