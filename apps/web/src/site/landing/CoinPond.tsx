import { useEffect, useRef, type CSSProperties } from 'react';
import { CoinCharacter, useOffscreenPause, type CoinMood, type CoinPaint } from '../../design';

/**
 * The hero's pond: coin characters living on the front terrace of the ring. They bob and blink;
 * in the middle a big sun coin chases a small scared one and swallows it ("+$0.12"), then the
 * snack wanders back in and the loop starts over (4.8 s, pure CSS). Decoration only.
 *
 * - `still` (reduced motion): one composed frame, nothing moves, nobody gets eaten.
 * - Off screen the loops pause (`data-paused`).
 * - `onChomp` fires at the bite of every loop (the optional landing sound).
 */

export interface PondEvents {
  /** The hunter swallowed the snack (for the optional sound). */
  onEat?: (big: number) => void;
}

interface Resident {
  paint: CoinPaint;
  mood: CoinMood;
  size: number;
  left: string;
  bottom: number;
  look: [number, number];
  phase: number;
  /** Hidden on phones. */
  far?: boolean;
  sweat?: boolean;
}

const RESIDENTS: Resident[] = [
  { paint: 'teal', mood: 'smile', size: 118, left: '3%', bottom: 14, look: [3, 1], phase: 0 },
  { paint: 'foam', mood: 'happy', size: 62, left: '13%', bottom: 6, look: [0, 0], phase: 0.6, far: true },
  { paint: 'cream', mood: 'smile', size: 82, left: '22%', bottom: 52, look: [-3, 2], phase: 1.1, far: true },
  { paint: 'up', mood: 'open', size: 96, left: '83%', bottom: 46, look: [-3, 0], phase: 1.4, far: true },
  { paint: 'cyan', mood: 'scared', size: 58, left: '92.5%', bottom: 8, look: [-4, 0], phase: 0.9, sweat: true },
];

const LOOP_S = 4.8;
/** Where in the loop the jaws close on the snack. */
const BITE_AT = 0.57;

export function CoinPond({ still, events }: { still: boolean; events?: PondEvents }) {
  const [ref, visible] = useOffscreenPause<HTMLDivElement>();
  const onEat = useRef(events?.onEat);
  onEat.current = events?.onEat;

  // the bite sound follows the CSS loop (only while it runs)
  useEffect(() => {
    if (still || !visible) return;
    let bite: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      bite = setTimeout(() => onEat.current?.(1), BITE_AT * LOOP_S * 1000);
    };
    tick();
    const loop = setInterval(tick, LOOP_S * 1000);
    return () => {
      clearInterval(loop);
      if (bite) clearTimeout(bite);
    };
  }, [still, visible]);

  return (
    <div ref={ref} className="ld-pond" data-still={still ? 'true' : 'false'} data-paused={!visible || still || undefined} aria-hidden="true">
      {RESIDENTS.map((r, i) => (
        <span key={i} className={`ld-pond__c${r.far ? ' is-far' : ''}`} style={{ left: r.left, bottom: r.bottom } as CSSProperties}>
          <CoinCharacter paint={r.paint} mood={r.mood} size={r.size} look={r.look} sweat={r.sweat} feet ground bob={!still} phase={r.phase} />
        </span>
      ))}
      <div className={`ld-chase${still ? ' is-still' : ''}`} style={{ ['--loop' as string]: `${LOOP_S}s` }}>
        <span className="ld-chase__hunter">
          <CoinCharacter paint="sun" mood="chomp" size={150} look={[4, 1]} feet ground chewing={!still} />
        </span>
        <span className="ld-chase__snack">
          <CoinCharacter paint="foam" mood="scared" size={62} look={[-3, -1]} sweat feet ground />
        </span>
        <span className="ld-chase__pop num">+$0.12</span>
      </div>
    </div>
  );
}
