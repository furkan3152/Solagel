import { motion } from 'motion/react';
import { useMemo, type HTMLAttributes } from 'react';
import { springs, useReducedMotion } from '../motion';

export interface CounterProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  value: number;
  /** Formatter, e.g. `(n) => n.toLocaleString('tr-TR')`. Default: en-US grouping. */
  format?: (n: number) => string;
  /** Mono unit after the number, e.g. "$SLANA". */
  unit?: string;
}

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const defaultFormat = (n: number) => Math.round(n).toLocaleString('en-US');

/**
 * Mechanical counter (spec §7.4 "makine sayacı"): every digit is a wheel that
 * rolls to its new value; wheels are keyed from the right so place values stay
 * put when the number grows. Screen readers get the plain formatted value.
 */
export function Counter({ value, format = defaultFormat, unit, className, ...rest }: CounterProps) {
  const reduced = useReducedMotion();
  const text = format(value);
  const chars = useMemo(() => [...text], [text]);
  return (
    <span {...rest} className={`kb-counter${className ? ` ${className}` : ''}`}>
      <span className="kb-sr">
        {text}
        {unit ? ` ${unit}` : ''}
      </span>
      <span className="kb-counter__wheels" aria-hidden="true">
        {chars.map((ch, i) => {
          const place = chars.length - i; // key from the right
          const d = DIGITS.indexOf(ch);
          if (d < 0) {
            return (
              <span key={`s${place}`} className="kb-counter__sep">
                {ch}
              </span>
            );
          }
          return (
            <span key={`d${place}`} className="kb-counter__digit">
              <motion.span
                className="kb-counter__reel"
                initial={false}
                animate={{ y: `${-d * 10}%` }}
                transition={
                  reduced
                    ? { duration: 0 }
                    : { ...springs.dial, delay: (place - 1) * 0.025 }
                }
              >
                {DIGITS.map((n) => (
                  <span key={n}>{n}</span>
                ))}
              </motion.span>
            </span>
          );
        })}
        {unit && <span className="kb-counter__unit mono">{unit}</span>}
      </span>
    </span>
  );
}
