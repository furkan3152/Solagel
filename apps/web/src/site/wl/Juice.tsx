import { motion } from 'motion/react';
import type { CSSProperties, ReactElement } from 'react';
import { useReducedMotion } from '../../design';
import { ChoreArt } from './ChoreArt';

/**
 * Small moments of the WL and collab plates: the ink a rubber stamp throws when it lands, and the
 * sticker album that fills as chores get done. All decorative (aria-hidden); reduced motion keeps
 * the end state still (a few dried specks, the stickers already in place).
 */

function seeded(seed: number) {
  let h = (seed * 9301 + 49297) % 2147483647 || 1;
  return () => (h = (h * 16807) % 2147483647) / 2147483647;
}

export interface InkSplatProps {
  /** Same seed, same splatter (so a re-render does not reshuffle the specks). */
  seed?: number;
  /** Specks thrown. */
  count?: number;
  /** How far they fly, px. */
  reach?: number;
  /** Keep the dried specks after the splash (default) or let them fade. */
  stay?: boolean;
  className?: string;
}

/**
 * The ink a stamp throws when it thumps down: a ring of round drops and long flicks flying out
 * from the impact, landing as dried specks. Ink colour is `currentColor` (put it inside the stamp's
 * tone). Pure CSS transforms (no layout), one shot.
 */
export function InkSplat({ seed = 1, count = 11, reach = 46, stay = true, className }: InkSplatProps): ReactElement {
  const reduced = useReducedMotion();
  const rnd = seeded(seed);
  const drops = Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 + (rnd() - 0.5) * 0.7;
    const d = reach * (0.55 + rnd() * 0.6);
    const flick = i % 3 === 1;
    const s = flick ? 3 + rnd() * 2 : 3 + rnd() * 5;
    return {
      x: Math.cos(a) * d,
      y: Math.sin(a) * d * 0.8,
      w: flick ? s * 3.2 : s,
      h: s,
      rot: (a * 180) / Math.PI,
      delay: rnd() * 60,
      flick,
    };
  });
  return (
    <span className={`wl-splat${stay ? ' is-stay' : ''}${reduced ? ' is-still' : ''}${className ? ` ${className}` : ''}`} aria-hidden="true">
      {drops.map((p, i) => (
        <i
          key={i}
          className={p.flick ? 'is-flick' : undefined}
          style={
            {
              '--x': `${p.x.toFixed(1)}px`,
              '--y': `${p.y.toFixed(1)}px`,
              '--r': `${p.rot.toFixed(0)}deg`,
              width: `${p.w.toFixed(1)}px`,
              height: `${p.h.toFixed(1)}px`,
              animationDelay: `${p.delay.toFixed(0)}ms`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}

export interface StickerAlbumProps {
  /** One slot per chore, in order: its kind and whether it is done. */
  slots: { key: string; kind: string; done: boolean }[];
  /** Caption over the page. */
  title?: string;
  /** The visitor's handle (the handle sticker wears its coin). */
  handle?: string;
}

const TILTS = [-6, 4, -3, 7, -5, 3, -7, 5];

/**
 * A page of a sticker album: one dashed die-cut hole per chore, numbered in pencil. Finishing a
 * chore presses its picture into the hole as a cream sticker (dropped on a spring, with a little
 * shine running across it). The progress bar beside it carries the numbers for screen readers.
 */
export function StickerAlbum({ slots, title = 'Sticker album', handle = '' }: StickerAlbumProps): ReactElement {
  const reduced = useReducedMotion();
  const got = slots.filter((s) => s.done).length;
  return (
    <div className="wl-album" aria-hidden="true">
      <span className="wl-album__head mono">
        <span>{title}</span>
        <span className="num">
          {got}/{slots.length}
        </span>
      </span>
      <ol className="wl-album__page">
        {slots.map((s, i) => (
          <li key={s.key} className={`wl-album__slot${s.done ? ' is-done' : ''}`}>
            <span className="wl-album__no num">{i + 1}</span>
            {s.done && (
              <motion.span
                className="wl-album__sticker"
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.7, y: -26, rotate: TILTS[i % TILTS.length] - 24 }}
                animate={reduced ? { opacity: 1, rotate: TILTS[i % TILTS.length] } : { opacity: 1, scale: 1, y: 0, rotate: TILTS[i % TILTS.length] }}
                transition={reduced ? { duration: 0.12 } : { type: 'spring', stiffness: 520, damping: 17, mass: 0.8 }}
              >
                <ChoreArt kind={s.kind} handle={s.kind === 'handle' ? handle || 'you' : ''} />
                <span className="wl-album__shine" />
              </motion.span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
