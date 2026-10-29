#!/usr/bin/env node
// Renders the Elymum brand kit (Ring Storybook style) to PNGs with Playwright's Chromium.
//
//   node brand/generate.mjs            render everything into brand/out/ and refresh the web app's
//                                      og-elymum.png, favicon-32.png and apple-touch-icon.png
//   node brand/generate.mjs og x-banner   render only the named jobs
//   node brand/generate.mjs --list     list the jobs
//
// Chromium: CHROME_PATH or Playwright's own browser.
// Playwright is resolved from apps/web (the web app's dev dependency); nothing extra to install.
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { requireFrom, resolveChromium } from '../scripts/lib/common.mjs';
import { ROOT } from './lib/art.mjs';
import * as T from './lib/templates.mjs';

const OUT = join(ROOT, 'brand/out');
const PUBLIC = join(ROOT, 'apps/web/public');

/** name -> { make, scale, file, copies } */
const JOBS = [
  { name: 'x-avatar-400', make: T.xAvatar, scale: 1, file: 'x/x-avatar-400.png' },
  { name: 'x-avatar-1000', make: T.xAvatar, scale: 2.5, file: 'x/x-avatar-1000.png' },
  { name: 'x-banner', make: T.xBanner, scale: 1, file: 'x/x-banner-1500x500.png' },
  { name: 'x-banner-2x', make: T.xBanner, scale: 2, file: 'x/x-banner-3000x1000.png' },
  { name: 'og', make: T.ogCard, scale: 1, file: 'web/og-elymum.png', copies: [join(PUBLIC, 'og-elymum.png')] },
  { name: 'favicon-32', make: () => T.favicon(32), scale: 1, file: 'web/favicon-32.png', copies: [join(PUBLIC, 'favicon-32.png')] },
  { name: 'apple-touch-icon', make: T.appleTouchIcon, scale: 1, file: 'web/apple-touch-icon.png', copies: [join(PUBLIC, 'apple-touch-icon.png')] },
  { name: 'coin-mark-512', make: () => T.favicon(512), scale: 1, file: 'web/coin-mark-512.png' },
  { name: 'post-wl-open', make: T.postWlOpen, scale: 1, file: 'posts/post-wl-open.png' },
  { name: 'post-mint', make: T.postMint, scale: 1, file: 'posts/post-mint.png' },
  { name: 'post-game-live', make: T.postGameLive, scale: 1, file: 'posts/post-game-live.png' },
  { name: 'sticker-sheet', make: T.stickerSheet, scale: 1, file: 'stickers/sticker-sheet.png' },
  ...T.ARENAS.map((a) => ({ name: `poster-${a.id}`, make: () => T.arenaPoster(a), scale: 2, file: `posters/poster-${a.id}-${a.slug}.png` })),
  ...T.STICKER_CAST.map((c) => ({ name: `sticker-${c.name}`, make: () => T.sticker(c), scale: 1, file: `stickers/sticker-${c.name}.png`, transparent: true })),
];

const args = process.argv.slice(2);
if (args.includes('--list')) {
  for (const j of JOBS) console.log(`${j.name.padEnd(22)} brand/out/${j.file}`);
  process.exit(0);
}
const unknown = args.filter((a) => !JOBS.some((j) => j.name === a));
if (unknown.length) {
  console.error(`unknown job(s): ${unknown.join(', ')} (see --list)`);
  process.exit(2);
}
const jobs = args.length ? JOBS.filter((j) => args.includes(j.name)) : JOBS;

const { chromium } = requireFrom('apps/web')('playwright');
const browser = await chromium.launch({ executablePath: resolveChromium(chromium).executablePath });
try {
  for (const job of jobs) {
    const { w, h, html } = job.make();
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: job.scale });
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(async () => {
      for (const f of ['Fraunces', 'DM Sans', 'Geist Mono']) await document.fonts.load(`700 16px "${f}"`).catch(() => {});
      await document.fonts.ready;
    });
    const missing = await page.evaluate(() => ['Fraunces', 'DM Sans', 'Geist Mono'].filter((f) => !document.fonts.check(`16px "${f}"`)));
    if (missing.length) console.warn(`  ! ${job.name}: font(s) not loaded: ${missing.join(', ')}`);
    const file = join(OUT, job.file);
    mkdirSync(join(file, '..'), { recursive: true });
    await page.locator('.frame').screenshot({ path: file, omitBackground: true });
    for (const c of job.copies ?? []) copyFileSync(file, c);
    console.log(`  ${job.name.padEnd(22)} ${Math.round(w * job.scale)}x${Math.round(h * job.scale)}  brand/out/${job.file}${job.copies ? `  (+ ${job.copies.map((c) => c.replace(`${ROOT}/`, '')).join(', ')})` : ''}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
