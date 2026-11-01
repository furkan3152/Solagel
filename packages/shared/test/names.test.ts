import { describe, expect, it } from 'vitest';
import { BOT_NAMES, BOT_NAME_BANNED_PARTS, isNaturalBotName, pickBotName } from '../src';

/** Deterministic rng for the picks. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('bot names', () => {
  it('is a large pool (300+) of unique names', () => {
    expect(BOT_NAMES.length).toBeGreaterThanOrEqual(300);
    const lower = BOT_NAMES.map((n) => n.toLowerCase());
    expect(new Set(lower).size).toBe(BOT_NAMES.length);
  });

  it('every name follows the style rules: ASCII handle, 3–16 chars, no crypto puns or rude words', () => {
    const bad = BOT_NAMES.filter((n) => !isNaturalBotName(n));
    expect(bad).toEqual([]);
    for (const n of BOT_NAMES) {
      expect(n).toMatch(/^[\x20-\x7e]+$/); // no Turkish (or other non-ASCII) letters
      for (const w of BOT_NAME_BANNED_PARTS) expect(n.toLowerCase()).not.toContain(w);
    }
  });

  it('mixes styles: digits, dots, underscores, plain lowercase, a few capitals', () => {
    const share = (re: RegExp) => BOT_NAMES.filter((n) => re.test(n)).length / BOT_NAMES.length;
    expect(share(/\d/)).toBeGreaterThan(0.05);
    expect(share(/\./)).toBeGreaterThan(0.1);
    expect(share(/_/)).toBeGreaterThan(0.2);
    expect(share(/^[a-z]+$/)).toBeGreaterThan(0.05);
    expect(share(/[A-Z]/)).toBeGreaterThan(0);
    expect(share(/[A-Z]/)).toBeLessThan(0.1);
    // international examples from the spec
    for (const n of ['deniz_k', 'emre.dmr', 'kenjiplays', 'lisa_b', 'marco88', 'sophie_m', 'ella.v']) expect(BOT_NAMES).toContain(n);
  });

  it('the style rules reject what bots must not be called', () => {
    for (const n of ['gm_gummy', 'hodl_hamster', 'moon_mochi', '\u015feyma', 'a', '_lead', 'trail.', 'two__marks', 'x'.repeat(17), 'has space']) {
      expect(isNaturalBotName(n)).toBe(false);
    }
    expect(isNaturalBotName('emre.dmr')).toBe(true);
  });

  it('never picks a name already in the room (case-insensitive, humans count too)', () => {
    const r = rng(1);
    const taken: string[] = ['MARCO88', 'Deniz_K'];
    for (let i = 0; i < BOT_NAMES.length + 40; i++) {
      const n = pickBotName(r, taken);
      expect(taken.map((t) => t.toLowerCase())).not.toContain(n.toLowerCase());
      taken.push(n);
    }
    expect(new Set(taken.map((t) => t.toLowerCase())).size).toBe(taken.length);
    // past the pool, names still look natural (a suffix of two digits)
    expect(taken.slice(-40).every((n) => isNaturalBotName(n) || /\d\d$/.test(n))).toBe(true);
  });

  it('regulars come back now and then, never twice at once', () => {
    const r = rng(9);
    const regulars = ['marco88', 'yuki_s', 'lena.m'];
    let back = 0;
    for (let i = 0; i < 400; i++) if (regulars.includes(pickBotName(r, [], regulars))) back++;
    expect(back / 400).toBeGreaterThan(0.2);
    expect(back / 400).toBeLessThan(0.6);
    // all regulars in the room already: a fresh name
    for (let i = 0; i < 50; i++) expect(regulars).not.toContain(pickBotName(r, regulars, regulars, 1));
  });
});
