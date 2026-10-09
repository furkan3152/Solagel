// Usage: node scripts/shot.mjs <url> <out.png> [width=1440] [height=900] [waitMs=1500] [mobile=0]
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const [url, out, w = '1440', h = '900', wait = '1500', mobile = '0'] = process.argv.slice(2);
const candidates = [
  process.env.CHROME_PATH,
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
  viewport: { width: Number(w), height: Number(h) },
  deviceScaleFactor: mobile === '1' ? 2 : 1,
  isMobile: mobile === '1',
  hasTouch: mobile === '1',
});
const page = await context.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out, fullPage: false });
if (logs.length) console.log(logs.slice(-30).join('\n'));
await browser.close();
