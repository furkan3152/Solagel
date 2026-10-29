#!/usr/bin/env node
// Bundles packages/art (the coin characters) into ../cache/art.js as the global `ElymumArt`.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
mkdirSync(resolve(HERE, '../cache'), { recursive: true });
const r = spawnSync(
  resolve(ROOT, 'packages/art/node_modules/.bin/esbuild'),
  [resolve(HERE, 'art-entry.ts'), '--bundle', '--format=iife', '--global-name=ElymumArt', '--target=chrome120', `--outfile=${resolve(HERE, '../cache/art.js')}`],
  { stdio: 'inherit', cwd: resolve(ROOT, 'packages/art') },
);
process.exit(r.status ?? 1);
