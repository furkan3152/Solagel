import { RULES, TICK_MS, WORLD_PRESETS, massToRadius, speedForRadius } from '@elymum/shared';
import { describe, expect, it } from 'vitest';
import { BotManager } from '../src/bots/manager';
import { BotSettingsStore, ROOKIE_BOT_MASS_CAP, defaultBotSettings } from '../src/bots/settings';
import { loadConfig } from '../src/config';
import { mulberry32 } from '../src/game/rng';
import { World, type WorldConfig } from '../src/game/world';

const cfg = (over: Partial<WorldConfig> = {}): WorldConfig => ({
  width: 6800,
  height: 6800,
  foodTarget: 0,
  virusTarget: 0,
  maxPowerUps: 0,
  powerUps: false,
  coinRain: false,
  seed: 21,
  ...over,
});

/** Runs a bots-only room the way `Room.tick` does (deaths reported, bots updated every tick). */
function runRoom(world: World, bots: BotManager, ms: number, each?: () => void): void {
  for (let i = 0; i < ms / TICK_MS; i++) {
    const ev = world.tick(TICK_MS);
    for (const k of ev.kills) {
      bots.onDeath(k.victim.id, world.now);
      world.removePlayer(k.victim.id);
    }
    bots.update(world.now, 0);
    each?.();
  }
}

describe('playtest tuning: rookie pond bots', () => {
  it('the rookie league caps bot mass; the pro league does not', () => {
    const store = new BotSettingsStore(null, defaultBotSettings(loadConfig({}).bots));
    expect(store.options('practiceRookie').massCap).toBe(ROOKIE_BOT_MASS_CAP);
    expect(store.options('practicePro').massCap).toBeUndefined();
    expect(store.options('arena').massCap).toBeUndefined();
    expect(store.options('private').massCap).toBeUndefined();
    // a cap a few times the start size: about 4x the start radius
    expect(massToRadius(ROOKIE_BOT_MASS_CAP) / massToRadius(RULES.startMass)).toBeLessThan(4.5);
  });

  it('rookie bots never spawn above the cap and shed what they eat past it within seconds', () => {
    const world = new World({ ...WORLD_PRESETS.practice, powerUps: true, coinRain: true, seed: 31 });
    const bots = new BotManager(world, { target: 12, min: 4, max: 12, mix: 'rookie', massCap: ROOKIE_BOT_MASS_CAP }, mulberry32(32));
    const over = new Map<number, number>();
    let longestOver = 0;
    let heaviest = 0;
    let first = true;
    runRoom(world, bots, 180_000, () => {
      for (const b of bots.bots.values()) {
        const m = b.player.totalMass();
        if (first) expect(m).toBeLessThanOrEqual(ROOKIE_BOT_MASS_CAP);
        heaviest = Math.max(heaviest, m);
        const t = m > ROOKIE_BOT_MASS_CAP * 1.05 ? (over.get(b.player.id) ?? 0) + TICK_MS : 0;
        over.set(b.player.id, t);
        longestOver = Math.max(longestOver, t);
      }
      first = false;
    });
    expect(bots.bots.size).toBeGreaterThan(0);
    // bots do reach the cap (they still play), but never stay much above it
    expect(heaviest).toBeGreaterThan(ROOKIE_BOT_MASS_CAP * 0.9);
    expect(longestOver).toBeLessThan(3000);
  });

  it('shedMass keeps the shape (every cell in proportion) and only touches the excess', () => {
    const world = new World(cfg());
    const p = world.addPlayer({ name: 'b', skin: 0, x: 1000, y: 1000, mass: 600, spawnShield: false });
    world.splitPlayer(p);
    expect(p.cells).toHaveLength(2);
    world.shedMass(p, 300, 0.5);
    expect(p.totalMass()).toBeCloseTo(450, 6);
    expect(p.cells[0].mass).toBeCloseTo(p.cells[1].mass, 6);
    world.shedMass(p, 1000, 0.5);
    expect(p.totalMass()).toBeCloseTo(450, 6);
  });
});

describe('playtest tuning: spawns and thorn bushes', () => {
  it('the spawn shield lasts 5-6 s', () => {
    expect(RULES.spawnShieldMs).toBeGreaterThanOrEqual(5000);
    expect(RULES.spawnShieldMs).toBeLessThanOrEqual(6000);
    const world = new World(cfg());
    const p = world.addPlayer({ name: 'n', skin: 0 });
    expect(p.shieldUntil - world.now).toBe(RULES.spawnShieldMs);
  });

  it('newcomers spawn clearly away from big cells (out of their split lunge and shield-time reach)', () => {
    const world = new World(cfg({ seed: 5 }));
    // two whales and a few mid-size cells
    const whales = [
      world.addPlayer({ name: 'w1', skin: 0, x: 2400, y: 2400, mass: 6000, spawnShield: false }),
      world.addPlayer({ name: 'w2', skin: 0, x: 4600, y: 4300, mass: 3000, spawnShield: false }),
    ];
    for (let i = 0; i < 6; i++) world.addPlayer({ name: `m${i}`, skin: 0, x: 900 + i * 900, y: 5800, mass: 250, spawnShield: false });
    const r = massToRadius(RULES.startMass);
    for (let i = 0; i < 40; i++) {
      const spot = world.findSpawnSpot(r);
      for (const w of whales) {
        const c = w.cells[0];
        const gap = Math.hypot(c.x - spot.x, c.y - spot.y) - c.r - r;
        // the split lunge (~390) plus half the shield time at its speed
        expect(gap).toBeGreaterThan(390 + speedForRadius(c.r) * (RULES.spawnShieldMs / 1000) * 0.5);
      }
    }
  });

  it('spawn spots keep room around thorn bushes, and bushes never grow next to a cell', () => {
    const world = new World(cfg({ virusTarget: WORLD_PRESETS.practice.virusTarget, seed: 8 }));
    const r = massToRadius(RULES.startMass);
    for (let i = 0; i < 30; i++) {
      const spot = world.findSpawnSpot(r);
      for (const v of world.viruses) expect(Math.hypot(v.x - spot.x, v.y - spot.y)).toBeGreaterThan(v.r + r + 200);
      world.addPlayer({ name: `p${i}`, skin: 0, x: spot.x, y: spot.y });
    }
    // bushes that grow back keep away from every cell
    for (let i = 0; i < 40; i++) {
      const v = world.spawnVirus();
      if (!v) continue;
      for (const c of world.cells) expect(Math.hypot(c.x - v.x, c.y - v.y)).toBeGreaterThan(c.r + v.r + 150);
    }
  });

  it('eaten thorn bushes grow back one every 4 s (was 1.5 s)', () => {
    const world = new World(cfg({ virusTarget: 3, seed: 4 }));
    const [v1, v2] = world.viruses;
    for (const v of [v1, v2]) {
      const p = world.addPlayer({ name: 'big', skin: 0, x: v.x, y: v.y, mass: 400, spawnShield: false });
      world.setTarget(p.id, v.x, v.y);
    }
    world.tick(TICK_MS);
    // both eaten; one grows back at once (nothing grew for a while), the other waits
    expect(world.viruses).toHaveLength(2);
    for (let i = 0; i < 3500 / TICK_MS; i++) world.tick(TICK_MS);
    expect(world.viruses).toHaveLength(2);
    for (let i = 0; i < 1000 / TICK_MS; i++) world.tick(TICK_MS);
    expect(world.viruses).toHaveLength(3);
  });
});
