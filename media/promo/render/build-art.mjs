#!/usr/bin/env node
// Bundles packages/art (coin characters, Pass cards) into cache/art.js as the global `SlanaArt`.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROMO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(PROMO, '../..');
mkdirSync(resolve(PROMO, 'cache'), { recursive: true });
const bin = resolve(ROOT, 'packages/art/node_modules/.bin/esbuild');
const r = spawnSync(
  bin,
  [resolve(PROMO, 'scenes/art-entry.ts'), '--bundle', '--format=iife', '--global-name=SlanaArt', '--target=chrome120', `--outfile=${resolve(PROMO, 'cache/art.js')}`],
  { stdio: 'inherit', cwd: resolve(ROOT, 'packages/art') },
);
process.exit(r.status ?? 1);
