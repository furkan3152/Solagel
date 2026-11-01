import { describe, expect, it } from 'vitest';
import { CAPACITY, RULES, WORLD_PRESETS, type League, type RoomMode } from '../src';

describe('v2 economy constants', () => {
  it('adds the loot rules (no Pass rules)', () => {
    expect('passStartMassMul' in RULES).toBe(false);
    expect('passCashoutMs' in RULES).toBe(false);
    expect(RULES).toMatchObject({
      lootPiecesMin: 3,
      lootPiecesMax: 24,
      lootPieceEntryFraction: 0.25,
      lootSpeed: 520,
      lootFrictionPerSec: 0.08,
      lootRadius: 14,
    });
  });

  it('keeps the v1 rules the simulation depends on', () => {
    expect(RULES.startMass).toBe(20);
    expect(RULES.cashoutMs).toBe(3000);
    expect(RULES.afkGraceMs).toBe(45_000);
    expect(RULES.lootPiecesMin).toBeLessThanOrEqual(RULES.lootPiecesMax);
  });

  it('has one world preset and one capacity per room mode', () => {
    const modes: RoomMode[] = ['practice', 'private', 'arena'];
    expect(Object.keys(WORLD_PRESETS).sort()).toEqual([...modes].sort());
    expect(Object.keys(CAPACITY).sort()).toEqual([...modes].sort());
  });

  it('sizes the worlds', () => {
    expect(WORLD_PRESETS.arena).toEqual({ width: 7800, height: 7800, foodTarget: 2230, virusTarget: 18, maxPowerUps: 4 });
    // the old free room, renamed
    expect(WORLD_PRESETS.practice).toEqual({ width: 6800, height: 6800, foodTarget: 1620, virusTarget: 14, maxPowerUps: 3 });
    expect(WORLD_PRESETS.private).toEqual({ width: 4600, height: 4600, foodTarget: 800, virusTarget: 10, maxPowerUps: 2 });
    expect(CAPACITY).toEqual({ practice: 40, private: 20, arena: 50 });
  });

  it('grew the pond and the arena maps at the same food density, with sparse thorn bushes', () => {
    const before = { practice: { side: 5600, food: 1100 }, arena: { side: 6400, food: 1500 } };
    for (const mode of ['practice', 'arena'] as const) {
      const p = WORLD_PRESETS[mode];
      const was = before[mode];
      expect(p.width / was.side).toBeGreaterThan(1.2);
      expect(p.width / was.side).toBeLessThan(1.3);
      const density = p.foodTarget / (p.width * p.height);
      expect(Math.abs(density / (was.food / (was.side * was.side)) - 1)).toBeLessThan(0.01);
      // well under the old ~0.7 bushes per million square units
      expect(p.virusTarget / ((p.width * p.height) / 1e6)).toBeLessThan(0.35);
    }
  });

  it('types the practice leagues (checked by tsc)', () => {
    const leagues: League[] = ['rookie', 'pro'];
    // @ts-expect-error only rookie and pro exist
    const bad: League = 'veteran';
    expect([leagues, bad]).toHaveLength(2);
  });
});
