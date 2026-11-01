// Custom rooms tour: screenshots of the lobby's "Your own room" card, the room creator sheet,
// the payment step, the transfer in flight, the invite (code + share link), the room with its
// invite / close buttons, and a guest opening the invite link straight into the room.
// Needs a dev server whose game server runs NODE_ENV=development DEV_FAKE_CHAIN=1 DEV_FAKE_TOKEN=1
// with ADMIN_WALLETS set (the treasury defaults to the owner wallet) and GAME_ACCESS=public: the web
// dev build then "sends" the HYPE fee through its fake chain (src/wallet/devFake.ts) and the
// server's fake payment reader accepts that hash. An EIP-6963 dev wallet signs the free sign-in.
// Usage: node scripts/rooms.mjs <playUrl> <outDir>   → <outDir>/rooms-*.png
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { installEvmWallet, newDevKey, signInGame } from './evm-wallet.mjs';

const [base = 'http://localhost:5173/play', out = 'out'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const logs = [];
const D = { width: 1440, height: 900 };
const P = { width: 390, height: 844 };

async function newPage({ viewport, mobile = false, wallet = true, url = base, theme = 'light' }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, locale: 'en-US' });
  await ctx.addInitScript((theme) => {
    localStorage.setItem('elymum.settings.v1', JSON.stringify({ name: 'Daphne', skin: 4, theme, sound: false, showMinimap: true, showChat: true }));
    // the first-play brief was read already
    localStorage.setItem('elymum.brief', '1');
  }, theme);
  let account = null;
  if (wallet) ({ account } = await installEvmWallet(ctx, { privateKey: newDevKey(), autoConnect: true, allowTransactions: false }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && logs.push(`[console.error] ${m.text()}`));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__elymum && window.__elymum.useUi.getState().connected, null, { timeout: 20000 });
  if (wallet) {
    await signInGame(page, new URL(base).origin, account);
    await page.waitForFunction(() => !!window.__elymumChain?.fakeWallet, null, { timeout: 10000 });
  }
  await page.waitForTimeout(1200);
  return { ctx, page };
}

const shot = (page, name) => page.screenshot({ path: `${out}/rooms-${name}.png` });

async function fillCreator(page) {
  await page.getByTestId('room-create').click();
  await page.waitForSelector('[data-testid="cr-setup"]');
  await page.getByLabel('Room name').fill('Friday Night Pond');
  await page.getByRole('button', { name: '60 min' }).click();
  await page.getByRole('button', { name: 'Large' }).click();
  await page.getByRole('group', { name: 'Bots' }).getByRole('button', { name: 'One more' }).click();
  await page.getByRole('button', { name: 'Hard' }).click();
  await page.waitForTimeout(600);
}

// ── desktop: card → creator → payment → paying → invite → in the room ──
let code = null;
{
  const { ctx, page } = await newPage({ viewport: D });
  await page.getByTestId('room-card').scrollIntoViewIfNeeded();
  await shot(page, 'lobby-card-desktop');
  await fillCreator(page);
  await shot(page, 'creator-desktop');
  await page.getByTestId('cr-continue').click();
  await page.waitForSelector('[data-testid="cr-payment"]');
  await page.waitForTimeout(600);
  await shot(page, 'payment-desktop');
  await page.evaluate(() => (window.__elymumChain.fakeWallet.delayMs = 1500));
  await page.getByTestId('cr-pay').click();
  await page.waitForTimeout(500);
  await shot(page, 'paying-desktop');
  await page.waitForSelector('[data-testid="cr-done"]', { timeout: 15000 });
  await page.waitForTimeout(900);
  code = (await page.getByTestId('cr-code').textContent())?.trim();
  await shot(page, 'invite-desktop');
  await page.getByTestId('cr-enter').click();
  await page.waitForFunction(() => window.__elymum.useUi.getState().screen === 'playing', null, { timeout: 10000 });
  await page.waitForTimeout(3000);
  await shot(page, 'in-room-desktop');
  await ctx.close();
}

// ── a guest opens the invite link: straight into the room ──
if (code) {
  const url = `${base}?room=${code}`;
  const { ctx, page } = await newPage({ viewport: P, mobile: true, wallet: false, url });
  await page.waitForFunction(() => window.__elymum.useUi.getState().screen === 'playing', null, { timeout: 15000 });
  await page.waitForTimeout(2500);
  await shot(page, 'guest-invite-mobile');
  await ctx.close();
}

// ── phone: the creator and the payment step (night) ──
{
  const { ctx, page } = await newPage({ viewport: P, mobile: true, theme: 'dark' });
  await page.getByTestId('room-card').scrollIntoViewIfNeeded();
  await fillCreator(page);
  await shot(page, 'creator-mobile-night');
  await page.getByTestId('cr-continue').click();
  await page.waitForSelector('[data-testid="cr-payment"]');
  await page.waitForTimeout(700);
  await shot(page, 'payment-mobile-night');
  await ctx.close();
}

// ── a guest at the creator: connect first ──
{
  const { ctx, page } = await newPage({ viewport: D, wallet: false });
  await page.getByTestId('room-create').click();
  await page.waitForSelector('[data-testid="cr-setup"]');
  await page.waitForTimeout(700);
  await shot(page, 'creator-guest-desktop');
  await ctx.close();
}

await browser.close();
if (logs.length) console.log(logs.join('\n'));
console.log(`code ${code}; screenshots in ${out}`);
