// Renders a bundle that exposes `window.demo()` (the sfx kit through the real mixer in an
// OfflineAudioContext) in headless Chromium and writes the result as a 32-bit float WAV.
//   node scripts/audio/render-sfx.mjs BUNDLE.js OUT.wav
import { writeFileSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [bundle, out] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><html><body></body></html>');
await page.addScriptTag({ content: readFileSync(bundle, 'utf8') });
const { data, labels } = await page.evaluate(() => window.demo());
await browser.close();

const sr = 48000;
const pcm = Buffer.alloc(data.length * 4);
data.forEach((v, i) => pcm.writeFloatLE(v, i * 4));
const h = Buffer.alloc(44);
h.write('RIFF', 0);
h.writeUInt32LE(36 + pcm.length, 4);
h.write('WAVEfmt ', 8);
h.writeUInt32LE(16, 16);
h.writeUInt16LE(3, 20);
h.writeUInt16LE(1, 22);
h.writeUInt32LE(sr, 24);
h.writeUInt32LE(sr * 4, 28);
h.writeUInt16LE(4, 32);
h.writeUInt16LE(32, 34);
h.write('data', 36);
h.writeUInt32LE(pcm.length, 40);
writeFileSync(out, Buffer.concat([h, pcm]));
writeFileSync(out.replace(/\.wav$/, '.json'), JSON.stringify(labels, null, 1));
console.log(`wrote ${out} (${(data.length / sr).toFixed(1)} s, peak ${data.reduce((m, v) => Math.max(m, Math.abs(v)), 0).toFixed(3)})`);
