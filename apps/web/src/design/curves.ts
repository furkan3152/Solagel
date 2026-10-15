/**
 * Plain timing curves shared by the DOM transitions (motion presets) and the
 * canvas (camera, renderer). No dependencies, so the engine can use them.
 * Every function takes a progress or a time and is pure.
 */

export const clamp01 = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t);

/** Cubic-bezier easing (CSS semantics) for the rare place that needs one outside motion. */
export function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  return (t) => {
    const x = clamp01(t);
    let u = x;
    for (let i = 0; i < 8; i++) {
      const d = ((3 * ax * u + 2 * bx) * u + cx) || 1e-6;
      const e = sx(u) - x;
      if (Math.abs(e) < 1e-5) break;
      u = clamp01(u - e / d);
    }
    return sy(u);
  };
}

/** Easing arrays for motion (cubic-bezier control points). */
export const EASE = {
  /** Paper settling: quick out, long soft landing. */
  paper: [0.2, 0.9, 0.25, 1],
  /** The screen wipe: hesitates like a punch going through, then opens. */
  wipe: [0.7, 0, 0.2, 1],
  /** Leaving with a flick of the finger. */
  flick: [0.55, 0, 0.9, 0.45],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/** Durations in seconds (spec: 180–600 ms; reduced motion: fades ≤ 150 ms). */
export const DUR = {
  /** Ticket punch: hole + chads, before the wipe opens. */
  punch: 0.18,
  /** Lobby ↔ game paper wipe. */
  wipe: 0.56,
  /** Coin drop onto the paper (join / respawn). */
  drop: 0.56,
  /** Camera from far to normal on entering a room. */
  zoomIn: 1.15,
  /** Out of the lobby, the coin drops once the wipe has opened this far (s after the join). */
  dropDelay: 0.32,
  /** Death slow motion (hold at 0.3, then back). */
  slowmo: 0.4,
  /** Reduced motion fade. */
  fade: 0.15,
} as const;

/**
 * Camera zoom multiplier while entering a room: starts far (`from`) and lands
 * on 1 with an ease-out that has no overshoot (the world must not bounce).
 */
export function zoomIn(t: number, from = 0.42): number {
  const k = clamp01(t);
  const e = 1 - Math.pow(1 - k, 3);
  return from + (1 - from) * e;
}

/**
 * Coin drop: scale of a coin falling onto the paper. Starts large (close to the
 * eye), lands at 55 % with a squash below 1, rebounds a hair over and settles.
 * Returns 1 from t ≥ 1.
 */
export function dropScale(t: number): number {
  if (t >= 1) return 1;
  if (t <= 0) return 1.9;
  const LAND = 0.55;
  if (t < LAND) {
    const k = t / LAND;
    // accelerating fall
    return 1.9 - 0.98 * k * k;
  }
  // a damped bounce around 1: 0.92 at landing → 1.02 → 1
  const k = (t - LAND) / (1 - LAND);
  return 1 - 0.08 * Math.cos(k * Math.PI * 1.5) * Math.exp(-2 * k);
}

/** The drop's landing moment (progress), where the ink ring goes off. */
export const DROP_LAND = 0.55;

/**
 * Death slow motion: the renderer's time scale `t` seconds after the death.
 * Eases to 0.3 in 80 ms, holds until `DUR.slowmo`, eases back to 1 by +250 ms.
 */
export function slowmoScale(t: number): number {
  if (t < 0) return 1;
  const IN = 0.08;
  const HOLD = DUR.slowmo;
  const OUT = 0.25;
  const LOW = 0.3;
  const smooth = (x: number) => x * x * (3 - 2 * x);
  if (t < IN) return 1 - (1 - LOW) * smooth(t / IN);
  if (t < HOLD) return LOW;
  if (t < HOLD + OUT) return LOW + (1 - LOW) * smooth((t - HOLD) / OUT);
  return 1;
}

/** Whole slow-motion length in seconds (scale back at 1). */
export const SLOWMO_TOTAL = DUR.slowmo + 0.25;
