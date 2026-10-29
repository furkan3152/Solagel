#!/usr/bin/env node
// Opens a visible Chromium on the Elymum URL with the Dev Wallet injected (an EIP-6963 wallet whose
// key stays in this process; no extension needed). Started by `pnpm demo --browser`; can also be run by hand:
//   node scripts/dev-browser.mjs [url] [--key <file>] [--account <n>] [--rpc <url>]
//     --key <file>    a 0x private key file (created when missing; default out/dev-wallet.key)
//     --account <n>   use Hardhat dev account n instead (localnet: 0 is the owner/admin, 2 a plain player)
//     --rpc <url>     the chain's JSON-RPC for transactions (localnet: http://127.0.0.1:8545); none on the fake chain
import { resolve } from 'node:path';
import { ROOT, requireFrom, resolveChromium } from './lib/common.mjs';
import { devAccountKey, installDevWallet, loadOrCreateKey } from './lib/dev-wallet.mjs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const valued = new Set(['--key', '--account', '--rpc'].map((n) => args.indexOf(n) + 1).filter((i) => i > 0));
const url = args.find((a, i) => !a.startsWith('--') && !valued.has(i)) ?? 'http://localhost:5173/';
const keyPath = resolve(ROOT, opt('--key') ?? 'out/dev-wallet.key');
const account = opt('--account');
const rpcUrl = opt('--rpc') ?? null;

if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  console.error('dev-browser: no display found (DISPLAY is empty). Open the URL in your own browser with an EVM wallet instead.');
  process.exit(2);
}
const { chromium } = requireFrom('apps/web')('playwright');
let chrome;
try {
  chrome = resolveChromium(chromium);
} catch (e) {
  console.error(`dev-browser: ${e.message}`);
  process.exit(2);
}
const browser = await chromium.launch({ headless: false, executablePath: chrome.executablePath });
const ctx = await browser.newContext({ viewport: null });
const key = account !== undefined ? devAccountKey(Number(account)) : loadOrCreateKey(keyPath);
const address = await installDevWallet(ctx, key, { rpcUrl });
const page = await ctx.newPage();
await page.goto(url);
console.log(`Dev Wallet ${address} (${account !== undefined ? `Hardhat account #${account}` : `key: ${keyPath}`}${rpcUrl ? `, RPC ${rpcUrl}` : ', fake chain'}). Close the window to quit.`);
await new Promise((r) => browser.on('disconnected', r));
