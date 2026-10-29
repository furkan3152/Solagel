// Lobby and ticket-flow tour: screenshots of the lobby (desktop / mobile,
// paper / night), the ticket confirm sheet, the stamp-and-tear frame, the R24 collect-payout slip,
// a refused transaction, the wallet / profile sheets, and the "Opening soon" lobby before the
// game token is set (step `soon`).
// Needs a dev server (pnpm dev) whose game server runs NODE_ENV=development DEV_FAKE_CHAIN=1
// (with DEV_FAKE_TOKEN=1 for every step but `soon`, which needs the token unset and then sets it
// through POST /api/dev/token to shoot the live flip):
// the web dev build then uses its fake chain stand-in (src/wallet/devFake.ts), so no
// transaction is signed. An EIP-6963 dev wallet is injected (scripts/evm-wallet.mjs: a viem local
// account with a throwaway key; it signs the free SIWE login message and refuses transactions).
// Usage: node scripts/lobby.mjs <baseUrl> <outDir> [step ...]   → <outDir>/lobby-*.png
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { installEvmWallet, newDevKey, signInGame } from './evm-wallet.mjs';

const [base, out, ...which] = process.argv.slice(2);
const want = (k) => which.length === 0 || which.includes(k);
const exe = process.env.CHROME_PATH;
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const logs = [];

/** One whole token of the fake chain's 18-decimal game token. */
const ONE = 10n ** 18n;

async function newPage({ viewport, mobile = false, theme = 'light', wallet = true, verified = true, pending = null, reduced = false, tokenReady = true }) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    locale: 'en-US',
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  await ctx.addInitScript(
    (s) => {
      const def = {
        name: 'Daphne',
        skin: 4,
        theme: 'light',
        quality: 'high',
        sound: false,
        volume: 0.6,
        showNames: true,
        showMass: true,
        showFps: false,
        showMinimap: true,
        showChat: true,
      };
      localStorage.setItem('elymum.settings.v1', JSON.stringify({ ...def, ...s }));
    },
    { theme },
  );
  if (pending) await ctx.route('**/api/pending*', (r) => r.fulfill({ json: { pending } }));
  let address = null;
  let account = null;
  if (wallet) ({ address, account } = await installEvmWallet(ctx, { privateKey: newDevKey(), autoConnect: true, allowTransactions: false }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && logs.push(`[console.error] ${m.text()}`));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__elymum && window.__elymum.useUi.getState().connected, null, { timeout: 15000 });
  if (wallet && verified) await signInGame(page, base, account);
  // (the token balance is only read once the game token is set)
  if (wallet && tokenReady)
    await page.waitForFunction(() => !!window.__elymumChain?.fakeWallet && window.__elymumChain.useChainData.getState().tokenBalance !== null, null, {
      timeout: 10000,
    });
  await page.waitForFunction(() => !!window.__elymumChain?.fakeWallet, null, { timeout: 10000 });
  await page.evaluate(() => window.__elymumChain.refresh());
  await page.waitForTimeout(1600);
  return { ctx, page, address };
}

const shot = (page, name) => page.screenshot({ path: `${out}/lobby-${name}.png` });
const D = { width: 1440, height: 900 };
const P = { width: 390, height: 844 };

async function pickTicket(page, key) {
  await page.locator(`[role="radio"][data-kb-value="${key}"]`).click();
  await page.waitForTimeout(250);
}
const cta = (page) => page.locator('.kl-cta').first();

// ── lobby, all four prints ──
for (const [k, viewport, mobile, theme] of [
  ['desktop-paper', D, false, 'light'],
  ['desktop-night', D, false, 'dark'],
  ['mobile-paper', P, true, 'light'],
  ['mobile-night', P, true, 'dark'],
]) {
  if (!want(`lobby-${k}`) && !want('lobby')) continue;
  const { ctx, page } = await newPage({ viewport, mobile, theme });
  await shot(page, `lobby-${k}`);
  await ctx.close();
}

// ── standings: the Ranks tab (desktop paper, phone night) ──
for (const [k, viewport, mobile, theme] of [
  ['desktop-paper', D, false, 'light'],
  ['mobile-night', P, true, 'dark'],
]) {
  if (!want(`ranks-${k}`) && !want('ranks')) continue;
  const { ctx, page } = await newPage({ viewport, mobile, theme });
  await page.getByText('Ranks', { exact: true }).first().click();
  await page.waitForTimeout(1200);
  await shot(page, `ranks-${k}`);
  await ctx.close();
}

// ── guest (no wallet) ──
if (want('guest')) {
  for (const [k, viewport, mobile] of [
    ['desktop', D, false],
    ['mobile', P, true],
  ]) {
    const { ctx, page } = await newPage({ viewport, mobile, wallet: false });
    await shot(page, `guest-${k}`);
    await ctx.close();
  }
}

// ── confirm sheet → stamp and tear → into the room ──
for (const [k, viewport, mobile, theme, reduced] of [
  ['desktop', D, false, 'light', false],
  ['mobile', P, true, 'light', false],
  ['desktop-night', D, false, 'dark', false],
  ['mobile-night', P, true, 'dark', false],
  ['reduced', D, false, 'light', true],
]) {
  if (!want(`ticket-${k}`) && !want('ticket')) continue;
  const { ctx, page } = await newPage({ viewport, mobile, theme, reduced });
  await pickTicket(page, 'arena:1');
  await cta(page).click();
  await page.waitForSelector('.tf-sheet', { timeout: 5000 });
  await page.waitForTimeout(700);
  await shot(page, `ticket-sheet-${k}`);
  await page.evaluate(() => (window.__elymumChain.fakeWallet.delayMs = 700));
  await page.locator('.tf-sheet .kb-btn--pink').click();
  await page.waitForTimeout(350);
  await shot(page, `ticket-signing-${k}`);
  await page.waitForSelector('.tf-ticket__stamp', { timeout: 5000 });
  await page.waitForTimeout(reduced ? 150 : 330);
  await shot(page, `ticket-stamp-${k}`);
  await page.waitForTimeout(reduced ? 200 : 520);
  await shot(page, `ticket-tear-${k}`);
  await page.waitForFunction(() => window.__elymum.useUi.getState().screen === 'playing', null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  await shot(page, `ticket-ingame-${k}`);
  await ctx.close();
}

// ── frame strip of the stamp and tear (ticket only) ──
if (want('frames')) {
  const { ctx, page } = await newPage({ viewport: D });
  await pickTicket(page, 'arena:2');
  await cta(page).click();
  await page.waitForSelector('.tf-sheet');
  await page.waitForTimeout(600);
  await page.evaluate(() => (window.__elymumChain.fakeWallet.delayMs = 400));
  await page.locator('.tf-sheet .kb-btn--pink').click();
  await page.waitForSelector('.tf-ticket__stamp', { timeout: 5000 });
  const box = await page.locator('.tf-ticket').boundingBox();
  const clip = { x: box.x - 10, y: box.y - 10, width: box.width + 60, height: box.height + 70 };
  for (let i = 0; i < 12; i++) {
    await page.screenshot({ path: `${out}/lobby-frame-${String(i).padStart(2, '0')}.png`, clip });
    await page.waitForTimeout(60);
  }
  await ctx.close();
}

// ── death → "New ticket" routes back into this arena's ticket ──
if (want('newticket')) {
  const { ctx, page } = await newPage({ viewport: P, mobile: true });
  await pickTicket(page, 'arena:2');
  await cta(page).click();
  await page.waitForSelector('.tf-sheet');
  await page.evaluate(() => (window.__elymumChain.fakeWallet.delayMs = 300));
  await page.locator('.tf-sheet .kb-btn--pink').click();
  await page.waitForFunction(() => window.__elymum.useUi.getState().screen === 'playing', null, { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.evaluate(() =>
    window.__elymum.engine['onMessage']({
      t: 'death',
      stats: { aliveMs: 61_000, finalMass: 0, maxMass: 300, foodEaten: 40, cellsEaten: 0, playersEaten: 0, bestRank: 4, valueLost: 10_000_000_000 },
      killer: 'Nakamoto',
      killerSkin: 1,
    }),
  );
  await page.waitForTimeout(1200);
  await page.locator('.g-death .kb-btn--pink').click();
  await page.waitForFunction(() => window.__elymum.useUi.getState().screen === 'lobby', null, { timeout: 5000 });
  await page.waitForTimeout(1500);
  await shot(page, 'newticket-lobby');
  await ctx.close();
}

// ── Gold Lake (balance topped up): every arena is open to everyone; then a refused transaction ──
if (want('goldlake')) {
  const { ctx, page } = await newPage({ viewport: D });
  await page.evaluate(() => {
    window.__elymumChain.fakeWallet.tokenBalance = 62_450n * 10n ** 18n;
    window.__elymumChain.refresh();
  });
  await page.waitForTimeout(900);
  await pickTicket(page, 'arena:3');
  await cta(page).click();
  await page.waitForSelector('.tf-sheet');
  await page.waitForTimeout(700);
  await shot(page, 'ticket-sheet-goldlake');
  // ArenaFull: the chain refuses the join
  await page.evaluate(() => (window.__elymumChain.fakeWallet.failNext = 'ArenaFull'));
  await page.locator('.tf-sheet .kb-btn--pink').click();
  await page.waitForSelector('.tf-error', { timeout: 6000 });
  await page.waitForTimeout(300);
  await shot(page, 'ticket-error-arenafull');
  await ctx.close();
}

// ── the game token is not set yet: "Opening soon", then the live flip when it is set ──
// (the server must run without DEV_FAKE_TOKEN; this step sets the token on the fake chain)
if (want('soon')) {
  const api = base.replace(/\/$/, '');
  for (const [k, viewport, mobile] of [
    ['desktop', D, false],
    ['mobile', P, true],
  ]) {
    const { ctx, page } = await newPage({ viewport, mobile, tokenReady: false });
    const ready = await page.evaluate(() => window.__elymum.useUi.getState().chain?.tokenReady);
    if (ready) {
      logs.push('[soon] the server already has the token set: run it without DEV_FAKE_TOKEN');
      await ctx.close();
      break;
    }
    await shot(page, `soon-${k}`);
    if (k === 'mobile') {
      // the server sets the token and pushes `chain`: the arenas open with no reload
      const res = await fetch(`${api}/api/dev/token`, { method: 'POST' });
      logs.push(`[soon] POST /api/dev/token → ${res.status}`);
      await page.waitForFunction(() => window.__elymum.useUi.getState().chain?.tokenReady === true, null, { timeout: 10000 });
      await page.waitForFunction(() => window.__elymum.useUi.getState().rooms.some((r) => r.mode === 'arena'), null, { timeout: 15000 });
      await page.waitForTimeout(1200);
      await shot(page, 'soon-flipped-mobile');
    }
    await ctx.close();
  }
}

// ── a finalized session waits for the player to collect the payout ──
if (want('pending')) {
  for (const [k, viewport, mobile] of [
    ['desktop', D, false],
    ['mobile', P, true],
  ]) {
    const { ctx, page } = await newPage({ viewport, mobile });
    // the token transfer to the player failed at settlement: the session is finalized and its
    // payout (`owed`) waits in the arena vault
    await page.evaluate(
      ([owed, player]) => {
        const w = window.__elymumChain.fakeWallet;
        w.sessions[1] = {
          arenaId: 1,
          player,
          id: 1n,
          entryFee: 1000n * 10n ** 18n,
          openedAt: Math.floor(Date.now() / 1000) - 600,
          feeBps: 500,
          finalized: true,
          owed: BigInt(owed),
        };
        window.__elymumChain.refresh();
      },
      [String(2_150n * ONE), address],
    );
    await page.waitForTimeout(1200);
    await shot(page, `pending-${k}`);
    if (k === 'mobile') {
      // "Collect payout" opens the collect sheet (one `refund` transaction)
      await page.locator('.kl-owed .kb-btn').click();
      await page.waitForSelector('.tf-sheet');
      await page.waitForTimeout(700);
      await shot(page, 'pending-collect-sheet');
    }
    await ctx.close();
  }
}

// ── wallet, profile sheets, ranks tab ──
if (want('sheets')) {
  const { ctx, page } = await newPage({ viewport: P, mobile: true });
  await page.locator('.kl-wallet').click();
  await page.waitForTimeout(700);
  await shot(page, 'wallet-sheet');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.locator('.kl-tabs button', { hasText: 'Profile' }).click();
  await page.waitForTimeout(500);
  await shot(page, 'tab-profile');
  await page.locator('.kl-tabs button', { hasText: 'Ranks' }).click();
  await page.waitForTimeout(500);
  await shot(page, 'tab-ranks');
  await ctx.close();
  const g = await newPage({ viewport: P, mobile: true, wallet: true, verified: false });
  await g.page.evaluate(() => window.__elymum.useUi.setState({ modal: 'wallet' }));
  await g.page.waitForTimeout(700);
  await shot(g.page, 'wallet-sheet-unverified');
  await g.ctx.close();
  const n = await newPage({ viewport: P, mobile: true, wallet: false });
  await n.page.locator('.kl-wallet').click();
  await n.page.waitForTimeout(700);
  await shot(n.page, 'wallet-sheet-choose');
  await n.ctx.close();
}

if (logs.length) console.log(logs.slice(-40).join('\n'));
await browser.close();
