#!/usr/bin/env node
// Opens a visible Chromium on the Slana URL with the Dev Wallet injected (a local keypair, no
// extension needed). Started by `pnpm demo --browser`; can also be run by hand:
//   node scripts/dev-browser.mjs [url] [--keypair <path>]
import { resolve } from 'node:path';
import { ROOT, requireFrom, resolveChromium } from './lib/common.mjs';
import { addressOf, installDevWallet, loadOrCreateKeypair } from './lib/dev-wallet.mjs';

const args = process.argv.slice(2);
const kpIdx = args.indexOf('--keypair');
const keypairPath = resolve(ROOT, kpIdx >= 0 ? args[kpIdx + 1] : 'out/dev-wallet.json');
const url = args.find((a, i) => !a.startsWith('--') && i !== kpIdx + 1) ?? 'http://localhost:5173/';

if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  console.error('dev-browser: no display found (DISPLAY is empty). Open the URL in your own browser with Phantom instead.');
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
const kp = loadOrCreateKeypair(keypairPath);
await installDevWallet(ctx, kp);
const page = await ctx.newPage();
await page.goto(url);
console.log(`Dev Wallet ${addressOf(kp)} (key: ${keypairPath}). Close the window to quit.`);
await new Promise((r) => browser.on('disconnected', r));
