#!/usr/bin/env node
// Frame renderer for the Slana promo.
//
// Serves media/promo over a local HTTP port, opens scenes/promo.html in
// headless Chromium (one browser per worker), steps the timeline frame by
// frame through window.renderAt(t) and pipes the frames to ffmpeg.
//
//   node render/render.mjs --preview 0.5,2.4,4.9      → cache/preview/t<time>.png
//   node render/render.mjs [--from 0] [--to 52.8] [--workers 3]
//                                                     → cache/video.mp4 (picture only, near-lossless)
//
// Env: CHROME_PATH (default: Playwright's Chromium, then /opt/pw-browsers/...), FFMPEG.
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROMO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(PROMO, '../..');
const FFMPEG = process.env.FFMPEG || '/usr/bin/ffmpeg';
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const TL = JSON.parse(readFileSync(join(PROMO, 'timeline.json'), 'utf8'));
const FPS = TL.fps;

// ── static server ──
const FONT_DIR = join(ROOT, 'apps/web/node_modules');
const ROUTES = {
  '/fonts/brico.woff2': join(FONT_DIR, '@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-standard-normal.woff2'),
  '/fonts/dmmono-400.woff2': join(FONT_DIR, '@fontsource/dm-mono/files/dm-mono-latin-400-normal.woff2'),
  '/fonts/dmmono-500.woff2': join(FONT_DIR, '@fontsource/dm-mono/files/dm-mono-latin-500-normal.woff2'),
};
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  // the brand art (arena posters) is served from brand/
  const file = ROUTES[url] || (url.startsWith('/brand/') ? join(ROOT, url) : join(PROMO, url));
  if (!file.startsWith(PROMO) && !file.startsWith(join(ROOT, 'brand')) && !ROUTES[url]) return res.writeHead(403).end();
  if (!existsSync(file) || statSync(file).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'max-age=3600' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ── browser ──
const { chromium } = createRequire(join(ROOT, 'apps/web/package.json'))('playwright');
let exe = process.env.CHROME_PATH;
if (!exe) {
  try { exe = chromium.executablePath(); } catch {}
  if (!exe || !existsSync(exe)) exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
}
async function openPage() {
  const browser = await chromium.launch({
    executablePath: exe,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--force-device-scale-factor=1'],
  });
  const page = await browser.newPage({ viewport: { width: TL.width, height: TL.height }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  page.on('console', (m) => m.type() === 'error' && console.error('[console]', m.text()));
  await page.goto(`${BASE}/scenes/promo.html`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
  return { browser, page };
}
async function grab(page, t, type = 'jpeg') {
  const b64 = await page.evaluate(async ([t, type]) => {
    await window.renderAt(t);
    const c = document.getElementById('stage');
    const url = type === 'png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.96);
    return url.slice(url.indexOf(',') + 1);
  }, [t, type]);
  return Buffer.from(b64, 'base64');
}

const preview = opt('--preview', null);
try {
  if (preview) {
    const dir = join(PROMO, 'cache/preview');
    mkdirSync(dir, { recursive: true });
    const { browser, page } = await openPage();
    for (const s of preview.split(',')) {
      const t = parseFloat(s);
      const t0 = Date.now();
      writeFileSync(join(dir, `t${t.toFixed(2).padStart(6, '0')}.png`), await grab(page, t, 'png'));
      console.log(`t=${t} ${Date.now() - t0} ms`);
    }
    await browser.close();
  } else {
    const from = parseFloat(opt('--from', '0'));
    const to = parseFloat(opt('--to', String(TL.cutDuration ?? TL.duration)));
    const workers = parseInt(opt('--workers', '3'), 10);
    const out = resolve(opt('--out', join(PROMO, 'cache/video.mp4')));
    const f0 = Math.round(from * FPS), f1 = Math.round(to * FPS);
    const n = f1 - f0;
    const chunkDir = join(PROMO, 'cache/chunks');
    rmSync(chunkDir, { recursive: true, force: true });
    mkdirSync(chunkDir, { recursive: true });
    const per = Math.ceil(n / workers);
    const T0 = Date.now();
    let done = 0;
    const jobs = [];
    for (let w = 0; w < workers; w++) {
      const a = f0 + w * per, b = Math.min(f1, a + per);
      if (a >= b) continue;
      jobs.push((async () => {
        const { browser, page } = await openPage();
        const file = join(chunkDir, `c${w}.mp4`);
        const ff = spawn(FFMPEG, ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
          '-c:v', 'libx264', '-preset', 'medium', '-crf', '10', '-pix_fmt', 'yuv420p', '-r', String(FPS), file], { stdio: ['pipe', 'inherit', 'inherit'] });
        for (let f = a; f < b; f++) {
          const buf = await grab(page, f / FPS);
          if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
          done++;
          if (done % 60 === 0) {
            const el = (Date.now() - T0) / 1000;
            console.log(`${done}/${n} frames  ${(done / el).toFixed(2)} fps  eta ${((n - done) / (done / el) / 60).toFixed(1)} min`);
          }
        }
        ff.stdin.end();
        await new Promise((r) => ff.on('close', r));
        await browser.close();
        return file;
      })());
    }
    const files = await Promise.all(jobs);
    writeFileSync(join(chunkDir, 'list.txt'), files.map((f) => `file '${f}'`).join('\n'));
    await new Promise((r, j) => {
      const ff = spawn(FFMPEG, ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(chunkDir, 'list.txt'), '-c', 'copy', out], { stdio: 'inherit' });
      ff.on('close', (c) => (c === 0 ? r() : j(new Error('concat failed'))));
    });
    console.log(`wrote ${out} (${n} frames in ${((Date.now() - T0) / 60000).toFixed(1)} min)`);
  }
} finally {
  server.close();
}
