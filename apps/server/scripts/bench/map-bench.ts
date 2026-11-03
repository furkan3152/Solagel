/**
 * Adaptive map benchmark: CPU per tick of a full 100-player room (people with connections and
 * snapshots, plus bots) on the auto-sized map, against the same room on a fixed arena preset,
 * and the cost of the resizes themselves.
 *   pnpm -F @elymum/server exec tsx scripts/bench/map-bench.ts [players] [humans] [seconds]
 *
 * The production server runs on a 0.5 CPU instance: a tick has 33 ms; read the numbers below
 * as roughly twice as slow there.
 */
import { MAP_SCALE_DEFAULT, MAP_SPACE, TICK_MS, WORLD_PRESETS, worldForSide } from '@elymum/shared';
import { World } from '../../src/game/world';
import { runMapRoom } from '../../test/map-room';

const players = Number(process.argv[2] ?? 100);
const humans = Number(process.argv[3] ?? 40);
const seconds = Number(process.argv[4] ?? 20);

const fmt = (r: { mean: number; p95: number; max: number; side: number; food: number; cacti: number }) =>
  `side ${r.side} · food ${r.food} · cacti ${r.cacti} · tick mean ${r.mean.toFixed(2)} ms · p95 ${r.p95.toFixed(2)} ms · max ${r.max.toFixed(2)} ms`;

console.log(`${players} players (${humans} people with a connection, ${players - humans} bots), ${seconds} s measured\n`);
console.log(`auto   : ${fmt(runMapRoom({ players, humans, seconds, map: { ...MAP_SCALE_DEFAULT } }))}`);
console.log(`fixed  : ${fmt(runMapRoom({ players, humans, seconds, map: null, world: { ...WORLD_PRESETS.arena } }))}`);

// resize cost alone, on a full 9000 world
const w = new World({ ...worldForSide(9000), powerUps: true, coinRain: false, seed: 9, space: MAP_SPACE });
for (let i = 0; i < 100; i++) w.addPlayer({ name: `p${i}`, skin: 1 });
for (let i = 0; i < 300; i++) w.tick(TICK_MS);
let t = performance.now();
for (let s = 9000; s >= 3000; s -= 600) w.resize(s, s, worldForSide(s));
const shrink = performance.now() - t;
t = performance.now();
for (let s = 3000; s <= 9000; s += 600) w.resize(s, s, worldForSide(s));
const grow = performance.now() - t;
console.log(`resize : 11 shrink steps 9000 -> 3000 in ${shrink.toFixed(2)} ms total; 11 grow steps in ${grow.toFixed(2)} ms total (grids never rebuilt)`);
