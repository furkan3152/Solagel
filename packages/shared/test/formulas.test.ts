import { describe, expect, it } from 'vitest';
import {
  RULES,
  canEat,
  clamp,
  coversVictim,
  formatSol,
  levelFromXp,
  lootTier,
  massToRadius,
  radiusToMass,
  speedForRadius,
  viewSize,
  xpForGame,
  xpForLevel,
} from '../src';

describe('formulas', () => {
  it('maps mass to radius and back', () => {
    expect(massToRadius(100)).toBe(100);
    expect(massToRadius(0)).toBe(0);
    expect(radiusToMass(massToRadius(1234))).toBeCloseTo(1234, 6);
  });

  it('levels mirror the on-chain formula', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(49)).toBe(1);
    expect(levelFromXp(50)).toBe(2);
    expect(levelFromXp(199)).toBe(2);
    expect(levelFromXp(200)).toBe(3);
    expect(levelFromXp(18050)).toBe(20);
    expect(levelFromXp(18049)).toBe(19);
    for (let l = 1; l <= 40; l++) expect(levelFromXp(xpForLevel(l))).toBe(l);
  });

  it('big cells are slower', () => {
    let prev = Infinity;
    for (let r = 10; r < 2000; r += 37) {
      const s = speedForRadius(r);
      expect(s).toBeLessThan(prev);
      prev = s;
    }
  });

  it('eat rules', () => {
    expect(canEat(125, 100)).toBe(true);
    expect(canEat(124.9, 100)).toBe(false);
    expect(coversVictim(100, 50, 79)).toBe(true);
    expect(coversVictim(100, 50, 80)).toBe(false);
  });

  it('view grows with mass and respects aspect', () => {
    const small = viewSize(20, 16 / 9);
    const big = viewSize(5000, 16 / 9);
    expect(big.h).toBeGreaterThan(small.h);
    expect(small.w / small.h).toBeCloseTo(16 / 9, 5);
    const portrait = viewSize(20, 0.5);
    expect(portrait.w).toBeCloseTo(small.h, 5);
    expect(portrait.h).toBeCloseTo(small.h * 2, 5);
    expect(viewSize(1e9, 1).h).toBeLessThanOrEqual(5200);
    expect(Number.isFinite(viewSize(20, Number.NaN).w)).toBe(true);
  });

  it('xp per game is clamped', () => {
    expect(xpForGame(0, 0, 0)).toBe(1);
    expect(xpForGame(1_000_000, 100, 1e9)).toBe(2000);
  });

  it('formats SOL compactly', () => {
    expect(formatSol(153_000_000)).toBe('◎0.153');
    expect(formatSol(1_200_000_000)).toBe('◎1.2');
    expect(formatSol(10_000_000_000)).toBe('◎10');
    expect(formatSol(100_000_000_000)).toBe('◎100');
    expect(formatSol(0)).toBe('◎0');
  });

  it('sizes loot pieces by their value relative to the entry fee', () => {
    const fee = 1_000_000_000; // 1 000 tokens
    const piece = fee * RULES.lootPieceEntryFraction; // a full ticket spills 4 of these
    expect(lootTier(piece, fee)).toBe(1);
    expect(lootTier(0, fee)).toBe(0);
    expect(lootTier(piece * 0.49, fee)).toBe(0);
    expect(lootTier(piece * 0.5, fee)).toBe(1);
    expect(lootTier(piece * 1.49, fee)).toBe(1);
    expect(lootTier(piece * 1.5, fee)).toBe(2);
    expect(lootTier(piece * 3.99, fee)).toBe(2);
    expect(lootTier(fee, fee)).toBe(3); // a piece worth a whole ticket
    expect(lootTier(fee * 50, fee)).toBe(3);
  });

  it('keeps loot tiers monotonic and inside 0..3, even for odd inputs', () => {
    let prev = 0;
    for (let v = 0; v <= 2_000_000_000; v += 1_000_000) {
      const tier = lootTier(v, 1_000_000_000);
      expect(tier).toBeGreaterThanOrEqual(prev);
      expect(tier).toBeLessThanOrEqual(3);
      prev = tier;
    }
    expect(lootTier(5, 0)).toBe(0);
    expect(lootTier(5, -10)).toBe(0);
    expect(lootTier(-5, 100)).toBe(0);
    expect(lootTier(Number.NaN, 100)).toBe(0);
    expect(lootTier(5, Number.NaN)).toBe(0);
  });

  it('a spilled full ticket is made of normal pieces; a rich victim spills bigger ones', () => {
    const fee = 1_000_000_000;
    const pieces = (v: number) => clamp(Math.ceil(v / (fee * RULES.lootPieceEntryFraction)), RULES.lootPiecesMin, RULES.lootPiecesMax);
    expect(pieces(fee)).toBe(4);
    expect(lootTier(fee / pieces(fee), fee)).toBe(1);
    expect(pieces(100)).toBe(RULES.lootPiecesMin);
    expect(pieces(fee * 1000)).toBe(RULES.lootPiecesMax);
    expect(lootTier((fee * 10) / pieces(fee * 10), fee)).toBe(2);
    expect(lootTier((fee * 30) / pieces(fee * 30), fee)).toBe(3);
  });
});
