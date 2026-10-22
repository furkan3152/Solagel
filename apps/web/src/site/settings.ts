import { SITE_SETTINGS_DEFAULT, type SiteSettings } from '@slana/shared';
import { useEffect, useState } from 'react';
import { site } from './api';

/** The X account and the site, for links and copy. */
export const X_URL = 'https://x.com/slanaio';

let cache: SiteSettings | null = null;
let pending: Promise<SiteSettings> | null = null;

/** The public site settings, fetched once per page (defaults while loading or when the server is down). */
export function loadSiteSettings(): Promise<SiteSettings> {
  if (cache) return Promise.resolve(cache);
  pending ??= site
    .settings()
    .then((s) => (cache = s))
    .catch(() => {
      pending = null;
      return SITE_SETTINGS_DEFAULT;
    });
  return pending;
}

/** For tests: forget the cached settings. */
export function resetSiteSettings(): void {
  cache = null;
  pending = null;
}

export function useSiteSettings(): { settings: SiteSettings; loaded: boolean } {
  const [state, setState] = useState<{ settings: SiteSettings; loaded: boolean }>(() => ({ settings: cache ?? SITE_SETTINGS_DEFAULT, loaded: !!cache }));
  useEffect(() => {
    let live = true;
    void loadSiteSettings().then((s) => live && setState({ settings: s, loaded: true }));
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/** `x.com/<handle>` for a stored (normalised) handle. */
export const xProfile = (handle: string): string => `https://x.com/${handle.replace(/^@/, '')}`;

/** An X "compose" link with the text filled in (the user attaches the card themselves). */
export const xIntent = (text: string, inReplyTo?: string | null): string =>
  `https://x.com/intent/post?text=${encodeURIComponent(text)}${inReplyTo ? `&in_reply_to=${encodeURIComponent(inReplyTo)}` : ''}`;

export const shortWallet = (w: string): string => (w.length > 12 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w);
