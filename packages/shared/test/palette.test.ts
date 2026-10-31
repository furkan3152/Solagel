import { describe, expect, it } from 'vitest';
import { CARD_PAPER, COIN_PAINTS, ELYSIUM, INK, INK_2, NIGHT, PAPER, RISO, SHADE, TEXT_INKS } from '../src/palette';

const HEX = /^#[0-9A-F]{6}$/;

describe('Storybook palette', () => {
  it('every paint is an upper-case hex with exactly one shade', () => {
    expect(Object.keys(SHADE).sort()).toEqual(Object.keys(ELYSIUM).sort());
    for (const v of [...Object.values(ELYSIUM), ...Object.values(SHADE), ...Object.values(TEXT_INKS.day), ...Object.values(TEXT_INKS.night)]) {
      expect(v).toMatch(HEX);
    }
  });
  it('the named roles point at paints', () => {
    expect(INK).toBe(ELYSIUM.abyss);
    expect(PAPER).toBe(ELYSIUM.plain);
    expect(CARD_PAPER).toBe(ELYSIUM.cream);
    expect(INK_2).toBe(ELYSIUM.stone);
    expect(NIGHT.paper).toBe(ELYSIUM.trench);
    for (const p of COIN_PAINTS) expect(ELYSIUM[p]).toMatch(HEX);
  });
  it('keeps every legacy riso name (aliased to a paint) so old imports compile and draw', () => {
    expect(Object.keys(RISO).sort()).toEqual(['aqua', 'blue', 'brown', 'fluoPink', 'green', 'lilac', 'mint', 'mustard', 'orange', 'purple', 'red', 'teal']);
    const paints = new Set<string>([...Object.values(ELYSIUM), ...Object.values(SHADE)]);
    for (const v of Object.values(RISO)) expect(paints.has(v)).toBe(true);
  });
});
