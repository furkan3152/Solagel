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
/** The last download failure per path (a stale tab after a deploy, or the network). */
const failed = new Map<string, unknown>();

/** True when the last try to load the page at `path` failed. */
export const pageFailed = (path: string): boolean => failed.has(path);

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
      failed.delete(path);
      pending.delete(path);
      return c;
    },
    (err: unknown) => {
      failed.set(path, err);
      pending.delete(path);
      return null;
    },
  );
  pending.set(path, p);
  return p;
}

/**
 * `warmPage` for rendering: resolves with the component, rejects with the download error (so
 * the page can recover: reload once, or offer a retry; never a 404 for a page that exists).
 */
export async function loadPage(path: string): Promise<ComponentType> {
  const c = await warmPage(path);
  if (c) return c;
  throw new ChunkLoadError(path, failed.get(path));
}

/** A page's code could not be downloaded (browsers word this differently; the name is what counts). */
export class ChunkLoadError extends Error {
  override name = 'ChunkLoadError';
  constructor(
    readonly path: string,
    override readonly cause?: unknown,
  ) {
    super(`The code for ${path} could not be loaded${cause instanceof Error ? `: ${cause.message}` : '.'}`);
  }
}

/** For tests. */
export function resetPages(): void {
  loaded.clear();
  pending.clear();
  failed.clear();
}
