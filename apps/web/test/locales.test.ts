import { describe, expect, it } from 'vitest';
import { detectLocale, formatMessage, LOCALES, loadLocale, setLocale, translate, type Dict, type Locale, type TKey } from '../src/i18n';
import { en } from '../src/i18n/en';
import { renderRich } from '../src/i18n/rich';

/** The variable names a string uses: `{name}` and `{name, plural, ...}`. */
const varsOf = (s: string) => [...new Set([...s.matchAll(/\{(\w+)(?:, plural,|\})/g)].map((m) => m[1]))].sort();
/** The rich-text tags a string uses (`<em>…</em>`). */
const tagsOf = (s: string) => [...s.matchAll(/<(\w+)>/g)].map((m) => m[1]).sort();

const OTHERS = ['tr', 'es', 'pt', 'ru', 'zh'] as const;

describe('the translations', () => {
  it('ship every language the picker offers', () => {
    expect(LOCALES.map((l) => l.code).sort()).toEqual(['en', ...OTHERS].sort());
  });

  for (const code of OTHERS) {
    it(`${code}: exactly the keys of en.ts, with the same placeholders and tags`, async () => {
      const dict: Dict = await loadLocale(code);
      expect(Object.keys(dict).sort()).toEqual(Object.keys(en).sort());
      const bad: string[] = [];
      for (const [key, value] of Object.entries(en)) {
        const tr = dict[key as TKey];
        if (typeof tr !== 'string' || !tr.trim()) {
          bad.push(`${key}: empty`);
          continue;
        }
        if (varsOf(tr).join() !== varsOf(value).join()) bad.push(`${key}: vars [${varsOf(tr)}] != [${varsOf(value)}]`);
        if (tagsOf(tr).join() !== tagsOf(value).join()) bad.push(`${key}: tags [${tagsOf(tr)}] != [${tagsOf(value)}]`);
        if (/\p{Extended_Pictographic}/u.test(tr)) bad.push(`${key}: emoji`);
      }
      expect(bad).toEqual([]);
    });
  }

  it('keep the brand names untranslated', async () => {
    const bad: string[] = [];
    for (const code of OTHERS) {
      const dict = await loadLocale(code as Locale);
      for (const [key, value] of Object.entries(en)) {
        for (const brand of ['$ELYMUM', 'HYPE', 'Elysium', '@elymumio']) {
          if (value.includes(brand) && !dict[key as TKey].includes(brand)) bad.push(`${code} ${key}: ${brand}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('the i18n layer', () => {
  it('picks a language from navigator.languages, else English', () => {
    expect(detectLocale(['ru-RU', 'en'])).toBe('ru');
    expect(detectLocale(['de-DE', 'pt-BR'])).toBe('pt');
    expect(detectLocale(['zh-Hans-CN'])).toBe('zh');
    expect(detectLocale(['de', 'fr'])).toBe('en');
  });

  it('formats plurals by the language rules', () => {
    const s = '{n, plural, one {# coin} few {# coins (few)} many {# coins (many)} other {# coins}}';
    expect(formatMessage(s, { n: 1 }, 'en')).toBe('1 coin');
    expect(formatMessage(s, { n: 5 }, 'en')).toBe('5 coins');
    expect(formatMessage(s, { n: 3 }, 'ru')).toBe('3 coins (few)');
    expect(formatMessage(s, { n: 11 }, 'ru')).toBe('11 coins (many)');
    expect(formatMessage(s, { n: 21 }, 'ru')).toBe('21 coin');
    expect(formatMessage('{n, plural, =0 {none} other {# and {x}}}', { n: 0, x: 'y' }, 'en')).toBe('none');
    expect(formatMessage('{n, plural, =0 {none} other {# and {x}}}', { n: 2, x: 'y' }, 'en')).toBe('2 and y');
  });

  it('renders rich tags, switches the language and sets <html lang>', async () => {
    const out = renderRich('a <em>b</em> c', { em: (c) => `[${String(c)}]` });
    expect(Array.isArray(out) && out.length).toBe(3);
    await setLocale('ru', false);
    expect(document.documentElement.lang).toBe('ru');
    expect(translate('gs.title')).not.toBe(en['gs.title']);
    expect(translate('lo.humans', { n: 3 })).toBe('3 игрока');
    await setLocale('en', false);
    expect(document.documentElement.lang).toBe('en');
    expect(translate('gs.title')).toBe('Settings');
  });
});
