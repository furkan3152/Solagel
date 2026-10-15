// Player guide tour (Task 16): /docs on desktop 1440×900 and phone 390×844 (DPR 2), TR / EN, paper / night.
// Needs a dev server (pnpm dev). Usage: node scripts/docs.mjs <baseUrl> <outDir>  -> <outDir>/docs-*.png
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const [base = 'http://127.0.0.1:5173', out = '.'] = process.argv.slice(2);
const exe = process.env.CHROME_PATH;
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const logs = [];

async function shoot({ name, lang, theme, mobile, path = '/docs', after }) {
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  );
  await ctx.addInitScript(
    ({ lang, theme }) => localStorage.setItem('slana.settings.v1', JSON.stringify({ lang, theme, sound: false })),
    { lang, theme },
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

for (const lang of ['tr', 'en']) {
  for (const theme of ['light', 'dark']) {
    const t = theme === 'light' ? 'paper' : 'night';
    await shoot({ name: `desk-${lang}-${t}-top`, lang, theme, mobile: false });
    await shoot({ name: `desk-${lang}-${t}-cashout`, lang, theme, mobile: false, after: scrollTo('#docs-cashout') });
    await shoot({ name: `desk-${lang}-${t}-pass`, lang, theme, mobile: false, after: scrollTo('#docs-pass') });
    await shoot({ name: `phone-${lang}-${t}-top`, lang, theme, mobile: true });
    await shoot({ name: `phone-${lang}-${t}-cashout`, lang, theme, mobile: true, after: scrollTo('#docs-cashout .dc-fee') });
  }
}
// more sections (TR paper) and the lobby links
await shoot({ name: 'desk-tr-paper-value', lang: 'tr', theme: 'light', mobile: false, after: scrollTo('#docs-value') });
await shoot({ name: 'desk-tr-paper-seasons', lang: 'tr', theme: 'light', mobile: false, after: scrollTo('#docs-seasons') });
await shoot({ name: 'desk-tr-paper-fair', lang: 'tr', theme: 'light', mobile: false, after: scrollTo('#docs-fair') });
await shoot({
  name: 'desk-en-paper-faq',
  lang: 'en',
  theme: 'light',
  mobile: false,
  after: async (page) => {
    await scrollTo('#docs-faq')(page);
    await page.locator('.dc-faq__q').first().click();
    await page.waitForTimeout(200);
  },
});
await shoot({ name: 'phone-tr-paper-pass', lang: 'tr', theme: 'light', mobile: true, after: scrollTo('#docs-pass') });
await shoot({ name: 'phone-en-night-fair', lang: 'en', theme: 'dark', mobile: true, after: scrollTo('#docs-fair') });
await shoot({ name: 'desk-tr-paper-hash', lang: 'tr', theme: 'light', mobile: false, path: '/#docs' });
await shoot({ name: 'desk-tr-paper-lobby-index', lang: 'tr', theme: 'light', mobile: false, path: '/' });
await shoot({ name: 'desk-en-paper-lobby-footer', lang: 'en', theme: 'light', mobile: false, path: '/', after: scrollTo('.kl-colophon') });
await shoot({ name: 'phone-tr-paper-lobby-footer', lang: 'tr', theme: 'light', mobile: true, path: '/', after: scrollTo('.kl-colophon') });
// clicking the footer link opens the guide
await shoot({
  name: 'phone-en-paper-footer-click',
  lang: 'en',
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
