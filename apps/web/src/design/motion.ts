import { useReducedMotion as useMotionReducedMotion, type Transition, type Variants } from 'motion/react';
import { DUR, EASE } from './curves';

/**
 * Motion rules (spec §6.6, Ring Storybook):
 *  - things are stickers and toys: they pop, drop, sink into their shadow and
 *    bob; springs for coins, buttons and stickers, `EASE.out` for the rest;
 *  - 160 ms state, 320 ms enter, 640 ms scene; lists stagger 40 ms;
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
  /** Storybook pop: a sticker or coin bouncing to full size. */
  pop: { type: 'spring', stiffness: 520, damping: 17, mass: 0.7 },
  /** A sticker slapped down on the page: falls, squashes, settles its tilt. */
  drop: { type: 'spring', stiffness: 360, damping: 20, mass: 0.9 },
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

/** Lists appear 40 ms apart (spec §6.6). */
export const STAGGER = 0.04;

/**
 * Storybook moves (spec §6.6) as motion variants: `hidden` → `shown`
 * (`rest` / `pressed` for press, `still` / `moving` for loops). Use with
 * `initial="hidden" animate="shown"`, or through `useMoves()`, which swaps in
 * the reduced-motion twins (a 120 ms fade; loops stand still).
 */
export const moves = {
  /** A sticker or coin popping into existence: 0.6 → 1 with a bounce. */
  popIn: {
    hidden: { opacity: 0, scale: 0.6, rotate: -4 },
    shown: { opacity: 1, scale: 1, rotate: 0, transition: springs.pop },
  },
  /** A sticker slapped onto the page from above; lands on its tilt (custom = degrees). */
  stickerDrop: {
    hidden: (tilt: number = -1.5) => ({ opacity: 0, y: -28, scale: 1.06, rotate: tilt - 5 }),
    shown: (tilt: number = -1.5) => ({ opacity: 1, y: 0, scale: 1, rotate: tilt, transition: { ...springs.drop, opacity: { duration: 0.12 } } }),
  },
  /** A button sinking into its hard shadow. Pair with the CSS shadow (or use the .kb-btn press). */
  press: {
    rest: { x: 0, y: 0 },
    hover: { x: -1, y: -1 },
    pressed: { x: 3, y: 3, transition: springs.press },
  },
  /** The idle bob of a coin character (2.6 s loop). */
  bob: {
    still: { y: 0 },
    moving: { y: [0, -7, 0], transition: { duration: 2.6, ease: 'easeInOut', repeat: Infinity } },
  },
  /** One chomp: a squash towards the food and back. */
  chomp: {
    still: { scaleX: 1, scaleY: 1, x: 0 },
    moving: {
      scaleX: [1, 1.08, 0.96, 1],
      scaleY: [1, 0.9, 1.05, 1],
      x: [0, 6, 0, 0],
      transition: { duration: 0.42, times: [0, 0.35, 0.7, 1], ease: 'easeOut' },
    },
  },
  /** A parent that staggers its children 40 ms apart (children use any `hidden`/`shown` move). */
  stagger: {
    hidden: {},
    shown: { transition: { staggerChildren: STAGGER, delayChildren: 0.04 } },
  },
} as const satisfies Record<string, Variants>;

export type MoveName = keyof typeof moves;

const REDUCED_MOVES: Record<MoveName, Variants> = {
  popIn: { hidden: { opacity: 0 }, shown: { opacity: 1, transition: { duration: 0.12 } } },
  stickerDrop: {
    hidden: (tilt: number = -1.5) => ({ opacity: 0, rotate: tilt }),
    shown: (tilt: number = -1.5) => ({ opacity: 1, rotate: tilt, transition: { duration: 0.12 } }),
  },
  press: { rest: {}, hover: {}, pressed: {} },
  bob: { still: { y: 0 }, moving: { y: 0 } },
  chomp: { still: {}, moving: {} },
  stagger: { hidden: {}, shown: {} },
};

/** The Storybook moves, or their reduced-motion twins when the user asks for less motion. */
export function useMoves(): Record<MoveName, Variants> {
  return useReducedMotion() ? REDUCED_MOVES : moves;
}

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
