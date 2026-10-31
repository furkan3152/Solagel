import { motion } from 'motion/react';
import type { HTMLAttributes } from 'react';
import { springs, stampKeyframes, useReducedMotion } from '../motion';

/** `up` (DONE, green), `down` (EATEN, red), `teal`, `sun`, `cyan`, `ink`; legacy `pink`/`red` → down, `mustard` → sun. */
export type StampTone = 'up' | 'down' | 'teal' | 'sun' | 'cyan' | 'ink' | 'pink' | 'mustard' | 'red';

type SpanAttrs = Omit<
  HTMLAttributes<HTMLSpanElement>,
  'children' | 'onAnimationStart' | 'onAnimationEnd' | 'onAnimationIteration' | 'onDrag' | 'onDragStart' | 'onDragEnd'
>;

export interface StampProps extends SpanAttrs {
  text: string;
  tone?: StampTone;
  /** Degrees. Rubber stamps never land straight; default -8. */
  rotate?: number;
  /** Play the 420 ms stamp-in on mount (remount with a `key` to replay). */
  animateIn?: boolean;
  /** `sm` sits on tickets, `md` is the default, `lg` is a verdict ("EATEN"). */
  size?: 'sm' | 'md' | 'lg';
  /** Round seal instead of the rectangular frame. */
  round?: boolean;
  /** Small second line under the text (lg / round only). */
  sub?: string;
  delay?: number;
}

/**
 * A rubber stamp ("DONE", "SEALED", "EATEN"): framed Geist Mono caps in one
 * ink, a little worn, pressed on at an angle. Stamp-in = 1.4 → 1 with a squash
 * on impact (420 ms keyframes), a 3° turn that settles on the `stamp` spring,
 * and an ink bloom ring. Reduced motion: a fade.
 */
export function Stamp({
  text,
  tone = 'up',
  rotate = -7,
  animateIn = false,
  size = 'md',
  round = false,
  sub,
  delay = 0,
  className,
  style,
  ...rest
}: StampProps) {
  const reduced = useReducedMotion();
  const cls = `kb-stamp kb-stamp--${size} kb-tone-${tone}${round ? ' kb-stamp--round' : ''}${className ? ` ${className}` : ''}`;
  const content = (
    <>
      <span className="kb-stamp__text">{text}</span>
      {sub && <span className="kb-stamp__sub">{sub}</span>}
    </>
  );
  if (!animateIn) {
    return (
      <span {...rest} className={cls} style={{ ...style, transform: `rotate(${rotate}deg)` }}>
        {content}
      </span>
    );
  }
  if (reduced) {
    return (
      <motion.span
        {...rest}
        className={cls}
        style={{ ...style, rotate }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.12, delay }}
      >
        {content}
      </motion.span>
    );
  }
  return (
    <motion.span
      {...rest}
      className={cls}
      style={style}
      initial={{ opacity: 0, scale: 1.4, rotate: rotate + 3, filter: 'blur(1.2px)' }}
      animate={{
        opacity: [0, 1, 1],
        scale: [1.4, 0.97, 1],
        rotate,
        filter: ['blur(1.2px)', 'blur(0px)', 'blur(0px)'],
      }}
      transition={{ ...stampKeyframes, delay, rotate: { ...springs.stamp, delay: delay + 0.2 } }}
    >
      {content}
      <motion.span
        className="kb-stamp__bloom"
        aria-hidden="true"
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: [0, 0.45, 0], scale: [0.92, 1, 1.22] }}
        transition={{ duration: 0.36, delay: delay + 0.28, times: [0, 0.15, 1], ease: 'easeOut' }}
      />
    </motion.span>
  );
}
