import type { SiteCounts, WlEntryAdmin, WlStatus } from '@elymum/shared';
import { useCallback, useEffect, useState } from 'react';
import { Chip, InkButton, Sheet, StampSpinner } from '../../design';
import type { WlPage } from '../../site/api';
import { Empty, Ext, errText, fmtDate, useFlash, type TabProps } from './common';

const TONE: Record<WlStatus, 'sun' | 'up' | 'down'> = { pending: 'sun', approved: 'up', rejected: 'down' };
const PAGE_SIZE = 50;

export function Counts({ counts }: { counts: SiteCounts | null }) {
  if (!counts) return null;
  return (
    <dl className="ad-counts" aria-label="Counts">
      <div>
        <dt className="mono">WL total</dt>
        <dd className="num">{counts.wl.total}</dd>
      </div>
      <div className="is-sun">
        <dt className="mono">Pending</dt>
        <dd className="num">{counts.wl.pending}</dd>
      </div>
      <div className="is-up">
        <dt className="mono">Approved</dt>
        <dd className="num">{counts.wl.approved}</dd>
      </div>
      <div>
        <dt className="mono">Rejected</dt>
        <dd className="num">{counts.wl.rejected}</dd>
      </div>
    </dl>
  );
}

function answerNode(a: WlEntryAdmin['tasks'][number]) {
  if (a.answer === true) return <Chip tone="teal">Done (self-attested)</Chip>;
  if (a.answer === null || a.answer === '') return <span className="ad-note">—</span>;
  if (/^https?:\/\//.test(a.answer)) return <Ext href={a.answer} />;
  return <span style={{ whiteSpace: 'pre-wrap' }}>{a.answer}</span>;
}

function Detail({ entry, onClose, onChanged, api }: { entry: WlEntryAdmin; onClose: () => void; onChanged: (e: WlEntryAdmin) => void } & TabProps) {
  const [note, setNote] = useState(entry.note);
  const [flashNode, flash] = useFlash();
  useEffect(() => setNote(entry.note), [entry.id, entry.note]);
  const act = async (label: string, f: () => Promise<WlEntryAdmin>) => {
    try {
      onChanged(await f());
      flash('ok', label);
    } catch (e) {
      flash('err', errText(e));
    }
  };
  return (
    <Sheet open onClose={onClose} title={`@${entry.xHandle}`} kicker="WL entry" closeLabel="Close" className="ad-sheet">
      <div className="ad-form">
        <dl className="ad-kv">
          <div>
            <dt className="mono">Status</dt>
            <dd>
              <Chip tone={TONE[entry.status]}>{entry.status}</Chip>
            </dd>
          </div>
          <div>
            <dt className="mono">X</dt>
            <dd>
              <Ext href={`https://x.com/${entry.xHandle}`}>@{entry.xHandle}</Ext>
            </dd>
          </div>
          <div>
            <dt className="mono">Wallet</dt>
            <dd>
              <code>{entry.wallet}</code>
              {entry.legacy && <span className="ad-bad ad-legacy"> legacy (not an EVM wallet: never in the allowlist)</span>}
            </dd>
          </div>
          <div>
            <dt className="mono">Sent</dt>
            <dd>{fmtDate(entry.createdAt)}</dd>
          </div>
          {entry.dupCollabs.length > 0 && (
            <div>
              <dt className="mono">Duplicate</dt>
              <dd className="ad-bad">Also on collab list {entry.dupCollabs.join(', ')}</dd>
            </div>
          )}
        </dl>
        <h3 className="ad-h3">Tasks</h3>
        <ol className="ad-answers">
          {entry.tasks.map((t) => (
            <li key={t.id}>
              <span className="ad-note">
                {t.title}
                {t.target && (
                  <>
                    {' · '}
                    <Ext href={t.target}>target</Ext>
                  </>
                )}
              </span>
              <div>{answerNode(t)}</div>
            </li>
          ))}
        </ol>
        <div>
          <label className="mono ad-cap" htmlFor="ad-wl-note">
            Note
          </label>
          <textarea id="ad-wl-note" className="st-input" rows={3} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="ad-actions">
          <InkButton variant="paper" size="sm" onClick={() => void act('Note saved.', () => api.wlNote(entry.id, note))} disabled={note === entry.note}>
            Save note
          </InkButton>
          <InkButton variant="teal" size="sm" onClick={() => void act('Approved.', () => api.wlStatus(entry.id, 'approved'))} disabled={entry.status === 'approved'}>
            Approve
          </InkButton>
          <InkButton variant="paper" size="sm" onClick={() => void act('Rejected.', () => api.wlStatus(entry.id, 'rejected'))} disabled={entry.status === 'rejected'}>
            Reject
          </InkButton>
          <InkButton variant="paper" size="sm" onClick={() => void act('Reset to pending.', () => api.wlStatus(entry.id, 'pending'))} disabled={entry.status === 'pending'}>
            Reset
          </InkButton>
        </div>
        {flashNode}
      </div>
    </Sheet>
  );
}

/** WL applications: filters, search, detail, single and bulk status, notes, CSV, counts. */
export function WlTab({ api }: TabProps) {
  const [status, setStatus] = useState<WlStatus | ''>('pending');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<WlPage | null>(null);
  const [counts, setCounts] = useState<SiteCounts | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState<WlEntryAdmin | null>(null);
  const [busy, setBusy] = useState(false);
  const [flashNode, flash] = useFlash();

  const load = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([api.wl({ status, q: query, page, pageSize: PAGE_SIZE }), api.counts()]);
      setData(d);
      setCounts(c);
    } catch (e) {
      flash('err', errText(e));
    }
  }, [api, status, query, page, flash]);
  useEffect(() => void load(), [load]);
  useEffect(() => setPicked(new Set()), [status, query, page]);
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const items = data?.items ?? [];
  const allOn = items.length > 0 && items.every((e) => picked.has(e.id));
  const bulk = async (s: WlStatus) => {
    if (picked.size === 0) return;
    setBusy(true);
    try {
      const r = await api.wlBulk([...picked], s);
      flash('ok', `${r.updated} ${r.updated === 1 ? 'entry' : 'entries'} set to ${s}.`);
      setPicked(new Set());
      await load();
    } catch (e) {
      flash('err', errText(e));
    } finally {
      setBusy(false);
    }
  };
  const csv = async (scope: 'approved' | 'all') => {
    try {
      await api.wlCsv(scope);
    } catch (e) {
      flash('err', errText(e));
    }
  };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section className="ad-card" aria-labelledby="ad-wl-h">
      <div className="ad-card__bar">
        <h2 className="ad-card__title" id="ad-wl-h">
          WL applications
        </h2>
        <div className="ad-actions">
          <InkButton variant="ghost" size="sm" onClick={() => void csv('approved')}>
            CSV: approved
          </InkButton>
          <InkButton variant="ghost" size="sm" onClick={() => void csv('all')}>
            CSV: all
          </InkButton>
        </div>
      </div>
      <Counts counts={counts} />
      <div className="ad-filters">
        <div className="ad-chips" role="group" aria-label="Status">
          {(['', 'pending', 'approved', 'rejected'] as const).map((s) => (
            <Chip
              key={s || 'all'}
              tone="ink"
              selected={status === s}
              onClick={() => {
                setStatus(s);
                setPage(1);
              }}
            >
              {s || 'all'}
            </Chip>
          ))}
        </div>
        <label className="ad-search">
          <span className="kb-sr">Search</span>
          <input className="st-input" type="search" placeholder="Search wallet, handle, note or id" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div className={`ad-actions ad-bulk${picked.size > 0 ? ' is-live' : ''}`} aria-label="Bulk actions">
        <span className="ad-bulk__n">
          <span className="num">{picked.size}</span> selected
        </span>
        <InkButton variant="teal" size="sm" disabled={busy || picked.size === 0} onClick={() => void bulk('approved')}>
          Approve selected
        </InkButton>
        <InkButton variant="paper" size="sm" disabled={busy || picked.size === 0} onClick={() => void bulk('rejected')}>
          Reject selected
        </InkButton>
        <InkButton variant="paper" size="sm" disabled={busy || picked.size === 0} onClick={() => void bulk('pending')}>
          Reset selected
        </InkButton>
      </div>
      {flashNode}
      {!data ? (
        <StampSpinner label="Loading" />
      ) : items.length === 0 ? (
        <Empty scene="queue">
          No entries{status ? ` with status ${status}` : ''}
          {query ? ` matching “${query}”` : ''}. {status === 'pending' && !query ? 'Inbox zero. Have a snack.' : ''}
        </Empty>
      ) : (
        <div className="ad-tablewrap">
          <table className="ad-table ad-wltable">
            <thead>
              <tr>
                <th scope="col">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allOn}
                    onChange={() => setPicked(allOn ? new Set() : new Set(items.map((e) => e.id)))}
                    className="ad-box"
                  />
                </th>
                <th scope="col">Handle</th>
                <th scope="col">Wallet</th>
                <th scope="col">Status</th>
                <th scope="col">Sent</th>
                <th scope="col">Flags</th>
                <th scope="col">
                  <span className="kb-sr">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id}>
                  <td>
                    <input
                      type="checkbox"
                      className="ad-box"
                      aria-label={`Select @${e.xHandle}`}
                      checked={picked.has(e.id)}
                      onChange={() =>
                        setPicked((p) => {
                          const n = new Set(p);
                          if (n.has(e.id)) n.delete(e.id);
                          else n.add(e.id);
                          return n;
                        })
                      }
                    />
                  </td>
                  <td>
                    <Ext href={`https://x.com/${e.xHandle}`}>@{e.xHandle}</Ext>
                  </td>
                  <td>
                    <code title={e.wallet} className="ad-wallet">
                      {e.wallet.slice(0, 6)}…{e.wallet.slice(-4)}
                    </code>
                    {e.legacy && <span className="ad-bad ad-legacy"> legacy</span>}
                  </td>
                  <td>
                    <Chip tone={TONE[e.status]}>{e.status}</Chip>
                  </td>
                  <td className="num ad-date">{fmtDate(e.createdAt)}</td>
                  <td>
                    <span className="ad-flags">
                      {e.dupCollabs.length > 0 && <span className="ad-code mono is-bad">dup</span>}
                      {e.note && <span className="ad-code mono">note</span>}
                    </span>
                  </td>
                  <td>
                    <InkButton variant="paper" size="sm" onClick={() => setOpen(e)}>
                      Open
                    </InkButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > data.pageSize && (
        <div className="ad-actions">
          <InkButton variant="paper" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </InkButton>
          <span className="ad-note num">
            Page {page} of {pages} · {data.total} entries
          </span>
          <InkButton variant="paper" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </InkButton>
        </div>
      )}
      {open && (
        <Detail
          api={api}
          entry={open}
          onClose={() => setOpen(null)}
          onChanged={(e) => {
            setOpen(e);
            setData((d) => (d ? { ...d, items: d.items.map((x) => (x.id === e.id ? e : x)) } : d));
            void api.counts().then(setCounts, () => {});
          }}
        />
      )}
    </section>
  );
}
