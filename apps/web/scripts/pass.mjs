// Pass office, newspaper standings and profile tour (Task 15): the Pass page (owned sealed / revealed,
// the application form, a countdown, sold out), the mint sheet and its envelope, the seal break, the
// standings (season with a claimable prize cheque, today, all time), the claim sheet, the profile and
// settings, on desktop and mobile, paper / night.
// Needs a dev server (pnpm dev) whose game server runs NODE_ENV=development DEV_FAKE_CHAIN=1 DEV_FAKE_PASS=revealed (and,
// for the marketplace links, MARKET_URL_*): the web dev build then uses its fake chain stand-in
// (src/solana/devFake.ts), so nothing is signed. A Wallet Standard test wallet is injected.
// Usage: node scripts/pass.mjs <baseUrl> <outDir> [step ...]   -> <outDir>/t15-*.png
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
const NAMES = ['pennyhunter', 'Nakamoto', 'Selene', 'whale_bay', 'inkwell', 'riso', 'night market', 'Alice', 'tokyo_drift', 'mustard', 'Matt'];
const fakeKey = (i) => bs58.encode(Uint8Array.from({ length: 32 }, (_, j) => (i * 37 + j * 11) % 256));
const now = () => Math.floor(Date.now() / 1000);

/** A season where the test wallet is 5th now and finished 2nd last season (prize claimable). */
function seasonFor(me, { claimed = false } = {}) {
  const entries = NAMES.map((name, i) => ({ player: fakeKey(i + 1), name, skin: i % 8, points: Math.round(4210 * Math.pow(0.86, i)), bestScore: 9000 - i * 500 }));
  entries.splice(4, 0, { player: me, name: 'Daphne', skin: 4, points: 2290, bestScore: 6100 });
  entries.splice(3, 1);
  entries.sort((a, b) => b.points - a.points);
  const prev = NAMES.slice(3).concat(NAMES.slice(0, 2)).map((name, i) => ({ player: fakeKey(i + 40), name, skin: (i + 3) % 8, points: 5120 - i * 420, bestScore: 9900 - i * 400 }));
  prev.splice(1, 0, { player: me, name: 'Daphne', skin: 4, points: 4800, bestScore: 9700 });
  return {
    id: 2,
    startedAt: now() - 11 * 86_400 - 3600,
    finalized: false,
    prizePool: 84_200 * M,
    entries,
    previous: { id: 1, prizePool: 61_500 * M, endedAt: now() - 11 * 86_400 - 3600, entries: prev.slice(0, 10), claimedMask: claimed ? 0b111 : 0b101 },
  };
}
const BOARD = (me) => ({
  day: new Date().toISOString().slice(0, 10),
  daily: NAMES.slice(0, 9).map((name, i) => ({ name, score: 2480 - i * 190, skin: (i * 3) % 8, wallet: i === 2 ? me : fakeKey(i + 70), kills: 14 - i, at: Date.now() })),
  allTime: NAMES.map((name, i) => ({ name, score: 9120 - i * 410, skin: (i * 5) % 8, wallet: fakeKey(i + 90), kills: 41 - i * 3, at: Date.now() })),
});

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

async function newPage({ viewport, mobile = false, theme = 'light', wallet = true, reduced = false, hash = '', season = 'mine', setup = null }) {
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
      const def = { name: 'Daphne', skin: 4, theme: 'light', quality: 'high', sound: false, volume: 0.6, showNames: true, showMass: true, showFps: false, showMinimap: true, showChat: true };
      localStorage.setItem('slana.settings.v1', JSON.stringify({ ...def, ...s }));
    },
    { theme },
  );
  const kp = nacl.sign.keyPair();
  const me = bs58.encode(kp.publicKey);
  if (season) await ctx.route('**/api/season', (r) => r.fulfill({ json: seasonFor(me, { claimed: season === 'claimed' }) }));
  await ctx.route('**/api/leaderboard', (r) => r.fulfill({ json: BOARD(me) }));
  let address = null;
  if (wallet) address = await installWallet(ctx, kp, true);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && logs.push(`[console.error] ${m.text()}`));
  await page.goto(`${base}${hash}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__slana && window.__slana.useUi.getState().connected, null, { timeout: 15000 });
  await page.waitForFunction(() => !!window.__slanaChain?.fakeWallet, null, { timeout: 10000 });
  if (setup) await page.evaluate(setup);
  await page.evaluate(() => window.__slanaChain.refresh());
  if (wallet) await page.waitForFunction(() => window.__slanaChain.useChainData.getState().tokenBalance !== null, null, { timeout: 10000 });
  await page.waitForTimeout(1500);
  return { ctx, page, address };
}

const shot = (page, name) => page.screenshot({ path: `${out}/t15-${name}.png` });
const D = { width: 1440, height: 900 };
const P = { width: 390, height: 844 };
const PROFILE = (owner) => ({
  address: 'DevProfile',
  owner,
  name: 'Daphne',
  skin: 4,
  xp: 1840,
  level: 7,
  gamesPlayed: 212,
  kills: 389,
  bestScore: 9700,
  totalScore: 412000,
  season: 2,
  seasonPoints: 2290,
  stakeGames: 64,
  totalStaked: 128000000000n,
  totalWon: 151250000000n,
  createdAt: Math.floor(Date.now() / 1000) - 40 * 86400,
  lastPlayed: 0,
});
const sealedSetup = () => {
  window.__slanaChain.fakeWallet.pass = { revealed: false, mintOpen: true };
};
const applySetup = () => {
  window.__slanaChain.fakeWallet.passes = [];
  window.__slanaChain.fakeWallet.pass = { revealed: false, mintOpen: true };
};

// ── Pass page: revealed passport (seal broken), desktop + mobile, all prints ──
for (const [k, viewport, mobile, theme] of [
  ['desktop-paper', D, false, 'light'],
  ['desktop-night', D, false, 'dark'],
  ['mobile-paper', P, true, 'light'],
  ['mobile-night', P, true, 'dark'],
]) {
  if (!want('owned') && !want(`owned-${k}`)) continue;
  const { ctx, page } = await newPage({ viewport, mobile, theme, hash: '#pass' });
  await page.waitForSelector('.pp-card');
  await page.evaluate(() => {
    const p = window.__slanaChain.useChainData.getState().passes[0];
    localStorage.setItem('slana.revealSeen.v1', JSON.stringify([p.asset]));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.pp-card:not(.is-sealed)', { timeout: 15000 });
  await page.waitForTimeout(1500);
  await shot(page, `pass-owned-${k}`);
  if (k === 'desktop-paper') {
    await page.evaluate(() => document.querySelector('.kl-root').scrollTo({ top: 900 }));
    await page.waitForTimeout(400);
    await shot(page, `pass-owned-${k}-scrolled`);
  }
  await ctx.close();
}

// ── reveal: sealed passport after the reveal, then the seal break (frames) ──
if (want('reveal')) {
  const { ctx, page } = await newPage({ viewport: D, hash: '#pass' });
  await page.waitForSelector('.pp-card.is-sealed');
  await page.waitForTimeout(600);
  await shot(page, 'pass-reveal-ready');
  await page.locator('.pp-card .kb-btn--pink').click();
  const box = await page.locator('.pp-card__book').boundingBox();
  const clip = { x: box.x - 40, y: box.y - 40, width: 760, height: box.height + 160 };
  for (const [i, ms] of [[0, 120], [1, 160], [2, 160], [3, 180], [4, 260], [5, 600]]) {
    await page.waitForTimeout(ms);
    await page.screenshot({ path: `${out}/t15-reveal-frame-${i}.png`, clip });
  }
  await page.waitForTimeout(600);
  await shot(page, 'pass-reveal-done');
  await ctx.close();
}

// ── sealed (before the reveal) ──
if (want('sealed')) {
  for (const [k, viewport, mobile, theme] of [
    ['desktop', D, false, 'light'],
    ['mobile-night', P, true, 'dark'],
  ]) {
    const { ctx, page } = await newPage({ viewport, mobile, theme, hash: '#pass', setup: sealedSetup });
    await page.waitForSelector('.pp-card.is-sealed');
    await page.waitForTimeout(800);
    await shot(page, `pass-sealed-${k}`);
    await ctx.close();
  }
}

// ── application form: open mint, mobile, night, countdown, sold out ──
if (want('apply')) {
  for (const [k, viewport, mobile, theme, extra] of [
    ['desktop-paper', D, false, 'light', null],
    ['mobile-paper', P, true, 'light', null],
    ['desktop-night', D, false, 'dark', null],
    ['countdown', D, false, 'light', 'countdown'],
    ['soldout-mobile', P, true, 'light', 'soldout'],
    ['guest', D, false, 'light', 'guest'],
  ]) {
    const setup =
      extra === 'countdown'
        ? () => {
            window.__slanaChain.fakeWallet.passes = [];
            window.__slanaChain.fakeWallet.pass = { revealed: false, mintOpen: true, mintStartTs: Math.floor(Date.now() / 1000) + 2 * 86400 + 4 * 3600 + 9 * 60 + 33 };
          }
        : extra === 'soldout'
          ? () => {
              window.__slanaChain.fakeWallet.passes = [];
              window.__slanaChain.fakeWallet.pass = { revealed: false, mintOpen: true, minted: 3333 };
            }
          : applySetup;
    const { ctx, page } = await newPage({ viewport, mobile, theme, hash: '#pass', setup, wallet: extra !== 'guest' });
    if (extra === 'guest') {
      await page.evaluate(applySetup);
      await page.evaluate(() => window.__slanaChain.refresh());
      await page.waitForTimeout(800);
    }
    await page.waitForSelector('.pp-form');
    await page.waitForTimeout(1200);
    await shot(page, `pass-apply-${k}`);
    if (k === 'mobile-paper') {
      await page.evaluate(() => document.querySelector('.kl-root').scrollTo({ top: 700 }));
      await page.waitForTimeout(400);
      await shot(page, `pass-apply-${k}-scrolled`);
    }
    await ctx.close();
  }
}

// ── the mint: sheet, signing, envelope frames, delivered, the new sealed passport ──
for (const [k, viewport, mobile, reduced] of [
  ['desktop', D, false, false],
  ['mobile', P, true, false],
  ['reduced', D, false, true],
]) {
  if (!want('mint') && !want(`mint-${k}`)) continue;
  const { ctx, page } = await newPage({ viewport, mobile, reduced, hash: '#pass', setup: applySetup });
  await page.waitForSelector('.pp-form');
  await page.locator('.pp-mint .kb-btn').click();
  await page.waitForSelector('.mt-sheet');
  await page.waitForTimeout(700);
  await shot(page, `mint-sheet-${k}`);
  await page.evaluate(() => (window.__slanaChain.fakeWallet.delayMs = 700));
  await page.locator('.mt-sheet .kb-btn--pink').click();
  await page.waitForTimeout(400);
  await shot(page, `mint-signing-${k}`);
  await page.waitForSelector('.rv-env.is-open', { timeout: 6000 });
  if (k === 'desktop') {
    const box = await page.locator('.rv-env').boundingBox();
    const clip = { x: box.x - 30, y: box.y - 20, width: box.width + 60, height: box.height + 60 };
    for (let i = 0; i < 10; i++) {
      await page.screenshot({ path: `${out}/t15-envelope-frame-${String(i).padStart(2, '0')}.png`, clip });
      await page.waitForTimeout(170);
    }
  }
  await page.waitForTimeout(2300);
  await shot(page, `mint-delivered-${k}`);
  await page.locator('.mt-sheet .kb-btn--pink').click();
  await page.waitForTimeout(1600);
  await shot(page, `mint-after-${k}`);
  await ctx.close();
}

// ── standings ──
for (const [k, viewport, mobile, theme] of [
  ['desktop-paper', D, false, 'light'],
  ['desktop-night', D, false, 'dark'],
  ['mobile-paper', P, true, 'light'],
  ['mobile-night', P, true, 'dark'],
]) {
  if (!want('news') && !want(`news-${k}`)) continue;
  const { ctx, page } = await newPage({ viewport, mobile, theme, hash: '#ranks' });
  await page.waitForSelector('.nw-table');
  await page.waitForTimeout(1400);
  await shot(page, `news-season-${k}`);
  if (k.startsWith('mobile')) {
    await page.evaluate(() => document.querySelector('.kl-root').scrollTo({ top: 760 }));
    await page.waitForTimeout(500);
    await shot(page, `news-season-${k}-scrolled`);
    await page.evaluate(() => document.querySelector('.kl-root').scrollTo({ top: 0 }));
  }
  await page.locator('.nw-tabs [role="tab"]').nth(1).click();
  await page.waitForTimeout(900);
  await shot(page, `news-today-${k}`);
  if (k === 'desktop-paper') {
    await page.locator('.nw-tabs [role="tab"]').nth(2).click();
    await page.waitForTimeout(900);
    await shot(page, `news-all-${k}`);
  }
  await ctx.close();
}

// ── claim the prize ──
if (want('claim')) {
  const { ctx, page } = await newPage({ viewport: D, hash: '#ranks' });
  await page.waitForSelector('.sc-cheque');
  await page.locator('.sc-cheque .kb-btn').click();
  await page.waitForSelector('.sc-sheet');
  await page.waitForTimeout(700);
  await shot(page, 'claim-sheet');
  await page.evaluate(() => (window.__slanaChain.fakeWallet.delayMs = 500));
  await page.locator('.sc-sheet .kb-btn--pink').click();
  await page.waitForTimeout(300);
  await shot(page, 'claim-signing');
  await page.waitForSelector('.sc-sheet .sc-cheque__stamp', { timeout: 6000 });
  await page.waitForTimeout(700);
  await shot(page, 'claim-paid');
  await ctx.close();
  const c = await newPage({ viewport: D, hash: '#ranks', season: 'claimed' });
  await c.page.waitForSelector('.sc-cheque');
  await c.page.waitForTimeout(900);
  await shot(c.page, 'news-claimed');
  await c.ctx.close();
}

// ── profile and settings ──
for (const [k, viewport, mobile, theme] of [
  ['desktop-paper', D, false, 'light'],
  ['desktop-night', D, false, 'dark'],
  ['mobile-paper', P, true, 'light'],
  ['mobile-night', P, true, 'dark'],
]) {
  if (!want('profile') && !want(`profile-${k}`)) continue;
  const { ctx, page, address } = await newPage({ viewport, mobile, theme, hash: '#profile' });
  await page.evaluate((p) => {
    window.__slanaChain.fakeWallet.profile = { ...p, totalStaked: BigInt(p.totalStaked), totalWon: BigInt(p.totalWon) };
    window.__slanaChain.refresh();
  }, { ...PROFILE(address), totalStaked: '128000000000', totalWon: '151250000000' });
  await page.waitForSelector('.pf-card');
  await page.waitForTimeout(1500);
  await shot(page, `profile-${k}`);
  if (mobile) {
    await page.evaluate(() => document.querySelector('.kl-root').scrollTo({ top: 1000 }));
    await page.waitForTimeout(500);
    await shot(page, `profile-${k}-scrolled`);
  }
  if (k === 'desktop-paper') {
    await page.locator('.pf-box .kb-field__input').fill('Daphne K');
    await page.waitForTimeout(300);
    await shot(page, 'profile-dirty');
    await page.locator('.kl-mast .kb-iconbtn[aria-label="Settings"]').click();
    await page.waitForTimeout(700);
    await shot(page, 'settings-sheet');
    await page.locator('.g-settings .kl-link').click();
    await page.waitForTimeout(700);
    await shot(page, 'howto-sheet');
  }
  await ctx.close();
}

// ── the lobby front page after the changes (section index, Pass card links) ──
if (want('lobby')) {
  for (const [k, viewport, mobile] of [
    ['desktop', D, false],
    ['mobile', P, true],
  ]) {
    const { ctx, page } = await newPage({ viewport, mobile });
    await shot(page, `lobby-${k}`);
    await ctx.close();
  }
}

if (logs.length) console.log(logs.slice(-40).join('\n'));
await browser.close();
