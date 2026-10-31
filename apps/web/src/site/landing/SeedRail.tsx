import { useMotionValueEvent, useScroll } from 'motion/react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CoinCharacter, useReducedMotion, type CoinMood } from '../../design';

/**
 * The landing's reading progress, drawn as a snack: a row of seeds runs along the bottom of the
 * header and a little coin eats its way through them as the visitor scrolls (the seeds behind it
 * are gone). It chews while the page moves; when the page rests it wears the mood of the plate
 * under it (sleepy once night falls, wary at the cast of big coins, hungry at the menu).
 * Transform and clip only; the coin's place is a CSS variable fed by the scroll.
 * Reduced motion: the coin still marks the place but does not chew.
 */

/** Plate id → the mood the guide wears there. */
const MOODS: [string, CoinMood][] = [
  ['ld-hero', 'happy'],
  ['feast', 'open'],
  ['round', 'smile'],
  ['cast', 'scared'],
  ['nft', 'sleepy'],
  ['arenas', 'smile'],
  ['faq', 'open'],
];

export function SeedRail() {
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const rail = useRef<HTMLDivElement>(null);
  const [moving, setMoving] = useState(false);
  const [mood, setMood] = useState<CoinMood>('happy');
  const rest = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useMotionValueEvent(scrollYProgress, 'change', (p) => {
    rail.current?.style.setProperty('--p', p.toFixed(4));
    if (reduced) return;
    setMoving(true);
    clearTimeout(rest.current);
    rest.current = setTimeout(() => setMoving(false), 420);
  });
  useEffect(() => () => clearTimeout(rest.current), []);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const seen = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id || e.target.className, e.intersectionRatio);
        let best: CoinMood | null = null;
        let top = 0;
        for (const [id, m] of MOODS) {
          const r = seen.get(id) ?? 0;
          if (r > top) {
            top = r;
            best = m;
          }
        }
        if (best) setMood(best);
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const [id] of MOODS) {
      const el = document.getElementById(id) ?? document.querySelector(`.${id}`);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  return (
    <div ref={rail} className="ld-rail" aria-hidden="true" style={{ ['--p' as string]: 0 } as CSSProperties}>
      <span className="ld-rail__seeds" />
      <span className="ld-rail__coin">
        <CoinCharacter paint="sun" mood={moving ? 'chomp' : mood} size={30} look={[3, 0]} chewing={!reduced} blink={!reduced} />
      </span>
    </div>
  );
}
