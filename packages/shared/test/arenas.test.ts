import { describe, expect, it } from 'vitest';
import { ARENA_META, DEFAULT_ARENAS, arenaMeta } from '../src';

describe('arena catalog', () => {
  it('ships the four default tiers, all open to everyone', () => {
    expect(DEFAULT_ARENAS).toEqual([
      { id: 1, entryTokens: 1000, maxSessions: 300 },
      { id: 2, entryTokens: 10000, maxSessions: 300 },
      { id: 3, entryTokens: 50000, maxSessions: 300 },
      { id: 4, entryTokens: 250000, maxSessions: 300 },
    ]);
  });

  it('has display metadata for every default arena and nothing else', () => {
    expect(Object.keys(ARENA_META).map(Number)).toEqual(DEFAULT_ARENAS.map((a) => a.id));
    for (const a of DEFAULT_ARENAS) {
      const meta = arenaMeta(a.id);
      expect(meta.name.length).toBeGreaterThan(0);
      expect(meta.ink).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('names the tiers after Elysian places (spec section 1)', () => {
    expect(DEFAULT_ARENAS.map((a) => arenaMeta(a.id).name)).toEqual(['Asphodel Meadow', 'Lethe Shore', 'Golden Bough', 'Isles of the Blessed']);
  });

  it('uses the arena inks of the design spec', () => {
    expect(DEFAULT_ARENAS.map((a) => arenaMeta(a.id).ink)).toEqual(['#6FCDE8', '#93D9EE', '#F2C14E', '#3C9A87']);
    expect(arenaMeta(2).inkTo).toBe('#2D7388');
    expect(arenaMeta(1).inkTo).toBeUndefined();
  });

  it('gives every tier its own ink and keeps entry fees ascending', () => {
    expect(new Set(DEFAULT_ARENAS.map((a) => arenaMeta(a.id).ink)).size).toBe(DEFAULT_ARENAS.length);
    const fees = DEFAULT_ARENAS.map((a) => a.entryTokens);
    expect([...fees].sort((a, b) => a - b)).toEqual(fees);
  });

  it('falls back to a generic ticket for unknown arena ids', () => {
    const meta = arenaMeta(77);
    expect(meta.name).toBe('Arena #77');
    expect(meta.ink).toMatch(/^#[0-9A-F]{6}$/);
  });
});
