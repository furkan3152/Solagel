import { motion } from 'motion/react';
import { useEffect, useRef, type CSSProperties } from 'react';
import { Crest, Stamp, WaxSeal, useReducedMotion } from '../../design';
import { sound } from '../../game/sound';
import { useT } from '../../i18n';

/**
 * The two Pass moments (spec §7.2.6, "the envelope opens / the seal breaks"):
 *
 *  - `envelope`: after a mint, an airmail envelope from the Slana post opens,
 *    the sealed passport rises out of it, the envelope drops away and a
 *    "Delivered" stamp lands. Shown closed while the transaction is signed.
 *  - `seal`: after the reveal, the wax seal on a sealed passport shakes,
 *    cracks and falls apart in two halves; `onBreak` fires as it splits (the
 *    passport opens underneath), `onDone` when the pieces are gone.
 *
 * Reduced motion: both become short cross-fades, same callbacks.
 */
export interface RevealAnimationProps {
  kind: 'envelope' | 'seal';
  /** Formatted Pass number, e.g. `0413`. */
  number: string;
  /** Start the animation (an envelope shows closed until then). */
  play: boolean;
  /** Envelope: the recipient line (short wallet address). */
  to?: string;
  /** Seal: the moment the seal splits (open the passport now). */
  onBreak?: () => void;
  onDone?: () => void;
  className?: string;
  /** Seal: where to sit (over the passport's own wax seal). */
  style?: CSSProperties;
}

export function RevealAnimation(props: RevealAnimationProps) {
  return props.kind === 'envelope' ? <Envelope {...props} /> : <SealBreak {...props} />;
}

/** Timeline of the envelope, seconds. */
const ENV = { flap: 0.24, flapIn: 0.26, rise: 0.5, drop: 1.12, stamp: 1.55, done: 2.05 };

function Envelope({ number, play, to, onDone, className }: RevealAnimationProps) {
  const t = useT();
  const reduced = useReducedMotion();
  useAfter(play, reduced ? 0.3 : ENV.done, onDone);
  useAfter(play && !reduced, ENV.stamp + 0.28, () => sound.stamp());
  const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

  const fade = { duration: 0.2, ease: 'linear' } as const;
  return (
    <div className={`rv-env${play ? ' is-open' : ''}${className ? ` ${className}` : ''}`} aria-hidden="true">
      <div className="rv-env__stage">
        {/* inside of the envelope and the flap's inner face (behind the letter) */}
        <motion.div
          className="rv-env__back"
          initial={false}
          animate={play ? (reduced ? { opacity: 0 } : { y: 70, opacity: 0 }) : { y: 0, opacity: 1 }}
          transition={reduced ? fade : { delay: ENV.drop, duration: 0.38, ease: [0.5, 0, 0.75, 0] }}
        >
          <motion.span
            className="rv-env__flap-in"
            initial={false}
            animate={play && !reduced ? { rotateX: 0 } : { rotateX: -90 }}
            transition={{ delay: ENV.flap, duration: ENV.flapIn, ease: 'easeOut' }}
          />
        </motion.div>

        {/* the sealed passport */}
        <motion.div
          className="rv-env__letter"
          initial={false}
          animate={
            play
              ? reduced
                ? { opacity: 1, y: '-18%' }
                : { y: ['8%', '-78%', '-18%'], scale: [0.94, 0.98, 1.04], rotate: [0, -2.5, -1.5] }
              : { y: '8%', scale: 0.94, rotate: 0, opacity: reduced ? 0 : 1 }
          }
          transition={reduced ? fade : { delay: ENV.rise, duration: 1.15, times: [0, 0.48, 1], ease: ['easeOut', [0.34, 1.4, 0.64, 1]] }}
        >
          <div className="rv-cover">
            <Crest className="rv-cover__crest" />
            <span className="rv-cover__brand">SLANA</span>
            <span className="rv-cover__kind mono">PASS</span>
            <span className="rv-cover__no mono">No. {number}</span>
            <WaxSeal className="rv-cover__wax" />
          </div>
          {play && (
            <span className="rv-env__delivered">
              <Stamp text={t('mt.delivered')} tone="pink" size="md" rotate={-8} animateIn delay={reduced ? 0 : ENV.stamp} />
            </span>
          )}
        </motion.div>

        {/* the front pocket: airmail border, address, postmark */}
        <motion.div
          className="rv-env__front"
          initial={false}
          animate={play ? (reduced ? { opacity: 0 } : { y: 70, opacity: 0 }) : { y: 0, opacity: 1 }}
          transition={reduced ? fade : { delay: ENV.drop, duration: 0.38, ease: [0.5, 0, 0.75, 0] }}
        >
          <span className="rv-env__addr">
            <span className="rv-env__priority mono">{t('rv.priority')}</span>
            <span className="mono">{t('rv.to')}</span>
            <span className="rv-env__addr-line">Slana Pass No. {number}</span>
            {to && <span className="rv-env__addr-line mono">{to}</span>}
          </span>
          <span className="rv-env__postmark">
            <Stamp text={t('rv.post')} sub={date} tone="teal" round size="sm" rotate={12} />
          </span>
        </motion.div>

        {/* the outer flap, folding open */}
        <motion.span
          className="rv-env__flap"
          initial={false}
          animate={play ? (reduced ? { opacity: 0 } : { rotateX: 90, opacity: 0 }) : { rotateX: 0, opacity: 1 }}
          transition={reduced ? fade : { duration: ENV.flap, ease: 'easeIn', opacity: { delay: ENV.flap - 0.02, duration: 0.02 } }}
        >
          <WaxSeal className="rv-env__flap-seal" />
        </motion.span>
      </div>
    </div>
  );
}

/** Timeline of the seal break, seconds. */
const SEAL = { shake: 0.32, crack: 0.2, split: 0.56, done: 1.25 };
const CRUMBS = [
  { x: -46, y: 30, r: 5 },
  { x: -22, y: 58, r: 3.5 },
  { x: 8, y: 66, r: 4.5 },
  { x: 30, y: 44, r: 3 },
  { x: 52, y: 22, r: 4 },
  { x: -58, y: -6, r: 3 },
  { x: 40, y: -18, r: 2.5 },
];
const LEFT = 'polygon(0 0, 53% 0, 46% 21%, 56% 40%, 45% 59%, 54% 78%, 47% 100%, 0 100%)';
const RIGHT = 'polygon(53% 0, 100% 0, 100% 100%, 47% 100%, 54% 78%, 45% 59%, 56% 40%, 46% 21%)';

function SealBreak({ play, onBreak, onDone, className, style }: RevealAnimationProps) {
  const reduced = useReducedMotion();
  useAfter(play, reduced ? 0.12 : SEAL.split, onBreak);
  useAfter(play, reduced ? 0.3 : SEAL.done, onDone);
  useAfter(play && !reduced, SEAL.shake, () => sound.stamp());

  if (reduced) {
    return (
      <motion.div className={`rv-seal${className ? ` ${className}` : ''}`} style={style} aria-hidden="true" initial={{ opacity: 1 }} animate={{ opacity: play ? 0 : 1 }} transition={{ duration: 0.2 }}>
        <WaxSeal className="rv-seal__svg" />
      </motion.div>
    );
  }
  // CSS keyframes (pass.css): the shake, the crack drawing, the halves falling and the crumbs
  return (
    <div className={`rv-seal${play ? ' is-play' : ''}${className ? ` ${className}` : ''}`} style={style} aria-hidden="true">
      <span className="rv-seal__half is-l" style={{ clipPath: LEFT }}>
        <WaxSeal className="rv-seal__svg" />
      </span>
      <span className="rv-seal__half is-r" style={{ clipPath: RIGHT }}>
        <WaxSeal className="rv-seal__svg" />
      </span>
      <svg className="rv-seal__crack" viewBox="0 0 100 100" aria-hidden="true">
        <path d="M53 0 L46 21 L56 40 L45 59 L54 78 L47 100" fill="none" strokeWidth="3" strokeLinejoin="round" pathLength={1} />
      </svg>
      {play &&
        CRUMBS.map((c, i) => (
          <span
            key={i}
            className="rv-seal__crumb"
            style={{ width: c.r * 2, height: c.r * 2, ['--x' as string]: `${c.x}px`, ['--y' as string]: `${c.y + 30}px`, animationDelay: `${SEAL.split + i * 0.015}s` } as CSSProperties}
          />
        ))}
    </div>
  );
}

/** Calls `fn` once, `seconds` after `active` turns true (cancelled if it turns false or unmounts). */
function useAfter(active: boolean, seconds: number, fn?: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => ref.current?.(), seconds * 1000);
    return () => clearTimeout(id);
  }, [active, seconds]);
}
