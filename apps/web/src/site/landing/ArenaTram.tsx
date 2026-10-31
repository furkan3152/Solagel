import { useEffect, useRef, useState, type RefObject } from 'react';
import { ELYSIUM } from '@elymum/shared';
import { useOffscreenPause } from '../../design';

const INK = ELYSIUM.abyss;
const CORAL = ELYSIUM.coral;

/**
 * The ring tram of the arenas map: a little cable car with a coin passenger riding the ring band
 * from Asphodel Meadow to the Isles of the Blessed and back, stopping under each place (its pin
 * hops when the tram pulls in). It follows the same curve the map draws (viewBox 1000 × 300,
 * stretched to the map's width), as a CSS motion path set from JS. Decoration only.
 *
 * Reduced motion (`still`): parked at the first stop. Off screen: the loop stops.
 */

/** The map's ring curve in viewBox units (Landing `ld-map__ring`). */
const P0: [number, number] = [-20, 290];
const P1: [number, number] = [180, -40];
const P2: [number, number] = [820, -40];
const P3: [number, number] = [1020, 290];

function at(t: number): [number, number] {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * P0[0] + b * P1[0] + c * P2[0] + d * P3[0], a * P0[1] + b * P1[1] + c * P2[1] + d * P3[1]];
}

/** Arc-length fraction (0..1) of the point on the curve at viewBox x, for a map `w` px wide. */
function stopsFor(xs: number[], w: number): number[] {
  const N = 240;
  const pts: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const [x, y] = at(i / N);
    pts.push([(x * w) / 1000, y]);
  }
  const len = [0];
  for (let i = 1; i <= N; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = len[N];
  return xs.map((vx) => {
    const px = (vx * w) / 1000;
    let i = 0;
    while (i < N && pts[i][0] < px) i++;
    return len[i] / total;
  });
}

const TRAVEL = 1.9;
const DWELL = 1.3;
/** Stop order: there and back again. */
const ROUTE = [0, 1, 2, 3, 2, 1];

export function ArenaTram({ stopsX, places, still }: { stopsX: number[]; places: RefObject<HTMLElement | null>; still: boolean }) {
  const [ref, visible] = useOffscreenPause<HTMLDivElement>();
  const car = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  useEffect(() => {
    const el = car.current;
    if (!el || !w) return;
    const k = w / 1000;
    el.style.offsetPath = `path('M${P0[0] * k} ${P0[1]} C${P1[0] * k} ${P1[1]} ${P2[0] * k} ${P2[1]} ${P3[0] * k} ${P3[1]}')`;
    const stops = stopsFor(
      stopsX.map((x) => x * 10),
      w,
    );
    const lis = () => [...(places.current?.querySelectorAll<HTMLElement>('.ld-place') ?? [])];
    const put = (d: number, dir: number) => {
      el.style.offsetDistance = `${(d * 100).toFixed(3)}%`;
      el.dataset.dir = dir < 0 ? 'back' : 'on';
    };
    if (still || !visible) {
      put(stops[0], 1);
      return;
    }
    const leg = TRAVEL + DWELL;
    const loop = ROUTE.length * leg;
    let raf = 0;
    let lastStop = -1;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = ((now - t0) / 1000) % loop;
      const i = Math.floor(t / leg);
      const from = ROUTE[i];
      const to = ROUTE[(i + 1) % ROUTE.length];
      const f = t - i * leg;
      let stopAt = -1;
      if (f < DWELL) {
        put(stops[from], stops[to] - stops[from]);
        stopAt = from;
      } else {
        const p = (f - DWELL) / TRAVEL;
        const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
        put(stops[from] + (stops[to] - stops[from]) * e, stops[to] - stops[from]);
      }
      if (stopAt !== lastStop) {
        lastStop = stopAt;
        lis().forEach((li, j) => li.classList.toggle('is-stop', j === stopAt));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      lis().forEach((li) => li.classList.remove('is-stop'));
    };
  }, [w, still, visible, stopsX, places]);

  return (
    <div ref={ref} className="ld-tram" aria-hidden="true">
      <div ref={car} className="ld-tram__car">
        <svg viewBox="-42 -58 84 64" width="84" height="64" overflow="visible">
          <g stroke={INK} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round">
            {/* the pantograph */}
            <path d="M-8 -42 l8 -11 l8 11 M-13 -54 h26" fill="none" />
            {/* the cabin: cream body, coral roof, a sun stripe */}
            <path d="M-30 -42 h60 q6 0 6 6 v28 q0 6 -6 6 h-60 q-6 0 -6 -6 v-28 q0 -6 6 -6z" fill={ELYSIUM.cream} />
            <path d="M-30 -42 h60 q6 0 6 6 v3 h-72 v-3 q0 -6 6 -6z" fill={CORAL} />
            <path d="M-36 -9 h72" fill="none" />
            <rect x="-28" y="-28" width="26" height="15" rx="4" fill={ELYSIUM.mist} />
            <rect x="4" y="-28" width="24" height="15" rx="4" fill={ELYSIUM.mist} />
          </g>
          <path d="M-33 -8 h66 v3 h-66z" fill={ELYSIUM.sun} />
          {/* the passenger coin peeking out of the front window */}
          <g className="ld-tram__rider">
            <circle cx="-15" cy="-15" r="9" fill={ELYSIUM.sun} stroke={INK} strokeWidth="2.5" />
            <circle cx="-18.5" cy="-18" r="2.6" fill="#fff" stroke={INK} strokeWidth="1.2" />
            <circle cx="-11.5" cy="-18" r="2.6" fill="#fff" stroke={INK} strokeWidth="1.2" />
            <circle className="ld-tram__eye" cx="-18.5" cy="-18" r="1.3" fill={INK} />
            <circle className="ld-tram__eye" cx="-11.5" cy="-18" r="1.3" fill={INK} />
            <path d="M-18 -11 q3 2.6 6 0" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
          </g>
          <g fill={INK}>
            <circle cx="-18" cy="0" r="4.5" />
            <circle cx="18" cy="0" r="4.5" />
          </g>
          <g fill={ELYSIUM.sand}>
            <circle cx="-18" cy="0" r="1.6" />
            <circle cx="18" cy="0" r="1.6" />
          </g>
        </svg>
      </div>
    </div>
  );
}
