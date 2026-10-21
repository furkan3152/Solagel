#!/usr/bin/env node
/**
 * Slana story / vertical templates, 1080×1920 (X, Instagram and Telegram
 * stories). Key content stays between y 250 and y 1670, clear of the story
 * UI at the top and the reply bar at the bottom.
 *
 *   node brand/stories/generate.mjs                     # every story
 *   node brand/stories/generate.mjs --only arena        # one design (file-name prefix)
 *
 * Output is deterministic; files over ~1.9 MB as truecolor are written as
 * 256-colour indexed PNGs.
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readArgs, render, saveSmall } from '../lib/riso.mjs';
import { DESIGNS } from '../lib/cards.mjs';

const OUT = dirname(fileURLToPath(import.meta.url));
const args = readArgs();
const JOBS = [
  ['story-wl-open', DESIGNS.wlOpen],
  ['story-arena-1-penny-pond', DESIGNS.arenaReveal, { id: 1 }],
  ['story-arena-2-silver-creek', DESIGNS.arenaReveal, { id: 2 }],
  ['story-arena-3-gold-lake', DESIGNS.arenaReveal, { id: 3 }],
  ['story-arena-4-whale-bay', DESIGNS.arenaReveal, { id: 4 }],
];

console.log('Slana story templates');
let seed = 40;
for (const [name, draw, opts] of JOBS) {
  seed++;
  if (args.only && !name.replace('story-', '').startsWith(args.only)) continue;
  const c = render(1080, 1920, (x) => draw(x, 1080, 1920, opts), { seed });
  saveSmall(c, OUT, `${name}-1080x1920.png`);
}
