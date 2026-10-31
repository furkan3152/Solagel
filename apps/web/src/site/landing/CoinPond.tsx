import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CoinCharacter, FoodBit, useOffscreenPause, type CoinMood, type CoinPaint } from '../../design';
import { useGaze } from './gaze';

/**
 * The hero's pond: coin characters living on the front terrace of the ring. They bob and blink;
 * in the middle a big sun coin chases a small scared one and swallows it ("+$0.12"), then the
 * snack wanders back in and the loop starts over (4.8 s, pure CSS).
 *
 * The residents notice the visitor: their eyes follow the pointer, the little cyan one edges away
 * (sweating) when the pointer comes close, the big teal one starts chewing at it. Click (or tap)
 * a resident and a pear drops from the sky: it chomps it, crumbs fly, "+a bite", and it grows a
 * size (three pears, then it is full). Decoration only (aria-hidden); the feeding is a toy.
 *
 * - `still` (reduced motion): one composed frame, nothing moves, nobody gets eaten, nobody looks.
 * - Off screen the loops pause (`data-paused`).
 * - `onEat` fires at the bite of every loop and at every pear (the optional landing sound).
 */

export interface PondEvents {
  /** A coin swallowed something (for the optional sound). */
  onEat?: (big: number) => void;
}

/** How a resident reacts when the pointer comes close. */
type Temper = 'calm' | 'shy' | 'hungry';

interface Resident {
  paint: CoinPaint;
  mood: CoinMood;
  size: number;
  left: string;
  bottom: number;
  look: [number, number];
  phase: number;
  temper: Temper;
  /** Hidden on phones. */
  far?: boolean;
  sweat?: boolean;
}

const RESIDENTS: Resident[] = [
  { paint: 'teal', mood: 'smile', size: 118, left: '3%', bottom: 14, look: [3, 1], phase: 0, temper: 'hungry' },
  { paint: 'foam', mood: 'happy', size: 62, left: '13%', bottom: 6, look: [0, 0], phase: 0.6, far: true, temper: 'calm' },
  { paint: 'cream', mood: 'smile', size: 82, left: '22%', bottom: 52, look: [-3, 2], phase: 1.1, far: true, temper: 'calm' },
  { paint: 'up', mood: 'open', size: 96, left: '83%', bottom: 46, look: [-3, 0], phase: 1.4, far: true, temper: 'calm' },
  { paint: 'cyan', mood: 'scared', size: 58, left: '86.5%', bottom: 8, look: [-4, 0], phase: 0.9, sweat: true, temper: 'shy' },
];

const LOOP_S = 4.8;
/** Where in the loop the jaws close on the snack. */
const BITE_AT = 0.57;
/** Pears before a resident is full. */
const FULL = 3;

function PondResident({ r, still, onEat }: { r: Resident; still: boolean; onEat: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const gaze = useGaze(ref, { enabled: !still, rest: r.look });
  const [fed, setFed] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'drop' | 'chew' | 'full'>('idle');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const near = gaze.near < (r.temper === 'shy' ? 170 : 210);
  const fleeing = r.temper === 'shy' && near && phase === 'idle';
  let mood: CoinMood = r.mood;
  if (phase === 'chew') mood = 'chomp';
  else if (phase === 'full') mood = 'happy';
  else if (phase === 'drop') mood = 'open';
  else if (near && r.temper === 'hungry') mood = 'chomp';
  else if (near && r.temper === 'calm' && r.mood !== 'open') mood = 'open';

  const feed = () => {
    if (still || phase !== 'idle') return;
    if (fed >= FULL) {
      setPhase('full');
      timers.current.push(setTimeout(() => setPhase('idle'), 1100));
      return;
    }
    setPhase('drop');
    timers.current.push(
      setTimeout(() => {
        setPhase('chew');
        setFed((n) => n + 1);
        onEat();
      }, 420),
      setTimeout(() => setPhase('idle'), 1350),
    );
  };

  const grow = 1 + Math.min(fed, FULL) * 0.07;
  return (
    <span
      ref={ref}
      className={`ld-pond__c ld-pond__c--${r.temper}${r.far ? ' is-far' : ''}${fleeing ? ' is-fleeing' : ''} is-${phase}`}
      style={{ left: r.left, bottom: r.bottom, ['--grow' as string]: grow, ['--flee' as string]: gaze.side < 0 ? '34px' : '-34px' } as CSSProperties}
      onClick={feed}
    >
      <span className="ld-pond__body">
        <CoinCharacter
          paint={r.paint}
          mood={mood}
          size={r.size}
          look={phase === 'idle' ? gaze.look : [0, -3]}
          sweat={r.sweat || fleeing}
          feet
          ground
          bob={!still && phase === 'idle'}
          phase={r.phase}
          chewing={!still}
        />
      </span>
      {phase === 'drop' && (
        <span className="ld-pond__pear">
          <FoodBit kind="pear" size={Math.round(r.size * 0.42)} />
        </span>
      )}
      {phase === 'chew' && (
        <>
          <span className="ld-pond__crumbs">
            {[0, 1, 2, 3, 4].map((i) => (
              <i key={i} style={{ ['--a' as string]: `${-150 + i * 30}deg` } as CSSProperties} />
            ))}
          </span>
          <span className="ld-pond__tag num">{fed >= FULL ? 'Full.' : '+a bite'}</span>
        </>
      )}
      {phase === 'full' && <span className="ld-pond__tag num">No more. Full.</span>}
    </span>
  );
}

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
        <PondResident key={i} r={r} still={still} onEat={() => onEat.current?.(0)} />
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
