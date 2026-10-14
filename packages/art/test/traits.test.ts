import { describe, expect, it } from 'vitest';
import { passCollection, passTraits, traitKey, SEALED_LOOK } from '../src/index';
import { seededRandom } from '../src/rng';

const SEED_A = 'a3'.repeat(32);
const SEED_B = '5f0c'.repeat(16);
const SUPPLY = 3333;

describe('seededRandom', () => {
  it('is deterministic per seed + salt and in [0,1)', () => {
    const a = seededRandom(SEED_A, 'x');
    const b = seededRandom(SEED_A, 'x');
    const c = seededRandom(SEED_A, 'y');
    const va = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(va);
    expect([c(), c(), c()]).not.toEqual(va);
    for (const v of va) expect(v >= 0 && v < 1).toBe(true);
  });
});

describe('passCollection', () => {
  const col = passCollection(SEED_A, SUPPLY);

  it('same seed same collection', () => {
    expect(passCollection(SEED_A, SUPPLY)).toEqual(col);
  });

  it('different seeds differ', () => {
    const other = passCollection(SEED_B, SUPPLY);
    const same = other.filter((t, i) => traitKey(t) === traitKey(col[i])).length;
    expect(same).toBeLessThan(SUPPLY / 10);
  });

  it('3333 traits are unique', () => {
    expect(col).toHaveLength(SUPPLY);
    expect(new Set(col.map(traitKey)).size).toBe(SUPPLY);
  });

  it('exactly 10 one-of-ones', () => {
    const ones = col.filter((t) => typeof t.special === 'string' && t.special.startsWith('oneOfOne:'));
    expect(ones).toHaveLength(10);
    expect(new Set(ones.map((t) => t.special)).size).toBe(10);
    for (const t of ones) expect(t.rarity).toBe('legendary');
  });

  it('legendary share between 1.5% and 2.5%', () => {
    const leg = col.filter((t) => t.rarity === 'legendary').length / SUPPLY;
    expect(leg).toBeGreaterThanOrEqual(0.015);
    expect(leg).toBeLessThanOrEqual(0.025);
    const rare = col.filter((t) => t.rarity === 'rare').length / SUPPLY;
    expect(rare).toBeGreaterThan(0.16);
    expect(rare).toBeLessThan(0.2);
    // every legendary has a special; commons never do
    for (const t of col) {
      if (t.rarity === 'legendary') expect(t.special).not.toBeNull();
      else expect(t.special).toBeNull();
    }
  });

  it('passTraits(seed, 1) equals passCollection(seed)[0]', () => {
    expect(passTraits(SEED_A, 1, SUPPLY)).toEqual(col[0]);
    expect(passTraits(SEED_A, SUPPLY, SUPPLY)).toEqual(col[SUPPLY - 1]);
    expect(() => passTraits(SEED_A, 0, SUPPLY)).toThrow();
    expect(() => passTraits(SEED_A, SUPPLY + 1, SUPPLY)).toThrow();
  });

  it('offsets are small non-zero misregistrations', () => {
    for (const t of col.slice(0, 200)) {
      const m = Math.hypot(t.offset.dx, t.offset.dy);
      expect(m).toBeGreaterThan(1);
      expect(m).toBeLessThanOrEqual(5);
      expect(t.overprint).not.toBe(t.ink);
    }
  });

  it('exposes a sealed look', () => {
    expect(SEALED_LOOK.body).toMatch(/^#[0-9A-F]{6}$/i);
  });
});
