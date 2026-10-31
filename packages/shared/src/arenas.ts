export interface ArenaMeta {
  /** An Elysian place on the ring. */
  name: string;
  /** The arena's ink (ticket stripe, stamp, place marker). Upper-case hex. */
  ink: string;
  /** Second stop when the ink is a gradient (Lethe), else absent. */
  inkTo?: string;
}

/** Ink of an arena id the catalog does not know (`--teal`). */
export const ARENA_INK_FALLBACK = '#2D7388';

/** Display metadata for the arena contract's ids (the chain stores only numbers). */
export const ARENA_META: Record<number, ArenaMeta> = {
  1: { name: 'Asphodel Meadow', ink: '#6FCDE8' },
  2: { name: 'Lethe Shore', ink: '#93D9EE', inkTo: '#2D7388' },
  3: { name: 'Golden Bough', ink: '#F2C14E' },
  4: { name: 'Isles of the Blessed', ink: '#3C9A87' },
};

/**
 * Default tiers the admin creates on the arena contract (`createArena`), all open to everyone
 * (they differ only by entry fee). `entryTokens` is in whole tokens (scale by the token's
 * decimals for base units); `maxSessions` is how many tickets can be open at once.
 */
export const DEFAULT_ARENAS = [
  { id: 1, entryTokens: 1000, maxSessions: 300 },
  { id: 2, entryTokens: 10000, maxSessions: 300 },
  { id: 3, entryTokens: 50000, maxSessions: 300 },
  { id: 4, entryTokens: 250000, maxSessions: 300 },
] as const;

export function arenaMeta(id: number): ArenaMeta {
  return ARENA_META[id] ?? { name: `Arena #${id}`, ink: ARENA_INK_FALLBACK };
}
