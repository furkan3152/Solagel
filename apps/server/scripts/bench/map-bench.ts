/**
 * Adaptive map benchmark: CPU per tick of a full 100-player room (people with connections and
 * snapshots, plus bots) on the auto-sized map, against the same room on a fixed arena preset,
 * and the cost of the resizes themselves.
 *   pnpm -F @elymum/server exec tsx scripts/bench/map-bench.ts [players] [humans] [seconds]
 *
 * `rooms` mode: several quiet rooms side by side in one process (the usual production load: a
 * handful of rooms of ~12 players, mostly bots), all ticked every 33 ms, on the new default curve
 * (every such room at 10000) and on the old one (perPlayer 900, min 3000, max 9000).
 *   pnpm -F @elymum/server exec tsx scripts/bench/map-bench.ts rooms [rooms=6] [players=13] [humans=1] [seconds=20]
 *
 * The production server runs on a 0.5 CPU instance: a tick has 33 ms; read the numbers below
 * as roughly twice as slow there.
 */
import { MAP_SCALE_DEFAULT, MAP_SPACE, OLD_MAP_SCALE_DEFAULT, TICK_MS, WORLD_PRESETS, worldForSide } from '@elymum/shared';
import { World } from '../../src/game/world';
import { runMapRoom } from '../../test/map-room';

const fmt = (r: { mean: number; p95: number; max: number; side: number; food: number; cacti: number }) =>
  `side ${r.side} · food ${r.food} · cacti ${r.cacti} · tick mean ${r.mean.toFixed(2)} ms · p95 ${r.p95.toFixed(2)} ms · max ${r.max.toFixed(2)} ms`;

if (process.argv[2] === 'rooms') {
  const rooms = Number(process.argv[3] ?? 6);
  const players = Number(process.argv[4] ?? 13);
  const humans = Number(process.argv[5] ?? 1);
  const seconds = Number(process.argv[6] ?? 20);
  console.log(`${rooms} rooms x ${players} players (${humans} with a connection, ${players - humans} bots) in one process, ${seconds} s measured; times are all rooms per tick\n`);
  console.log(`new default (${MAP_SCALE_DEFAULT.perPlayer}/${MAP_SCALE_DEFAULT.min}/${MAP_SCALE_DEFAULT.max}): ${fmt(runMapRoom({ players, humans, seconds, rooms, map: { ...MAP_SCALE_DEFAULT } }))}`);
  console.log(`old default (${OLD_MAP_SCALE_DEFAULT.perPlayer}/${OLD_MAP_SCALE_DEFAULT.min}/${OLD_MAP_SCALE_DEFAULT.max}): ${fmt(runMapRoom({ players, humans, seconds, rooms, map: { auto: true, ...OLD_MAP_SCALE_DEFAULT } }))}`);
} else {
  const players = Number(process.argv[2] ?? 100);
  const humans = Number(process.argv[3] ?? 40);
  const seconds = Number(process.argv[4] ?? 20);

  console.log(`${players} players (${humans} people with a connection, ${players - humans} bots), ${seconds} s measured\n`);
  console.log(`auto   : ${fmt(runMapRoom({ players, humans, seconds, map: { ...MAP_SCALE_DEFAULT } }))}`);
  console.log(`fixed  : ${fmt(runMapRoom({ players, humans, seconds, map: null, world: { ...WORLD_PRESETS.arena } }))}`);

  // resize cost alone, over the whole space (shrink to the smallest custom size and back)
  const w = new World({ ...worldForSide(MAP_SPACE), powerUps: true, coinRain: false, seed: 9, space: MAP_SPACE });
  for (let i = 0; i < 100; i++) w.addPlayer({ name: `p${i}`, skin: 1 });
  for (let i = 0; i < 300; i++) w.tick(TICK_MS);
  let t = performance.now();
  for (let s = MAP_SPACE; s >= 3000; s -= 600) w.resize(s, s, worldForSide(s));
  const shrink = performance.now() - t;
  t = performance.now();
  for (let s = 3000; s <= MAP_SPACE; s += 600) w.resize(s, s, worldForSide(s));
  const grow = performance.now() - t;
  console.log(`resize : 16 shrink steps ${MAP_SPACE} -> 3000 in ${shrink.toFixed(2)} ms total; 16 grow steps in ${grow.toFixed(2)} ms total (grids never rebuilt)`);
}
