import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { printerEase, useReducedMotion } from '../motion';

export interface ReceiptLine {
  label: ReactNode;
  value: ReactNode;
  /** Total line: display type with a double rule above. */
  strong?: boolean;
  /** Muted line (fees, notes). */
  muted?: boolean;
}

export interface ReceiptProps {
  lines: ReceiptLine[];
  /** Heading printed at the top, e.g. "CASH-OUT". */
  title?: ReactNode;
  /** Mono line under the heading: date, room, session. */
  meta?: ReactNode;
  /** Footer below the barcode, e.g. a transaction link. */
  footer?: ReactNode;
  /** Barcode seed (the tx signature is a good one). Omit to hide it. */
  code?: string;
  /** Feed the slip out of a printer slot. Remount (key) to print again. */
  printing?: boolean;
  /** Called once the slip has fully printed. */
  onPrinted?: () => void;
  className?: string;
}

/** A thermal-printer slip: zigzag tear on both ends, dotted leaders, halftone shade. */
export function Receipt({ lines, title, meta, footer, code, printing = false, onPrinted, className }: ReceiptProps) {
  const reduced = useReducedMotion();
  const steps = lines.length + 4;
  const slip = (
    <div className="kb-receipt">
      {(title != null || meta != null) && (
        <header className="kb-receipt__head">
          {title != null && <div className="kb-receipt__title">{title}</div>}
          {meta != null && <div className="kb-receipt__meta mono">{meta}</div>}
        </header>
      )}
      <dl className="kb-receipt__lines">
        {lines.map((l, i) => (
          <div
            key={i}
            className={`kb-receipt__line${l.strong ? ' is-strong' : ''}${l.muted ? ' is-muted' : ''}`}
          >
            <dt>{l.label}</dt>
            <dd>{l.value}</dd>
          </div>
        ))}
      </dl>
      {code && <Barcode seed={code} />}
      {footer != null && <div className="kb-receipt__foot mono">{footer}</div>}
    </div>
  );

  return (
    <div className={`kb-receipt-wrap${printing ? ' is-printer' : ''}${className ? ` ${className}` : ''}`}>
      {printing && <div className="kb-receipt__slot" aria-hidden="true" />}
      <div className="kb-receipt__feed">
        {printing ? (
          <motion.div
            className="kb-receipt__paper"
            initial={reduced ? { opacity: 0 } : { y: '-101%' }}
            animate={reduced ? { opacity: 1 } : { y: '0%' }}
            transition={reduced ? { duration: 0.15 } : { duration: steps * 0.16, ease: printerEase(steps), delay: 0.15 }}
            onAnimationComplete={onPrinted}
          >
            <span className="kb-receipt__shade" aria-hidden="true" />
            {slip}
          </motion.div>
        ) : (
          <div className="kb-receipt__paper">
            <span className="kb-receipt__shade" aria-hidden="true" />
            {slip}
          </div>
        )}
      </div>
    </div>
  );
}

/** Deterministic decorative barcode from a string. */
function Barcode({ seed }: { seed: string }) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  for (let i = 0; i < 46 && x < 200; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const w = 1 + ((h >>> 3) & 3) * 0.75;
    const gap = 1.2 + ((h >>> 7) & 3) * 0.7;
    bars.push({ x, w });
    x += w + gap;
  }
  return (
    <svg className="kb-receipt__barcode" viewBox={`0 0 ${x.toFixed(1)} 30`} preserveAspectRatio="none" aria-hidden="true">
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={30} fill="currentColor" />
      ))}
    </svg>
  );
}
