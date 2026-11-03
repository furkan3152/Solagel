// The languages the interface ships in. Each language is named in itself (that is what a reader
// looks for in a picker); the names live here, in the locale directory, with the dictionaries.

export type Locale = 'en' | 'tr' | 'es' | 'pt' | 'ru' | 'zh';

export interface LocaleInfo {
  code: Locale;
  /** BCP 47 tag for `<html lang>` and `Intl`. */
  tag: string;
  /** The language's own name. */
  name: string;
  /** Two-letter mark for compact pickers. */
  short: string;
}

export const LOCALES: readonly LocaleInfo[] = [
  { code: 'en', tag: 'en', name: 'English', short: 'EN' },
  { code: 'tr', tag: 'tr', name: 'Türkçe', short: 'TR' },
  { code: 'es', tag: 'es', name: 'Español', short: 'ES' },
  { code: 'pt', tag: 'pt-BR', name: 'Português (Brasil)', short: 'PT' },
  { code: 'ru', tag: 'ru', name: 'Русский', short: 'RU' },
  { code: 'zh', tag: 'zh-CN', name: '简体中文', short: '中文' },
];
