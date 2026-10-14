import { TICK_MS, WORLD_PRESETS } from '@slana/shared';
import { describe, expect, it } from 'vitest';
import { BotBrain } from '../src/bots/brain';
import { BotManager } from '../src/bots/manager';
import { rollPersonality, type Personality } from '../src/bots/personality';
import { loadConfig } from '../src/config';
import type { Player } from '../src/game/entities';
import { mulberry32 } from '../src/game/rng';
import { World, type WorldConfig } from '../src/game/world';

const hard: Personality = {
  style: 'hunter',
  skill: 2,
  aggression: 1.4,
  greed: 1,
  caution: 1.1,
  splitBravery: 1,
  thinkMs: 100,
  aimNoise: 0.02,
  perception: 1.05,
  distraction: 0,
  virusAware: true,
  leadsTargets: true,
  virusShooter: true,
};

const emptyCfg = (over: Partial<WorldConfig> = {}): WorldConfig => ({
  width: 3000,
  height: 3000,
  foodTarget: 0,
  virusTarget: 0,
  maxPowerUps: 0,
  powerUps: false,
  coinRain: false,
  seed: 3,
  ...over,
});

/** Drives a single brain-controlled player for `ms`. */
function drive(world: World, brain: BotBrain, bot: Player, ms: number, onDecision?: (split: boolean) => void) {
  const ticks = Math.ceil(ms / TICK_MS);
  for (let i = 0; i < ticks; i++) {
    if (bot.alive && brain.shouldThink(world.now)) {
      const d = brain.think(world, bot, world.now);
      if (d) {
        world.setTarget(bot.id, d.target.x, d.target.y);
        if (d.split) world.queueSplit(bot.id);
        if (d.eject) world.queueEject(bot.id);
        onDecision?.(d.split);
      }
    }
    world.tick(TICK_MS);
  }
}

describe('bots', () => {
  it('flees from a much bigger threat', () => {
    const world = new World(emptyCfg());
    const bot = world.addPlayer({ spawnShield: false, name: 'bot', skin: 0, x: 1500, y: 1500, mass: 100 });
    const threat = world.addPlayer({ spawnShield: false, name: 'whale', skin: 1, x: 1880, y: 1500, mass: 900 });
    world.setTarget(threat.id, 1880, 1500);
    const brain = new BotBrain(hard, mulberry32(1));
    const before = Math.hypot(bot.cells[0].x - 1880, bot.cells[0].y - 1500);
    drive(world, brain, bot, 1000);
    expect(bot.alive).toBe(true);
    const after = Math.hypot(bot.center().x - 1880, bot.center().y - 1500);
    expect(after).toBeGreaterThan(before + 150);
    expect(brain.lastDanger).toBeGreaterThan(0);
  });

  it('split-kills reachable prey', () => {
    const world = new World(emptyCfg());
    const bot = world.addPlayer({ spawnShield: false, name: 'bot', skin: 0, x: 1000, y: 1000, mass: 400 });
    const prey = world.addPlayer({ spawnShield: false, name: 'snack', skin: 2, x: 1290, y: 1000, mass: 60 });
    prey.stats.joinedAt = -60_000; // a veteran, not a fresh spawn
    world.setTarget(prey.id, 1290, 1000);
    const brain = new BotBrain(hard, mulberry32(2));
    let splits = 0;
    drive(world, brain, bot, 2000, (s) => {
      if (s) splits++;
    });
    expect(splits).toBeGreaterThan(0);
    expect(prey.alive).toBe(false);
  });

  it('never split-attacks a human who just joined', () => {
    const world = new World(emptyCfg());
    const bot = world.addPlayer({ spawnShield: false, name: 'bot', skin: 0, x: 1000, y: 1000, mass: 400 });
    const newbie = world.addPlayer({ spawnShield: false, name: 'newbie', skin: 2, x: 1290, y: 1000, mass: 60 });
    world.setTarget(newbie.id, 1290, 1000);
    const brain = new BotBrain(hard, mulberry32(2));
    let splits = 0;
    drive(world, brain, bot, 1500, (s) => {
      if (s) splits++;
    });
    expect(splits).toBe(0);
  });

  it('does not split into prey guarded by a bigger player', () => {
    const world = new World(emptyCfg());
    const bot = world.addPlayer({ spawnShield: false, name: 'bot', skin: 0, x: 1000, y: 1000, mass: 400 });
    const prey = world.addPlayer({ spawnShield: false, name: 'snack', skin: 2, x: 1290, y: 1000, mass: 60 });
    const guard = world.addPlayer({ spawnShield: false, name: 'guard', skin: 3, x: 1600, y: 1000, mass: 380 });
    world.setTarget(prey.id, 1290, 1000);
    world.setTarget(guard.id, 1600, 1000);
    const brain = new BotBrain(hard, mulberry32(5));
    let splits = 0;
    drive(world, brain, bot, 600, (s) => {
      if (s) splits++;
    });
    expect(splits).toBe(0);
  });

  it('avoids getting stuck in corners', () => {
    const world = new World(emptyCfg());
    const bot = world.addPlayer({ spawnShield: false, name: 'bot', skin: 0, x: 40, y: 40, mass: 50 });
    const brain = new BotBrain({ ...hard, skill: 0, aimNoise: 0.3 }, mulberry32(9));
    drive(world, brain, bot, 3000);
    const c = bot.center();
    expect(Math.max(c.x, c.y)).toBeGreaterThan(250);
  });

  it('headless 2-minute room: stable population, finite state, bots grow', () => {
    const world = new World({ ...WORLD_PRESETS.practice, powerUps: true, coinRain: true, seed: 11 });
    const rng = mulberry32(12);
    const manager = new BotManager(world, { target: 18, min: 3, max: 18 }, rng);
    let maxSeen = 0;
    let kills = 0;
    for (let i = 0; i < (120_000 / TICK_MS); i++) {
      const events = world.tick(TICK_MS);
      for (const k of events.kills) {
        kills++;
        manager.onDeath(k.victim.id, world.now);
        world.removePlayer(k.victim.id);
        if (k.killer) manager.onKill(k.killer.id);
      }
      manager.update(world.now, 0);
      maxSeen = Math.max(maxSeen, manager.bots.size);
      if (i % 300 === 0) {
        for (const c of world.cells) {
          expect(Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.mass)).toBe(true);
          expect(c.x).toBeGreaterThanOrEqual(0);
          expect(c.x).toBeLessThanOrEqual(world.cfg.width);
        }
      }
    }
    expect(maxSeen).toBeLessThanOrEqual(18);
    expect(manager.bots.size).toBeGreaterThanOrEqual(12);
    const masses = [...manager.bots.values()].map((b) => b.player.totalMass());
    const avg = masses.reduce((a, b) => a + b, 0) / masses.length;
    expect(avg).toBeGreaterThan(60);
    expect(kills).toBeGreaterThan(0);
  }, 60_000);

  it('bots make room for humans', () => {
    const world = new World({ ...WORLD_PRESETS.practice, powerUps: false, coinRain: false, seed: 4 });
    const manager = new BotManager(world, { target: 18, min: 3, max: 18 }, mulberry32(4));
    manager.update(0, 0);
    expect(manager.bots.size).toBe(18);
    for (let t = 0; t < 120_000; t += 1000) {
      world.tick(TICK_MS);
      manager.update(world.now + t, 14);
    }
    expect(manager.bots.size).toBeLessThanOrEqual(5);
    expect(manager.desired(30)).toBe(3);
  });

  it('rookie mix has ≥ 60% easy bots over 200 rolls', () => {
    const rng = mulberry32(77);
    const rookie = Array.from({ length: 200 }, () => rollPersonality(rng, 'rookie'));
    const easy = rookie.filter((p) => p.skill === 0).length;
    expect(easy / 200).toBeGreaterThanOrEqual(0.6);
    expect(rookie.some((p) => p.skill === 2)).toBe(false);
    // the standard mix still has hard bots
    const standard = Array.from({ length: 200 }, () => rollPersonality(rng, 'standard'));
    expect(standard.some((p) => p.skill === 2)).toBe(true);
    expect(standard.filter((p) => p.skill === 0).length / 200).toBeLessThan(0.6);
  });

  it('bots ignore loot', () => {
    const world = new World(emptyCfg());
    const bot = world.addPlayer({ spawnShield: false, name: 'bot', skin: 0, x: 1500, y: 1500, mass: 60, isBot: true });
    // a rich pile of loot to the east, a few plain coins to the west
    const loot = [];
    for (let i = 0; i < 12; i++) loot.push({ x: 1650 + (i % 4) * 30, y: 1460 + Math.floor(i / 4) * 40, value: 1_000_000 });
    world.restoreLoot(loot);
    for (let i = 0; i < 6; i++) world.spawnFood(1300 - i * 25, 1500, 0);
    const brain = new BotBrain({ ...hard, aimNoise: 0 }, mulberry32(3));
    for (let i = 0; i < 20; i++) {
      const d = brain.think(world, bot, world.now + i * 200)!;
      const c = bot.center();
      // never aims at the loot side
      expect(d.target.x).toBeLessThan(c.x);
    }
    expect(world.loot().length).toBe(12);
  });

  it('bot count drops as humans join', () => {
    const cfg = loadConfig({});
    expect(cfg.bots.arena).toEqual({ target: 24, min: 2, max: 16, mix: 'standard' });
    expect(cfg.bots.practiceRookie).toEqual({ target: 20, min: 4, max: 20, mix: 'rookie' });
    expect(cfg.bots.practicePro).toEqual({ target: 20, min: 4, max: 20, mix: 'standard' });
    expect(cfg.bots.private).toEqual({ target: 8, min: 2, max: 8, mix: 'standard' });

    const world = new World({ ...WORLD_PRESETS.arena, powerUps: false, coinRain: false, seed: 8 });
    const manager = new BotManager(world, cfg.bots.arena, mulberry32(8));
    expect([0, 8, 10, 20, 22, 30, 50].map((h) => manager.desired(h))).toEqual([16, 16, 14, 4, 2, 2, 2]);
    manager.update(0, 0);
    expect(manager.bots.size).toBe(16);
    for (let t = 0; t < 120_000; t += 1000) {
      world.tick(TICK_MS);
      manager.update(world.now + t, 20);
    }
    expect(manager.bots.size).toBeLessThanOrEqual(5);
  });

  it('bots wear basic skins only', () => {
    const world = new World(emptyCfg());
    const manager = new BotManager(world, { target: 0, min: 0, max: 0, mix: 'standard' }, mulberry32(21));
    for (let i = 0; i < 300; i++) expect(manager.spawnBot(30).player.skin).toBeLessThan(8);
  });

  it('anticipates a charging threat from beyond its static danger zone', () => {
    const world = new World(emptyCfg({ width: 6000, height: 3000 }));
    const bot = world.addPlayer({ spawnShield: false, name: 'bot', skin: 0, x: 3000, y: 1500, mass: 40 });
    world.setTarget(bot.id, 3000, 1500);
    // a big splitter far to the west, charging straight at the bot
    const whale = world.addPlayer({ spawnShield: false, name: 'whale', skin: 1, x: 1850, y: 1500, mass: 400 });
    world.setTarget(whale.id, 6000, 1500);
    const brain = new BotBrain({ ...hard, caution: 1 }, mulberry32(4));
    brain.think(world, bot, world.now); // first look: no velocity known yet
    expect(brain.lastDanger).toBe(0);
    for (let i = 0; i < 3; i++) world.tick(TICK_MS);
    world.setTarget(bot.id, 3000, 1500);
    brain.think(world, bot, world.now);
    expect(brain.lastDanger).toBeGreaterThan(0);
  });
});
