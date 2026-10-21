#!/usr/bin/env node
/**
 * Slana X post templates, 1600×900 (16:9, the in-feed shape) and 1080×1080.
 *
 *   node brand/posts/generate.mjs                       # every post
 *   node brand/posts/generate.mjs --only fee            # one design (file-name prefix)
 *   node brand/posts/generate.mjs --days 3 --date "SAT · NOV 14 · 18:00 UTC" --title "The first bell"
 *
 * The countdown card takes its number and its date from the arguments (the
 * defaults are placeholders). Output is deterministic. Images that would be
 * over ~1.9 MB as truecolor PNGs are written as 256-colour indexed PNGs.
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readArgs, render, saveSmall } from '../lib/riso.mjs';
import { DESIGNS } from '../lib/cards.mjs';

const OUT = dirname(fileURLToPath(import.meta.url));
const args = readArgs();
const SIZES = [
  [1600, 900],
  [1080, 1080],
];
const countdownOpts = {
  days: args.days ?? '7',
  date: args.date ?? 'SAT · NOV 14 · 18:00 UTC',
  title: args.title ?? 'The first bell',
};
const JOBS = [
  ['wl-open', DESIGNS.wlOpen],
  ['collab-open', DESIGNS.collabOpen],
  ['arena-1-penny-pond', DESIGNS.arenaReveal, { id: 1 }],
  ['arena-2-silver-creek', DESIGNS.arenaReveal, { id: 2 }],
  ['arena-3-gold-lake', DESIGNS.arenaReveal, { id: 3 }],
  ['arena-4-whale-bay', DESIGNS.arenaReveal, { id: 4 }],
  ['how-a-round-works', DESIGNS.howRound],
  ['fee', DESIGNS.fee],
  ['nft-coming-soon', DESIGNS.nftSoon],
  ['countdown', DESIGNS.countdown, countdownOpts],
];

console.log('Slana X post templates');
let seed = 1;
for (const [name, draw, opts] of JOBS) {
  seed++;
  if (args.only && !name.startsWith(args.only)) continue;
  for (const [W, H] of SIZES) {
    const c = render(W, H, (x) => draw(x, W, H, opts), { seed: seed * 7 + W });
    saveSmall(c, OUT, `${name}-${W}x${H}.png`);
  }
}
