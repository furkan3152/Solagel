import type { ComponentType } from 'react';

/**
 * The site's lazily loaded pages, keyed by path. `warmPage` starts a page's chunk download (and
 * evaluation) ahead of time, on link hover / touchstart / focus, so the click finds it ready and
 * the page turn never waits on the network or flashes the loader. `/play` is its own entry
 * (a full page load): warming it fetches the game gate's chunk into the HTTP cache.
 */
type Loader = () => Promise<ComponentType>;

const LOADERS: Record<string, Loader> = {
  '/wl': () => import('./wl/WlPage').then((m) => m.WlPage),
  '/collab': () => import('./collab/CollabPage').then((m) => m.CollabPage),
  '/docs': () => import('./DocsRoute').then((m) => m.DocsRoute),
  '/mint': () => import('./mint/MintPage').then((m) => m.MintPage),
  '/faucet': () => import('./faucet/FaucetPage').then((m) => m.FaucetPage),
};

const loaded = new Map<string, ComponentType>();
const pending = new Map<string, Promise<ComponentType | null>>();

/** A page component that is already loaded (render it directly: no Suspense, no loader flash). */
export function loadedPage(path: string): ComponentType | null {
  return loaded.get(path) ?? null;
}

/** True when `path` is a lazily loaded site page. */
export const isLazyPage = (path: string): boolean => path in LOADERS;

/**
 * Starts loading the page at `path` (idempotent). Resolves with its component, or null for paths
 * that need no chunk (the landing) or when the download failed (the next try starts over).
 */
export function warmPage(path: string): Promise<ComponentType | null> {
  const hit = loaded.get(path);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(path);
  if (inflight) return inflight;
  if (path === '/play') {
    const p = import('./play/start').then(
      () => null,
      () => null,
    );
    pending.set(path, p);
    return p;
  }
  const load = LOADERS[path];
  if (!load) return Promise.resolve(null);
  const p = load().then(
    (c) => {
      loaded.set(path, c);
      pending.delete(path);
      return c;
    },
    () => {
      pending.delete(path);
      return null;
    },
  );
  pending.set(path, p);
  return p;
}

/** For tests. */
export function resetPages(): void {
  loaded.clear();
  pending.clear();
}
