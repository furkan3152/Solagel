import { useSyncExternalStore, type AnchorHTMLAttributes, type FocusEvent, type MouseEvent, type TouchEvent } from 'react';
import { flushSync } from 'react-dom';
import { isLazyPage, loadedPage, warmPage } from './pages';

/** Paths the site app renders itself; anything else (`/play`, `/admin`) is a full page load. */
export const SITE_PATHS = ['/', '/play', '/mint', '/faucet', '/wl', '/collab', '/docs'] as const;
export type SitePath = (typeof SITE_PATHS)[number];

/** `/play` is listed for the page-turn order only: it is its own entry (a full page load). */
const FULL_LOAD = new Set(['/play']);

const EVENT = 'site:navigate';

/** How long a click waits for a page that was not warmed before the turn happens anyway (the loader shows then). */
export const WARM_WAIT_MS = 600;

export function normalizePath(pathname: string): string {
  const p = pathname.replace(/\/+$/, '') || '/';
  return p.toLowerCase();
}

export const isSitePath = (pathname: string): pathname is SitePath => {
  const p = normalizePath(pathname);
  return (SITE_PATHS as readonly string[]).includes(p) && !FULL_LOAD.has(p);
};

/** The path the page shows now (the previous page while a back/forward turn waits for its chunk). */
let shown: string | null = null;
const shownPath = () => (shown ??= normalizePath(typeof location === 'undefined' ? '/' : location.pathname));

function emit(): void {
  shown = normalizePath(location.pathname);
  window.dispatchEvent(new Event(EVENT));
}

/** Bumped by every navigation: a slow warm-up of an older click never wins over a newer one. */
let seq = 0;

/** Waits for the page chunk (at most `WARM_WAIT_MS`); instant when it is warm or needs none. */
function whenReady(path: string): Promise<void> | null {
  if (!isLazyPage(path) || loadedPage(path)) return null;
  return Promise.race([warmPage(path).then(() => undefined), new Promise<void>((r) => setTimeout(r, WARM_WAIT_MS))]);
}

let popBound = false;
/** Back / forward: the same page turn as a click (the URL already changed; the page follows once ready). */
function bindPop(): void {
  if (popBound || typeof window === 'undefined') return;
  popBound = true;
  window.addEventListener('popstate', () => {
    const from = shownPath();
    const to = normalizePath(location.pathname);
    const mine = ++seq;
    const go = () => {
      if (mine !== seq) return;
      turnPage(from, to, () => {
        emit();
        if (from !== to && !location.hash) window.scrollTo({ top: 0 });
      });
    };
    const wait = whenReady(to);
    if (wait) void wait.then(go);
    else go();
  });
}

function subscribe(fn: () => void): () => void {
  bindPop();
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

/** The current path (normalised), following `navigate` and the back button. */
export function usePath(): string {
  return useSyncExternalStore(
    subscribe,
    () => {
      const p = normalizePath(location.pathname);
      shown = p;
      return p;
    },
    () => '/',
  );
}

type TurnDoc = Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } };

/** Page-turn order (further into the site turns left, coming back turns right). */
const order = (p: string) => {
  const i = (SITE_PATHS as readonly string[]).indexOf(p);
  return i < 0 ? SITE_PATHS.length : i;
};

/**
 * A page change is a quick page turn in the picture book (site.css `::view-transition-*`, under
 * 280 ms): the old page tips away on its spine while the next one settles up from under it, and
 * the header stays put. Going further into the site the page turns to the left, coming back it
 * turns to the right; back / forward turn the same way. Browsers without view transitions, and
 * reduced motion, just swap the page.
 */
function turnPage(from: string, to: string, update: () => void): void {
  const doc = document as TurnDoc;
  const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!doc.startViewTransition || calm || from === to) {
    update();
    return;
  }
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
  const from = shownPath();
  const to = normalizePath(url.pathname);
  const same = url.pathname === location.pathname && url.search === location.search;
  const mine = ++seq;
  const go = () => {
    if (mine !== seq) return;
    turnPage(from, to, () => {
      if (!same || url.hash !== location.hash) history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`);
      emit();
      if (url.hash) requestAnimationFrame(() => document.getElementById(url.hash.slice(1))?.scrollIntoView());
      else if (!same) window.scrollTo({ top: 0 });
    });
  };
  const wait = whenReady(to);
  if (wait) void wait.then(go);
  else go();
}

/** Warms the page behind a link (its code chunk), so the click turns the page at once. */
export function prefetch(href: string): void {
  try {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return;
    void warmPage(normalizePath(url.pathname));
  } catch {
    /* not a URL */
  }
}

/**
 * An anchor that moves between site pages without a reload (modifier clicks keep their meaning).
 * Hovering, focusing or touching it warms the next page's code, so the click is instant.
 */
export function Link({ href, onClick, onPointerEnter, onTouchStart, onFocus, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target) return;
    const url = new URL(href, location.href);
    if (url.origin !== location.origin || !isSitePath(url.pathname)) return;
    e.preventDefault();
    navigate(href);
  };
  return (
    <a
      href={href}
      onClick={handle}
      onPointerEnter={(e: MouseEvent<HTMLAnchorElement>) => {
        onPointerEnter?.(e as never);
        prefetch(href);
      }}
      onTouchStart={(e: TouchEvent<HTMLAnchorElement>) => {
        onTouchStart?.(e);
        prefetch(href);
      }}
      onFocus={(e: FocusEvent<HTMLAnchorElement>) => {
        onFocus?.(e);
        prefetch(href);
      }}
      {...rest}
    />
  );
}
