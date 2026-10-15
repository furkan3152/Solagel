/**
 * Display text keyed by language. Slana ships English only; `tr` mirrors `en` until the web
 * client drops its language switch, after which this collapses to a plain string.
 */
export interface Localized {
  en: string;
  tr: string;
}

/** English display text (the `tr` key mirrors it, see {@link Localized}). */
export const english = (text: string): Localized => ({ en: text, tr: text });
