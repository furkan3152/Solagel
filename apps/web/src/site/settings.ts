import { SITE_SETTINGS_DEFAULT, SITE_X_HANDLE_DEFAULT, type SiteSettings } from '@elymum/shared';
import { useEffect, useState } from 'react';
import { site } from './api';

/** The project's X account (the default handle; pages that know the settings use `xProfile(settings.xHandle)`). */
export const X_HANDLE = SITE_X_HANDLE_DEFAULT;
export const X_URL = `https://x.com/${X_HANDLE}`;

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

/** The host this site is served at (never hard-coded: `PUBLIC_URL` decides). */
export function siteHost(): string {
  try {
    return window.location.host;
  } catch {
    return '';
  }
}

/** `0x1234…abcd` for an EVM address; other (legacy) wallets keep 4 characters at each end. */
export const shortWallet = (w: string): string => (w.length <= 12 ? w : w.startsWith('0x') ? `${w.slice(0, 6)}…${w.slice(-4)}` : `${w.slice(0, 4)}…${w.slice(-4)}`);
