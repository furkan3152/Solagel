// Shared helpers for the flow regression scripts (scripts/flows/*.mjs). They drive a running local
// stack (`node apps/web/scripts/ui-audit.mjs --serve`, dev fake chain) at BASE with Playwright.
import { chromium } from 'playwright';

export const BASE = (process.env.BASE || 'http://localhost:5199').replace(/\/$/, '');
const IGNORE = [/\[vite\]/i, /React DevTools/i, /favicon/i, /net::ERR_ABORTED/, /WebSocket connection to .* failed/i, /Failed to load resource/i];

export async function launch() {
  return chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
}

let ipSeq = 10;
/** A context with its own client address (the stack trusts X-Forwarded-For) and console capture. */
export async function newContext(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, extraHTTPHeaders: { 'x-forwarded-for': `10.9.${ipSeq >> 8}.${ipSeq++ & 255}` }, ...opts });
  return ctx;
}

export function watchPage(page, errors) {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (IGNORE.some((r) => r.test(text))) return;
    errors.push(`[console] ${page.url()} ${text}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${page.url()} ${e.message}`));
}

let failures = 0;
export function check(cond, msg) {
  if (cond) console.log(`  ok   ${msg}`);
  else {
    failures++;
    console.log(`  FAIL ${msg}`);
  }
}
export function done() {
  console.log(failures ? `${failures} failure(s)` : 'all passed');
  process.exit(failures ? 1 : 0);
}
