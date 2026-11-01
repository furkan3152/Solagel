import type { MintState } from '@elymum/shared';
import { SiteApiError, site } from '../api';

/**
 * The mint state outside the mint page's heavy chunk (no wallet code, no viem): a fetch with a
 * timeout and retries, an early start (the site entry kicks it off for `/mint` while the page's
 * code is still downloading) and the last answer kept in localStorage, so a return visit paints
 * the real card at once and refreshes it behind the scenes.
 */

const KEY = 'elymum.mint-state.v1';
/** Older than this, a kept state is not shown (the phase or the supply may have moved a lot). */
const MAX_AGE_MS = 3 * 24 * 3600_000;

export interface CachedMint {
  state: MintState;
  /** When the server answered (ms since epoch). */
  at: number;
}

/** The last mint state this browser saw, or null (none, too old, unreadable, or no storage). */
export function readCachedMint(now = Date.now()): CachedMint | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<CachedMint>;
    if (!v || typeof v.at !== 'number' || !v.state || typeof v.state !== 'object' || !('contract' in v.state)) return null;
    if (now - v.at > MAX_AGE_MS || v.at > now + 60_000) return null;
    return { state: v.state, at: v.at };
  } catch {
    return null;
  }
}

export function writeCachedMint(state: MintState, at = Date.now()): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ state, at }));
  } catch {
    /* no storage (private window, quota): the page still works */
  }
}

export interface FetchMintOpts {
  /** Per try (default 8 s). */
  timeoutMs?: number;
  /** Extra tries after the first (default 2). */
  retries?: number;
  /** Wait before try n (1-based), ms. */
  backoff?: (n: number) => number;
  signal?: AbortSignal;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
  });

/** A try worth repeating: the network, a timeout, the server busy or failing (not a 4xx answer). */
const retryable = (e: unknown) => !(e instanceof SiteApiError) || e.code === 'network' || e.code === 'rate_limited' || e.status >= 500;

/** `GET /api/site/mint` with a timeout per try and retries with backoff. Rejects with the last error. */
export async function fetchMintState({ timeoutMs = 8000, retries = 2, backoff = (n) => 1000 * 2 ** (n - 1), signal }: FetchMintOpts = {}): Promise<MintState> {
  let last: unknown;
  for (let n = 0; n <= retries; n++) {
    if (n > 0) await sleep(backoff(n), signal);
    const ctrl = new AbortController();
    const stop = () => ctrl.abort();
    signal?.addEventListener('abort', stop, { once: true });
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // the race also covers a fetch that ignores the abort
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
        reject(new DOMException('timed out', 'TimeoutError'));
      }, timeoutMs);
    });
    try {
      const s = await Promise.race([site.mint(ctrl.signal), timeout]);
      writeCachedMint(s);
      return s;
    } catch (e) {
      if (signal?.aborted) throw e;
      last = timedOut ? new SiteApiError(0, 'network', 'The mint is taking too long to answer. Try again in a moment.') : e;
      if (!retryable(last)) break;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
    }
  }
  throw last;
}

let early: { p: Promise<MintState>; at: number } | null = null;

/** Starts loading the mint state now (idempotent while one is in flight). */
export function prefetchMintState(): void {
  if (early) return;
  const p = fetchMintState();
  early = { p, at: Date.now() };
  // a failed early start is not reported here: the page asks again and shows its own error
  p.catch(() => {});
}

/** The early start, once (later loads fetch afresh). Null when none was started in the last 20 s. */
export function takeEarlyMint(): Promise<MintState> | null {
  const e = early;
  early = null;
  return e && Date.now() - e.at < 20_000 ? e.p : null;
}

/** For tests. */
export function resetMintState(): void {
  early = null;
}
