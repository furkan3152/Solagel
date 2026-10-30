// Usage: node scripts/play.mjs <url> <outPrefix> [width=1440] [height=900] [seconds=6] [mobile=0]
// Joins a free game, wanders around with the mouse, splits once and saves screenshots.
import { chromium } from 'playwright';

const [url, out, w = '1440', h = '900', secs = '6', mobile = '0'] = process.argv.slice(2);
const exe = process.env.CHROME_PATH;
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({
  viewport: { width: Number(w), height: Number(h) },
  deviceScaleFactor: mobile === '1' ? 2 : 1,
  isMobile: mobile === '1',
  hasTouch: mobile === '1',
});
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => m.type() !== 'debug' && logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const name = page.locator('input.input').first();
await name.fill('Tester');
await page.locator('button.btn-gold.btn-xl').first().click();
await page.waitForTimeout(800);
const W = Number(w);
const H = Number(h);
const t0 = Date.now();
let i = 0;
while (Date.now() - t0 < Number(secs) * 1000) {
  const a = i / 12;
  if (mobile !== '1') await page.mouse.move(W / 2 + Math.cos(a) * W * 0.35, H / 2 + Math.sin(a * 0.7) * H * 0.3);
  if (i === 30 && mobile !== '1') await page.keyboard.press('Digit3');
  await page.waitForTimeout(100);
  i++;
}
await page.screenshot({ path: `${out}-game.png` });
if (mobile !== '1') {
  await page.keyboard.press('Space');
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${out}-split.png` });
}
console.log(logs.slice(-20).join('\n'));
await browser.close();
