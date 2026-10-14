import { useEffect, useRef } from 'react';

/* One requestAnimationFrame loop for every small canvas and HUD readout. */
type Tick = (now: number, dt: number) => void;
const tickers = new Set<Tick>();
let rafId = 0;
let lastTick = typeof performance !== 'undefined' ? performance.now() : 0;

function loop(now: number) {
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  for (const t of tickers) t(now, dt);
  rafId = tickers.size > 0 ? requestAnimationFrame(loop) : 0;
}

/** Calls `fn(now, dtSeconds)` every frame while `active`; the latest `fn` is always used. */
export function useTicker(fn: Tick, active = true): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const t: Tick = (n, d) => ref.current(n, d);
    tickers.add(t);
    if (!rafId) {
      lastTick = performance.now();
      rafId = requestAnimationFrame(loop);
    }
    return () => {
      tickers.delete(t);
    };
  }, [active]);
}
