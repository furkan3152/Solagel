import { useReducedMotion as useMotionReducedMotion, type Transition } from 'motion/react';

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
  /** Stamp landing (used by springy follow-ups; the stamp itself is keyed). */
  stamp: { type: 'spring', stiffness: 700, damping: 18, mass: 0.7 },
  /** Odometer wheels and indicators. */
  dial: { type: 'spring', stiffness: 260, damping: 26, mass: 0.8 },
} as const satisfies Record<string, Transition>;

export type SpringName = keyof typeof springs;

export const durations = { micro: 0.15, screen: 0.32, stamp: 0.42 } as const;

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
  duration: durations.stamp,
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

export const reducedTransitions = { instant: INSTANT, fade: FADE } as const;
