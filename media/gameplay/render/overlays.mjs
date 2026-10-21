#!/usr/bin/env node
// Renders the motion-graphics layer of an edit, frame by frame, as transparent PNGs.
//   node overlays.mjs <edit.json> <outDir> [--pages 3] [--from f] [--to f]
//   node overlays.mjs <edit.json> <outDir> --preview t1,t2,... [--bg frame.jpg]
// <edit.json> is written by an edit script: {fps, frames, items: [{id,type,start,dur,z,props}]}.
// Each frame with something on it is captured clipped to the bounds of what is visible
// (`f000123.png`), and `manifest.json` maps frame -> [x, y, w, h, opaque]. The motion page is
// deterministic (motion/motion.js), so pages can split the frames between them.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const require = createRequire(resolve(ROOT, 'apps/web/package.json'));
const { chromium } = require('playwright');
const CHROME = process.env.CHROME_PATH;

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const [editPath, outDir] = argv;
if (!editPath || !outDir) { console.error('usage: overlays.mjs <edit.json> <outDir> [--pages N] [--preview t,t] [--bg img]'); process.exit(2); }
const edit = JSON.parse(readFileSync(editPath, 'utf8'));
const fps = edit.fps || 30;
const N = edit.frames;
mkdirSync(outDir, { recursive: true });
const PAGES = Number(opt('--pages', '3'));
const preview = opt('--preview', null);
const EW = edit.w || 1920, EH = edit.h || 1080;
const motionUrl = `${pathToFileURL(resolve(HERE, '../motion/motion.html')).href}?w=${EW}&h=${EH}`;

const browser = await chromium.launch({ executablePath: CHROME, args: ['--disable-gpu', '--allow-file-access-from-files', '--force-color-profile=srgb', '--font-render-hinting=none'] });
async function openPage() {
  const ctx = await browser.newContext({ viewport: { width: EW, height: EH }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[page]', e.message));
  await page.goto(motionUrl);
  await page.evaluate(() => window.ready);
  const n = await page.evaluate((items) => window.setup(items), edit.items);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  return { page, cdp, n };
}

if (preview) {
  const { page, cdp } = await openPage();
  const bg = opt('--bg', null);
  if (bg) await page.evaluate((u) => { document.body.style.background = `url(${u}) 0 0 / 100% 100%`; }, pathToFileURL(resolve(bg)).href);
  for (const t of preview.split(',').map(Number)) {
    await page.evaluate((t) => window.frame(t), t);
    const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
    writeFileSync(resolve(outDir, `preview-${t.toFixed(2)}.jpg`), Buffer.from(r.data, 'base64'));
  }
  await browser.close();
  process.exit(0);
}

const from = Number(opt('--from', '0')), to = Number(opt('--to', String(N)));
const manifest = {};
const pages = await Promise.all(Array.from({ length: PAGES }, openPage));
const t0 = Date.now();
let done = 0;
await Promise.all(pages.map(async ({ page, cdp }, k) => {
  for (let f = from + k; f < to; f += PAGES) {
    const res = await page.evaluate((t) => window.frame(t), f / fps);
    if (!res.n) continue;
    const [x0, y0, x1, y1] = res.box;
    const w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) continue;
    // an opaque frame (a card or a board covers everything) is stored as a JPEG, the rest as PNG with alpha
    const r = res.opaque
      ? await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 93, clip: { x: 0, y: 0, width: EW, height: EH, scale: 1 }, captureBeyondViewport: false })
      : await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: x0, y: y0, width: w, height: h, scale: 1 }, optimizeForSpeed: true, captureBeyondViewport: false });
    writeFileSync(resolve(outDir, `f${String(f).padStart(6, '0')}.${res.opaque ? 'jpg' : 'png'}`), Buffer.from(r.data, 'base64'));
    manifest[f] = res.opaque ? [0, 0, EW, EH, 1] : [x0, y0, w, h, 0];
    if (++done % 200 === 0) console.log(`overlays: ${done} frames, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}));
const mp = resolve(outDir, 'manifest.json');
const prev = existsSync(mp) && (from > 0 || to < N) ? JSON.parse(readFileSync(mp, 'utf8')) : {};
writeFileSync(mp, JSON.stringify({ ...prev, ...manifest }));
console.log(`overlays: ${done} frames with graphics of ${to - from}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
await browser.close();
