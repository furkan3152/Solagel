export interface ArenaMeta {
  name: { en: string; tr: string };
  /** Riso ink colour of the arena's ticket (stripe, stamp). */
  ink: string;
}

/** Display metadata for on-chain arena ids (the chain stores only numbers). */
export const ARENA_META: Record<number, ArenaMeta> = {
  1: { name: { en: 'Penny Pond', tr: 'Kuruş Gölü' }, ink: '#E5402B' },
  2: { name: { en: 'Silver Stream', tr: 'Gümüş Dere' }, ink: '#0E9C9A' },
  3: { name: { en: 'Golden Lake', tr: 'Altın Göl' }, ink: '#F2B705' },
  4: { name: { en: 'Whale Bay', tr: 'Balina Koyu' }, ink: '#3B5BDB' },
};

/**
 * Default tiers created by `admin create-arena --defaults`. `entryTokens` is in
 * whole tokens (scale by the mint's decimals for base units); `maxSessions` is
 * how many tickets can be open at once.
 */
export const DEFAULT_ARENAS = [
  { id: 1, entryTokens: 1000, requiresPass: false, maxSessions: 300 },
  { id: 2, entryTokens: 10000, requiresPass: false, maxSessions: 300 },
  { id: 3, entryTokens: 50000, requiresPass: true, maxSessions: 300 },
  { id: 4, entryTokens: 250000, requiresPass: true, maxSessions: 300 },
] as const;

export function arenaMeta(id: number): ArenaMeta {
  return ARENA_META[id] ?? { name: { en: `Arena #${id}`, tr: `Arena #${id}` }, ink: '#1E1B2E' };
}
