import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAP_SCALE_DEFAULT, TICK_MS } from '@elymum/shared';
import { describe, expect, it } from 'vitest';
import { BotBrain, huntClaims } from '../src/bots/brain';
import { BotManager } from '../src/bots/manager';
import { BOT_MIX_PRESETS, OLD_BOT_MIX_PRESETS, rollPersonality, type Personality } from '../src/bots/personality';
import { BOT_SETTINGS_FILE, BotSettingsError, BotSettingsStore, DEFAULT_BOT_STRENGTH, DEFAULT_MAX_CHASERS, applyBotSettings, defaultBotSettings, upgradeSavedBotSettings } from '../src/bots/settings';
import { loadConfig } from '../src/config';
import type { Player } from '../src/game/entities';
import { mulberry32 } from '../src/game/rng';
import { World, type WorldConfig } from '../src/game/world';

/** A hard hunter with no randomness in the way (the people-specific holding back stays on). */
const hunter: Personality = {
  ...rollPersonality(mulberry32(1), { easy: 0, medium: 0, hard: 100 }),
  style: 'hunter',
  aggression: 1.4,
  greed: 0.6,
  splitBravery: 1,
  aimNoise: 0,
  distraction: 0,
  mistakeRate: 0,
  lapseRate: 0,
  thinkMs: 100,
};

const emptyCfg = (over: Partial<WorldConfig> = {}): WorldConfig => ({
  width: 4000,
  height: 4000,
  foodTarget: 0,
  virusTarget: 0,
  maxPowerUps: 0,
  powerUps: false,
  coinRain: false,
  seed: 3,
  ...over,
});

interface Driven {
  player: Player;
  brain: BotBrain;
}

/** Ticks the world with every brain thinking on its own clock; `each` runs after every tick. */
function drive(world: World, bots: Driven[], ms: number, each?: () => void, onSplit?: (b: Driven) => void) {
  for (let i = 0; i < Math.ceil(ms / TICK_MS); i++) {
    for (const b of bots) {
      if (!b.player.alive || !b.brain.shouldThink(world.now)) continue;
      const d = b.brain.think(world, b.player, world.now);
      if (!d) continue;
      world.setTarget(b.player.id, d.target.x, d.target.y);
      if (d.split) {
        world.queueSplit(b.player.id);
        onSplit?.(b);
      }
    }
    world.tick(TICK_MS);
    each?.();
  }
}

function bot(world: World, x: number, y: number, mass: number, p: Personality, seed: number, maxChasers = Infinity): Driven {
  const player = world.addPlayer({ spawnShield: false, name: `bot${seed}`, skin: 0, x, y, mass, isBot: true });
  const brain = new BotBrain(p, mulberry32(seed));
  brain.pid = player.id;
  brain.maxChasers = maxChasers;
  return { player, brain };
}

function veteran(world: World, x: number, y: number, mass: number): Player {
  const p = world.addPlayer({ spawnShield: false, name: 'human', skin: 2, x, y, mass });
  p.stats.joinedAt = -60_000;
  return p;
}

describe('bots are fair to people (2026-11 playtest)', () => {
  it('never more than the room limit chase one person at once (1 in rookie rooms, 2 in arenas)', () => {
    for (const limit of [1, 2]) {
      const world = new World(emptyCfg());
      const human = veteran(world, 2000, 2000, 40);
      const bots = [bot(world, 1500, 2000, 500, hunter, 11, limit), bot(world, 2500, 2000, 500, hunter, 12, limit), bot(world, 2000, 1500, 500, hunter, 13, limit), bot(world, 2000, 2500, 500, hunter, 14, limit)];
      // the person runs for a corner
      world.setTarget(human.id, 3900, 3900);
      let most = 0;
      let seen = 0;
      drive(world, bots, 3000, () => {
        if (!human.alive) return;
        const n = bots.filter((b) => b.brain.chasing === human.id).length;
        most = Math.max(most, n);
        if (n > 0) seen++;
        // the seats agree with the brains
        expect(huntClaims(world).count(human.id, world.now)).toBeLessThanOrEqual(limit);
      });
      expect(seen).toBeGreaterThan(0);
      expect(most).toBeLessThanOrEqual(limit);
    }
  });

  it('a person spotted a moment ago is not chased before the reaction delay', () => {
    const world = new World(emptyCfg());
    const b = bot(world, 1000, 1000, 400, { ...hunter, reactionMs: 400 }, 21);
    const human = veteran(world, 1400, 1000, 40);
    world.setTarget(human.id, 1400, 1000);
    b.brain.think(world, b.player, world.now);
    expect(b.brain.chasing).toBe(-1);
    drive(world, [b], 300);
    expect(b.brain.chasing).toBe(-1);
    drive(world, [b], 300);
    expect(b.brain.chasing).toBe(human.id);
  });

  it('gives up chasing a person after its chase time (sooner by a wall), and leaves them alone a while', () => {
    const world = new World(emptyCfg({ width: 8000, height: 2000 }));
    const b = bot(world, 600, 1000, 300, { ...hunter, chaseMs: 1500, splitBravery: 0 }, 31);
    const human = veteran(world, 1000, 1000, 60);
    let first = -1;
    let gaveUp = -1;
    let back = false;
    drive(world, [b], 9000, () => {
      // the person keeps running along the middle line
      const c = human.center();
      world.setTarget(human.id, c.x + 500, 1000);
      if (b.brain.chasing === human.id && first < 0) first = world.now;
      else if (first >= 0 && gaveUp < 0 && b.brain.chasing !== human.id) gaveUp = world.now;
      else if (gaveUp >= 0 && world.now - gaveUp < 6000 && b.brain.chasing === human.id) back = true;
    });
    expect(first).toBeGreaterThanOrEqual(0);
    expect(gaveUp).toBeGreaterThan(first);
    expect(gaveUp - first).toBeLessThanOrEqual(1500 + 400);
    expect(back).toBe(false);
  });

  it('no double split on a person, and no second split attack on people within the cooldown', () => {
    // just beyond one split: a bot would double-split another bot here (see bots.test.ts)
    const world = new World(emptyCfg());
    const b = bot(world, 900, 1500, 900, { ...hunter, reactionMs: 0 }, 41);
    const human = veteran(world, 900 + 650, 1500, 60);
    world.setTarget(human.id, 900 + 650, 1500);
    const at: number[] = [];
    drive(world, [b], 2500, undefined, () => at.push(world.now));
    // (it may close in and split once; never a second split right behind the first)
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThan(1000);
    expect(at.length).toBeLessThanOrEqual(1);

    // within one split: at most one attack in the cooldown, whatever the bravery
    const w2 = new World(emptyCfg());
    const b2 = bot(w2, 1000, 1000, 800, { ...hunter, reactionMs: 0, humanSplit: 10, humanSplitCooldownMs: 30_000 }, 42);
    const people = [veteran(w2, 1290, 1000, 60), veteran(w2, 1000, 1300, 60), veteran(w2, 700, 1000, 60)];
    for (const p of people) w2.setTarget(p.id, p.center().x, p.center().y);
    let attacks = 0;
    drive(w2, [b2], 6000, undefined, () => attacks++);
    expect(attacks).toBe(1);
  });

  it('room strength and the chaser limit reach every bot, live', () => {
    const world = new World(emptyCfg());
    const m = new BotManager(world, { target: 4, min: 4, max: 4, strength: 60, maxChasers: 1 }, mulberry32(5));
    m.update(0, 0);
    expect(m.bots.size).toBe(4);
    for (const b of m.bots.values()) {
      expect(b.brain.strength).toBeCloseTo(0.6);
      expect(b.brain.maxChasers).toBe(1);
      expect(b.brain.pid).toBe(b.player.id);
    }
    m.setOptions({ target: 4, min: 4, max: 4, strength: 150 }, 0);
    for (const b of m.bots.values()) {
      expect(b.brain.strength).toBeCloseTo(1.5);
      expect(b.brain.maxChasers).toBe(Infinity);
    }
  });
});

describe('bot strength settings and the upgrade of old saved defaults', () => {
  const base = defaultBotSettings(loadConfig({}).bots);

  it('defaults per room kind, validated admin fields, passed to the rooms', () => {
    for (const k of ['practiceRookie', 'practicePro', 'arena', 'private'] as const) {
      expect(base.kinds[k].strength).toBe(DEFAULT_BOT_STRENGTH[k]);
      expect(base.kinds[k].maxChasers).toBe(DEFAULT_MAX_CHASERS[k]);
    }
    expect(DEFAULT_MAX_CHASERS).toEqual({ practiceRookie: 1, practicePro: 2, arena: 2, private: 1 });
    const next = applyBotSettings(base, { kinds: { arena: { strength: 70, maxChasers: 0 } } });
    expect(next.kinds.arena).toMatchObject({ strength: 70, maxChasers: 0 });
    const store = new BotSettingsStore(null, next);
    expect(store.options('arena').strength).toBe(70);
    expect(store.options('arena').maxChasers).toBeUndefined();
    expect(store.options('practiceRookie').maxChasers).toBe(1);
    for (const body of [{ strength: 10 }, { strength: 300 }, { strength: 1.5 }, { maxChasers: -1 }, { maxChasers: 99 }]) {
      expect(() => applyBotSettings(base, { kinds: { arena: body } })).toThrow(BotSettingsError);
    }
  });

  it('a saved file with the old defaults gets the new ones; values the admin chose stay', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-bots-'));
    mkdirSync(join(dir, 'site'), { recursive: true });
    const saved = structuredClone(base) as unknown as Record<string, any>;
    saved.kinds.practiceRookie.mix = { ...OLD_BOT_MIX_PRESETS.rookie };
    saved.kinds.practicePro.mix = { ...OLD_BOT_MIX_PRESETS.standard };
    saved.kinds.arena.mix = { easy: 20, medium: 40, hard: 40 };
    // written before strength and chasers existed
    for (const k of Object.values(saved.kinds) as Record<string, unknown>[]) {
      delete k.strength;
      delete k.maxChasers;
    }
    saved.maps.practiceRookie = { auto: true, perPlayer: 900, min: 3000, max: 9000 };
    saved.maps.arena = { auto: false, perPlayer: 900, min: 3000, max: 9000 };
    saved.maps.private = { auto: true, perPlayer: 800, min: 3000, max: 9000 };
    writeFileSync(join(dir, BOT_SETTINGS_FILE), JSON.stringify(saved));
    const logs: string[] = [];
    const store = new BotSettingsStore(dir, base, (m) => logs.push(m));
    const s = store.settings;
    expect(s.kinds.practiceRookie.mix).toEqual(BOT_MIX_PRESETS.rookie);
    expect(s.kinds.practicePro.mix).toEqual(BOT_MIX_PRESETS.standard);
    expect(s.kinds.arena.mix).toEqual({ easy: 20, medium: 40, hard: 40 });
    expect(s.kinds.arena).toMatchObject({ strength: 100, maxChasers: 2 });
    expect(s.maps.practiceRookie).toEqual(MAP_SCALE_DEFAULT);
    // auto off is the admin's choice: kept, with the new curve
    expect(s.maps.arena).toEqual({ ...MAP_SCALE_DEFAULT, auto: false });
    expect(s.maps.private).toEqual({ auto: true, perPlayer: 800, min: 3000, max: 9000 });
    expect(logs.join('\n')).toMatch(/upgraded/);
    // the upgrade is idempotent on new values
    expect(upgradeSavedBotSettings(structuredClone(s) as unknown as Record<string, unknown>)).toEqual([]);
  });
});
