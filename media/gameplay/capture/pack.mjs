#!/usr/bin/env node
// Packs a take's screencast JPEGs into a compact mezzanine: video.mkv (H.264 CRF 16, one encoded
// frame per screencast frame, in order) + pts.json (each frame's PTS in the file, for seeking).
// The true capture times stay in frames.json; the edit maps by frame index. Deletes the JPEGs.
//   node media/gameplay/capture/pack.mjs <take> [<take> ...]
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const TAKES = resolve(dirname(fileURLToPath(import.meta.url)), '../cache/takes');
const FFMPEG = process.env.FFMPEG || '/usr/bin/ffmpeg';
export function pack(dir) {
  if (!existsSync(resolve(dir, 'frames'))) return console.log('nothing to pack in', dir);
  const n = JSON.parse(readFileSync(resolve(dir, 'frames.json'), 'utf8')).length;
  let r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'frames.txt', '-vf', 'setpts=N/(30*TB)', '-r', '30', '-fps_mode', 'cfr', '-c:v', 'libx264', '-preset', 'faster', '-crf', '16', '-pix_fmt', 'yuv420p', '-g', '30', 'video.mkv'], { cwd: dir, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('pack encode failed ' + dir);
  r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', 'video.mkv'], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 26 });
  const pts = r.stdout.trim().split('\n').map(Number).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  if (pts.length < n) throw new Error(`pack: ${pts.length} frames in mkv, ${n} expected`);
  writeFileSync(resolve(dir, 'pts.json'), JSON.stringify(pts.slice(0, n)));
  rmSync(resolve(dir, 'frames'), { recursive: true, force: true });
  console.log('packed', dir, n, 'frames');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) for (const t of process.argv.slice(2)) pack(resolve(TAKES, t));
