import { useCallback, useEffect, useRef, useState } from 'react';
import type { Sfx } from '../../audio/sfx';

/**
 * The landing's optional sound: off by default, on only after the visitor turns it on (a user
 * gesture). It reuses the game's synthesized paper and chomp sounds, loaded on demand so the first
 * paint carries no audio code.
 */
export function useLandingSound(): { on: boolean; toggle: () => void; chomp: () => void; click: () => void } {
  const [on, setOn] = useState(false);
  const sfx = useRef<Sfx | null>(null);
  const last = useRef(0);

  const toggle = useCallback(() => {
    setOn((was) => {
      const next = !was;
      if (next) {
        void Promise.all([import('../../audio/mixer'), import('../../audio/sfx')]).then(([{ Mixer }, { Sfx }]) => {
          if (!sfx.current) {
            const mixer = new Mixer();
            mixer.unlock();
            sfx.current = new Sfx(mixer);
          }
          sfx.current.click();
        });
      }
      return next;
    });
  }, []);

  const onRef = useRef(on);
  onRef.current = on;
  useEffect(() => {
    if (!on) return;
    const hide = () => {
      if (document.hidden) setOn(false);
    };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, [on]);

  const chomp = useCallback(() => {
    const now = performance.now();
    if (!onRef.current || now - last.current < 350) return;
    last.current = now;
    sfx.current?.chomp();
  }, []);
  const click = useCallback(() => {
    if (onRef.current) sfx.current?.click();
  }, []);
  return { on, toggle, chomp, click };
}
