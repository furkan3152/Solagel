export interface EmoteDef {
  id: number;
  key: string;
  text: string;
  label: { en: string; tr: string };
}

/** Quick emotes bound to keys 1–8; the web draws each as a sticker (`text` is the plain-text fallback, no emoji). */
export const EMOTES: readonly EmoteDef[] = [
  { id: 0, key: 'gm', text: 'GM', label: { en: 'GM', tr: 'Günaydın' } },
  { id: 1, key: 'wagmi', text: 'WAGMI', label: { en: 'WAGMI', tr: 'WAGMI' } },
  { id: 2, key: 'rocket', text: 'To the moon', label: { en: 'To the moon', tr: 'Aya!' } },
  { id: 3, key: 'diamond', text: 'Diamond hands', label: { en: 'Diamond hands', tr: 'Elmas eller' } },
  { id: 4, key: 'cry', text: 'Rekt', label: { en: 'Rekt', tr: 'Rekt' } },
  { id: 5, key: 'yum', text: 'Yum', label: { en: 'Yum', tr: 'Nefis' } },
  { id: 6, key: 'salute', text: 'Salute', label: { en: 'Salute', tr: 'Selam' } },
  { id: 7, key: 'love', text: 'Love', label: { en: 'Love', tr: 'Sevgi' } },
];

export const EMOTE_DURATION_MS = 2600;
