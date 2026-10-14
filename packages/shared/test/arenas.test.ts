import { describe, expect, it } from 'vitest';
import { ARENA_META, DEFAULT_ARENAS, arenaMeta } from '../src';

describe('arena catalog', () => {
  it('ships the four default tiers', () => {
    expect(DEFAULT_ARENAS).toEqual([
      { id: 1, entryTokens: 1000, requiresPass: false, maxSessions: 300 },
      { id: 2, entryTokens: 10000, requiresPass: false, maxSessions: 300 },
      { id: 3, entryTokens: 50000, requiresPass: true, maxSessions: 300 },
      { id: 4, entryTokens: 250000, requiresPass: true, maxSessions: 300 },
    ]);
  });

  it('has display metadata for every default arena and nothing else', () => {
    expect(Object.keys(ARENA_META).map(Number)).toEqual(DEFAULT_ARENAS.map((a) => a.id));
    for (const a of DEFAULT_ARENAS) {
      const meta = arenaMeta(a.id);
      expect(meta.name.en.length).toBeGreaterThan(0);
      expect(meta.name.tr.length).toBeGreaterThan(0);
      expect(meta.ink).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('names the tiers as in the design spec', () => {
    expect(DEFAULT_ARENAS.map((a) => arenaMeta(a.id).name.tr)).toEqual(['Kuruş Gölü', 'Gümüş Dere', 'Altın Göl', 'Balina Koyu']);
    expect(DEFAULT_ARENAS.map((a) => arenaMeta(a.id).name.en)).toEqual(['Penny Pond', 'Silver Stream', 'Golden Lake', 'Whale Bay']);
  });

  it('gives every tier its own ink and keeps entry fees ascending', () => {
    expect(new Set(DEFAULT_ARENAS.map((a) => arenaMeta(a.id).ink)).size).toBe(DEFAULT_ARENAS.length);
    const fees = DEFAULT_ARENAS.map((a) => a.entryTokens);
    expect([...fees].sort((a, b) => a - b)).toEqual(fees);
  });

  it('falls back to a generic ticket for unknown arena ids', () => {
    const meta = arenaMeta(77);
    expect(meta.name).toEqual({ en: 'Arena #77', tr: 'Arena #77' });
    expect(meta.ink).toMatch(/^#[0-9A-F]{6}$/);
  });
});
