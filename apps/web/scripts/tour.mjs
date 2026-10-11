// Visual tour of the UI: node scripts/tour.mjs <url> <outDir>
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [url, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const exe = [process.env.CHROME_PATH, '/usr/bin/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const logs = [];

async function session(viewport, mobile, fn) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && logs.push(`[console.error] ${m.text()}`));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await fn(page);
  await ctx.close();
}

const shot = (page, name) => page.screenshot({ path: `${outDir}/${name}.png` });

await session({ width: 1440, height: 900 }, false, async (page) => {
  await page.locator('.tab', { hasText: 'SOL' }).first().click();
  await page.waitForTimeout(400);
  await shot(page, 'stakes-tab');
  await page.locator('.tab', { hasText: 'Friends' }).first().click();
  await page.waitForTimeout(300);
  await shot(page, 'friends-tab');
  await page.locator('button', { hasText: 'Skin collection' }).first().click();
  await page.waitForTimeout(800);
  await shot(page, 'shop');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.waitForTimeout(400);
  await shot(page, 'settings');
  await page.locator('button', { hasText: 'Night Market' }).first().click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await shot(page, 'dark');
  await page.locator('button', { hasText: 'How to play' }).first().click();
  await page.waitForTimeout(400);
  await shot(page, 'howto');
});

await session({ width: 390, height: 844 }, true, async (page) => {
  await shot(page, 'mobile-lobby');
  await page.locator('.tab', { hasText: 'Practice' }).click();
  await page.locator('button.btn-gold.btn-xl').first().click();
  await page.waitForTimeout(2500);
  await shot(page, 'mobile-game');
});

console.log(logs.join('\n') || 'no page errors');
await browser.close();
