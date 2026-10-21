#!/usr/bin/env node
// Cuts the promo's gameplay shots (timeline.json "footage") out of the 1080p capture takes of
// the gameplay kit (media/gameplay/cache/takes, see media/gameplay/README.md) into
// cache/footage/<id>/NNNN.jpg: 1920x1080 at the entry's fps (default 60), one JPEG per frame, as
// scenes.js reads them, plus track.json: Daphne's coin in output px per frame ([x, y, r]).
// Each entry: {id, take, from (take seconds), dur, zoom?, cam?, speed?, lead?, lag?} with the
// reframing options of media/gameplay/render/timeline.mjs (default: follow Daphne at zoom 1).
//   node render/footage-from-takes.mjs [id ...]
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Edit } from '../../gameplay/render/timeline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMO = resolve(HERE, '..');
const ROOT = resolve(PROMO, '../..');
const PY = resolve(ROOT, 'media/gameplay/cache/venv/bin/python');
// --plan: only write the shot edits (cache/footage-plan/<id>.json) for capture/replay.mjs --edit
const PLAN = process.argv.includes('--plan');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const TL = JSON.parse(readFileSync(resolve(PROMO, 'timeline.json'), 'utf8'));
const work = resolve(PROMO, PLAN ? 'cache/footage-plan' : 'cache/footage-work');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

for (const f of TL.footage.filter((x) => !only.length || only.includes(x.id))) {
  const { id, take, dur, src, fps = 60, align, ...shot } = f;
  let { from } = f;
  if (align) {
    // align: {src, at}: choose `from` so that source second `src` plays at local second `at`
    const probe = new Edit({ name: 'probe', fps });
    const ps = probe.shot({ take, from: 0, dur, zoom: 1, ...shot, cam: 'center' });
    const k = Math.round(align.at * fps);
    from = align.src - ps.frames[k][0];
  }
  const e = new Edit({ name: `promo-${id}`, fps });
  e.shot({ take, dur, zoom: 1, ...shot, from });
  const editPath = resolve(work, `${id}.json`);
  const data = e.build(editPath);
  if (PLAN) { console.log(`plan ${id}: ${take} ${from.toFixed(2)}-${e.shots[0].srcEnd.toFixed(2)}`); continue; }
  const tmp = resolve(work, id);
  const frames = Array.from({ length: data.frames }, (_, i) => i).join(',');
  const r = spawnSync(PY, [resolve(ROOT, 'media/gameplay/render/compose.py'), editPath, resolve(work, 'none'), '/dev/null', '--preview', frames, '--out-dir', tmp], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`compose failed for ${id}`);
  const out = resolve(PROMO, 'cache/footage', id);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const n of readdirSync(tmp).sort()) {
    const k = Number(n.slice(1, 6)) + 1;
    renameSync(resolve(tmp, n), resolve(out, `${String(k).padStart(4, '0')}.jpg`));
  }
  const track = e.trackMe(e.shots[0], 0, dur, 1 / fps).map(([, x, y, r]) => [x, y, r]);
  writeFileSync(resolve(out, 'track.json'), JSON.stringify(track));
  console.log(`shot ${id}: ${data.frames} frames from ${take} ${from.toFixed(2)}-${e.shots[0].srcEnd.toFixed(2)}`);
}
if (!PLAN) rmSync(work, { recursive: true, force: true });
