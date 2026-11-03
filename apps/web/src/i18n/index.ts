import { useSyncExternalStore } from 'react';
import { en } from './en';
import { LOCALES, type Locale } from './locales/meta';

export { LOCALES, type Locale, type LocaleInfo } from './locales/meta';

export type TKey = keyof typeof en;
/** A full dictionary: every English key, any language. */
export type Dict = Record<TKey, string>;
export type TVars = Record<string, string | number>;

const STORAGE_KEY = 'elymum.locale.v1';
const CODES = LOCALES.map((l) => l.code);
export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (CODES as string[]).includes(v);

/**
 * The non-English dictionaries, each its own lazy chunk: English is the only table in the
 * entry bundle, a visitor downloads one other language at most.
 */
const LOADERS: Record<Exclude<Locale, 'en'>, () => Promise<{ default: Dict }>> = {
  tr: () => import('./locales/tr'),
  es: () => import('./locales/es'),
  pt: () => import('./locales/pt'),
  ru: () => import('./locales/ru'),
  zh: () => import('./locales/zh'),
};

let current: Locale = 'en';
let dict: Dict = en;
const loaded = new Map<Locale, Dict>([['en', en]]);
const listeners = new Set<() => void>();
const plurals = new Map<Locale, Intl.PluralRules>();

function pluralRules(l: Locale): Intl.PluralRules {
  let r = plurals.get(l);
  if (!r) {
    r = new Intl.PluralRules(l === 'pt' ? 'pt-BR' : l === 'zh' ? 'zh-CN' : l);
    plurals.set(l, r);
  }
  return r;
}

/**
 * ICU-style plurals, flat (no nesting): `{n, plural, one {# coin} few {# монеты} other {# coins}}`.
 * `=0`-style exact cases win; `#` is the number as passed. A missing category falls back to `other`.
 */
const PLURAL = /\{(\w+), plural,((?:\s*(?:=\d+|zero|one|two|few|many|other)\s*\{(?:[^{}]|\{\w+\})*\})+)\s*\}/g;
const CASE = /(=\d+|zero|one|two|few|many|other)\s*\{((?:[^{}]|\{\w+\})*)\}/g;

export function formatMessage(s: string, vars: TVars | undefined, locale: Locale = current): string {
  if (!vars) return s;
  if (s.includes(', plural,')) {
    s = s.replace(PLURAL, (whole, name: string, body: string) => {
      const raw = vars[name];
      if (raw === undefined) return whole;
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^\d.-]/g, ''));
      const cases = new Map<string, string>();
      for (const m of body.matchAll(CASE)) cases.set(m[1], m[2]);
      const pick = cases.get(`=${n}`) ?? cases.get(Number.isFinite(n) ? pluralRules(locale).select(n) : 'other') ?? cases.get('other') ?? '';
      return pick.replaceAll('#', String(raw));
    });
  }
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export function translate(key: TKey, vars?: TVars): string {
  const s: string = dict[key] ?? en[key] ?? key;
  return formatMessage(s, vars);
}

/** Non-React access (engine, toasts): always the current language. */
export const t = (key: TKey, vars?: TVars): string => translate(key, vars);

export const getLocale = (): Locale => current;

/**
 * A server error message (English) or our own words: outside English the client's translated
 * fallback wins, since the server only speaks English.
 */
export const serverText = (server: string | null | undefined, fallback: string): string => (current === 'en' && server ? server : fallback);

/** The `Intl` tag for dates and numbers in the current language (`en-US` for English). */
export const intlLocale = (): string => (current === 'en' ? 'en-US' : (LOCALES.find((l) => l.code === current)?.tag ?? current));

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** One function per language: components that memoise on `t` re-run when the language changes. */
const fns = new Map<Locale, (key: TKey, vars?: TVars) => string>();
function fnFor(l: Locale) {
  let f = fns.get(l);
  if (!f) {
    f = (key: TKey, vars?: TVars) => translate(key, vars);
    fns.set(l, f);
  }
  return f;
}

/** React hook: `const t = useT(); t('lo.tab.play')`. Re-renders when the language changes. */
export function useT(): (key: TKey, vars?: TVars) => string {
  return fnFor(useLocale());
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, () => 'en' as Locale);
}

function readStored(): Locale | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

/** The best language for this browser: the stored pick, else the first of `navigator.languages` we have. */
export function detectLocale(langs: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]): Locale {
  const stored = readStored();
  if (stored) return stored;
  for (const tag of langs) {
    const base = String(tag || '').toLowerCase().split(/[-_]/)[0];
    if (isLocale(base)) return base;
  }
  return 'en';
}

function apply(l: Locale, d: Dict): void {
  current = l;
  dict = d;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = LOCALES.find((x) => x.code === l)?.tag ?? l;
  }
  for (const fn of listeners) fn();
}

/** Downloads a language (cached). */
export async function loadLocale(l: Locale): Promise<Dict> {
  const have = loaded.get(l);
  if (have) return have;
  const d = (await LOADERS[l as Exclude<Locale, 'en'>]()).default;
  loaded.set(l, d);
  return d;
}

let pending = 0;
/** Switches the language (and remembers it): English at once, others after their chunk loads. */
export async function setLocale(l: Locale, persist = true): Promise<void> {
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* private mode: this visit only */
    }
  }
  const mine = ++pending;
  try {
    const d = await loadLocale(l);
    if (mine === pending) apply(l, d);
  } catch (err) {
    console.warn('language failed to load', l, err);
  }
}

/**
 * Boot: picks the language and waits (at most `maxWaitMs`) for its dictionary, so the first paint
 * is already in that language. A slow download paints English and switches when it lands.
 */
export function initLocale(maxWaitMs = 1500): Promise<void> {
  // `?lang=ru` (the UI audit, shared links) wins once and is remembered like a pick
  let forced: Locale | null = null;
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (isLocale(q)) forced = q;
  } catch {
    /* no location (tests) */
  }
  const l = forced ?? detectLocale();
  if (l === 'en') {
    // `?lang=en` over a stored other language is remembered too (like any forced pick)
    if (forced) {
      try {
        localStorage.setItem(STORAGE_KEY, 'en');
      } catch {
        /* private mode: this visit only */
      }
    }
    apply('en', en);
    return Promise.resolve();
  }
  const go = setLocale(l, forced !== null);
  return Promise.race([go, new Promise<void>((r) => setTimeout(r, maxWaitMs))]);
}
