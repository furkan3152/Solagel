import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CoinCharacter, type CoinMood } from '../../design';
import type { AdminApi } from '../../site/api';

export interface TabProps {
  api: AdminApi;
}

/** A one-line result of the last action (aria-live). */
export function useFlash(): [ReactNode, (kind: 'ok' | 'err', text: string) => void] {
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((kind: 'ok' | 'err', text: string) => {
    setMsg({ kind, text });
    if (timer.current) clearTimeout(timer.current);
    if (kind === 'ok') timer.current = setTimeout(() => setMsg(null), 4000);
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const node = (
    <p className={msg?.kind === 'err' ? 'ad-bad' : 'ad-note ad-flash'} role={msg?.kind === 'err' ? 'alert' : 'status'} aria-live="polite">
      {msg?.text ?? ''}
    </p>
  );
  return [node, flash];
}

export const errText = (err: unknown): string => (err as Error)?.message || 'Something went wrong.';

export const fmtDate = (ms: number | null | undefined): string =>
  ms ? new Date(ms).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/** `datetime-local` value for a Unix ms time (local clock). */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const fromLocalInput = (v: string): number => new Date(v).getTime();

/** An outbound link that is safe to click from the admin (http(s) only). */
export function Ext({ href, children }: { href: string | null | undefined; children?: ReactNode }) {
  if (!href || !/^https?:\/\//i.test(href)) return <span>{children ?? href ?? '—'}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children ?? href}
    </a>
  );
}

/** An empty table: a small sleepy coin and one honest line. */
export function Empty({ children, mood = 'sleepy' }: { children: ReactNode; mood?: CoinMood }) {
  return (
    <div className="ad-empty">
      <CoinCharacter paint="cream" mood={mood} size={56} />
      <p>{children}</p>
    </div>
  );
}
