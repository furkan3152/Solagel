import { describe, expect, it } from 'vitest';
import {
  canEat,
  coversVictim,
  formatSol,
  levelFromXp,
  massToRadius,
  parseJoinTarget,
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

  it('parses join targets', () => {
    expect(parseJoinTarget('free')).toEqual({ mode: 'free' });
    expect(parseJoinTarget('private:new')).toEqual({ mode: 'private', code: null });
    expect(parseJoinTarget('private:ab12c')).toEqual({ mode: 'private', code: 'AB12C' });
    expect(parseJoinTarget('private:toolong')).toBeNull();
    expect(parseJoinTarget('stake:3')).toEqual({ mode: 'stake', arenaId: 3 });
    expect(parseJoinTarget('stake:-1')).toBeNull();
    expect(parseJoinTarget('stake:x')).toBeNull();
    expect(parseJoinTarget('nope')).toBeNull();
  });
});
