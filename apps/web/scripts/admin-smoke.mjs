/** Production browser -> signed admin API -> durable settings -> live lobby smoke test.
 * Uses an unfunded, ephemeral wallet. No blockchain transaction is submitted.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(dir, '../../..');
const requireServer = createRequire(resolve(root, 'apps/server/package.json'));
const { Keypair } = requireServer('@solana/web3.js');
const nacl = requireServer('tweetnacl');
const key = Keypair.generate();
const dataDir = await mkdtemp(resolve(tmpdir(), 'solagel-admin-smoke-'));
const port = Number(process.env.ADMIN_SMOKE_PORT ?? 8791);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['dist/index.js'], {
  cwd: resolve(root, 'apps/server'),
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, WEB_DIST: resolve(root, 'apps/web/dist'),
    ADMIN_WALLETS: key.publicKey.toBase58(), AUTH_SECRET: 'ephemeral-smoke-only-secret', CORS_ORIGIN: base,
    SOLANA_CLUSTER: 'devnet', PROGRAM_ID: '', SERVER_KEYPAIR: '', SOLANA_RPC_URL: '', PUBLIC_RPC_URL: '', STAKE_ENABLED: 'false' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', value => { serverLog += value; });
server.stderr.on('data', value => { serverLog += value; });
let browser;
try {
  let ready = false;
  for (let n = 0; n < 100; n++) {
    try { if ((await fetch(`${base}/api/config`)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready, `Smoke server did not start: ${serverLog}`);
  assert.equal((await fetch(`${base}/api/admin/status`)).status, 401);
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.exposeBinding('smokeSignMessage', (_, bytes) => Array.from(nacl.sign.detached(Uint8Array.from(bytes), key.secretKey)));
  await context.addInitScript(({ address, publicKey }) => {
    const account = { address, publicKey: Uint8Array.from(publicKey), chains: ['solana:devnet'], features: ['solana:signMessage', 'solana:signTransaction'] };
    let connected = false;
    const listeners = new Set();
    const wallet = {
      version: '1.0.0', name: 'Smoke Admin', icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',
      chains: ['solana:devnet'], get accounts() { return connected ? [account] : []; },
      features: {
        'standard:connect': { version: '1.0.0', connect: async () => { connected = true; listeners.forEach(fn => fn({ accounts: [account] })); return { accounts: [account] }; } },
        'standard:disconnect': { version: '1.0.0', disconnect: async () => { connected = false; listeners.forEach(fn => fn({ accounts: [] })); } },
        'standard:events': { version: '1.0.0', on: (event, fn) => { if (event === 'change') listeners.add(fn); return () => listeners.delete(fn); } },
        'solana:signMessage': { version: '1.0.0', signMessage: async (...inputs) => Promise.all(inputs.map(async input => ({ signedMessage: input.message, signature: Uint8Array.from(await window.smokeSignMessage(Array.from(input.message))) }))) },
        'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: ['legacy', 0], signTransaction: async () => { throw new Error('Blockchain signing is disabled in this smoke test'); } },
      },
    };
    window.addEventListener('wallet-standard:app-ready', event => event.detail.register(wallet));
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: ({ register }) => register(wallet) }));
  }, { address: key.publicKey.toBase58(), publicKey: Array.from(key.publicKey.toBytes()) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/admin`);
  await page.getByRole('button', { name: 'Choose a wallet', exact: true }).click();
  await page.getByRole('button', { name: /Smoke Admin/ }).click();
  await page.getByRole('button', { name: 'Sign in as admin', exact: true }).click();
  await page.getByText('Saved revision 0', { exact: false }).waitFor();
  const imageDir = resolve(root, 'docs/images');
  await mkdir(imageDir, { recursive: true });
  await page.screenshot({ path: resolve(imageDir, 'admin-desktop.jpg'), fullPage: true, type: 'jpeg', quality: 85 });
  await page.getByRole('button', { name: 'Game settings', exact: true }).click();
  await page.getByRole('switch', { name: 'Pause new entries' }).click();
  await page.getByLabel('Public room population target').fill('12');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByText('Game settings saved. Existing games keep running.', { exact: false }).waitFor();
  const saved = JSON.parse(await readFile(resolve(dataDir, 'admin.json'), 'utf8'));
  assert.equal(saved.settings.admissionsPaused, true);
  assert.equal(saved.settings.bots.target, 12);
  assert.equal((await (await fetch(`${base}/api/config`)).json()).admissionsPaused, true);
  const lobby = await context.newPage();
  await lobby.goto(base);
  await lobby.getByText('New games are temporarily paused.', { exact: false }).waitFor();
  await lobby.getByRole('button', { name: /Practice/ }).click();
  assert.equal(await lobby.getByRole('button', { name: /Play practice/ }).isDisabled(), true);
  await page.getByRole('switch', { name: 'Pause new entries' }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByText('Saved revision 2', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'NFT skins', exact: false }).click();
  await page.getByLabel('Collection chain').selectOption('base');
  await page.getByLabel('Token standard').selectOption('erc721');
  await page.getByRole('button', { name: /Add.*mapping/i }).click();
  assert.equal(await page.locator('.admin-tab-panel:not([hidden]) select').last().inputValue(), '16');
  // Tab changes retain unsaved collection drafts.
  await page.getByRole('button', { name: 'Token', exact: true }).click();
  await page.getByRole('button', { name: 'NFT skins', exact: false }).click();
  assert.equal(await page.getByLabel('Collection chain').inputValue(), 'base');
  await page.getByLabel('Collection / contract address').fill('0x1111111111111111111111111111111111111111');
  await page.getByLabel('Asset ID for mapping 1').fill('1');
  await page.getByLabel('Configuration status').selectOption('configured');
  await page.getByRole('button', { name: 'Save staged collection', exact: true }).click();
  await page.getByText('Saved revision 3', { exact: false }).waitFor();
  const collection = JSON.parse(await readFile(resolve(dataDir, 'admin.json'), 'utf8')).settings.nft;
  assert.equal(collection.chain, 'base');
  assert.deepEqual(collection.skinMappings, [{ skinId: 16, assetId: '1' }]);
  const publicRelease = (await (await fetch(`${base}/api/config`)).json()).release;
  assert.equal(publicRelease.nft.collectionAddress, null);
  assert.equal(publicRelease.nft.ownershipEnabled, false);
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await page.getByText('Configuration activity', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile horizontal overflow');
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.screenshot({ path: resolve(imageDir, 'admin-mobile.jpg'), fullPage: true, type: 'jpeg', quality: 85 });
  await page.setViewportSize({ width: 320, height: 700 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '320px horizontal overflow');
  for (const name of ['Game settings', 'Token', 'NFT skins', 'On-chain', 'Activity']) {
    await page.getByRole('button', { name, exact: name !== 'NFT skins' }).click();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name}: 320px overflow`);
  }
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.getByRole('button', { name: 'Choose a wallet', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Game settings', exact: true }).isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log('Admin browser smoke passed: real signed login, durable CAS settings, live admission pause, NFT drafts, audit, wallet logout, 1440/390/320px layouts.');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await new Promise(resolve => { if (server.exitCode !== null) resolve(); else { server.once('exit', resolve); setTimeout(() => { server.kill('SIGKILL'); resolve(); }, 5000).unref(); } });
  await rm(dataDir, { recursive: true, force: true });
}
