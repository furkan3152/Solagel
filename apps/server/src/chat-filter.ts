// A deliberately small, friendly filter: masks common slurs/profanity.
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
];

const PATTERN = new RegExp(`(^|[^\\p{L}])(${WORDS.join('|')})(?=$|[^\\p{L}])`, 'giu');

export function maskProfanity(text: string): string {
  return text.replace(PATTERN, (_m, pre: string, word: string) => pre + '♥'.repeat(Array.from(word).length));
}

/** Rejects obvious scam bait in chat (links, "send hype", seed phrase talk). */
export function looksLikeScam(text: string): boolean {
  return /(https?:\/\/|www\.|\.(com|io|xyz|gg|app|net|org)\b|t\.me\/|seed phrase|private key|send (me )?(hype|eth|usdc|usdt)\b|airdrop claim)/i.test(text);
}
