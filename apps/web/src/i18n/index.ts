import { en } from './en';

export type TKey = keyof typeof en;

export function translate(key: TKey, vars?: Record<string, string | number>): string {
  let s: string = en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** React hook: `const t = useT(); t('lo.tab.play')`. */
export function useT(): (key: TKey, vars?: Record<string, string | number>) => string {
  return translate;
}

/** Non-React access (engine, toasts). */
export const t = (key: TKey, vars?: Record<string, string | number>): string => translate(key, vars);
