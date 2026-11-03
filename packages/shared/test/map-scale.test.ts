import { describe, expect, it } from 'vitest';
import {
  CUSTOM_MAP_SIZES,
  CUSTOM_MAP_WIDTH,
  FOOD_PER_AREA,
  MAP_SCALE_DEFAULT,
  MAP_SCALE_LIMITS,
  MAP_SPACE,
  MAP_WORLD_CAPS,
  VIRUS_PER_AREA,
  WORLD_PRESETS,
  mapScaleFieldError,
  mapSideFor,
  validateCustomConfig,
  worldForSide,
} from '../src';

describe('adaptive map size curve', () => {
  it('gives the documented sides for 5 / 10 / 25 / 50 / 100 players', () => {
    expect([5, 10, 25, 50, 100].map((n) => mapSideFor(n, MAP_SCALE_DEFAULT))).toEqual([3000, 3000, 4500, 6400, 9000]);
  });

  it('keeps the area per player about constant between the clamps', () => {
    for (const n of [12, 20, 30, 40, 60, 80, 99]) {
      const side = mapSideFor(n, MAP_SCALE_DEFAULT);
      const perPlayer = (side * side) / n;
      // rounding the side up to 100 adds at most a few percent
      expect(perPlayer / (MAP_SCALE_DEFAULT.perPlayer * MAP_SCALE_DEFAULT.perPlayer)).toBeGreaterThanOrEqual(1);
      expect(perPlayer / (MAP_SCALE_DEFAULT.perPlayer * MAP_SCALE_DEFAULT.perPlayer)).toBeLessThan(1.1);
    }
  });

  it('is monotonic, clamps to min..max and never leaves the coordinate space', () => {
    let last = 0;
    for (let n = 0; n <= 400; n++) {
      const s = mapSideFor(n, MAP_SCALE_DEFAULT);
      expect(s).toBeGreaterThanOrEqual(last);
      expect(s).toBeGreaterThanOrEqual(MAP_SCALE_DEFAULT.min);
      expect(s).toBeLessThanOrEqual(MAP_SCALE_DEFAULT.max);
      expect(s % 100).toBe(0);
      last = s;
    }
    expect(mapSideFor(1000, { perPlayer: 2000, min: 2000, max: 99_999 })).toBe(MAP_SPACE);
    // a min above the max never wins
    expect(mapSideFor(1, { perPlayer: 900, min: 8000, max: 5000 })).toBe(8000);
    expect(mapSideFor(Number.NaN, MAP_SCALE_DEFAULT)).toBe(3000);
  });

  it('spans the custom room sizes (XS..XL)', () => {
    expect(MAP_SCALE_DEFAULT.min).toBe(CUSTOM_MAP_WIDTH.XS);
    expect(MAP_SCALE_DEFAULT.max).toBe(CUSTOM_MAP_WIDTH.XL);
  });
});

describe('population of a world of a given side', () => {
  it('matches a practice pond at its size and scales food and cacti with the area', () => {
    const pond = WORLD_PRESETS.practice;
    expect(worldForSide(pond.width)).toEqual(pond);
    const small = worldForSide(3000);
    const big = worldForSide(9000);
    expect(small.foodTarget).toBe(Math.round(9e6 * FOOD_PER_AREA));
    expect(big.foodTarget).toBe(Math.round(81e6 * FOOD_PER_AREA));
    // 9x the area: 9x the food (within rounding)
    expect(big.foodTarget / small.foodTarget).toBeCloseTo(9, 1);
    expect(big.virusTarget).toBe(Math.round(81e6 * VIRUS_PER_AREA));
    expect(small.virusTarget).toBeGreaterThanOrEqual(2);
    expect(small.maxPowerUps).toBe(1);
    expect(big.maxPowerUps).toBe(5);
  });

  it('caps food and cacti for the small server, and grows no cacti at 0', () => {
    const huge = worldForSide(MAP_SPACE, { foodMul: 2, virusMul: 3 });
    expect(huge.foodTarget).toBe(MAP_WORLD_CAPS.food);
    expect(huge.virusTarget).toBe(MAP_WORLD_CAPS.viruses);
    expect(worldForSide(5000, { virusMul: 0 }).virusTarget).toBe(0);
  });
});

describe('admin field checks and the custom "auto" choice', () => {
  it('checks every map field', () => {
    expect(mapScaleFieldError('auto', true)).toBeNull();
    expect(mapScaleFieldError('auto', 'yes')).toMatch(/true or false/);
    expect(mapScaleFieldError('perPlayer', 900)).toBeNull();
    expect(mapScaleFieldError('perPlayer', MAP_SCALE_LIMITS.perPlayerMax + 1)).toMatch(/300 to 2000/);
    expect(mapScaleFieldError('min', 2500.5)).toMatch(/whole number/);
    expect(mapScaleFieldError('max', MAP_SPACE)).toBeNull();
    expect(mapScaleFieldError('max', MAP_SPACE + 1)).not.toBeNull();
  });

  it('accepts auto (the default) and every fixed size', async () => {
    const { CUSTOM_DEFAULTS, CUSTOM_MAP_CHOICES } = await import('../src');
    expect(CUSTOM_DEFAULTS.mapSize).toBe('auto');
    expect(CUSTOM_MAP_CHOICES).toEqual(['auto', ...CUSTOM_MAP_SIZES]);
    const v = validateCustomConfig({ ...CUSTOM_DEFAULTS, name: 'Auto pond' });
    expect(v).toMatchObject({ ok: true, config: { mapSize: 'auto' } });
    expect(validateCustomConfig({ ...CUSTOM_DEFAULTS, name: 'Fixed', mapSize: 'L' })).toMatchObject({ ok: true, config: { mapSize: 'L' } });
  });
});
