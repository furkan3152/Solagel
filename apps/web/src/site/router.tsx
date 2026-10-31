import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';

/** Paths the site app renders itself; anything else (`/play`, `/admin`) is a full page load. */
export const SITE_PATHS = ['/', '/wl', '/collab', '/docs', '/mint'] as const;
export type SitePath = (typeof SITE_PATHS)[number];

const EVENT = 'site:navigate';

export function normalizePath(pathname: string): string {
  const p = pathname.replace(/\/+$/, '') || '/';
  return p.toLowerCase();
}

export const isSitePath = (pathname: string): pathname is SitePath => (SITE_PATHS as readonly string[]).includes(normalizePath(pathname));

function subscribe(fn: () => void): () => void {
  window.addEventListener('popstate', fn);
  window.addEventListener(EVENT, fn);
  return () => {
    window.removeEventListener('popstate', fn);
    window.removeEventListener(EVENT, fn);
  };
}

/** The current path (normalised), following `navigate` and the back button. */
export function usePath(): string {
  return useSyncExternalStore(subscribe, () => normalizePath(location.pathname), () => '/');
}

type TurnDoc = Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } };

/**
 * A page change is a page turn in the picture book: the old page swings away on its spine and
 * the next one lies underneath (site.css `::view-transition-*`), while the header stays put. Going
 * further into the site the page turns to the left, coming back it turns to the right. Browsers
 * without view transitions, and reduced motion, just swap the page.
 */
function turnPage(from: string, to: string, update: () => void): void {
  const doc = document as TurnDoc;
  const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!doc.startViewTransition || calm || from === to) {
    update();
    return;
  }
  const order = (p: string) => {
    const i = (SITE_PATHS as readonly string[]).indexOf(p);
    return i < 0 ? SITE_PATHS.length : i;
  };
  const root = document.documentElement;
  root.dataset.turn = order(to) >= order(from) ? 'on' : 'back';
  try {
    const t = doc.startViewTransition(() => flushSync(update));
    void t.finished.finally(() => delete root.dataset.turn);
  } catch {
    update();
  }
}

/** Client-side navigation between site pages; other paths load as a full page. */
export function navigate(href: string): void {
  const url = new URL(href, location.href);
  if (url.origin !== location.origin || !isSitePath(url.pathname)) {
    location.assign(url.href);
    return;
  }
  const from = normalizePath(location.pathname);
  const to = normalizePath(url.pathname);
  const same = url.pathname === location.pathname && url.search === location.search;
  turnPage(from, to, () => {
    if (!same || url.hash !== location.hash) history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new Event(EVENT));
    if (url.hash) requestAnimationFrame(() => document.getElementById(url.hash.slice(1))?.scrollIntoView());
    else if (!same) window.scrollTo({ top: 0 });
  });
}

/** An anchor that moves between site pages without a reload (modifier clicks keep their meaning). */
export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target) return;
    const url = new URL(href, location.href);
    if (url.origin !== location.origin || !isSitePath(url.pathname)) return;
    e.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={handle} {...rest} />;
}
