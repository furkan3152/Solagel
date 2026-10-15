import { useReducedMotion as useMotionReducedMotion, type Transition } from 'motion/react';
import { DUR, EASE } from './curves';

/**
 * Motion rules:
 *  - micro interactions 120–180 ms, screen transitions 260–360 ms with a spring
 *    that overshoots, stamp 420 ms (1.4 → 1 scale, 2–3° turn, ink spread);
 *  - buttons collapse 3–4 px like a press, numbers count, lists stagger 30 ms;
 *  - prefers-reduced-motion: loops stop, transitions shorten to fades.
 */

export const springs = {
  /** Buttons and tickets: stiff, a hair of overshoot, settles ~150 ms. */
  press: { type: 'spring', stiffness: 900, damping: 32, mass: 0.6 },
  /** Sheets and screen changes: ~320 ms with a visible overshoot. */
  sheet: { type: 'spring', stiffness: 420, damping: 32, mass: 0.9 },
  /** Stamp: the 2–3° turn settling after impact (Stamp uses it for `rotate`). */
  stamp: { type: 'spring', stiffness: 700, damping: 18, mass: 0.7 },
  /** Odometer wheels and indicators. */
  dial: { type: 'spring', stiffness: 260, damping: 26, mass: 0.8 },
  /** Newspaper page turn: a heavier sheet that swings in and settles its skew. */
  page: { type: 'spring', stiffness: 320, damping: 26, mass: 1 },
  /** A pinned note swinging on its tape until it hangs still. */
  pin: { type: 'spring', stiffness: 380, damping: 14, mass: 0.8 },
} as const satisfies Record<string, Transition>;

export { clamp01, bezier, EASE, DUR, zoomIn, dropScale, DROP_LAND, slowmoScale, SLOWMO_TOTAL } from './curves';

/**
 * Named transitions of the motion table (spec "Motion"): page turn, screen wipe,
 * ticket punch, coin drop. Each has a reduced-motion twin (opacity ≤ 150 ms).
 */
export const presets = {
  /** Lobby tab change. `dir` is +1 for a page to the right, −1 to the left. */
  page: {
    enter: (dir: number) => ({ opacity: 0, x: 44 * dir, rotate: 2.6 * dir, skewY: 0.8 * dir }),
    center: { opacity: 1, x: 0, rotate: 0, skewY: 0 },
    exit: (dir: number) => ({ opacity: 0, x: -30 * dir, rotate: -1.2 * dir, transition: { duration: 0.16, ease: EASE.flick } }),
  },
  /** Reduced motion: a plain fade. */
  fade: {
    enter: { opacity: 0 },
    center: { opacity: 1 },
    exit: { opacity: 0, transition: { duration: DUR.fade, ease: 'linear' } },
  },
  /** Transition timing of the wipe and punch (seconds). */
  wipe: { duration: DUR.wipe, ease: EASE.wipe },
  punch: { duration: DUR.punch, ease: EASE.paper },
  drop: { duration: DUR.drop },
} as const;

export type SpringName = keyof typeof springs;

/** Lists appear 30 ms apart. */
export const STAGGER = 0.03;

/** Printer feel: snaps forward in `steps` ticks with a short hold between. */
export function printerEase(steps: number): (t: number) => number {
  return (t) => {
    if (t >= 1) return 1;
    const x = t * steps;
    const i = Math.floor(x);
    const f = Math.min(1, (x - i) * 2.6);
    return (i + f * f * (3 - 2 * f)) / steps;
  };
}

/** The 420 ms stamp: hits at 70 %, squashes a touch, settles. */
export const stampKeyframes: Transition = {
  times: [0, 0.7, 1],
  duration: 0.42,
  ease: ['easeIn', 'easeOut'],
};

const INSTANT: Transition = { duration: 0 };
const FADE: Transition = { duration: 0.12, ease: 'linear' };

/**
 * The single source of truth for reduced motion in the design system. Wraps
 * motion's hook (which follows `prefers-reduced-motion`) so every component
 * asks the same question.
 */
export function useReducedMotion(): boolean {
  return useMotionReducedMotion() ?? false;
}

/**
 * Transition for a named spring, or an instant/fade transition when reduced
 * motion is on. `fade: true` keeps a short opacity-only fade for elements
 * whose entrance should not pop in.
 */
export function usePreset(name: SpringName, opts: { fade?: boolean } = {}): Transition {
  const reduced = useReducedMotion();
  if (reduced) return opts.fade ? FADE : INSTANT;
  return springs[name];
}

/**
 * Staggered entrance of the `i`-th row of a list (30 ms apart, capped at 20
 * rows): printed onto the page from a few px below. Reduced motion: no motion.
 */
export function staggerIn(
  i: number,
  reduced: boolean,
  opts: { delay?: number; x?: number; y?: number; step?: number } = {},
): { initial: false | { opacity: number; x: number; y: number }; animate: { opacity: number; x: number; y: number }; transition: Transition } {
  const { delay = 0, x = 0, y = 6, step = STAGGER } = opts;
  return {
    initial: reduced ? false : { opacity: 0, x, y },
    animate: { opacity: 1, x: 0, y: 0 },
    transition: { duration: 0.24, ease: EASE.paper, delay: delay + Math.min(i, 20) * step },
  };
}
