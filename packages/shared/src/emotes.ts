
export interface EmoteDef {
  id: number;
  key: string;
  text: string;
  label: string;
}

/** Quick emotes bound to keys 1–8; the web draws each as a sticker (`text` is the plain-text fallback, no emoji). */
export const EMOTES: readonly EmoteDef[] = [
  { id: 0, key: 'gm', text: 'GM', label: 'GM' },
  { id: 1, key: 'wagmi', text: 'WAGMI', label: 'WAGMI' },
  { id: 2, key: 'rocket', text: 'To the moon', label: 'To the moon' },
  { id: 3, key: 'diamond', text: 'Diamond hands', label: 'Diamond hands' },
  { id: 4, key: 'cry', text: 'Rekt', label: 'Rekt' },
  { id: 5, key: 'yum', text: 'Yum', label: 'Yum' },
  { id: 6, key: 'salute', text: 'Salute', label: 'Salute' },
  { id: 7, key: 'love', text: 'Love', label: 'Love' },
];

export const EMOTE_DURATION_MS = 2600;
