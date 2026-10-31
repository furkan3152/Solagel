import { vi } from 'vitest';

export interface Call {
  method: string;
  path: string;
  body: unknown;
  auth: string | null;
}

type Handler = (call: Call) => unknown | Response | Promise<unknown | Response>;

/**
 * A fetch stand-in for the site API: `routes` maps "METHOD /path" (query string ignored, or kept
 * when the key has one) to a JSON body, a Response or a handler. Unmatched calls answer 404.
 */
export function mockFetch(routes: Record<string, unknown | Handler>): { calls: Call[]; restore: () => void } {
  const calls: Call[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: Call = { method, path: url.pathname + url.search, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: headers.Authorization ?? null };
    calls.push(call);
    const route = routes[`${method} ${url.pathname}${url.search}`] ?? routes[`${method} ${url.pathname}`];
    if (route === undefined) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    const out = typeof route === 'function' ? await (route as Handler)(call) : route;
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = orig) };
}

export const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** jsdom has no IntersectionObserver or 2D canvas: quiet stand-ins. */
export function installDomStubs(): void {
  class IO {
    constructor(private cb: IntersectionObserverCallback) {}
    observe(el: Element) {
      this.cb([{ isIntersecting: false, target: el } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = IO;
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  Element.prototype.scrollIntoView = () => {};
}

export const SETTINGS = { wlOpen: true, collabOpen: true, gameAccess: 'admins' as const, xHandle: 'elymumio', launchPostUrl: null };
