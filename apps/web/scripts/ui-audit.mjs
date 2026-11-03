#!/usr/bin/env node
// UI robustness audit: visits every page, sheet, modal, card, drawer, toast and in-game HUD state
// of the web app at phone / tablet / desktop sizes in the day and night themes, with extreme data
// (huge and tiny balances, 16-character names, 50-row standings, long room names and errors,
// many toasts), and runs in-page detectors (scripts/ui-audit-detect.js):
//   overflow · text (spill / clipped / truncated) · overlap · offscreen · contrast · touch · console
// Output: <out>/<label>/findings.json, report.md, report.html, shots/*.png (cropped, highlighted).
//
//   node apps/web/scripts/ui-audit.mjs --start [--label before] [--viewports 390x844,1280x800]
//        [--themes day,night] [--scenes lobby,wallet] [--workers 3] [--out DIR] [--base URL]
//
// --start   spawns the local stack itself: the game server (NODE_ENV=development DEV_FAKE_CHAIN=1
//           DEV_FAKE_TOKEN=1 GAME_ACCESS=public ADMIN_WALLETS=<the audit's dev wallet>, a temp
//           DATA_DIR) on --server-port (8899) and vite on --web-port (5199); stops both at the end.
//           Without it, such a stack must already run at --base (its ADMIN_WALLETS must hold
//           AUDIT_ADDRESS below for the admin scenes).
// The dev wallet is an EIP-6963 provider (scripts/evm-wallet.mjs) with a fixed audit key; it signs
// the free SIWE sign-in. No transaction ever leaves the fake chain.
// Themes: `day` (the app's light paper) and `night` (the app's dark theme, plus the OS dark scheme
// for the site and admin pages, which are day pages by design).
// --serve   only starts the stack (as --start does) and keeps it up, for repeated runs against --base.
// --full-shots also saves a viewport screenshot of every audited state (states/*.png).
// --selftest checks the detectors against a fixture page with one known bug each.
// --scenes takes id prefixes (`lobby` runs lobby-*); --list prints the scene ids.
// --locale ru runs every scene in that interface language (en, tr, es, pt, ru, zh; default en): the
//           browser locale and the stored language pick are set before the app boots.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright';
import { privateKeyToAccount } from 'viem/accounts';
import { installEvmWallet, newDevKey } from './evm-wallet.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const list = (n, d) => (opt(n, d) || '').split(',').filter(Boolean);

const SERVER_PORT = Number(opt('--server-port', '8899'));
const WEB_PORT = Number(opt('--web-port', '5199'));
const BASE = opt('--base', `http://localhost:${WEB_PORT}`).replace(/\/$/, '');
const OUT_ROOT = resolve(opt('--out', '/home/user/Solagel/out/work/ui-audit'));
const LABEL = opt('--label', 'run');
const OUT = join(OUT_ROOT, LABEL);
const WORKERS = Number(opt('--workers', '3'));
const LOCALE = opt('--locale', 'en');
const LOCALE_TAG = { en: 'en-US', tr: 'tr-TR', es: 'es-ES', pt: 'pt-BR', ru: 'ru-RU', zh: 'zh-CN' }[LOCALE];
if (!LOCALE_TAG) throw new Error(`--locale must be one of en, tr, es, pt, ru, zh (got ${LOCALE})`);
const MAX_SHOTS = Number(opt('--max-shots', '500'));
const SHOTS = !flag('--no-shots');
const log = (...a) => console.error('[ui-audit]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The audit's dev wallet (fixed, so the stack can list it in ADMIN_WALLETS). */
export const AUDIT_KEY = `0x${'a1'.repeat(32)}`;
export const AUDIT_ADDRESS = privateKeyToAccount(AUDIT_KEY).address;
const ONE = 10n ** 18n;

const VIEWPORTS = [
  { name: '320x568', w: 320, h: 568, touch: true, dpr: 2 },
  { name: '360x640', w: 360, h: 640, touch: true, dpr: 2 },
  { name: '390x844', w: 390, h: 844, touch: true, dpr: 2 },
  { name: '414x896', w: 414, h: 896, touch: true, dpr: 2 },
  { name: '844x390', w: 844, h: 390, touch: true, dpr: 2 },
  { name: '768x1024', w: 768, h: 1024, touch: true, dpr: 1 },
  { name: '1024x768', w: 1024, h: 768, touch: true, dpr: 1 },
  { name: '1280x800', w: 1280, h: 800, touch: false, dpr: 1 },
  { name: '1440x900', w: 1440, h: 900, touch: false, dpr: 1 },
  { name: '1920x1080', w: 1920, h: 1080, touch: false, dpr: 1 },
];
const THEMES = ['day', 'night'];

// ───────────────────────────── stress data ─────────────────────────────
const LONG = 'WWWWWWWWWWWWWWWW'; // 16, the name limit
const LONG_M = 'MMMMMMMMMMMMMMMM';
const LONG_ROOM = 'Friday Night Mega Whale Pond of Champions';
const LONG_ERR =
  'The transaction was rejected by the node: execution reverted with a custom error ArenaFull(uint256 arenaId, uint256 players, uint256 cap) while estimating gas for 0x5d5c99EdF529335160FF180fA141Dd4967fc00D2';
const BAL = {
  huge: 1_109_986_257_991_550_000_000_000n, // 1,109,986.25799155
  max: 999_999_999_999_123_456_000_000_000_000n, // 999,999,999,999.123456
  zero: 0n,
  tiny: 1_000_000_000_000n, // 0.000001
};
const HYPE = { huge: 12_345_678_900_000_000_000_000n, zero: 0n, tiny: 1_000_000_000_000n };

// ───────────────────────────── the stack (optional) ─────────────────────────────
const kids = [];
async function startStack() {
  const data = mkdtempSync(join(tmpdir(), 'elymum-ui-audit-'));
  const server = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: join(ROOT, 'apps/server'),
    detached: true,
    stdio: 'ignore',
    // TRUST_PROXY: every audit context sends its own X-Forwarded-For, so the per-IP rate limits never trip
    env: { ...process.env, TRUST_PROXY: '1', ROUND_SECONDS: '3600', ROUND_JOIN_CLOSE_SECONDS: '5', NODE_ENV: 'development', DEV_FAKE_CHAIN: '1', DEV_FAKE_TOKEN: '1', GAME_ACCESS: 'public', ADMIN_WALLETS: AUDIT_ADDRESS, PORT: String(SERVER_PORT), DATA_DIR: data },
  });
  const web = spawn('npx', ['vite', '--port', String(WEB_PORT), '--strictPort'], {
    cwd: join(ROOT, 'apps/web'),
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, GAME_SERVER: `http://127.0.0.1:${SERVER_PORT}` },
  });
  kids.push(server, web);
  for (let i = 0; i < 90; i++) {
    const ok = await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false);
    if (ok) return () => rmSync(data, { recursive: true, force: true });
    await sleep(1000);
  }
  throw new Error('the stack did not come up');
}
function stopStack() {
  for (const k of kids) {
    try {
      process.kill(-k.pid, 'SIGTERM');
    } catch {}
  }
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'])
  process.on(sig, () => {
    stopStack();
    process.exit(130);
  });

// ───────────────────────────── page helpers ─────────────────────────────
const DETECT_SRC = readFileSync(join(HERE, 'ui-audit-detect.js'), 'utf8');

/** Console noise that is not the app's: dev-server chatter, the fake chain's warnings, blocked fonts. */
const CONSOLE_IGNORE = [/\[vite\]/i, /Download the React DevTools/i, /favicon/i, /net::ERR_ABORTED/, /WebSocket connection to .* failed/i];

async function settle(page, ms = 700) {
  await page.waitForTimeout(ms);
  // finish entrance animations: jump every running animation to its end
  await page
    .evaluate(() => {
      for (const a of document.getAnimations()) {
        try {
          const t = a.effect?.getComputedTiming?.();
          if (t && Number.isFinite(t.endTime) && t.iterations !== Infinity) a.finish();
        } catch {}
      }
    })
    .catch(() => {});
  await page.waitForTimeout(150);
}

/** Signs the context's site session in once (SIWE through the dev wallet; the token lands in localStorage). */
async function ensureSession(page) {
  const ok = await page.evaluate(async () => {
    try {
      const raw = localStorage.getItem('elymum.auth.v1');
      if (raw && JSON.parse(raw).exp > Date.now() + 120_000) return true;
      const w = window.__elymumDevWallet;
      if (!w) return false;
      const n = await fetch(`/api/auth/nonce?address=${w.address}`).then((r) => r.json());
      const hex = '0x' + [...new TextEncoder().encode(n.message)].map((b) => b.toString(16).padStart(2, '0')).join('');
      const signature = await w.provider.request({ method: 'personal_sign', params: [hex, w.address] });
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: w.address, message: n.message, signature }) }).then((r) => r.json());
      if (!res.token) return false;
      localStorage.setItem('elymum.auth.v1', JSON.stringify({ address: res.address, token: res.token, exp: Date.now() + 23 * 3600_000 }));
      if (res.admin) localStorage.setItem('elymum.site.admin.v1', res.address);
      return true;
    } catch (e) {
      return String(e);
    }
  });
  if (ok !== true) throw new Error(`site sign-in failed: ${ok}`);
}

/** In-page stress for the game app: fake-chain balances, long names, inflated messages. */
async function stressPlay(page, { token = 'max', hype = 'huge' } = {}) {
  await page.evaluate(
    ([tok, wei, LONG, LONG_M]) => {
      const c = window.__elymumChain;
      if (c?.fakeWallet) {
        c.fakeWallet.tokenBalance = BigInt(tok);
        c.fakeWallet.wei = BigInt(wei);
        c.fakeWallet.delayMs = 400;
        c.refresh();
      }
      const E = window.__elymum?.engine;
      if (E && !E.__auditWrapped) {
        E.__auditWrapped = true;
        const orig = E.onMessage.bind(E);
        const long = (i) => (i % 2 ? LONG_M : LONG);
        // flags by the names: drawn ones, a code badge (TV) and none
        const flag = (i) => ['US', 'GB', 'TV', undefined, 'BR', 'JP'][i % 6];
        E.onMessage = (m) => {
          try {
            if (m.t === 'lb') {
              m = { ...m, top: m.top.map((e, i) => ({ ...e, name: long(i), country: flag(i), score: 99_999 - i * 997, value: e.value !== undefined ? 99_999_999_999_000_000 - i * 1e12 : undefined })), players: Math.max(m.players, 50) };
              if (m.me) m.me = { ...m.me, rank: 50, score: 99_999, value: m.me.value !== undefined ? 999_999_999_999_123_456 : undefined };
            } else if (m.t === 'standings') {
              const rows = [];
              for (let i = 0; i < 50; i++) rows.push({ pid: 1000 + i, name: long(i), country: flag(i), skin: i % 8, score: 99_999 - i * 1999, value: 99_999_999_999_000_000 - i * 1e15, isBot: i % 3 === 0, verified: i % 4 === 1, holder: i % 5 === 2 });
              if (m.rows[0]) rows[7] = { ...m.rows[0], name: long(7), score: 99_999 };
              m = { ...m, rows, players: 50, watching: 1234 };
            } else if (m.t === 'kf') {
              m = { ...m, killer: LONG, victim: LONG_M };
            } else if (m.t === 'chat') {
              m = { ...m, from: LONG };
            } else if (m.t === 'value') {
              m = { ...m, value: 999_999_999_999_123_456 };
            }
          } catch {}
          return orig(m);
        };
      }
    },
    [String(BAL[token]), String(HYPE[hype]), LONG, LONG_M],
  );
}

const ui = (page, fn, arg) => page.evaluate(fn, arg);
/** Sets the game app's UI store. */
const setUi = (page, patch) => page.evaluate((p) => window.__elymum.useUi.setState(p), patch);
/** Feeds a server message to the engine (as if the server sent it). */
const feed = (page, m) => page.evaluate((m) => window.__elymum.engine.onMessage(m), m);

async function openPlay(page, h, { hash = '', signed = true, token = 'max', hype = 'huge', wait = 900 } = {}) {
  await page.goto(`${BASE}/play${hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__elymum && window.__elymum.useUi.getState().connected, null, { timeout: 30000 });
  if (signed) {
    await page.waitForFunction(() => !!window.__elymum.useUi.getState().auth, null, { timeout: 15000 }).catch(async () => {
      const acct = privateKeyToAccount(AUDIT_KEY);
      const res = await page.evaluate((a) => fetch(`/api/auth/nonce?address=${a}`).then((r) => r.json()), acct.address);
      const signature = await acct.signMessage({ message: res.message });
      await page.evaluate(([a, m, s]) => window.__elymum.engine.authSignature(a, m, s), [acct.address, res.message, signature]);
      await page.waitForFunction(() => !!window.__elymum.useUi.getState().auth, null, { timeout: 10000 });
    });
    await page.waitForFunction(() => !!window.__elymumChain?.fakeWallet, null, { timeout: 15000 });
  }
  await stressPlay(page, { token, hype });
  await page.waitForFunction(() => window.__elymum.useUi.getState().rooms.length > 0, null, { timeout: 15000 }).catch(() => {});
  await settle(page, wait);
}

async function playPractice(page) {
  await page.evaluate(() => window.__elymum.engine.play('practice'));
  await page.waitForFunction(() => window.__elymum.useUi.getState().screen === 'playing', null, { timeout: 15000 });
  await settle(page, 1800);
  // the round intro card (a passing, pointer-transparent overlay) leaves first
  await page.waitForFunction(() => !document.querySelector('.gm-intro__card'), null, { timeout: 12000 }).catch(() => {});
  await settle(page, 300);
}

const DEATH_STATS = { aliveMs: 3_723_000, finalMass: 0, maxMass: 99_999, foodEaten: 99_999, cellsEaten: 9_999, playersEaten: 999, bestRank: 1, xp: 99_999, payout: 0, valueLost: 999_999_999_999_123_456 };
const ROUND_STANDINGS = Array.from({ length: 10 }, (_, i) => ({ name: i % 2 ? LONG_M : LONG, value: 999_999_999_999_123_456 - i * 1e15, isBot: i % 3 === 0, you: i === 3 }));

// ───────────────────────────── scenes ─────────────────────────────
// Each scene: { id, app: site|play|admin, auth: guest|signed, run(page, h) } — `run` leaves the page in
// the state to audit; `h.check(label)` may be called for intermediate states (each is audited).
const site = (id, path, extra = {}) => ({ id, app: 'site', auth: 'signed', run: async (page) => (await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' }), await page.waitForLoadState('networkidle').catch(() => {}), await settle(page, 1500)), ...extra });

const SCENES = [
  // ── public site ──
  site('site-landing', '/'),
  site('site-landing-guest', '/', { auth: 'guest', scroll: false }),
  site('site-wl', '/wl'),
  site('site-collab', '/collab'),
  site('site-mint', '/mint'),
  site('site-mint-guest', '/mint', { auth: 'guest' }),
  site('site-faucet', '/faucet'),
  site('site-faucet-guest', '/faucet', { auth: 'guest' }),
  site('site-docs', '/docs'),
  // every free text field filled with long values (X handles, post links, names, wallets)
  ...['wl', 'collab'].map((pg) => ({
    id: `site-${pg}-filled`,
    app: 'site',
    auth: 'signed',
    run: async (page, h) => {
      await page.goto(`${BASE}/${pg}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      await settle(page, 1500);
      await fillAll(page);
      await settle(page, 600);
    },
  })),
  {
    id: 'site-faucet-claimed',
    app: 'site',
    auth: 'signed',
    run: async (page, h) => {
      await page.goto(`${BASE}/faucet`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      await settle(page, 1500);
      const b = page.getByTestId('fc-claim');
      if (await b.count()) {
        await b.click().catch(() => {});
        await page.waitForSelector('[data-testid="fc-done"], [data-testid="fc-wait"]', { timeout: 15000 }).catch(() => h.note('no fc-done'));
        await settle(page, 800);
      } else h.note('no claim button');
    },
  },
  site('site-404', '/no-such-page'),
  {
    id: 'site-wallet-sheet',
    app: 'site',
    auth: 'signed',
    run: async (page) => {
      await page.goto(`${BASE}/wl`, { waitUntil: 'domcontentloaded' });
      await settle(page, 1500);
      await page.locator('.st-connect').first().click();
      await settle(page, 900);
    },
  },
  {
    id: 'site-wallet-connect',
    app: 'site',
    auth: 'wallet',
    run: async (page) => {
      await page.goto(`${BASE}/wl`, { waitUntil: 'domcontentloaded' });
      await settle(page, 1500);
      await page.locator('.st-connect').first().click();
      await settle(page, 900);
    },
  },

  // ── the game app: lobby ──
  { id: 'lobby-guest', app: 'play', auth: 'guest', run: (page, h) => openPlay(page, h, { signed: false }) },
  { id: 'lobby', app: 'play', auth: 'signed', run: (page, h) => openPlay(page, h) },
  { id: 'lobby-zero', app: 'play', auth: 'signed', run: (page, h) => openPlay(page, h, { token: 'zero', hype: 'zero' }) },
  { id: 'lobby-ranks', app: 'play', auth: 'signed', run: (page, h) => openPlay(page, h, { hash: '#ranks', wait: 1500 }) },
  {
    // the Countries tab with a full board: 50 long-named players with flags, 50 countries with whale numbers
    id: 'lobby-ranks-countries',
    app: 'play',
    auth: 'signed',
    run: async (page, h) => {
      const codes = ['US', 'GB', 'TV', 'BR', 'JP', 'DE', 'CD', 'VC', 'GS', 'KR', 'ZA', 'IN', 'TR', 'AU', 'CA', 'FR', 'IT', 'ES', 'MX', 'AR'];
      const players = Array.from({ length: 50 }, (_, i) => ({ name: i % 2 ? LONG_M : LONG, score: 99_999 - i * 997, skin: i % 8, wallet: null, kills: 999 - i, at: 0, country: codes[i % codes.length] }));
      // one row per country (the server's board is keyed by code): the 20 above, then 30 more
      const board = [...codes, 'NL', 'SE', 'NO', 'PL', 'UA', 'GR', 'PT', 'IE', 'NZ', 'CH', 'AT', 'BE', 'DK', 'FI', 'CZ', 'HU', 'RO', 'CL', 'CO', 'PE', 'PH', 'ID', 'TH', 'VN', 'EG', 'NG', 'KE', 'MA', 'SA', 'AE'];
      const countries = Array.from({ length: 50 }, (_, i) => ({ country: board[i], mass: 99_999_999_999 - i * 1e9, games: 9_999_999 - i, paid: i % 3 ? 999_999_999_999_123_456 - i * 1e15 : 0 }));
      await page.route('**/api/leaderboard', (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ day: '2026-11-03', daily: players, allTime: players, countries: { daily: countries, allTime: countries } }) }),
      );
      await openPlay(page, h, { hash: '#ranks', wait: 1200 });
      await h.check('today-flags');
      // the third tab (today, all time, countries): by position, so every language runs it
      await page.getByRole('tab').nth(2).click();
      await settle(page, 1200);
    },
  },
  {
    id: 'lobby-profile',
    app: 'play',
    auth: 'signed',
    run: async (page, h) => {
      await openPlay(page, h, { hash: '#profile', wait: 1500 });
      await h.check('profile');
      await fillAll(page);
      await settle(page, 500);
    },
  },
  { id: 'lobby-docs', app: 'play', auth: 'signed', run: (page, h) => openPlay(page, h, { hash: '#docs', wait: 1500 }) },
  {
    id: 'lobby-picture',
    app: 'play',
    auth: 'signed',
    run: async (page, h) => {
      await openPlay(page, h, { hash: '#profile', wait: 1200 });
      const input = page.locator('input[type=file]').first();
      if (await input.count()) {
        await input.setInputFiles({ name: 'pic.png', mimeType: 'image/png', buffer: PNG_1200x800 });
        await settle(page, 1200);
      } else h.note('no picture input');
    },
  },
  ...['huge', 'max', 'zero', 'tiny'].map((b) => ({
    id: `wallet-sheet-${b}`,
    app: 'play',
    auth: 'signed',
    run: async (page, h) => {
      await openPlay(page, h, { token: b, hype: b === 'max' ? 'huge' : b === 'huge' ? 'huge' : b });
      await setUi(page, { modal: 'wallet' });
      await settle(page, 900);
    },
  })),
  {
    id: 'wallet-connect',
    app: 'play',
    auth: 'wallet',
    run: async (page, h) => {
      await openPlay(page, h, { signed: false });
      await setUi(page, { modal: 'wallet' });
      await settle(page, 900);
    },
  },
  { id: 'settings-sheet', app: 'play', auth: 'signed', run: async (page, h) => (await openPlay(page, h), await setUi(page, { modal: 'settings' }), await settle(page, 900)) },
  { id: 'howto-sheet', app: 'play', auth: 'signed', run: async (page, h) => (await openPlay(page, h), await setUi(page, { modal: 'howto' }), await settle(page, 900)) },
  { id: 'shop-sheet', app: 'play', auth: 'signed', run: async (page, h) => (await openPlay(page, h), await setUi(page, { modal: 'shop' }), await settle(page, 1200)) },
  { id: 'shop-sheet-guest', app: 'play', auth: 'guest', run: async (page, h) => (await openPlay(page, h, { signed: false }), await setUi(page, { modal: 'shop' }), await settle(page, 1200)) },
  {
    id: 'toasts',
    app: 'play',
    auth: 'signed',
    run: async (page, h) => {
      await openPlay(page, h);
      await page.evaluate((err) => {
        const now = Date.now();
        const kinds = ['info', 'success', 'error', 'warn', 'error', 'info'];
        window.__elymum.useUi.setState({
          toasts: kinds.map((kind, i) => ({ id: 9000 + i, kind, text: i === 2 ? err : i === 4 ? 'WWWWWWWWWWWWWWWW ate MMMMMMMMMMMMMMMM and took 999,999,999,999.12 tokens' : `Toast number ${i + 1}: something happened`, link: i === 1 ? { href: 'https://example.com/tx/0x' + 'ab'.repeat(32), label: 'View transaction' } : undefined, at: now })),
        });
      }, LONG_ERR);
      await settle(page, 700);
    },
  },
  // ── tickets ──
  {
    id: 'ticket',
    app: 'play',
    auth: 'signed',
    run: async (page, h) => {
      await openPlay(page, h);
      await pickTicket(page, 'arena:1');
      await h.check('picked');
      await page.locator('.kl-cta').first().click();
      await page.waitForSelector('.tf-sheet', { timeout: 8000 });
      await settle(page, 900);
      await h.check('sheet');
      await page.evaluate(() => (window.__elymumChain.fakeWallet.delayMs = 4000));
      await page.locator('.tf-sheet .tf-pay').first().click();
      await page.waitForTimeout(700);
      await h.check('signing');
      await page.evaluate(() => (window.__elymumChain.fakeWallet.delayMs = 300));
    },
    final: false,
  },
  {
    id: 'ticket-error',
    app: 'play',
    auth: 'signed',
    run: async (page, h) => {
      await openPlay(page, h, { token: 'tiny' });
      await pickTicket(page, 'arena:2');
      await h.check('poor');
      await openPlay(page, h, { token: 'huge' });
      await pickTicket(page, 'arena:2');
      await page.locator('.kl-cta').first().click();
      await page.waitForSelector('.tf-sheet', { timeout: 8000 });
      await page.evaluate(() => (window.__elymumChain.fakeWallet.failNext = 'ArenaFull'));
      await page.locator('.tf-sheet .tf-pay').first().click();
      await page.waitForSelector('.tf-error', { timeout: 8000 }).catch(() => h.note('no .tf-error'));
      await settle(page, 600);
    },
  },
  // ── custom rooms ──
  {
    id: 'room-card',
    app: 'play',
    auth: 'signed',
    run: async (page, h) => {
      await openPlay(page, h);
      await page.getByTestId('room-card').scrollIntoViewIfNeeded();
      // a long code typed into the join field
      const code = page.getByTestId('room-card').locator('input').first();
      if (await code.count()) await code.fill('ABCDEFGHJK');
      await settle(page, 500);
    },
    scroll: false,
  },
  {
    id: 'room-creator',
    fresh: true,
    app: 'play',
    auth: 'signed',
    run: async (page, h) => {
      await openPlay(page, h);
      await page.getByTestId('room-create').click();
      await page.waitForSelector('[data-testid="cr-setup"]');
      await page.locator('input[data-autofocus]').first().fill(LONG_ROOM); // the room name (any language)
      await settle(page, 700);
      await h.check('setup');
      await page.getByTestId('cr-continue').click();
      await page.waitForSelector('[data-testid="cr-payment"]');
      await settle(page, 800);
      await h.check('payment');
      await page.evaluate(() => (window.__elymumChain.fakeWallet.delayMs = 3000));
      await page.getByTestId('cr-pay').click();
      await page.waitForTimeout(600);
      await h.check('paying');
      await page.waitForSelector('[data-testid="cr-done"]', { timeout: 20000 });
      await settle(page, 900);
    },
  },
  {
    id: 'room-creator-guest',
    app: 'play',
    auth: 'guest',
    run: async (page, h) => {
      await openPlay(page, h, { signed: false });
      await page.getByTestId('room-create').click();
      await page.waitForSelector('[data-testid="cr-setup"]');
      await settle(page, 800);
    },
  },
  {
    id: 'room-in',
    fresh: true,
    app: 'play',
    auth: 'signed',
    run: async (page, h) => {
      await openPlay(page, h);
      await page.getByTestId('room-create').click();
      await page.waitForSelector('[data-testid="cr-setup"]');
      await page.locator('input[data-autofocus]').first().fill(LONG_ROOM); // the room name (any language)
      await page.getByTestId('cr-continue').click();
      await page.waitForSelector('[data-testid="cr-payment"]');
      await page.evaluate(() => (window.__elymumChain.fakeWallet.delayMs = 100));
      await page.getByTestId('cr-pay').click();
      await page.waitForSelector('[data-testid="cr-done"]', { timeout: 20000 });
      await page.getByTestId('cr-enter').click();
      await page.waitForFunction(() => window.__elymum.useUi.getState().screen === 'playing', null, { timeout: 15000 });
      await settle(page, 2000);
      await page.waitForFunction(() => !document.querySelector('.gm-intro__card'), null, { timeout: 12000 }).catch(() => {});
      await settle(page, 300);
    },
  },
  // ── in game ──
  { id: 'hud-practice', app: 'play', auth: 'signed', run: async (page, h) => (await openPlay(page, h), await playPractice(page), await hudExtras(page)) },
  { id: 'hud-guest', app: 'play', auth: 'guest', run: async (page, h) => (await openPlay(page, h, { signed: false }), await playPractice(page)) },
  {
    id: 'hud-arena',
    app: 'play',
    auth: 'signed',
    run: async (page, h) => {
      await openPlay(page, h, { token: 'huge' });
      await pickTicket(page, 'arena:1');
      await page.locator('.kl-cta').first().click();
      await page.waitForSelector('.tf-sheet', { timeout: 8000 });
      await page.evaluate(() => (window.__elymumChain.fakeWallet.delayMs = 50));
      await page.locator('.tf-sheet .tf-pay').first().click();
      await page.waitForFunction(() => window.__elymum.useUi.getState().screen === 'playing', null, { timeout: 20000 });
      await settle(page, 2000);
      await hudExtras(page);
    },
  },
  {
    id: 'hud-boosts',
    app: 'play',
    auth: 'signed',
    run: async (page, h) => {
      await openPlay(page, h, { token: 'huge' });
      await pickTicket(page, 'arena:1');
      await page.locator('.kl-cta').first().click();
      await page.waitForSelector('.tf-sheet', { timeout: 8000 });
      await page.evaluate(() => (window.__elymumChain.fakeWallet.delayMs = 50));
      await page.locator('.tf-sheet .tf-pay').first().click();
      await page.waitForFunction(() => window.__elymum.useUi.getState().screen === 'playing', null, { timeout: 40000 });
      await settle(page, 1500);
      await hudExtras(page);
      // every power-up owned, the arena allowance shown: the bar at its largest
      await page.evaluate(() => {
        const s = window.__elymum.useUi.getState();
        window.__elymum.useUi.setState({ boosts: { ...(s.boosts ?? {}), usable: true, signedIn: true, disabled: [], cooldownMs: { magnet: 0, shock: 0, speed: 0 }, charges: { magnet: 3, shock: 3, speed: 3 }, arena: { left: 3, max: 3 } } });
      });
      await settle(page, 600);
    },
  },
  {
    id: 'standings-sheet',
    app: 'play',
    auth: 'signed',
    run: async (page, h) => {
      await openPlay(page, h);
      await playPractice(page);
      await setUi(page, { modal: 'standings' });
      await page.waitForTimeout(1500);
      await page.waitForSelector('[data-testid="standings-row"]', { timeout: 8000 }).catch(() => h.note('no standings rows'));
      await settle(page, 600);
    },
  },
  {
    id: 'death',
    app: 'play',
    auth: 'signed',
    run: async (page, h) => {
      await openPlay(page, h);
      await playPractice(page);
      await feed(page, { t: 'death', stats: DEATH_STATS, killer: LONG, killerSkin: 2 });
      await settle(page, 1500);
    },
  },
  {
    id: 'round-over',
    app: 'play',
    auth: 'signed',
    run: async (page, h) => {
      await openPlay(page, h);
      await playPractice(page);
      await page.evaluate(([stats, standings]) => {
        const s = window.__elymum.useUi.getState();
        window.__elymum.useUi.setState({ room: { ...(s.room ?? {}), mode: 'arena' }, ticket: { entryFee: 999_999_999_999_000_000, arenaId: 1, session: '1' } });
        window.__elymum.engine.endGame('round', 12345, 999_999_999_999_123_456, { ...stats, payout: 999_999_999_999_123_456 }, standings);
      }, [DEATH_STATS, ROUND_STANDINGS]);
      await settle(page, 1500);
      await h.check('result');
      await page.evaluate(() =>
        window.__elymum.useUi.setState({ lastSettlement: { session: '1', arenaId: 1, txHash: '0xde7fa4e0' + '0'.repeat(56), payout: 999_999_999_999_123_456, fee: 49_999_999_999_956_172, net: 949_999_999_999_167_284, at: Date.now() } }),
      );
      await settle(page, 1200);
    },
  },
  {
    id: 'first-brief',
    app: 'play',
    auth: 'signed',
    brief: true,
    run: async (page, h) => {
      await openPlay(page, h);
      await page.evaluate(() => window.__elymum.engine.play('practice'));
      await page.waitForSelector('.g-brief__step', { timeout: 15000 });
      await settle(page, 900);
    },
  },
  {
    id: 'spectate',
    app: 'play',
    auth: 'signed',
    run: async (page, h) => {
      await openPlay(page, h);
      await playPractice(page);
      await feed(page, { t: 'death', stats: DEATH_STATS, killer: LONG, killerSkin: 2 });
      await settle(page, 800);
      const b = page.locator('.g-death button.g-link').first();
      if (await b.count()) {
        await b.click();
        await settle(page, 1500);
      } else h.note('no spectate button');
    },
  },
  { id: 'game-settings', app: 'play', auth: 'signed', run: async (page, h) => (await openPlay(page, h), await playPractice(page), await setUi(page, { modal: 'settings' }), await settle(page, 900)) },
  { id: 'game-shop', app: 'play', auth: 'signed', run: async (page, h) => (await openPlay(page, h), await playPractice(page), await setUi(page, { modal: 'shop' }), await settle(page, 1200)) },
  { id: 'game-closed', app: 'play', auth: 'signed', run: async (page, h) => (await openPlay(page, h), await setUi(page, { gameClosed: true }), await settle(page, 900)) },
  {
    id: 'lobby-held',
    app: 'play',
    auth: 'signed',
    run: async (page, h) => {
      await openPlay(page, h);
      await page.evaluate(() => window.__elymum.useUi.setState({ held: { arenaId: 1, opensAt: Date.now() + 3_600_000 } }));
      await settle(page, 900);
    },
  },
  {
    id: 'lobby-owed',
    app: 'play',
    auth: 'signed',
    run: async (page, h) => {
      await openPlay(page, h);
      await page.evaluate((addr) => {
        const w = window.__elymumChain.fakeWallet;
        w.sessions[1] = { arenaId: 1, player: addr, id: 1n, entryFee: 999_999_999n * 10n ** 18n, openedAt: Math.floor(Date.now() / 1000) - 600, feeBps: 500, finalized: true, owed: 999_999_999_999_123_456n * 10n ** 6n };
        window.__elymumChain.refresh();
      }, AUDIT_ADDRESS);
      await settle(page, 1500);
    },
  },

  // ── admin ──
  ...['', '#setup', '#mint', '#game', '#community', '#community/tasks', '#community/collabs', '#safety', '#settings'].map((hash) => ({
    id: `admin-${hash.replace('#', '').replace('/', '-') || 'network'}`,
    app: 'admin',
    auth: 'signed',
    run: async (page) => {
      await page.goto(`${BASE}/admin${hash}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      await settle(page, 2000);
    },
  })),
];

/** Fills every visible, editable text field with a long value that fits its kind. */
async function fillAll(page) {
  const fields = page.locator('input:visible, textarea:visible');
  const n = await fields.count();
  for (let i = 0; i < n; i++) {
    const f = fields.nth(i);
    const info = await f
      .evaluate((el) => ({ type: el.type, ro: el.readOnly || el.disabled || el.tabIndex === -1, mode: el.inputMode, ph: el.placeholder || '', max: el.maxLength, tag: el.tagName }))
      .catch(() => null);
    if (!info || info.ro || !['text', 'url', 'search', 'email', 'textarea', 'number', 'tel'].includes(info.tag === 'TEXTAREA' ? 'textarea' : info.type)) continue;
    let v = 'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW';
    if (info.mode === 'numeric' || info.type === 'number') v = '999999999999';
    else if (/https?:/.test(info.ph)) v = 'https://x.com/WWWWWWWWWWWWWWW/status/18446744073709551615123';
    else if (/0x/.test(info.ph)) v = '0x5d5c99EdF529335160FF180fA141Dd4967fc00D2';
    else if (info.tag === 'TEXTAREA') v = `${'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW '.repeat(6)}`;
    if (info.max > 0) v = v.slice(0, info.max);
    await f.fill(v, { timeout: 3000 }).catch(() => {});
  }
}

async function pickTicket(page, key) {
  const r = page.locator(`[role="radio"][data-kb-value="${key}"]`).first();
  await r.scrollIntoViewIfNeeded().catch(() => {});
  await r.click();
  await page.waitForTimeout(300);
}

/** HUD extras: chat lines, kill feed, a coin rain banner, power-up chips. */
async function hudExtras(page) {
  await page.waitForFunction(() => !document.querySelector('.gm-intro__card'), null, { timeout: 12000 }).catch(() => {});
  for (let i = 0; i < 4; i++) await feed(page, { t: 'kf', killer: LONG, killerSkin: 1, victim: LONG_M, victimSkin: 2, cause: 'eat', killerIsBot: i % 2 === 0 });
  for (let i = 0; i < 3; i++) await feed(page, { t: 'chat', pid: 7, from: LONG, skin: 3, text: 'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW' });
  await feed(page, { t: 'event', kind: 'coinrain', state: 'start', ms: 60_000 });
  await feed(page, { t: 'powerup', type: 1, ms: 30_000 });
  await feed(page, { t: 'powerup', type: 2, ms: 30_000 });
  await settle(page, 900);
}

// a 1200x800 PNG for the picture picker (solid teal), built without dependencies
const PNG_1200x800 = (() => {
  const w = 1200;
  const h = 800;
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set([30 + (x % 200), 140, 160], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const crcT = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b) => {
    let c = 0xffffffff;
    for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
})();

/** Admin API (the audit wallet is an admin): room limits up, and every custom room closed (room scenes open some). */
let adminToken = null;
async function adminApi(path, method = 'GET', body) {
  const res = await fetch(`${BASE}/api/admin/${path}`, { method, headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json', 'x-forwarded-for': '10.255.0.1' }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({}));
}
async function closeRooms(keep = 0) {
  if (!adminToken) return;
  const r = await adminApi('custom-rooms');
  // other workers may be inside a room right now: close only when the slots run low
  if ((r.rooms ?? []).length <= keep) return;
  for (const room of r.rooms ?? []) await adminApi(`custom-rooms/${room.code}`, 'DELETE');
}

// ───────────────────────────── running a scene ─────────────────────────────
const findings = [];
const seenKeys = new Map(); // finding key → shot file
let shotCount = 0;
const sceneRuns = [];

async function auditState(page, ctxInfo, sceneId, state, dedupe) {
  const { vp, theme } = ctxInfo;
  const one = async (where) => {
    // the DOM pass first; a screenshot only when some text sits on art the DOM cannot read (gradients, canvas)
    const run = (b64) =>
      page.evaluate(
        async ([src, b64, touch]) => {
          if (!window.__uiAudit?.detect) (0, eval)(src);
          let px = null;
          if (b64) {
            const blob = await fetch(`data:image/png;base64,${b64}`).then((r) => r.blob());
            const bmp = await createImageBitmap(blob);
            const c = new OffscreenCanvas(bmp.width, bmp.height);
            const g = c.getContext('2d');
            g.drawImage(bmp, 0, 0);
            px = { w: bmp.width, h: bmp.height, data: g.getImageData(0, 0, bmp.width, bmp.height).data };
          }
          return window.__uiAudit.detect({ touch, pixels: px });
        },
        [DETECT_SRC, b64, vp.touch],
      );
    let out = await run(null);
    if (out.needPixels) {
      const png = await page.screenshot({ scale: 'css', type: 'png', animations: 'disabled', caret: 'hide' }).catch(() => null);
      if (png) out = await run(png.toString('base64'));
    }
    const res = out.findings;
    for (const f of res) {
      // one key per element and problem, whatever the scene (the lobby's cards show under every sheet)
      const key = `${f.detector}|${f.kind ?? ''}|${f.selector}|${f.detector === 'contrast' || f.detector === 'text' || f.detector === 'overlap' ? f.text : ''}`;
      if (dedupe.has(key)) continue;
      dedupe.add(key);
      const rec = { ...f, key, scene: sceneId, state, where, viewport: vp.name, theme };
      if (SHOTS && f.severity === 'issue' && !seenKeys.has(key) && shotCount < MAX_SHOTS) {
        seenKeys.set(key, null);
        shotCount++;
        const file = `shots/${String(shotCount).padStart(4, '0')}-${f.detector}-${sceneId}-${vp.name}-${theme}.png`;
        try {
          const rects = [f.rect, f.rect2].filter(Boolean);
          await page.evaluate((r) => window.__uiAudit.highlight(r), rects);
          const x0 = Math.max(0, Math.min(...rects.map((r) => r.x)) - 60);
          const y0 = Math.max(0, Math.min(...rects.map((r) => r.y)) - 60);
          const x1 = Math.min(vp.w, Math.max(...rects.map((r) => r.x + r.w)) + 60);
          const y1 = Math.min(vp.h, Math.max(...rects.map((r) => r.y + r.h)) + 60);
          if (x1 - x0 > 8 && y1 - y0 > 8) await page.screenshot({ path: join(OUT, file), clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, animations: 'disabled' });
          else await page.screenshot({ path: join(OUT, file), animations: 'disabled' });
          await page.evaluate(() => window.__uiAudit.unhighlight());
          seenKeys.set(key, file);
          rec.shot = file;
        } catch {}
      } else if (seenKeys.get(key)) rec.shot = seenKeys.get(key);
      findings.push(rec);
    }
  };
  if (flag('--full-shots')) {
    mkdirSync(join(OUT, 'states'), { recursive: true });
    await page.screenshot({ path: join(OUT, 'states', `${sceneId}-${state}-${vp.name}-${theme}.png`) }).catch(() => {});
  }
  await one('top');
  if (ctxInfo.scroll === false) return;
  // the page, step by step
  const pageH = await page.evaluate(() => document.scrollingElement.scrollHeight - innerHeight);
  if (pageH > 20) {
    const step = Math.round(vp.h * 0.95);
    for (let y = step, n = 0; y < pageH + step && n < 10; y += step, n++) {
      await page.evaluate((y) => window.scrollTo(0, y), Math.min(y, pageH));
      await settle(page, 120);
      await one(`scroll ${Math.min(y, pageH)}`);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  // inner scrollers (sheets, panels)
  const ns = await page.evaluate(() => window.__uiAudit.scrollers());
  for (let i = 0; i < ns; i++) {
    for (let n = 0; n < 8; n++) {
      const moved = await page.evaluate((i) => window.__uiAudit.scrollStep(i, true), i);
      if (!moved) break;
      await settle(page, 100);
      await one(`scroller ${i} step ${n + 1}`);
    }
  }
}

let ipSeq = 0;
async function newContext(browser, vp, theme, auth, app, brief = false, key = AUDIT_KEY) {
  ipSeq++;
  const ctx = await browser.newContext({
    // one client address per context (the stack runs with TRUST_PROXY=1): the server's per-IP limits never trip
    extraHTTPHeaders: { 'x-forwarded-for': `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}` },
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: vp.dpr,
    isMobile: vp.touch,
    hasTouch: vp.touch,
    locale: LOCALE_TAG,
    colorScheme: theme === 'night' ? 'dark' : 'light',
    reducedMotion: 'reduce',
  });
  await ctx.addInitScript(
    ([theme, brief, name, locale]) => {
      try {
        localStorage.setItem('elymum.locale.v1', locale);
        localStorage.setItem('elymum.settings.v1', JSON.stringify({ name, skin: 4, theme: theme === 'night' ? 'dark' : 'light', quality: 'low', sound: false, showMinimap: true, showChat: true, showNames: true, showMass: true, showFps: true }));
        if (!brief) localStorage.setItem('elymum.brief', '1');
        else localStorage.removeItem('elymum.brief');
        localStorage.setItem('elymum.autoQuality', 'off');
      } catch {}
    },
    [theme, brief, LONG, LOCALE],
  );
  if (auth !== 'guest') await installEvmWallet(ctx, { privateKey: key, autoConnect: true, allowTransactions: false });
  return ctx;
}

async function runScene(browser, vp, theme, scene, sessionCtxCache) {
  const t0 = Date.now();
  const ctxInfo = { vp, theme, scroll: scene.scroll };
  // `fresh`: a wallet of its own (the server rate-limits room creation per wallet)
  const ctx = await newContext(browser, vp, theme, scene.auth, scene.app, scene.brief, scene.fresh ? newDevKey() : AUDIT_KEY);
  const page = await ctx.newPage();
  const consoleErrs = [];
  page.on('pageerror', (e) => consoleErrs.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (CONSOLE_IGNORE.some((re) => re.test(t))) return;
    consoleErrs.push(t);
  });
  const notes = [];
  const dedupe = new Set();
  let ok = true;
  try {
    if (scene.auth === 'signed') {
      // the site session (SIWE), shared by the site pages, /play and /admin
      if (sessionCtxCache.token && !scene.fresh) {
        await ctx.addInitScript((s) => {
          localStorage.setItem('elymum.auth.v1', s.auth);
          if (s.admin) localStorage.setItem('elymum.site.admin.v1', s.admin);
        }, sessionCtxCache.token);
      } else {
        await page.goto(`${BASE}/no-such-page-audit`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.__elymumDevWallet, null, { timeout: 10000 });
        await ensureSession(page);
        if (!scene.fresh) sessionCtxCache.token = await page.evaluate(() => ({ auth: localStorage.getItem('elymum.auth.v1'), admin: localStorage.getItem('elymum.site.admin.v1') }));
      }
    }
    const h = {
      check: (label) => auditState(page, ctxInfo, scene.id, label, dedupe),
      note: (n) => notes.push(n),
    };
    await scene.run(page, h);
    if (scene.final !== false) await auditState(page, ctxInfo, scene.id, 'final', dedupe);
  } catch (e) {
    ok = false;
    notes.push(`scene failed: ${e.message.split('\n')[0]}`);
    try {
      mkdirSync(join(OUT, 'fail'), { recursive: true });
      await page.screenshot({ path: join(OUT, 'fail', `${scene.id}-${vp.name}-${theme}.png`) });
    } catch {}
  }
  if (scene.id.startsWith('room-')) await closeRooms(5).catch(() => {});
  for (const c of [...new Set(consoleErrs)]) findings.push({ detector: 'console', severity: 'issue', key: `console|${scene.id}|${c.slice(0, 120)}`, scene: scene.id, state: 'any', viewport: vp.name, theme, selector: '', text: c.slice(0, 300), detail: c.slice(0, 600) });
  await ctx.close().catch(() => {});
  sceneRuns.push({ scene: scene.id, viewport: vp.name, theme, ok, ms: Date.now() - t0, notes });
  if (!ok || notes.length) log(`${scene.id} ${vp.name} ${theme}: ${notes.join('; ')}`);
}

// ───────────────────────────── report ─────────────────────────────
const DETECTORS = ['overflow', 'text', 'overlap', 'offscreen', 'contrast', 'touch', 'console'];
function writeReport(meta) {
  const issues = findings.filter((f) => f.severity === 'issue');
  const infos = findings.filter((f) => f.severity === 'info');
  const counts = Object.fromEntries(DETECTORS.map((d) => [d, { issue: issues.filter((f) => f.detector === d).length, info: infos.filter((f) => f.detector === d).length, unique: new Set(issues.filter((f) => f.detector === d).map((f) => f.key)).size }]));
  // group issues by key
  const groups = new Map();
  for (const f of issues) {
    const g = groups.get(f.key) ?? { ...f, where: [], scenes: new Set(), n: 0 };
    g.n++;
    g.where.push(`${f.viewport}/${f.theme}`);
    g.scenes.add(f.scene);
    if (!g.shot && f.shot) g.shot = f.shot;
    groups.set(f.key, g);
  }
  const rows = [...groups.values()].sort((a, b) => DETECTORS.indexOf(a.detector) - DETECTORS.indexOf(b.detector) || a.scene.localeCompare(b.scene));
  const failed = sceneRuns.filter((r) => !r.ok);
  writeFileSync(join(OUT, 'findings.json'), JSON.stringify({ meta, counts, scenes: sceneRuns, findings }, null, 1));
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const md = [
    `# UI audit: ${LABEL}`,
    '',
    `${meta.started} · ${meta.runs} scene runs (${meta.scenes} scenes × ${meta.viewports.length} viewports × ${meta.themes.length} themes) · ${failed.length} failed runs`,
    '',
    '| detector | issues | unique issues | info |',
    '|---|---:|---:|---:|',
    ...DETECTORS.map((d) => `| ${d} | ${counts[d].issue} | ${counts[d].unique} | ${counts[d].info} |`),
    '',
    '## Issues (grouped)',
    '',
    '| detector | scene | where | element | text | detail | shot |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((g) => `| ${g.detector}${g.kind ? `/${g.kind}` : ''} | ${[...g.scenes].slice(0, 4).join(', ')}${g.scenes.size > 4 ? ` +${g.scenes.size - 4}` : ''} (${g.state}) | ${[...new Set(g.where)].slice(0, 6).join(', ')}${new Set(g.where).size > 6 ? ` +${new Set(g.where).size - 6}` : ''} | \`${g.selector}\` | ${String(g.text).replace(/\|/g, '/')} | ${String(g.detail).replace(/\|/g, '/')} | ${g.shot ? `[png](${g.shot})` : ''} |`),
    '',
    failed.length ? `## Failed runs\n\n${failed.map((r) => `- ${r.scene} ${r.viewport} ${r.theme}: ${r.notes.join('; ')}`).join('\n')}` : '',
  ].join('\n');
  writeFileSync(join(OUT, 'report.md'), md);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>UI audit ${esc(LABEL)}</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:16px;background:#fbf7ef;color:#222}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}th{background:#efe7d6}code{font-size:12px;word-break:break-all}img{max-width:420px;max-height:260px;border:1px solid #ccc}.k{font-weight:700}</style></head><body>
<h1>UI audit: ${esc(LABEL)}</h1><p>${esc(meta.started)} · ${meta.runs} scene runs · ${failed.length} failed</p>
<table><tr><th>detector</th><th>issues</th><th>unique</th><th>info</th></tr>${DETECTORS.map((d) => `<tr><td>${d}</td><td>${counts[d].issue}</td><td>${counts[d].unique}</td><td>${counts[d].info}</td></tr>`).join('')}</table>
<h2>Issues</h2><table><tr><th>detector</th><th>scene</th><th>where</th><th>element / detail</th><th>shot</th></tr>
${rows.map((g) => `<tr><td class="k">${esc(g.detector)}${g.kind ? `/${esc(g.kind)}` : ''}</td><td>${esc([...g.scenes].join(', '))}<br><small>${esc(g.state)} · ${esc(g.where[0])}</small></td><td><small>${esc([...new Set(g.where)].join(', '))}</small></td><td><code>${esc(g.selector)}</code><br>${esc(g.text)}<br><small>${esc(g.detail)}</small></td><td>${g.shot ? `<a href="${esc(g.shot)}"><img loading="lazy" src="${esc(g.shot)}"></a>` : ''}</td></tr>`).join('\n')}
</table>${failed.length ? `<h2>Failed runs</h2><ul>${failed.map((r) => `<li>${esc(r.scene)} ${esc(r.viewport)} ${esc(r.theme)}: ${esc(r.notes.join('; '))}</li>`).join('')}</ul>` : ''}</body></html>`;
  writeFileSync(join(OUT, 'report.html'), html);
  return { counts, unique: rows.length, failed: failed.length };
}

// ───────────────────────────── self test ─────────────────────────────
// A fixture page with one known bug per detector (and look-alikes that are fine): `--selftest`
// checks the detectors still see them, so tuning them never makes the audit blind.
const FIXTURE = `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>
body{margin:0;font:16px/1.4 sans-serif;background:#fff;color:#111}
.row{display:flex;gap:8px;width:300px}
.bal{white-space:nowrap;width:120px}
.fixed-h{height:20px;overflow:hidden;width:200px}
.dark{background:#1b1b22;padding:8px}
.dark input{background:#20202a;color:#33333d;border:0;padding:6px}
.tiny{width:20px;height:20px;padding:0}
.wide{width:1200px;height:10px;background:#eee}
.ell{width:80px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dock{position:fixed;left:0;right:0;bottom:0;height:60px;background:#eee}
.pad{height:120px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
</style></head><body>
<div class="row" id="t-overlap"><span class="bal">1,109,986.25799155 ELY</span><span>HYPE · network fees</span></div>
<div class="fixed-h" id="t-clip">a long line of text that wraps to a second and a third line here</div>
<div class="dark" id="t-contrast"><input value="ABCDEF" aria-label="code"></div>
<button class="tiny" id="t-touch">x</button>
<div class="ell" id="t-ell">truncated by design with an ellipsis</div>
<span class="sr">screen reader only text that is long</span>
<div class="wide" id="t-wide"></div>
<div class="pad"></div>
<div class="dock"><button style="margin:10px;height:40px;width:120px">Dock</button></div>
</body></html>`;

async function selfTest() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 600 }, hasTouch: true, isMobile: true });
  await page.setContent(FIXTURE);
  const png = (await page.screenshot({ scale: 'css' })).toString('base64');
  const res = await page.evaluate(
    async ([src, b64]) => {
      (0, eval)(src);
      const blob = await fetch(`data:image/png;base64,${b64}`).then((r) => r.blob());
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d');
      g.drawImage(bmp, 0, 0);
      return window.__uiAudit.detect({ touch: true, pixels: { w: bmp.width, h: bmp.height, data: g.getImageData(0, 0, bmp.width, bmp.height).data } }).findings;
    },
    [DETECT_SRC, png],
  );
  await browser.close();
  const has = (pred) => res.some(pred);
  const checks = [
    ['overflow: the 1200px strip', has((f) => f.detector === 'overflow')],
    ['overlap: balance over the next column', has((f) => f.detector === 'overlap' && /1,109,986/.test(f.text))],
    ['text: clipped by a fixed-height box', has((f) => f.detector === 'text' && f.kind === 'clipped' && /a long line/.test(f.text))],
    ['text: ellipsis is info', has((f) => f.detector === 'text' && f.kind === 'truncated' && f.severity === 'info')],
    ['contrast: dark input text on a dark field', has((f) => f.detector === 'contrast' && f.kind === 'input' && f.severity === 'issue')],
    ['touch: 20x20 button', has((f) => f.detector === 'touch' && /20x20/.test(f.detail))],
    ['no finding for sr-only text', !has((f) => /screen reader only/.test(f.text))],
    ['no finding for the 120x40 dock button', !has((f) => f.detector === 'touch' && /Dock/.test(f.text))],
  ];
  for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (checks.some(([, ok]) => !ok)) {
    console.log(JSON.stringify(res, null, 1));
    process.exit(1);
  }
  process.exit(0);
}

// ───────────────────────────── main ─────────────────────────────
if (flag('--selftest')) await selfTest();
if (flag('--serve')) {
  // just the stack, for runs against --base while fixing (Ctrl+C stops it)
  await startStack();
  log(`stack up: ${BASE} (server :${SERVER_PORT}); admin wallet ${AUDIT_ADDRESS}`);
  await new Promise(() => {});
}
if (flag('--list')) {
  console.log(SCENES.map((s) => `${s.id} (${s.app}, ${s.auth})`).join('\n'));
  process.exit(0);
}
const wantVp = list('--viewports', '');
const wantTh = list('--themes', THEMES.join(','));
const wantSc = list('--scenes', '');
const vps = VIEWPORTS.filter((v) => !wantVp.length || wantVp.includes(v.name));
const scenes = SCENES.filter((s) => !wantSc.length || wantSc.some((w) => s.id === w || s.id.startsWith(`${w}-`) || (w.endsWith('*') && s.id.startsWith(w.slice(0, -1)))));
const themes = THEMES.filter((t) => wantTh.includes(t));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'shots'), { recursive: true });
let cleanup = null;
if (flag('--start')) cleanup = await startStack();
const started = new Date().toISOString();
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const jobs = [];
// site and admin pages are day pages by design (they pin the light theme): their night pass (the OS dark
// scheme) runs at three sizes only, unless --full-night
const NIGHT_SPOT = new Set(['390x844', '768x1024', '1440x900']);
for (const vp of vps)
  for (const theme of themes)
    for (const scene of scenes) {
      if (theme === 'night' && scene.app !== 'play' && !flag('--full-night') && !NIGHT_SPOT.has(vp.name) && vps.length > 3) continue;
      jobs.push({ vp, theme, scene });
    }
log(`${jobs.length} scene runs (${scenes.length} scenes × ${vps.length} viewports × ${themes.length} themes), ${WORKERS} workers → ${OUT}`);
const sessionCache = { token: null };
let done = 0;
// the first signed job makes the session; the others reuse it
const firstSigned = jobs.find((j) => j.scene.auth === 'signed');
if (firstSigned) {
  const ctx = await newContext(browser, firstSigned.vp, 'day', 'signed', 'site');
  const page = await ctx.newPage();
  await page.goto(`${BASE}/no-such-page-audit`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__elymumDevWallet, null, { timeout: 15000 });
  await ensureSession(page);
  sessionCache.token = await page.evaluate(() => ({ auth: localStorage.getItem('elymum.auth.v1'), admin: localStorage.getItem('elymum.site.admin.v1') }));
  await ctx.close();
  adminToken = JSON.parse(sessionCache.token.auth).token;
  await adminApi('custom-rooms', 'PUT', { maxLive: 24, maxPerWallet: 10 });
  await closeRooms();
}
await Promise.all(
  Array.from({ length: Math.max(1, WORKERS) }, async () => {
    while (jobs.length) {
      const j = jobs.shift();
      await runScene(browser, j.vp, j.theme, j.scene, sessionCache);
      done++;
      if (done % 10 === 0) log(`${done} runs, ${findings.filter((f) => f.severity === 'issue').length} issues so far`);
    }
  }),
);
await browser.close();
const summary = writeReport({ label: LABEL, started, runs: sceneRuns.length, scenes: scenes.length, viewports: vps.map((v) => v.name), themes });
stopStack();
cleanup?.();
console.log(JSON.stringify({ out: OUT, ...summary }, null, 1));
