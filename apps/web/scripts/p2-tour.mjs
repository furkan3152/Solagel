// Testnet-launch tour: /faucet, the mint's emblem perks, the lobby (holders-only laurel, holder
// fee), BOT tags in a room, the admin groups (Network, Setup, Mint, Game), at 1440 and 390, and a
// phone navigation clip (home → mint → faucet → WL → play).
// Needs the game server on DEV_FAKE_CHAIN=1 DEV_FAKE_TOKEN=1 GAME_ACCESS=public with the dev
// wallet below in ADMIN_WALLETS, and the web dev server proxying to it.
// Usage: node scripts/p2-tour.mjs <baseUrl> <outDir> [step ...]
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { privateKeyToAccount } from 'viem/accounts';
import { installEvmWallet, signInGame } from './evm-wallet.mjs';

const [base, out, ...which] = process.argv.slice(2);
const want = (k) => which.length === 0 || which.includes(k);
// hardhat account #1 (a public test key): the admin of the dev server
const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const account = privateKeyToAccount(KEY);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const logs = [];
const D = { width: 1440, height: 900 };
const P = { width: 390, height: 844 };

async function siteSession() {
  const n = await (await fetch(`${base}/api/auth/nonce?address=${account.address}`)).json();
  const signature = await account.signMessage({ message: n.message });
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: account.address, message: n.message, signature }) });
  return r.json();
}

async function open(path, { viewport = D, mobile = false, wallet = true, admin = false, frames = null } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, locale: 'en-US' });
  if (admin) {
    const s = await siteSession();
    await ctx.addInitScript(
      ([a, t]) => {
        localStorage.setItem('elymum.auth.v1', JSON.stringify({ address: a, token: t, exp: Date.now() + 3600_000 }));
        localStorage.setItem('elymum.site.admin.v1', a);
      },
      [s.address, s.token],
    );
  }
  if (wallet) await installEvmWallet(ctx, { privateKey: KEY, autoConnect: true, allowTransactions: false });
  const page = await ctx.newPage();
  if (frames) {
    // CDP screencast frames → ffmpeg (Playwright's own video recorder is unavailable here)
    const cdp = await ctx.newCDPSession(page);
    cdp.on('Page.screencastFrame', async (f) => {
      frames.push({ t: f.metadata.timestamp, data: f.data });
      await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 });
  }
  page.on('pageerror', (e) => logs.push(`[pageerror ${path}] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && logs.push(`[console.error ${path}] ${m.text()}`));
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  return { ctx, page };
}
const shot = (page, name, full = false) => page.screenshot({ path: `${out}/p2-${name}.png`, fullPage: full });

for (const [tag, viewport, mobile] of [
  ['1440', D, false],
  ['390', P, true],
]) {
  if (want('faucet')) {
    const { ctx, page } = await open('/faucet', { viewport, mobile });
    await shot(page, `faucet-${tag}`);
    await page.getByTestId('fc-claim').click();
    await page.waitForTimeout(1300);
    await shot(page, `faucet-pouring-${tag}`);
    await page.waitForSelector('[data-testid="fc-wait"]', { timeout: 8000 });
    await page.waitForTimeout(400);
    await shot(page, `faucet-claimed-${tag}`);
    await ctx.close();
    const off = await open('/faucet', { viewport, mobile, wallet: false });
    await off.page.route('**/api/config', (r) => r.fulfill({ json: { chain: { enabled: true, chainId: 4242, chainName: 'Elysium', rpcUrl: null, explorerUrl: null, arenaAddress: null, nftAddress: null, arenasEnabled: false, tokenReady: false, token: null, feeBps: 500, serverKey: null } } }));
    await off.page.reload({ waitUntil: 'networkidle' });
    await off.page.waitForTimeout(900);
    await shot(off.page, `faucet-mainnet-${tag}`);
    await off.ctx.close();
  }
  if (want('mint')) {
    const { ctx, page } = await open('/mint', { viewport, mobile });
    await page.locator('[data-testid="mt-perks"]').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -120));
    await page.waitForTimeout(500);
    await shot(page, `mint-perks-${tag}`);
    await ctx.close();
  }
  if (want('lobby')) {
    const { ctx, page } = await open('/play', { viewport, mobile });
    await page.waitForFunction(() => !!window.__elymum && window.__elymum.useUi.getState().connected, null, { timeout: 15000 });
    await signInGame(page, base, account);
    await page.waitForFunction(() => !!window.__elymumChain?.fakeWallet, null, { timeout: 10000 });
    await page.evaluate(() => window.__elymumChain.refresh());
    await page.waitForTimeout(1500);
    await page.locator('[data-testid="holders-only"]').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await shot(page, `lobby-holders-${tag}`);
    // as a holder: the laurel turns sun and the fee line shows the holder rate
    await page.evaluate(async () => {
      const dev = await import('/src/wallet/devFake.ts');
      dev.fakeFaucet.holder = true;
      window.__elymumChain.refresh();
    });
    await page.waitForTimeout(1500);
    await page.locator('[data-testid="holders-only"]').first().scrollIntoViewIfNeeded();
    await shot(page, `lobby-holder-fee-${tag}`);
    // into a practice room: BOT chips in the standings, the feed and the name tags
    await page.evaluate(() => window.__elymum.engine.play('practice'));
    await page.waitForTimeout(6000);
    await shot(page, `room-bots-${tag}`);
    await ctx.close();
  }
  if (want('admin')) {
    for (const g of ['network', 'setup', 'mint', 'game']) {
      const { ctx, page } = await open(`/admin${g === 'network' ? '' : `#${g}`}`, { viewport, mobile, admin: true });
      await page.waitForTimeout(1500);
      await shot(page, `admin-${g}-${tag}`);
      if (g === 'game') {
        await page.locator('[data-card="bots"]').scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await shot(page, `admin-game-bots-${tag}`);
      }
      await ctx.close();
    }
  }
}

if (want('nav')) {
  // phone: home → mint → faucet → WL → play, tapping the menu each time (hover/touch warms the next page)
  const dir = '/tmp/p2-nav-frames';
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const frames = [];
  const { ctx, page } = await open('/', { viewport: P, mobile: true, frames });
  const times = [];
  for (const [label, path] of [
    ['Mint', '/mint'],
    ['Faucet', '/faucet'],
    ['WL', '/wl'],
  ]) {
    await page.locator('.st-menu-btn').tap();
    await page.waitForTimeout(250);
    const link = page.locator('#st-menu').getByRole('link', { name: label, exact: true });
    const t0 = Date.now();
    await link.tap();
    await page.waitForURL(`**${path}`);
    await page.waitForFunction(() => !document.querySelector('.st-loadpage'));
    times.push(`${label}: ${Date.now() - t0} ms`);
    await page.waitForTimeout(900);
  }
  await page.locator('.st-menu-btn').tap();
  await page.waitForTimeout(250);
  const t0 = Date.now();
  await page.locator('.st-menu__play').tap();
  await page.waitForURL('**/play');
  await page.waitForLoadState('networkidle');
  times.push(`Play (full load): ${Date.now() - t0} ms`);
  await page.waitForTimeout(1200);
  await ctx.close();
  let list = '';
  frames.forEach((f, i) => {
    const name = `${dir}/f${String(i).padStart(5, '0')}.jpg`;
    writeFileSync(name, Buffer.from(f.data, 'base64'));
    const d = i + 1 < frames.length ? frames[i + 1].t - f.t : 0.1;
    list += `file '${name}'\nduration ${Math.max(0.01, d).toFixed(3)}\n`;
  });
  writeFileSync(`${dir}/list.txt`, list);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${dir}/list.txt`, '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libvpx-vp9', '-b:v', '1.2M', '-deadline', 'realtime', '-cpu-used', '8', `${out}/p2-nav-390.webm`]);
  console.log(times.join('\n'));
}

if (logs.length) console.log(logs.slice(-40).join('\n'));
await browser.close();
