import { ELYSIUM } from '@elymum/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { CoinMark, Seigaiha, useReducedMotion } from '../../design';

/**
 * The mint's rituals: the wax seal on the emblem (it trembles while the wallet works, and breaks
 * when the mint lands), the fanned hand of emblem cards next to the quantity, the split-flap price
 * and the two-faced emblem card that flips over to show what you got. Decorative pieces are
 * aria-hidden; reduced motion shows every end state still.
 */

const INK = ELYSIUM.abyss;
/** Sealing wax: the coral paint with its own shade. */
const WAX = ELYSIUM.coral;
const WAX_S = '#B4573A';

/** The wax blob outline (a lumpy circle, the wax squeezed out under the press). */
const BLOB =
  'M50 6 C60 4 66 12 74 13 C83 15 86 25 91 32 C96 40 93 50 95 58 C97 68 88 74 84 82 C79 91 68 90 60 94 C51 98 43 92 35 92 C25 92 19 84 13 77 C7 70 8 60 5 51 C2 42 9 35 12 27 C16 18 25 16 32 11 C38 7 44 7 50 6Z';

/** The two halves of the broken seal (left, right), split along a jagged crack. */
const CRACK = 'M47 4 L54 22 L44 36 L56 50 L46 64 L55 78 L48 96';
const HALF_L = 'M47 4 C40 5 34 7 28 10 C14 18 6 32 4 50 C3 66 10 80 22 88 C30 93 40 96 48 96 L55 78 L46 64 L56 50 L44 36 L54 22Z';
const HALF_R = 'M47 4 C60 4 70 10 80 16 C92 26 97 42 95 58 C93 74 82 88 66 94 C60 96 54 96 48 96 L55 78 L46 64 L56 50 L44 36 L54 22Z';

function SealFace() {
  return (
    <>
      <circle cx={50} cy={50} r={31} fill={WAX_S} stroke={INK} strokeWidth={2.5} />
      <circle cx={48} cy={48} r={28} fill={WAX} />
      <circle cx={50} cy={50} r={31} fill="none" stroke={INK} strokeWidth={2.5} />
      {/* the pressed E of the coin mark */}
      <path d="M58 34 H42 V64 H58 M42 49 H55" fill="none" stroke={WAX_S} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M57 33 H41 V63 H57 M41 48 H54" fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" opacity={0.75} />
      <path d="M22 36 a30 30 0 0 1 14 -14" stroke="#FFFFFF" strokeWidth={3.5} fill="none" strokeLinecap="round" opacity={0.6} />
    </>
  );
}

/**
 * The wax seal pressed on the emblem. `state`: `sealed` (still), `trembling` (the mint is in
 * flight: it shakes and a crack starts to show), `cracked` (a crack drawn through it).
 */
export function WaxSeal({ size = 74, state = 'sealed', className }: { size?: number; state?: 'sealed' | 'trembling' | 'cracked'; className?: string }): ReactElement {
  return (
    <svg className={`mt-wax mt-wax--${state}${className ? ` ${className}` : ''}`} viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" focusable="false" overflow="visible">
      <path d={BLOB} fill={INK} transform="translate(4 4)" />
      <path d={BLOB} fill={WAX} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <path d="M20 74 C30 86 50 90 70 86" stroke={WAX_S} strokeWidth={5} fill="none" strokeLinecap="round" />
      <SealFace />
      {state !== 'sealed' && <path className="mt-wax__crack" d={CRACK} fill="none" stroke={INK} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" pathLength={1} />}
    </svg>
  );
}

/**
 * The unsealing, at the start of the minted moment: the big wax seal drops in, shakes, a crack runs
 * through it, light leaks out from behind, it breaks in two with a snap and the halves tumble away.
 * `onSnap` fires at the break (the starburst and the emblems follow it). Reduced motion: nothing
 * (and `onSnap` right away).
 */
export function SealBreak({ size = 200, onSnap }: { size?: number; onSnap?: () => void }): ReactElement | null {
  const reduced = useReducedMotion();
  const snapped = useRef(false);
  const fire = () => {
    if (snapped.current) return;
    snapped.current = true;
    onSnap?.();
  };
  // a backstop in case the animation never reports back (a background tab, say)
  useEffect(() => {
    const t = setTimeout(fire, reduced ? 0 : 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (reduced) return null;
  // CSS keyframes (mint.css, `mt-unseal`): they run on the compositor, so the confetti and the
  // emblems mounting at the snap cannot stall the break
  return (
    <div className="mt-unseal" aria-hidden="true" style={{ width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 }}>
      <svg className="mt-unseal__rays" viewBox="-100 -100 200 200" overflow="visible" focusable="false">
        {Array.from({ length: 12 }, (_, i) => (
          <path key={i} d="M-8 -60 L0 -98 L8 -60Z" fill={i % 2 ? ELYSIUM.sun : ELYSIUM.cream} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" transform={`rotate(${i * 30})`} />
        ))}
      </svg>
      <svg className="mt-unseal__whole" viewBox="0 0 100 100" overflow="visible" focusable="false" onAnimationEnd={(e) => e.target === e.currentTarget && fire()}>
        <path d={BLOB} fill={INK} transform="translate(4 4)" />
        <path d={BLOB} fill={WAX} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
        <SealFace />
        <path className="mt-unseal__crack" d={CRACK} fill="none" stroke={INK} strokeWidth={3.4} strokeLinejoin="round" strokeLinecap="round" pathLength={1} />
      </svg>
      {[HALF_L, HALF_R].map((d, i) => (
        <svg key={i} className={`mt-unseal__half mt-unseal__half--${i ? 'r' : 'l'}`} viewBox="0 0 100 100" overflow="visible" focusable="false">
          <path d={d} fill={INK} transform="translate(3 3)" />
          <path d={d} fill={WAX} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
        </svg>
      ))}
      <svg className="mt-unseal__snap" viewBox="-60 -60 120 120" overflow="visible" focusable="false" onAnimationStart={fire}>
        {Array.from({ length: 10 }, (_, i) => {
          const a = (i / 10) * Math.PI * 2;
          return <line key={i} x1={Math.cos(a) * 42} y1={Math.sin(a) * 42} x2={Math.cos(a) * 56} y2={Math.sin(a) * 56} stroke={ELYSIUM.sun} strokeWidth={5} strokeLinecap="round" />;
        })}
      </svg>
    </div>
  );
}

/**
 * The hand of emblem cards beside the quantity: one sealed card per emblem, fanned like a hand of
 * cards. Adding one deals a card in from below; removing one tucks it away.
 */
export function EmblemHand({ count, max = 10 }: { count: number; max?: number }): ReactElement {
  const reduced = useReducedMotion();
  const n = Math.max(1, Math.min(count, max));
  const spread = n > 1 ? Math.min(13, 64 / (n - 1)) : 0;
  return (
    <div className="mt-hand" aria-hidden="true">
      <AnimatePresence initial={false}>
        {Array.from({ length: n }, (_, i) => {
          const mid = (n - 1) / 2;
          const rot = (i - mid) * spread;
          const x = (i - mid) * 5;
          const y = 0;
          return (
            <motion.span
              key={i}
              className="mt-hand__card"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 40, rotate: rot + 20, x }}
              animate={reduced ? { opacity: 1, rotate: rot, x, y } : { opacity: 1, y, rotate: rot, x }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: 34, rotate: rot - 16 }}
              transition={reduced ? { duration: 0.12 } : { type: 'spring', stiffness: 520, damping: 24 }}
              style={{ zIndex: i }}
            >
              <CoinMark size={22} paint="sun" />
              <i className="mt-hand__wax" />
            </motion.span>
          );
        })}
      </AnimatePresence>
      {count > max && <span className="mt-hand__more num">+{count - max}</span>}
    </div>
  );
}

/**
 * A split-flap figure: when `value` changes, the old figure folds down and the new one flips in
 * (the first render just shows it). The text inside stays the figure, for readers and tests.
 */
export function Flap({ value, children }: { value: string; children: ReactNode }): ReactElement {
  const reduced = useReducedMotion();
  const [mountValue] = useState(value);
  const isFirst = value === mountValue;
  return (
    <span className="mt-flap">
      <motion.span
        key={value}
        className="mt-flap__face"
        initial={isFirst || reduced ? false : { rotateX: -88, opacity: 0.4 }}
        animate={{ rotateX: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 16 }}
      >
        {children}
      </motion.span>
    </span>
  );
}

/**
 * A freshly minted emblem as a two-faced card: it lands face down (the seigaiha back with the
 * coin mark), then flips over to show the emblem.
 */
export function FlipCard({ front, delay = 0, go = true }: { front: ReactNode; delay?: number; go?: boolean }): ReactElement {
  const reduced = useReducedMotion();
  if (reduced) return <div className="mt-flipcard is-still">{front}</div>;
  return (
    <motion.div
      className="mt-flipcard"
      initial={{ rotateY: 180 }}
      animate={{ rotateY: go ? 0 : 180 }}
      transition={{ type: 'spring', stiffness: 160, damping: 15, delay }}
    >
      <div className="mt-flipcard__front">{front}</div>
      <div className="mt-flipcard__back">
        <Seigaiha rows={7} r={26} span={300} tone="ink" />
        <span className="mt-flipcard__mark">
          <CoinMark size={84} paint="sun" />
        </span>
      </div>
    </motion.div>
  );
}

