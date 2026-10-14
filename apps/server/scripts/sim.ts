/**
 * Headless balance check: runs a free room with bots only and prints stats.
 *   pnpm -F @slana/server sim [minutes=5] [seed=1]
 */
import { TICK_MS, WORLD_PRESETS } from '@slana/shared';
import { BotManager } from '../src/bots/manager';
import { mulberry32 } from '../src/game/rng';
import { World } from '../src/game/world';

const minutes = Number(process.argv[2] ?? 5);
const seed = Number(process.argv[3] ?? 1);
const world = new World({ ...WORLD_PRESETS.free, powerUps: true, coinRain: true, seed });
const bots = new BotManager(world, { target: 18, min: 3, max: 18 }, mulberry32(seed + 1));

let kills = 0;
let virusKills = 0;
let pops = 0;
let splitsByBots = 0;
const origQueueSplit = world.queueSplit.bind(world);
world.queueSplit = (pid: number) => {
  splitsByBots++;
  origQueueSplit(pid);
};

const t0 = performance.now();
const ticks = Math.round((minutes * 60_000) / TICK_MS);
for (let i = 0; i < ticks; i++) {
  const ev = world.tick(TICK_MS);
  pops += ev.pops.length;
  for (const k of ev.kills) {
    kills++;
    if (k.cause === 'virus') virusKills++;
    bots.onDeath(k.victim.id, world.now);
    world.removePlayer(k.victim.id);
    if (k.killer) bots.onKill(k.killer.id);
  }
  bots.update(world.now, 0);
  if (i % Math.round(60_000 / TICK_MS) === 0 || i === ticks - 1) {
    const masses = [...bots.bots.values()].map((b) => Math.round(b.player.totalMass())).sort((a, b) => b - a);
    console.log(
      `t=${(world.now / 1000).toFixed(0).padStart(4)}s bots=${masses.length} top=${masses.slice(0, 5).join(',')} median=${masses[Math.floor(masses.length / 2)]} food=${world.foodCount} viruses=${world.viruses.length} pu=${world.powerUps.length}`,
    );
  }
}
const ms = performance.now() - t0;
console.log(
  `\n${minutes} min simulated in ${(ms / 1000).toFixed(1)}s (${((ms / ticks) * 1000).toFixed(0)}µs/tick) — kills=${kills} (${(kills / minutes).toFixed(1)}/min), virus pops=${pops}, split presses=${splitsByBots}`,
);
