import { INK, RISO } from './palette';

export interface ArenaMeta {
  name: string;
  /** Riso ink colour of the arena's ticket (stripe, stamp). */
  ink: string;
}

/** Display metadata for on-chain arena ids (the chain stores only numbers). */
export const ARENA_META: Record<number, ArenaMeta> = {
  1: { name: 'Penny Pond', ink: RISO.red },
  2: { name: 'Silver Creek', ink: RISO.teal },
  3: { name: 'Gold Lake', ink: RISO.mustard },
  4: { name: 'Whale Bay', ink: RISO.blue },
};

/**
 * Default tiers created by `admin create-arena --defaults`, all open to everyone (they
 * differ only by entry fee). `entryTokens` is in whole tokens (scale by the mint's
 * decimals for base units); `maxSessions` is how many tickets can be open at once.
 */
export const DEFAULT_ARENAS = [
  { id: 1, entryTokens: 1000, maxSessions: 300 },
  { id: 2, entryTokens: 10000, maxSessions: 300 },
  { id: 3, entryTokens: 50000, maxSessions: 300 },
  { id: 4, entryTokens: 250000, maxSessions: 300 },
] as const;

export function arenaMeta(id: number): ArenaMeta {
  return ARENA_META[id] ?? { name: `Arena #${id}`, ink: INK };
}
