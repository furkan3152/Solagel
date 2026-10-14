// Configurable matchMedia for jsdom. Reduced motion defaults to OFF; call
// setReducedMotion(true) in a test to exercise the instant/fade paths.
// Listeners are notified so motion's cached preference follows the change.

type Listener = (e: MediaQueryListEvent) => void;

let reduced = false;
const lists = new Set<{ mql: MediaQueryList; listeners: Set<Listener> }>();

function evaluate(query: string): boolean {
  return query.includes('prefers-reduced-motion') ? reduced : false;
}

export function installMatchMedia(): void {
  window.matchMedia = (query: string) => {
    const listeners = new Set<Listener>();
    const mql = {
      get matches() {
        return evaluate(query);
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, l: Listener) => listeners.add(l),
      removeEventListener: (_: string, l: Listener) => listeners.delete(l),
      addListener: (l: Listener) => listeners.add(l),
      removeListener: (l: Listener) => listeners.delete(l),
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
    lists.add({ mql, listeners });
    return mql;
  };
}

export function setReducedMotion(on: boolean): void {
  if (reduced === on) return;
  reduced = on;
  for (const { mql, listeners } of lists) {
    if (!mql.media.includes('prefers-reduced-motion')) continue;
    const ev = { matches: on, media: mql.media } as MediaQueryListEvent;
    for (const l of listeners) l(ev);
  }
}
