import { describe, expect, it } from 'vitest';
import { CAPACITY, RULES, WORLD_PRESETS, type League, type RoomMode } from '../src';

describe('v2 economy constants', () => {
  it('adds the loot rules (no Pass rules: Slana Simple)', () => {
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
    expect(WORLD_PRESETS.arena).toEqual({ width: 6400, height: 6400, foodTarget: 1500, virusTarget: 28, maxPowerUps: 4 });
    // the old free room, renamed
    expect(WORLD_PRESETS.practice).toEqual({ width: 5600, height: 5600, foodTarget: 1100, virusTarget: 22, maxPowerUps: 3 });
    expect(WORLD_PRESETS.private).toEqual({ width: 4600, height: 4600, foodTarget: 800, virusTarget: 16, maxPowerUps: 2 });
    expect(CAPACITY).toEqual({ practice: 40, private: 20, arena: 50 });
  });

  it('types the practice leagues (checked by tsc)', () => {
    const leagues: League[] = ['rookie', 'pro'];
    // @ts-expect-error only rookie and pro exist
    const bad: League = 'veteran';
    expect([leagues, bad]).toHaveLength(2);
  });
});
