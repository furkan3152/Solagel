#!/usr/bin/env node
/**
 * Rebuilds every brand kit under brand/ except brand/x (run that one on its
 * own: node brand/x/generate.mjs). Each generator is deterministic.
 *
 *   node brand/generate-all.mjs
 *   node brand/generate-all.mjs --days 3 --date "SAT · NOV 14 · 18:00 UTC"   # passed to the posts (countdown)
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const extra = process.argv.slice(2);
for (const kit of ['posts', 'stories', 'stickers', 'posters', 'community', 'sheet']) {
  const r = spawnSync(process.execPath, [join(HERE, kit, 'generate.mjs'), ...(kit === 'posts' ? extra : [])], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
