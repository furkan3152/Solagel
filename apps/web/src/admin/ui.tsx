import { explorerAddressUrl } from '@elymum/shared';
import type { StatusSnapshot } from '@elymum/sdk/ops';
import { useState, type ReactNode } from 'react';
import type { Address, PublicClient } from 'viem';
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
}

export function Addr({ value, net }: { value: string | null | undefined; net: AdminNetwork }) {
  if (!value) return <span className="ad-note">none</span>;
  const href = explorerAddressUrl(net.info?.explorerUrl, value);
  return href ? (
    <a className="ad-addr" href={href} target="_blank" rel="noreferrer">
      <code>{value}</code>
    </a>
  ) : (
    <code className="ad-addr">{value}</code>
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

export function Card({ title, id, children, lede }: { title: string; id: string; children: ReactNode; lede?: ReactNode }) {
  return (
    <section className="ad-card" aria-labelledby={`ad-${id}-h`} data-card={id}>
      <h2 className="ad-card__title" id={`ad-${id}-h`}>
        {title}
      </h2>
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  type?: string;
}) {
  return (
    <label className="ad-field">
      <span className="mono ad-cap">{label}</span>
      <input className="st-input" type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} />
      {hint && <span className="ad-note">{hint}</span>}
    </label>
  );
}

export function Btn({ children, onClick, disabled, primary, danger, testId }: { children: ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean; danger?: boolean; testId?: string }) {
  return (
    <button type="button" className={`ad-btn${primary ? ' ad-btn--primary' : ''}${danger ? ' ad-btn--danger' : ''}`} disabled={disabled} onClick={onClick} data-testid={testId}>
      {children}
    </button>
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
  return api ? null : <p className="ad-warn">Sign in as the admin (above) first: this step also talks to the server.</p>;
}
