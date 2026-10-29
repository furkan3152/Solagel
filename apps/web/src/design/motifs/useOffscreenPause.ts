import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Pauses a motif's loops while it is off screen: returns a ref and whether the
 * element is visible. Put `data-paused={!visible || undefined}` on the root;
 * storybook.css stops every CSS animation under `[data-paused]`, and SVG SMIL
 * timelines are paused through `pauseAnimations()`.
 */
export function useOffscreenPause<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) setVisible(e.isIntersecting);
    }, { rootMargin: '120px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const el = ref.current;
    const svgs: SVGSVGElement[] = el instanceof SVGSVGElement ? [el] : [...(el?.querySelectorAll('svg') ?? [])];
    for (const s of svgs) {
      if (typeof s.pauseAnimations !== 'function') continue;
      if (visible) s.unpauseAnimations();
      else s.pauseAnimations();
    }
  }, [visible]);
  return [ref, visible];
}
