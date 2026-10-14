import { EntityKind, RULES, TICK_MS } from '@slana/shared';
import { describe, expect, it } from 'vitest';
import { World, type WorldConfig } from '../src/game/world';

const cfg = (over: Partial<WorldConfig> = {}): WorldConfig => ({
  width: 4000,
  height: 4000,
  foodTarget: 0,
  virusTarget: 0,
  maxPowerUps: 0,
  powerUps: false,
  coinRain: false,
  seed: 11,
  ...over,
});

const sum = (w: World) => w.loot().reduce((s, l) => s + l.value, 0);

describe('loot', () => {
  it('spawnLoot pieces sum to total', () => {
    const w = new World(cfg());
    w.spawnLoot(2000, 2000, 1_000_003, 7);
    const items = w.loot();
    expect(items).toHaveLength(7);
    expect(sum(w)).toBe(1_000_003);
    // remainder on the first piece
    expect(items[0].value).toBe(142_857 + 4);
    for (const l of items.slice(1)) expect(l.value).toBe(142_857);
    for (const l of items) expect(Number.isSafeInteger(l.value) && l.value > 0).toBe(true);
    // never more pieces than base units; zero spawns nothing
    w.spawnLoot(100, 100, 2, 5);
    expect(w.loot()).toHaveLength(9);
    w.spawnLoot(100, 100, 0, 5);
    expect(w.loot()).toHaveLength(9);
    expect(sum(w)).toBe(1_000_005);
    // visible as Loot entities
    const kinds: number[] = [];
    w.forEachVisible(1500, 1500, 2500, 2500, (e) => kinds.push(e.kind));
    expect(kinds.filter((k) => k === EntityKind.Loot)).toHaveLength(7);
  });

  it('bots never pick loot', () => {
    const w = new World(cfg());
    const bot = w.addPlayer({ name: 'bot', skin: 1, isBot: true, x: 2000, y: 2000, mass: 400, spawnShield: false });
    w.restoreLoot([{ x: 2000, y: 2000, value: 500 }]);
    for (let i = 0; i < 30; i++) {
      const ev = w.tick(TICK_MS);
      expect(ev.lootPicked).toHaveLength(0);
    }
    expect(bot.alive).toBe(true);
    expect(sum(w)).toBe(500);
  });

  it('humans pick loot and emit lootPicked', () => {
    const w = new World(cfg());
    const me = w.addPlayer({ name: 'me', skin: 1, x: 2000, y: 2000, mass: 100, spawnShield: false });
    w.restoreLoot([
      { x: 2005, y: 2000, value: 300 },
      { x: 3000, y: 3000, value: 9 },
    ]);
    const [near] = w.loot();
    const ev = w.tick(TICK_MS);
    expect(ev.lootPicked).toEqual([{ pid: me.id, lootId: near.id, value: 300 }]);
    expect(w.loot().map((l) => l.value)).toEqual([9]);
    expect(w.removed.get(near.id)).toBe(me.cells[0].id);
    // picking loot does not change mass
    expect(me.totalMass()).toBe(100);
  });

  it('loot slows to rest and stays forever', () => {
    const w = new World(cfg());
    w.spawnLoot(2000, 2000, 24_000, 12);
    const start = w.loot();
    // pieces burst outward
    w.tick(TICK_MS);
    const moved = w.loot();
    for (let i = 0; i < moved.length; i++) {
      const d = Math.hypot(moved[i].x - start[i].x, moved[i].y - start[i].y);
      expect(d).toBeGreaterThan((RULES.lootSpeed * TICK_MS) / 1000 * 0.5);
    }
    for (let i = 0; i < Math.ceil(10_000 / TICK_MS); i++) w.tick(TICK_MS);
    const rest = w.loot();
    for (const l of rest) {
      expect(l.x).toBeGreaterThan(0);
      expect(l.x).toBeLessThan(4000);
      expect(Math.hypot(l.x - 2000, l.y - 2000)).toBeLessThan(RULES.lootSpeed / -Math.log(RULES.lootFrictionPerSec) + 10);
    }
    // at rest: nothing moves any more, and nothing despawns
    for (let i = 0; i < Math.ceil(600_000 / (TICK_MS * 10)); i++) w.tick(TICK_MS * 10);
    expect(w.loot()).toEqual(rest);
    expect(sum(w)).toBe(24_000);
  });
});
