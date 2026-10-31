import { describe, expect, it } from 'vitest';
import { looksLikeScam, maskProfanity } from '../src/chat-filter';

describe('chat filter', () => {
  it('masks listed words with hearts, keeping the length and the surrounding text', () => {
    expect(maskProfanity('what the fuck')).toBe('what the ♥♥♥♥');
    expect(maskProfanity('SHIT, again')).toBe('♥♥♥♥, again');
  });

  it('only masks whole words', () => {
    expect(maskProfanity('classic assassin')).toBe('classic assassin');
    expect(maskProfanity('shitake mushrooms')).toBe('shitake mushrooms');
  });

  it('leaves clean text and non-English words alone', () => {
    expect(maskProfanity('gm wagmi 🚀')).toBe('gm wagmi 🚀');
    expect(maskProfanity('Renée says hi')).toBe('Renée says hi');
  });

  it('flags scam bait', () => {
    expect(looksLikeScam('send me sol please')).toBe(true);
    expect(looksLikeScam('send me hype please')).toBe(true);
    expect(looksLikeScam('visit https://example.xyz')).toBe(true);
    expect(looksLikeScam('good game')).toBe(false);
  });
});
