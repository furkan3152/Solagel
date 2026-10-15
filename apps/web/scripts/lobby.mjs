// Lobby and ticket-flow tour (Task 14): screenshots of the lobby (desktop / mobile,
// paper / night), the ticket confirm sheet, the stamp-and-tear frame, the R10 payout CTA,
// the PassInUse error, and the wallet / profile sheets.
// Needs a dev server (pnpm dev) whose game server runs NODE_ENV=development DEV_FAKE_CHAIN=1:
// the web dev build then uses its fake chain stand-in (src/solana/devFake.ts), so no
// transaction is signed. A Wallet Standard test wallet is injected (it signs the free login
// message with a throwaway key and refuses transactions).
// Usage: node scripts/lobby.mjs <baseUrl> <outDir> [step ...]   → <outDir>/t14-*.png
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const nacl = require('tweetnacl');
const bs58 = require('bs58').default ?? require('bs58');

const [base, out, ...which] = process.argv.slice(2);
const want = (k) => which.length === 0 || which.includes(k);
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', process.env.CHROME_PATH].filter(Boolean).find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const logs = [];

const M = 1_000_000;
const SEASON = {
  id: 1,
  startedAt: Math.floor(Date.now() / 1000) - 11 * 86_400 - 3600,
  finalized: false,
  prizePool: 84_200 * M,
  entries: [
    { player: 'P1', name: 'pennyhunter', skin: 3, points: 4210, bestScore: 9000 },
    { player: 'P2', name: 'Nakamoto', skin: 1, points: 3980, bestScore: 8800 },
    { player: 'P3', name: 'Daphne', skin: 4, points: 3120, bestScore: 7000 },
    { player: 'P4', name: 'whale_bay', skin: 6, points: 2400, bestScore: 6400 },
    { player: 'P5', name: 'inkwell', skin: 2, points: 1985, bestScore: 5000 },
    { player: 'P6', name: 'riso', skin: 5, points: 1530, bestScore: 4100 },
    { player: 'P7', name: 'night market', skin: 7, points: 990, bestScore: 2500 },
  ],
  previous: null,
};

const ICON =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#1E1B2E"/><circle cx="16" cy="16" r="8" fill="#FF4F87"/></svg>',
  ).toString('base64');

/** Injects a Wallet Standard wallet ("Test Wallet") whose key lives in this script. */
async function installWallet(ctx, kp, autoConnect) {
  const address = bs58.encode(kp.publicKey);
  await ctx.exposeBinding('__kbSign', (_src, bytes) => Array.from(nacl.sign.detached(Uint8Array.from(bytes), kp.secretKey)));
  await ctx.addInitScript(
    ({ address, pub, icon, autoConnect }) => {
      if (autoConnect) localStorage.setItem('walletName', JSON.stringify('Test Wallet'));
      const chains = ['solana:devnet', 'solana:mainnet', 'solana:testnet', 'solana:localnet'];
      const account = { address, publicKey: Uint8Array.from(pub), chains, features: ['solana:signMessage', 'solana:signTransaction'], label: 'Test' };
      const listeners = new Set();
      const wallet = {
        version: '1.0.0',
        name: 'Test Wallet',
        icon,
        chains,
        accounts: [],
        features: {
          'standard:connect': {
            version: '1.0.0',
            connect: async () => {
              wallet.accounts = [account];
              listeners.forEach((l) => l({ accounts: wallet.accounts }));
              return { accounts: wallet.accounts };
            },
          },
          'standard:disconnect': {
            version: '1.0.0',
            disconnect: async () => {
              wallet.accounts = [];
              listeners.forEach((l) => l({ accounts: [] }));
            },
          },
          'standard:events': {
            version: '1.0.0',
            on: (ev, l) => {
              if (ev !== 'change') return () => {};
              listeners.add(l);
              return () => listeners.delete(l);
            },
          },
          'solana:signMessage': {
            version: '1.0.0',
            signMessage: async (...inputs) =>
              Promise.all(
                inputs.map(async ({ message }) => ({ signedMessage: message, signature: Uint8Array.from(await window.__kbSign(Array.from(message))) })),
              ),
          },
          'solana:signTransaction': {
            version: '1.0.0',
            supportedTransactionVersions: ['legacy', 0],
            signTransaction: async () => {
              throw new Error('test wallet refuses transactions');
            },
          },
        },
      };
      const register = ({ register }) => register(wallet);
      window.addEventListener('wallet-standard:app-ready', (e) => register(e.detail));
      try {
        window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }));
      } catch {
        /* ignore */
      }
    },
    { address, pub: Array.from(kp.publicKey), icon: ICON, autoConnect },
  );
  return address;
}

async function newPage({ viewport, mobile = false, theme = 'light', wallet = true, verified = true, pending = null, reduced = false }) {
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
      localStorage.setItem('slana.settings.v1', JSON.stringify({ ...def, ...s }));
    },
    { theme },
  );
  await ctx.route('**/api/season', (r) => r.fulfill({ json: SEASON }));
  if (pending) await ctx.route('**/api/pending*', (r) => r.fulfill({ json: { pending } }));
  const kp = nacl.sign.keyPair();
  let address = null;
  if (wallet) address = await installWallet(ctx, kp, true);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && logs.push(`[console.error] ${m.text()}`));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__slana && window.__slana.useUi.getState().connected, null, { timeout: 15000 });
  if (wallet && verified) {
    const res = await fetch(`${base.replace(/\/$/, '')}/api/auth/nonce?pubkey=${address}`);
    const { message } = await res.json();
    const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
    await page.evaluate(([p, m, s]) => window.__slana.engine.authSignature(p, m, s), [address, message, sig]);
    await page.waitForFunction(() => !!window.__slana.useUi.getState().auth, null, { timeout: 10000 });
  }
  if (wallet)
    await page.waitForFunction(() => !!window.__slanaChain?.fakeWallet && window.__slanaChain.useChainData.getState().tokenBalance !== null, null, {
      timeout: 10000,
    });
  await page.waitForFunction(() => !!window.__slanaChain?.fakeWallet, null, { timeout: 10000 });
  await page.evaluate(() => window.__slanaChain.refresh());
  await page.waitForTimeout(1600);
  return { ctx, page, address };
}

const shot = (page, name) => page.screenshot({ path: `${out}/t14-${name}.png` });
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
  // turn the Pass on to show what it changes
  const sw = page.locator('.tf-switch');
  if (k === 'desktop' && (await sw.count())) {
    await sw.click();
    await page.waitForTimeout(300);
    await shot(page, `ticket-sheet-pass-${k}`);
  }
  await page.evaluate(() => (window.__slanaChain.fakeWallet.delayMs = 700));
  await page.locator('.tf-sheet .kb-btn--pink').click();
  await page.waitForTimeout(350);
  await shot(page, `ticket-signing-${k}`);
  await page.waitForSelector('.tf-ticket__stamp', { timeout: 5000 });
  await page.waitForTimeout(reduced ? 150 : 330);
  await shot(page, `ticket-stamp-${k}`);
  await page.waitForTimeout(reduced ? 200 : 520);
  await shot(page, `ticket-tear-${k}`);
  await page.waitForFunction(() => window.__slana.useUi.getState().screen === 'playing', null, { timeout: 15000 });
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
  await page.evaluate(() => (window.__slanaChain.fakeWallet.delayMs = 400));
  await page.locator('.tf-sheet .kb-btn--pink').click();
  await page.waitForSelector('.tf-ticket__stamp', { timeout: 5000 });
  const box = await page.locator('.tf-ticket').boundingBox();
  const clip = { x: box.x - 10, y: box.y - 10, width: box.width + 60, height: box.height + 70 };
  for (let i = 0; i < 12; i++) {
    await page.screenshot({ path: `${out}/t14-frame-${String(i).padStart(2, '0')}.png`, clip });
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
  await page.evaluate(() => (window.__slanaChain.fakeWallet.delayMs = 300));
  await page.locator('.tf-sheet .kb-btn--pink').click();
  await page.waitForFunction(() => window.__slana.useUi.getState().screen === 'playing', null, { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.evaluate(() =>
    window.__slana.engine['onMessage']({
      t: 'death',
      stats: { aliveMs: 61_000, finalMass: 0, maxMass: 300, foodEaten: 40, cellsEaten: 0, playersEaten: 0, bestRank: 4, valueLost: 10_000_000_000 },
      killer: 'Nakamoto',
      killerSkin: 1,
    }),
  );
  await page.waitForTimeout(1200);
  await page.locator('.g-death .kb-btn--pink').click();
  await page.waitForFunction(() => window.__slana.useUi.getState().screen === 'lobby', null, { timeout: 5000 });
  await page.waitForTimeout(1500);
  await shot(page, 'newticket-lobby');
  await ctx.close();
}

// ── Pass-required arena (balance topped up), with the Pass picker ──
if (want('passarena')) {
  const { ctx, page } = await newPage({ viewport: D });
  await page.evaluate(() => {
    window.__slanaChain.fakeWallet.tokenBalance = 62_450_000_000n;
    window.__slanaChain.refresh();
  });
  await page.waitForTimeout(900);
  await pickTicket(page, 'arena:3');
  await cta(page).click();
  await page.waitForSelector('.tf-sheet');
  await page.waitForTimeout(700);
  await shot(page, 'ticket-sheet-passarena');
  // PassInUse: the chain refuses the Pass lock
  await page.evaluate(() => (window.__slanaChain.fakeWallet.failNext = 'PassInUse'));
  await page.locator('.tf-sheet .kb-btn--pink').click();
  await page.waitForSelector('.tf-error', { timeout: 6000 });
  await page.waitForTimeout(300);
  await shot(page, 'ticket-error-passinuse');
  await ctx.close();
}

// ── R10: a payout waits for the player's token account ──
if (want('pending')) {
  const pending = [{ key: 'DevPendingSession1', arenaId: 1, payout: 2_150 * M, needsTokenAccount: true }];
  for (const [k, viewport, mobile] of [
    ['desktop', D, false],
    ['mobile', P, true],
  ]) {
    const { ctx, page } = await newPage({ viewport, mobile, pending });
    // the payout waits for a token account this wallet does not have yet
    await page.evaluate(() => {
      window.__slanaChain.fakeWallet.ataExists = false;
      window.__slanaChain.refresh();
    });
    await page.waitForTimeout(1200);
    await shot(page, `pending-${k}`);
    if (k === 'mobile') {
      await page.locator('.kl-owed .kb-btn').click();
      await page.waitForSelector('.tf-sheet');
      await page.waitForTimeout(700);
      await shot(page, 'pending-ata-sheet');
    }
    await ctx.close();
  }
}

// ── wallet, profile sheets, Pass and ranks tabs ──
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
  await page.locator('.kl-tabs button', { hasText: 'Pass' }).click();
  await page.waitForTimeout(500);
  await shot(page, 'tab-pass');
  await page.locator('.kl-tabs button', { hasText: 'Ranks' }).click();
  await page.waitForTimeout(500);
  await shot(page, 'tab-ranks');
  await ctx.close();
  const g = await newPage({ viewport: P, mobile: true, wallet: true, verified: false });
  await g.page.evaluate(() => window.__slana.useUi.setState({ modal: 'wallet' }));
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
