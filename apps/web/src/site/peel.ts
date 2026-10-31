import { useEffect, useRef, useState, type RefObject } from 'react';
import { useReducedMotion } from '../design';

/**
 * Wordmark letters as stickers: point at a letter (or tap it) and it peels up off the page, wobbles
 * on its tape and slaps back down (site.css `.st-peel`). Works on any `.kb-wordmark` inside the
 * returned ref. The load hop plays first; after it the letters rest (`is-settled`) so a peel never
 * replays the entrance. Reduced motion: nothing peels.
 */
export function usePeelLetters<T extends HTMLElement>(): { ref: RefObject<T | null>; className: string } {
  const ref = useRef<T | null>(null);
  const reduced = useReducedMotion();
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 1100);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced || !settled) return;
    const peel = (e: Event) => {
      const letter = (e.target as Element | null)?.closest?.('.kb-wordmark__letter');
      if (!letter || letter.classList.contains('is-peel')) return;
      letter.classList.add('is-peel');
      const done = () => letter.classList.remove('is-peel');
      letter.addEventListener('animationend', done, { once: true });
      // a safety net in case the animation is cancelled (tab hidden)
      setTimeout(done, 1200);
    };
    el.addEventListener('pointerover', peel);
    el.addEventListener('pointerdown', peel);
    return () => {
      el.removeEventListener('pointerover', peel);
      el.removeEventListener('pointerdown', peel);
    };
  }, [reduced, settled]);
  return { ref, className: `st-peel${settled ? ' is-settled' : ''}` };
}
