/**
 * Measures how long a *stationary* fresh human survives in a busy bot room.
 *   pnpm -F @slana/server exec tsx scripts/newbie.ts [trials=30]
 */
import { TICK_MS, WORLD_PRESETS } from '@slana/shared';
import { BotManager } from '../src/bots/manager';
import { mulberry32 } from '../src/game/rng';
import { World } from '../src/game/world';

const trials = Number(process.argv[2] ?? 30);
const world = new World({ ...WORLD_PRESETS.practice, powerUps: true, coinRain: true, seed: 5 });
const bots = new BotManager(world, { target: 18, min: 3, max: 18 }, mulberry32(6));

const step = () => {
  const ev = world.tick(TICK_MS);
  let died: number | null = null;
  for (const k of ev.kills) {
    if (bots.isBot(k.victim.id)) bots.onDeath(k.victim.id, world.now);
    else died = k.victim.id;
    world.removePlayer(k.victim.id);
    if (k.killer) bots.onKill(k.killer.id);
  }
  bots.update(world.now, 1);
  return died;
};

// warm up so bots have grown
for (let i = 0; i < 120_000 / TICK_MS; i++) step();

const results: number[] = [];
for (let t = 0; t < trials; t++) {
  const p = world.addPlayer({ name: `newbie${t}`, skin: 0 });
  const start = world.now;
  let alive = true;
  while (alive && world.now - start < 60_000) {
    const c = p.center();
    world.setTarget(p.id, c.x, c.y); // stand still
    if (step() === p.id) alive = false;
  }
  if (alive) world.removePlayer(p.id);
  results.push((world.now - start) / 1000);
}
results.sort((a, b) => a - b);
const median = results[Math.floor(results.length / 2)];
const survived = results.filter((r) => r >= 60).length;
console.log(`stationary newbie survival over ${trials} trials: median ${median.toFixed(1)}s, p25 ${results[Math.floor(trials / 4)].toFixed(1)}s, survived 60s: ${survived}/${trials}`);
