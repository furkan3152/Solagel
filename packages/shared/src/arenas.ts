export interface ArenaMeta {
  name: { en: string; tr: string };
  emoji: string;
  color: string;
}

/** Display metadata for on-chain arena ids (the chain stores only numbers). */
export const ARENA_META: Record<number, ArenaMeta> = {
  1: { name: { en: 'Penny Pond', tr: 'Kuruş Gölü' }, emoji: '🪙', color: '#E8875A' },
  2: { name: { en: 'Silver Stream', tr: 'Gümüş Dere' }, emoji: '🥈', color: '#9E98D6' },
  3: { name: { en: 'Golden Lake', tr: 'Altın Göl' }, emoji: '🏆', color: '#FFC93C' },
  4: { name: { en: 'Whale Bay', tr: 'Balina Koyu' }, emoji: '🐋', color: '#3D8BFF' },
};

/** Default tiers created by `solagel-admin create-arena --defaults`. */
export const DEFAULT_ARENAS = [
  { id: 1, buyInSol: 0.01, maxPlayers: 20 },
  { id: 2, buyInSol: 0.05, maxPlayers: 20 },
  { id: 3, buyInSol: 0.1, maxPlayers: 16 },
] as const;

export function arenaMeta(id: number): ArenaMeta {
  return ARENA_META[id] ?? { name: { en: `Arena #${id}`, tr: `Arena #${id}` }, emoji: '💰', color: '#9945FF' };
}
