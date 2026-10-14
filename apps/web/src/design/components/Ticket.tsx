import { motion } from 'motion/react';
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { usePreset, useReducedMotion } from '../motion';
import { Stamp } from './Stamp';

export interface TicketProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title' | 'value' | 'onClick'> {
  /** Main line, e.g. the room name. */
  title?: ReactNode;
  /** Mono line under the title, e.g. "23 players · open". */
  meta?: ReactNode;
  /** Right-hand stub (behind the perforation): fee and unit. */
  stub: ReactNode;
  /** Small rotated stamp over the perforation, e.g. "PASS". */
  stamp?: string;
  /** Standalone toggle state (aria-pressed). Ignored inside a TicketGroup. */
  selected?: boolean;
  /** Identity inside a TicketGroup. */
  value?: string;
  onClick?: () => void;
  /** Replaces title/meta when you need a custom body. */
  children?: ReactNode;
}

interface GroupCtx {
  value: string | null;
  /** The one ticket with tabIndex 0: the selection, else the first enabled ticket. */
  tabStop: string | null;
  select: (v: string) => void;
}
const TicketGroupContext = createContext<GroupCtx | null>(null);

/**
 * A paper ticket: real notches cut at the perforation (CSS mask, so it works
 * on any background), outline + pink misregistered offset when selected, and
 * a 3 px press. The shadow lives on a wrapper as drop-shadow so it follows the
 * cut shape. Alone it is a toggle button (aria-pressed); inside a
 * `TicketGroup` it is a radio with roving focus.
 */
export function Ticket({
  title,
  meta,
  stub,
  stamp,
  selected: selectedProp = false,
  value,
  disabled = false,
  onClick,
  children,
  className,
  ...rest
}: TicketProps) {
  const group = useContext(TicketGroupContext);
  const press = usePreset('press');
  const reduced = useReducedMotion();
  const inGroup = group !== null && value !== undefined;
  const selected = inGroup ? group.value === value : selectedProp;
  const lifted = selected && !reduced;

  const a11y = inGroup
    ? { role: 'radio' as const, 'aria-checked': selected, tabIndex: group.tabStop === value ? 0 : -1, 'data-kb-value': value }
    : { 'aria-pressed': selected };

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
          disabled={disabled}
          {...rest}
          {...a11y}
          onClick={() => {
            if (inGroup) group.select(value);
            onClick?.();
          }}
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

export interface TicketGroupProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'role'> {
  /** Accessible name of the radio group (translated). */
  label: string;
  value: string | null;
  onChange: (value: string) => void;
  children: ReactNode;
}

/**
 * Radio group of tickets (WAI-ARIA radiogroup): one tab stop, arrows move and
 * select, Home/End jump, disabled tickets are skipped. Selection follows focus,
 * like native radios. Every ticket's tabIndex comes from context (no DOM writes).
 */
export function TicketGroup({ label, value, onChange, children, onKeyDown, ...rest }: TicketGroupProps) {
  const root = useRef<HTMLDivElement>(null);
  /** Values of the enabled tickets in DOM order (React state, so the tab stop follows them). */
  const [enabledValues, setEnabledValues] = useState<string[]>([]);

  const radios = () =>
    [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])].filter(
      (r) => r.closest('[role="radiogroup"]') === root.current,
    );
  const enabled = () => radios().filter((r) => !r.disabled);

  // Track the enabled tickets in DOM order, as React state.
  useLayoutEffect(() => {
    const vals = enabled().map((r) => r.dataset.kbValue ?? '');
    if (vals.join('\u0000') !== enabledValues.join('\u0000')) setEnabledValues(vals);
  });

  // The selected ticket is the tab stop only while it is an enabled ticket of this group;
  // a disabled or unknown value falls back to the first enabled one (never zero tab stops).
  const tabStop = value !== null && enabledValues.includes(value) ? value : (enabledValues[0] ?? null);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    if (!radios().includes(target as HTMLButtonElement)) return; // only our tickets
    const list = enabled();
    if (!list.length) return;
    const i = list.indexOf(target as HTMLButtonElement);
    let next = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (i + 1) % list.length;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = i < 0 ? list.length - 1 : (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const el = list[next];
    const v = el.dataset.kbValue;
    if (v !== undefined) onChange(v);
    el.focus();
  };

  return (
    <TicketGroupContext.Provider value={{ value, tabStop, select: onChange }}>
      <div {...rest} ref={root} role="radiogroup" aria-label={label} onKeyDown={onKey}>
        {children}
      </div>
    </TicketGroupContext.Provider>
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
