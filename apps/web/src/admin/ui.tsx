import { explorerAddressUrl, type ContractsRegistry } from '@elymum/shared';
import type { StatusSnapshot } from '@elymum/sdk/ops';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Address, PublicClient } from 'viem';
import { Button, Icon } from '../design';
import type { AdminApi } from '../site/api';
import type { AdminNetwork } from './net';
import type { Plan } from './plan';

/** Everything a chain tab needs. */
export interface ChainCtx {
  net: AdminNetwork;
  status: StatusSnapshot | null;
  refresh: () => Promise<void>;
  /** Re-reads the server's chain status (after a registration). */
  reloadNet: () => Promise<void>;
  me: Address | null;
  walletChainId: number | null;
  client: PublicClient | null;
  /** The admin site session's API (null until the admin signed in). */
  api: AdminApi | null;
  /** Opens the transaction preview for a plan. */
  open: (plan: Plan) => void;
  /** The server's registered contracts (`GET /api/site/contracts`; null while loading, absent in tests). */
  registry?: ContractsRegistry | null;
}

/**
 * A collapsed "Advanced: …" section (closed by default): manual controls and address overrides.
 * Everything the panel can know by itself is used automatically; only overrides live in here.
 */
export function Advanced({ title, children, testId, section }: { title: string; children: ReactNode; testId?: string; section?: boolean }) {
  return (
    <details className={`ad-more ad-advanced${section ? ' ad-advanced--section' : ''}`} data-testid={testId} data-advanced="">
      <summary>{title.startsWith('Advanced') ? title : `Advanced: ${title}`}</summary>
      <div className="ad-advanced__body">{children}</div>
    </details>
  );
}

/** A small copy button (the 44 px hit area is padded out around the glyph). */
export function CopyButton({ value, label = 'Copy address' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <button
      type="button"
      className={`ad-copy${done ? ' is-done' : ''}`}
      aria-label={done ? 'Copied' : label}
      title={done ? 'Copied' : label}
      onClick={async () => {
        try {
          await navigator.clipboard?.writeText(value);
          setDone(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard refused */
        }
      }}
    >
      {done ? (
        <Icon name="check" size={13} />
      ) : (
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
          <path d="M15.5 5.5v-.5a1.5 1.5 0 0 0-1.5-1.5H6a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 6 14.5h.5" />
        </svg>
      )}
    </button>
  );
}

/**
 * A full address, never shortened (the owner checks it against an announcement): Geist Mono,
 * the ends that people compare in bold, the middle a shade lighter, an explorer link when the
 * chain has an explorer, and a copy button.
 */
export function Addr({ value, net, copy = true }: { value: string | null | undefined; net: AdminNetwork; copy?: boolean }) {
  if (!value) return <span className="ad-none">none</span>;
  const href = explorerAddressUrl(net.info?.explorerUrl, value);
  const hex = value.startsWith('0x') && value.length > 14;
  const text = hex ? (
    <code className="ad-addr__v">
      <b>{value.slice(0, 6)}</b>
      <span className="ad-addr__mid">{value.slice(6, -4)}</span>
      <b>{value.slice(-4)}</b>
    </code>
  ) : (
    <code className="ad-addr__v">{value}</code>
  );
  return (
    <span className="ad-addr">
      {href ? (
        <a className="ad-addr__link" href={href} target="_blank" rel="noreferrer">
          {text}
        </a>
      ) : (
        text
      )}
      {copy && <CopyButton value={value} />}
    </span>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="mono">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * A workshop card: a cream sticker with an ink edge. `danger` puts a red band on top and a
 * DANGER tag next to the title (freeze, sweep, pause, ownership: things that cannot be taken back).
 */
export function Card({
  title,
  id,
  children,
  lede,
  kicker,
  aside,
  tone,
  className,
}: {
  title: string;
  id: string;
  children?: ReactNode;
  lede?: ReactNode;
  kicker?: ReactNode;
  aside?: ReactNode;
  tone?: 'danger' | 'quiet' | 'done';
  className?: string;
}) {
  return (
    <section className={`ad-card${tone ? ` is-${tone}` : ''}${className ? ` ${className}` : ''}`} aria-labelledby={`ad-${id}-h`} data-card={id}>
      <header className="ad-card__head">
        <div className="ad-card__heading">
          {kicker && <span className="kicker ad-card__kicker">{kicker}</span>}
          <h2 className="ad-card__title" id={`ad-${id}-h`}>
            {title}
          </h2>
        </div>
        {tone === 'danger' && <span className="ad-danger-tag mono">Danger</span>}
        {aside}
      </header>
      {lede && <p className="ad-card__lede">{lede}</p>}
      {children}
    </section>
  );
}

export function Input({
  label,
  value,
  onChange,
  placeholder,
  hint,
  type = 'text',
  suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  type?: string;
  suffix?: string;
}) {
  const id = useId();
  return (
    <div className="ad-field">
      <label className="ad-field__label mono" htmlFor={id}>
        {label}
      </label>
      <span className="ad-field__box">
        <input
          id={id}
          className="ad-input"
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        {suffix && <span className="ad-field__suffix mono">{suffix}</span>}
      </span>
      {hint && (
        <span className="ad-field__hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
    </div>
  );
}

/**
 * The panel's buttons (design `Button`, small). `primary` is the step's main action (teal);
 * `sun` is the one sun button of a view; `danger` is red.
 */
export function Btn({
  children,
  onClick,
  disabled,
  primary,
  sun,
  danger,
  testId,
  icon,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  sun?: boolean;
  danger?: boolean;
  testId?: string;
  icon?: 'arrow' | 'wallet' | 'check' | 'key' | 'lock';
}) {
  const variant = danger ? 'danger' : sun ? 'primary' : primary ? 'teal' : 'secondary';
  return (
    <Button variant={variant} size="sm" disabled={disabled} onClick={onClick} data-testid={testId} lead={icon}>
      {children}
    </Button>
  );
}

/** An inline input error kept next to a form (`AdminInputError` / `RangeError` messages). */
export function useFormError(): [string | null, (fn: () => void) => void, (m: string | null) => void] {
  const [err, setErr] = useState<string | null>(null);
  const guard = (fn: () => void) => {
    try {
      setErr(null);
      fn();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return [err, guard, setErr];
}

export function FormError({ error }: { error: string | null }) {
  return error ? (
    <p className="ad-bad" role="alert">
      {error}
    </p>
  ) : null;
}

/** "needs the admin session" note for actions that talk to `/api/admin/*`. */
export function NeedsSession({ api }: { api: AdminApi | null }) {
  return api ? null : (
    <p className="ad-warn ad-warn--quiet">
      <Icon name="lock" size={16} /> Sign in as the admin (top right) first: this step also talks to the server.
    </p>
  );
}

/** A mono state mark: OK / TODO / ? (the launch checklist and the deploy steps). */
export function Mark({ state }: { state: 'ok' | 'todo' | 'unknown' | 'active' }) {
  return (
    <span className={`ad-mark is-${state} mono`} aria-hidden="true">
      {state === 'ok' ? <Icon name="check" size={14} /> : state === 'unknown' ? '?' : state === 'active' ? '•' : ''}
    </span>
  );
}
