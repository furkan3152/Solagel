import { describe, expect, it } from 'vitest';
import { COUNTRY_CODES, botCountry, isCountryCode, normalizeCountry, packCountry, suggestCountry, unpackCountry } from '../src';

describe('country allowlist', () => {
  it('holds the 249 ISO 3166-1 alpha-2 codes, sorted and unique', () => {
    expect(COUNTRY_CODES.length).toBe(249);
    expect(new Set(COUNTRY_CODES).size).toBe(249);
    expect([...COUNTRY_CODES].sort()).toEqual(COUNTRY_CODES);
    for (const c of COUNTRY_CODES) expect(c).toMatch(/^[A-Z]{2}$/);
  });

  it('is strict: upper case, assigned codes only', () => {
    for (const ok of ['US', 'GB', 'DE', 'BR', 'JP', 'ZW', 'AX']) expect(isCountryCode(ok)).toBe(true);
    for (const bad of ['us', 'UK', 'EU', 'XX', 'ZZ', 'USA', '', 'U', null, undefined, 12, {}, ['US']]) expect(isCountryCode(bad)).toBe(false);
  });

  it('normalizes loose input to a code or null', () => {
    expect(normalizeCountry(' de ')).toBe('DE');
    expect(normalizeCountry('br')).toBe('BR');
    expect(normalizeCountry('uk')).toBeNull();
    expect(normalizeCountry('')).toBeNull();
    expect(normalizeCountry('a very long string')).toBeNull();
    expect(normalizeCountry(7)).toBeNull();
  });

  it('packs into 16 bits and back', () => {
    for (const c of COUNTRY_CODES) expect(unpackCountry(packCountry(c))).toBe(c);
    expect(packCountry(null)).toBe(0);
    expect(packCountry('XX')).toBe(0);
    expect(unpackCountry(0)).toBeNull();
    expect(unpackCountry((90 << 8) | 90)).toBeNull();
  });
});

describe('suggestCountry', () => {
  it('takes the first region a language tag carries', () => {
    expect(suggestCountry(['en-GB', 'en'])).toBe('GB');
    expect(suggestCountry(['pt_BR'])).toBe('BR');
    expect(suggestCountry(['zh-Hant-TW'])).toBe('TW');
    expect(suggestCountry(['fr', 'fr-CA'])).toBe('CA');
  });

  it('falls back to a language mostly spoken in one country', () => {
    expect(suggestCountry(['de'])).toBe('DE');
    expect(suggestCountry(['ja', 'en'])).toBe('JP');
  });

  it('gives no guess for widely shared languages or junk', () => {
    expect(suggestCountry(['en'])).toBeNull();
    expect(suggestCountry(['es-419'])).toBeNull();
    expect(suggestCountry([])).toBeNull();
    expect(suggestCountry(undefined)).toBeNull();
    expect(suggestCountry(['xx-QQ'])).toBeNull();
  });
});

describe('botCountry', () => {
  it('is stable per name (any case) and always on the allowlist', () => {
    expect(botCountry('jake_r')).toBe(botCountry('JAKE_R'));
    const seen = new Set<string>();
    for (const n of ['jake_r', 'emily22', 'mattplays', 'sarah.k', 'tommy7', 'jess_m', 'ryan_2004', 'katie.l', 'danny_b', 'chloe99', 'liam_w', 'olivia.j']) {
      const c = botCountry(n);
      expect(isCountryCode(c)).toBe(true);
      seen.add(c);
    }
    // a board of bots shows a few different flags, not one
    expect(seen.size).toBeGreaterThan(2);
  });
});
