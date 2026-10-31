// Player guide tour: /docs on desktop 1440×900 and phone 390×844 (DPR 2), paper / night.
// Needs a dev server (pnpm dev). Usage: node scripts/docs.mjs <baseUrl> <outDir>  -> <outDir>/docs-*.png
import { chromium } from 'playwright';

const [base = 'http://127.0.0.1:5173', out = '.'] = process.argv.slice(2);
const exe = process.env.CHROME_PATH;
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const logs = [];

async function shoot({ name, theme, mobile, path = '/docs', after }) {
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  );
  await ctx.addInitScript(
    ({ theme }) => localStorage.setItem('elymum.settings.v1', JSON.stringify({ theme, sound: false })),
    { theme },
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => logs.push(`[${name}] pageerror ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && logs.push(`[${name}] console ${m.text()}`));
  await page.goto(base + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  if (after) await after(page);
  await page.screenshot({ path: `${out}/docs-${name}.png`, fullPage: false });
  // overflow check: nothing wider than the viewport
  const wide = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    return [...document.querySelectorAll('.dc-page *')].filter((el) => el.getBoundingClientRect().right > w + 1).map((el) => el.className).slice(0, 5);
  });
  if (wide.length) logs.push(`[${name}] overflow: ${wide.join(', ')}`);
  await ctx.close();
}

const scrollTo = (sel) => async (page) => {
  await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'start' }), sel);
  await page.waitForTimeout(400);
};

for (const theme of ['light', 'dark']) {
  const t = theme === 'light' ? 'paper' : 'night';
  await shoot({ name: `desk-${t}-top`, theme, mobile: false });
  await shoot({ name: `desk-${t}-payout`, theme, mobile: false, after: scrollTo('#docs-payout') });
  await shoot({ name: `desk-${t}-rooms`, theme, mobile: false, after: scrollTo('#docs-rooms') });
  await shoot({ name: `phone-${t}-top`, theme, mobile: true });
  await shoot({ name: `phone-${t}-payout`, theme, mobile: true, after: scrollTo('#docs-payout .dc-fee') });
}
// more sections (paper) and the lobby links
await shoot({ name: 'desk-paper-value', theme: 'light', mobile: false, after: scrollTo('#docs-value') });
await shoot({ name: 'desk-paper-fair', theme: 'light', mobile: false, after: scrollTo('#docs-fair') });
await shoot({
  name: 'desk-paper-faq',
  theme: 'light',
  mobile: false,
  after: async (page) => {
    await scrollTo('#docs-faq')(page);
    await page.locator('.dc-faq__q').first().click();
    await page.waitForTimeout(200);
  },
});
await shoot({ name: 'phone-paper-rooms', theme: 'light', mobile: true, after: scrollTo('#docs-rooms') });
await shoot({ name: 'phone-night-fair', theme: 'dark', mobile: true, after: scrollTo('#docs-fair') });
await shoot({ name: 'desk-paper-hash', theme: 'light', mobile: false, path: '/#docs' });
await shoot({ name: 'desk-paper-lobby-index', theme: 'light', mobile: false, path: '/' });
await shoot({ name: 'desk-paper-lobby-footer', theme: 'light', mobile: false, path: '/', after: scrollTo('.kl-colophon') });
await shoot({ name: 'phone-paper-lobby-footer', theme: 'light', mobile: true, path: '/', after: scrollTo('.kl-colophon') });
// clicking the footer link opens the guide
await shoot({
  name: 'phone-paper-footer-click',
  theme: 'light',
  mobile: true,
  path: '/',
  after: async (page) => {
    await page.locator('.kl-colophon__link').click();
    await page.waitForTimeout(700);
    logs.push(`[footer-click] url ${page.url()} title ${await page.locator('#dc-title').textContent()}`);
  },
});
console.log(logs.join('\n') || 'no errors');
await browser.close();
