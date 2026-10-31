import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { useReducedMotion } from '../motion';

export interface CountdownProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Deadline as epoch ms; the component ticks by itself. */
  to?: number;
  /** Or the remaining seconds, controlled by the parent. */
  seconds?: number;
  /**
   * `ms` 05:00, `hms` 01:05:00, `dhm` 2d 06h 14m, `auto` (default): dhm over a
   * day, hms over an hour, else ms.
   */
  format?: 'auto' | 'ms' | 'hms' | 'dhm';
  /** Mono caption under the digits, e.g. "until the bell". */
  label?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** `cream` cells (default) or `sun` cells (the "05:00 per round" badge). */
  tone?: 'cream' | 'sun' | 'plain';
  /** Called once when it reaches zero. */
  onDone?: () => void;
}

function split(total: number, format: CountdownProps['format']) {
  const t = Math.max(0, Math.floor(total));
  const d = Math.floor(t / 86400);
  const h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const f = format === 'auto' || !format ? (d > 0 ? 'dhm' : h > 0 ? 'hms' : 'ms') : format;
  const p2 = (n: number) => String(n).padStart(2, '0');
  if (f === 'dhm') return { text: `${d}d ${p2(h)}h ${p2(m)}m`, spoken: `${d} days ${h} hours ${m} minutes` };
  if (f === 'hms') return { text: `${p2(h + d * 24)}:${p2(m)}:${p2(s)}`, spoken: `${h + d * 24} hours ${m} minutes ${s} seconds` };
  return { text: `${p2(m + (h + d * 24) * 60)}:${p2(s)}`, spoken: `${m + (h + d * 24) * 60} minutes ${s} seconds` };
}

/**
 * A countdown in Geist Mono where every digit sits in its own little key and
 * flips when it changes (the old digit drops away, the new one swings in).
 * role="timer"; reduced motion: digits swap without moving.
 */
export function Countdown({ to, seconds, format = 'auto', label, size = 'md', tone = 'cream', onDone, className, ...rest }: CountdownProps) {
  const reduced = useReducedMotion();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (to === undefined) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [to]);
  const remaining = to !== undefined ? (to - now) / 1000 : (seconds ?? 0);
  const done = remaining <= 0;
  const fired = useRef(false);
  useEffect(() => {
    if (done && !fired.current) {
      fired.current = true;
      onDone?.();
    }
    if (!done) fired.current = false;
  }, [done, onDone]);
  const { text, spoken } = split(Math.ceil(remaining - 1e-9), format);
  const chars = [...text];
  return (
    <div {...rest} className={`kb-count kb-count--${size} kb-count--${tone}${done ? ' is-done' : ''}${className ? ` ${className}` : ''}`} role="timer" aria-label={spoken}>
      <span className="kb-count__digits" aria-hidden="true">
        {chars.map((ch, i) => {
          const place = chars.length - i;
          if (!/[0-9]/.test(ch)) {
            return (
              <span key={`s${place}`} className={ch === ' ' ? 'kb-count__gap' : 'kb-count__sep'}>
                {ch === ' ' ? '' : ch}
              </span>
            );
          }
          return (
            <span key={`d${place}`} className="kb-count__cell">
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span
                  key={ch}
                  className="kb-count__digit"
                  initial={reduced ? { opacity: 0 } : { y: '-70%', rotateX: 80, opacity: 0 }}
                  animate={{ y: '0%', rotateX: 0, opacity: 1 }}
                  exit={reduced ? { opacity: 0 } : { y: '70%', rotateX: -80, opacity: 0 }}
                  transition={reduced ? { duration: 0.08 } : { type: 'spring', stiffness: 600, damping: 30 }}
                >
                  {ch}
                </motion.span>
              </AnimatePresence>
            </span>
          );
        })}
      </span>
      {label != null && <span className="kb-count__label">{label}</span>}
    </div>
  );
}
