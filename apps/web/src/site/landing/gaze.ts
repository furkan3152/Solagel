import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Coins that notice you: one shared pointer listener for the whole page, and a hook that turns
 * the pointer position into a coin's `look` (pupil offset, about -4..4 coin units). Each coin
 * reads its own box once per animation frame, only while the pointer moves and only while the
 * coin is on screen; looks are rounded so React re-renders a coin only when its eyes really move.
 */

type Listener = (x: number, y: number) => void;
const listeners = new Set<Listener>();
let last: [number, number] | null = null;
let frame = 0;
let installed = false;

function onMove(e: PointerEvent) {
  last = [e.clientX, e.clientY];
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (last) for (const l of listeners) l(last[0], last[1]);
  });
}

function subscribe(l: Listener): () => void {
  listeners.add(l);
  if (!installed && typeof window !== 'undefined') {
    installed = true;
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onMove, { passive: true });
  }
  return () => {
    listeners.delete(l);
    if (!listeners.size && installed) {
      installed = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onMove);
    }
  };
}

export interface Gaze {
  /** Pupil offset for `CoinCharacter.look`. */
  look: [number, number];
  /** Pointer distance from the coin centre in px (Infinity before the first move). */
  near: number;
  /** -1 when the pointer is to the coin's left, 1 to its right. */
  side: -1 | 1;
}

const REST: Gaze = { look: [0, 0], near: Infinity, side: 1 };

/**
 * Where a coin should look. `rest` is the look before the pointer has moved (and when `enabled`
 * is false, e.g. reduced motion keeps the composed frame). `reach` scales the pupils (1 = full).
 */
export function useGaze(ref: RefObject<Element | null>, { enabled = true, rest = [0, 0] as [number, number], reach = 1 } = {}): Gaze {
  const [gaze, setGaze] = useState<Gaze>({ ...REST, look: rest });
  const prev = useRef('');
  useEffect(() => {
    if (!enabled) return;
    return subscribe((x, y) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.bottom < -100 || r.top > innerHeight + 100) return;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height * 0.42;
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy) || 1;
      // full deflection from ~180 px away, gentler up close
      const k = Math.min(1, d / 180) * 4 * reach;
      const look: [number, number] = [Math.round((dx / d) * k), Math.round((dy / d) * k * 0.8)];
      const near = Math.round(d / 20) * 20;
      const side = dx < 0 ? -1 : 1;
      const key = `${look[0]},${look[1]},${near},${side}`;
      if (key === prev.current) return;
      prev.current = key;
      setGaze({ look, near, side });
    });
  }, [enabled, ref, reach]);
  return enabled ? gaze : { ...REST, look: rest };
}
