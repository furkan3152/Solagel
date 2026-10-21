#!/usr/bin/env node
// Checks that every source time an edit uses has a replayed frame near it (replay.mjs ranges).
//   node coverage.mjs edit.json [edit.json ...]   -> prints the uncovered spans per take
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const TAKES = resolve(dirname(fileURLToPath(import.meta.url)), '../cache/takes');
let bad = 0;
for (const p of process.argv.slice(2)) {
  const ed = JSON.parse(readFileSync(p, 'utf8'));
  for (const s of ed.audioShots) {
    const ft = JSON.parse(readFileSync(resolve(TAKES, s.take, 'frames.json'), 'utf8'));
    const miss = [];
    for (const [, t] of s.map) {
      let lo = 0, hi = ft.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ft[m] <= t) lo = m; else hi = m; }
      const d = Math.min(Math.abs(ft[lo] - t), Math.abs(ft[hi] - t));
      if (d > 1 / 100) miss.push(t);
    }
    if (miss.length) { bad++; console.log(`${p.split('/').pop()} ${s.take}: ${miss.length} uncovered, ${Math.min(...miss).toFixed(2)}-${Math.max(...miss).toFixed(2)}`); }
  }
}
console.log(bad ? `${bad} shots need frames` : 'all covered');
