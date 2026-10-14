import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { usePreset, useReducedMotion } from '../motion';
import { Stamp } from './Stamp';

export interface TicketProps {
  /** Main line, e.g. the room name. */
  title?: ReactNode;
  /** Mono line under the title, e.g. "23 players · open". */
  meta?: ReactNode;
  /** Right-hand stub (behind the perforation): fee and unit. */
  stub: ReactNode;
  /** Small rotated stamp over the perforation, e.g. "PASS". */
  stamp?: string;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  /** Replaces title/meta when you need a custom body. */
  children?: ReactNode;
  /** Use `role="radio"` semantics inside a radiogroup. */
  asRadio?: boolean;
  'aria-label'?: string;
  className?: string;
}

/**
 * A paper ticket: real notches cut at the perforation (CSS mask, so it works
 * on any background), outline + pink misregistered offset when selected, and
 * a 3 px press. The shadow lives on the wrapper as drop-shadow so it follows
 * the cut shape.
 */
export function Ticket({
  title,
  meta,
  stub,
  stamp,
  selected = false,
  disabled = false,
  onClick,
  children,
  asRadio = false,
  className,
  ...rest
}: TicketProps) {
  const press = usePreset('press');
  const reduced = useReducedMotion();
  const lifted = selected && !reduced;
  return (
    <motion.div
      className={`kb-ticket${selected ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`}
      initial={false}
      animate={{ x: lifted ? -2 : 0, y: lifted ? -2 : 0 }}
      whileTap={disabled || reduced ? undefined : { x: 1, y: 3 }}
      transition={press}
    >
      <div className="kb-ticket__shape">
        <button
          type="button"
          className="kb-ticket__face"
          onClick={onClick}
          disabled={disabled}
          role={asRadio ? 'radio' : undefined}
          aria-checked={asRadio ? selected : undefined}
          aria-pressed={asRadio ? undefined : selected}
          aria-label={rest['aria-label']}
        >
          <span className="kb-ticket__body">
            {children ?? (
              <>
                {title != null && <span className="kb-ticket__title">{title}</span>}
                {meta != null && <span className="kb-ticket__meta mono">{meta}</span>}
              </>
            )}
          </span>
          <span className="kb-ticket__stub">{stub}</span>
          {stamp && <span className="kb-sr">{stamp}</span>}
        </button>
      </div>
      {stamp && (
        <span className="kb-ticket__stamp" aria-hidden="true">
          <Stamp text={stamp} tone="pink" size="sm" rotate={-11} />
        </span>
      )}
    </motion.div>
  );
}

/** Conventional stub content: big value over a mono unit. */
export function TicketStub({ value, unit }: { value: ReactNode; unit?: ReactNode }) {
  return (
    <>
      <span className="kb-ticket__value">{value}</span>
      {unit != null && <span className="kb-ticket__unit mono">{unit}</span>}
    </>
  );
}
