/**
 * Per-page head tags for the client-routed site. index.html ships one canonical / og:url (the root)
 * for every path the SPA rewrite serves: left alone, `/mint` or `/docs` would tell crawlers they are
 * duplicates of `/`, and an unknown path (served with a 200) would be indexed as the landing.
 */
function meta(selector: string, create: () => HTMLElement): HTMLElement {
  return document.head.querySelector<HTMLElement>(selector) ?? document.head.appendChild(create());
}

/** The site's origin as index.html names it (the build's `VITE_PUBLIC_URL`), else the page's. */
function origin(): string {
  const canon = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.getAttribute('href');
  if (canon) {
    try {
      return new URL(canon).origin;
    } catch {
      /* relative or broken: fall through */
    }
  }
  return location.origin;
}

/**
 * Points canonical and og:url at `path` and marks the page `noindex` when `indexable` is false
 * (the not-found page). `path` is the normalised pathname (`/`, `/mint`, ...).
 */
export function setPageHead(path: string, indexable = true): void {
  if (typeof document === 'undefined') return;
  const url = `${origin()}${path === '/' ? '/' : path}`;
  const canon = meta('link[rel="canonical"]', () => Object.assign(document.createElement('link'), { rel: 'canonical' }));
  canon.setAttribute('href', url);
  const og = meta('meta[property="og:url"]', () => {
    const m = document.createElement('meta');
    m.setAttribute('property', 'og:url');
    return m;
  });
  og.setAttribute('content', url);
  const robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (indexable) robots?.remove();
  else meta('meta[name="robots"]', () => Object.assign(document.createElement('meta'), { name: 'robots' })).setAttribute('content', 'noindex');
}
