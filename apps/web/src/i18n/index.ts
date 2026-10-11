import { useUi, type Lang } from '../store';
import { en } from './en';

export type TKey = keyof typeof en;

export function translate(_lang: Lang, key: TKey, vars?: Record<string, string | number>): string {
  let s: string = en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** React hook: `const t = useT(); t('lobby.play')`. */
export function useT(): (key: TKey, vars?: Record<string, string | number>) => string {
  const lang = useUi((s) => s.settings.lang);
  return (key, vars) => translate(lang, key, vars);
}

/** Non-React access (engine, toasts). */
export const t = (key: TKey, vars?: Record<string, string | number>): string => translate(useUi.getState().settings.lang, key, vars);
