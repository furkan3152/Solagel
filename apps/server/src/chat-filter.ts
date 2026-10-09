// A deliberately small, friendly filter: masks common slurs/profanity (EN/TR).
const WORDS = [
  'fuck',
  'shit',
  'bitch',
  'cunt',
  'nigger',
  'nigga',
  'faggot',
  'retard',
  'whore',
  'slut',
  'amk',
  'aq',
  'orospu',
  'piç',
  'sik',
  'yarrak',
  'yarak',
  'göt',
  'pezevenk',
  'kahpe',
  'ibne',
  'amcık',
  'gavat',
];

const PATTERN = new RegExp(`(^|[^\\p{L}])(${WORDS.join('|')})(?=$|[^\\p{L}])`, 'giu');

export function maskProfanity(text: string): string {
  return text.replace(PATTERN, (_m, pre: string, word: string) => pre + '♥'.repeat(Array.from(word).length));
}

/** Rejects obvious scam bait in chat (links, "send sol", seed phrase talk). */
export function looksLikeScam(text: string): boolean {
  return /(https?:\/\/|www\.|\.(com|io|xyz|gg|app|net|org)\b|t\.me\/|seed phrase|private key|send (me )?sol|airdrop claim)/i.test(text);
}
