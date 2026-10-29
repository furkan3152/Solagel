import { SITE_LIMITS, type CollabAdmin, type CollabStatus, type SiteCounts } from '@elymum/shared';
import { useCallback, useEffect, useState } from 'react';
import { Chip, Field, InkButton, Sheet, StampSpinner } from '../../design';
import { ROLE_LABEL, TYPE_LABEL } from '../../site/collab/labels';
import { Ext, errText, fmtDate, fromLocalInput, toLocalInput, useFlash, type TabProps } from './common';

type Filter = CollabStatus | 'closed' | '';
const PHASE_TONE: Record<CollabAdmin['phase'], 'mustard' | 'pink' | 'teal' | 'ink'> = { in_review: 'mustard', rejected: 'pink', approved: 'teal', submitted: 'ink', closed: 'pink' };
const DAY = 24 * 3600_000;

const dupCount = (c: CollabAdmin) => c.wallets.filter((w) => w.dupWl || w.dupCollabs.length > 0).length;

function Detail({ collab: c, onClose, onChanged, api }: { collab: CollabAdmin; onClose: () => void; onChanged: (c: CollabAdmin) => void } & TabProps) {
  const [spots, setSpots] = useState(String(c.spots ?? 20));
  const [deadline, setDeadline] = useState(toLocalInput(c.deadline && c.deadline > Date.now() ? c.deadline : Date.now() + 3 * DAY));
  const [note, setNote] = useState(c.note);
  const [errs, setErrs] = useState<{ spots?: string; deadline?: string }>({});
  const [flashNode, flash] = useFlash();
  useEffect(() => setNote(c.note), [c.id, c.note]);

  const act = async (label: string, f: () => Promise<CollabAdmin>) => {
    try {
      onChanged(await f());
      flash('ok', label);
    } catch (e) {
      flash('err', errText(e));
    }
  };
  const read = (): { spots: number; deadline: number } | null => {
    const n = Number(spots);
    const d = fromLocalInput(deadline);
    const e: typeof errs = {};
    if (!Number.isInteger(n) || n < Math.max(1, c.wallets.length) || n > SITE_LIMITS.maxSpots) e.spots = `A whole number from ${Math.max(1, c.wallets.length)} to ${SITE_LIMITS.maxSpots}.`;
    if (!Number.isFinite(d) || d <= Date.now()) e.deadline = 'A time in the future.';
    else if (d > Date.now() + 365 * DAY) e.deadline = 'Within a year.';
    setErrs(e);
    return Object.keys(e).length ? null : { spots: n, deadline: d };
  };

  const canApprove = c.status === 'pending' || c.status === 'rejected' || c.status === 'approved';
  const canExtend = c.status === 'approved' || c.status === 'submitted';

  return (
    <Sheet open onClose={onClose} title={c.community} kicker={`Collab · ${c.id}`} closeLabel="Close" className="ad-sheet">
      <div className="ad-form">
        <div className="ad-chips">
          <Chip tone={PHASE_TONE[c.phase]}>{c.phase.replace('_', ' ')}</Chip>
          {c.spots !== null && <Chip tone="ink">{c.spots} spots</Chip>}
          {c.deadline && <Chip tone="ink">deadline {fmtDate(c.deadline)}</Chip>}
        </div>
        <dl className="ad-kv">
          <div>
            <dt className="mono">Type · members</dt>
            <dd>
              {TYPE_LABEL[c.type]} · {c.members.toLocaleString('en-US')}
            </dd>
          </div>
          <div>
            <dt className="mono">Community X</dt>
            <dd>
              <Ext href={`https://x.com/${c.communityX}`}>@{c.communityX}</Ext>
            </dd>
          </div>
          <div>
            <dt className="mono">Contact</dt>
            <dd>
              <Ext href={`https://x.com/${c.contactX}`}>@{c.contactX}</Ext> · {ROLE_LABEL[c.role]}
              {c.discord && <> · Discord {c.discord}</>}
            </dd>
          </div>
          <div>
            <dt className="mono">Post</dt>
            <dd>
              <Ext href={c.postUrl} />
            </dd>
          </div>
          <div>
            <dt className="mono">Raffle</dt>
            <dd>{c.raffleUrl ? <Ext href={c.raffleUrl} /> : <span className="ad-note">not yet</span>}</dd>
          </div>
          <div>
            <dt className="mono">Applicant wallet</dt>
            <dd>
              <code>{c.wallet}</code>
              {c.legacy && <span className="ad-bad ad-legacy"> legacy (not an EVM wallet)</span>}
            </dd>
          </div>
          <div>
            <dt className="mono">About</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>{c.about}</dd>
          </div>
          <div>
            <dt className="mono">Applied · submitted</dt>
            <dd>
              {fmtDate(c.createdAt)} · {fmtDate(c.submittedAt)}
            </dd>
          </div>
        </dl>

        <h3 className="ad-h3">{c.status === 'approved' || c.status === 'submitted' ? 'Spots and deadline' : 'Approve'}</h3>
        <div className="ad-row">
          <Field label="Spots" value={spots} onChange={(e) => setSpots(e.target.value)} inputMode="numeric" error={errs.spots} />
          <Field label="Deadline (your time)" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} error={errs.deadline} />
        </div>
        <div className="ad-actions">
          {canApprove && (
            <InkButton
              variant="pink"
              size="sm"
              onClick={() => {
                const v = read();
                if (v) void act(c.status === 'approved' ? 'Spots and deadline updated.' : 'Approved.', () => api.approveCollab(c.id, v.spots, v.deadline));
              }}
            >
              {c.status === 'approved' ? 'Update approval' : 'Approve'}
            </InkButton>
          )}
          {canExtend && (
            <InkButton
              variant="paper"
              size="sm"
              onClick={() => {
                const v = read();
                if (v) void act('Deadline extended.', () => api.extendCollab(c.id, v.deadline, v.spots));
              }}
            >
              Extend
            </InkButton>
          )}
          {(c.status === 'pending' || c.status === 'approved') && (
            <InkButton variant="paper" size="sm" onClick={() => void act('Rejected.', () => api.rejectCollab(c.id))}>
              Reject
            </InkButton>
          )}
          {c.status === 'submitted' && (
            <InkButton variant="paper" size="sm" onClick={() => void act('Unlocked: the community can edit its list again.', () => api.unlockCollab(c.id))}>
              Unlock list
            </InkButton>
          )}
        </div>

        <div>
          <label className="mono ad-cap" htmlFor="ad-cb-note">
            Note
          </label>
          <textarea id="ad-cb-note" className="st-input" rows={3} value={note} maxLength={SITE_LIMITS.note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="ad-actions">
          <InkButton variant="paper" size="sm" onClick={() => void act('Note saved.', () => api.collabNote(c.id, note))} disabled={note === c.note}>
            Save note
          </InkButton>
        </div>

        <div className="ad-card__bar">
          <h3 className="ad-h3">
            Wallets ({c.wallets.length}
            {c.spots ? ` / ${c.spots}` : ''})
          </h3>
          {c.wallets.length > 0 && (
            <InkButton variant="paper" size="sm" onClick={() => void api.collabCsv(c.id).catch((e) => flash('err', errText(e)))}>
              CSV
            </InkButton>
          )}
        </div>
        {c.wallets.length === 0 ? (
          <p className="ad-note">No wallets yet.</p>
        ) : (
          <div className="ad-tablewrap">
            <table className="ad-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Name</th>
                  <th scope="col">Wallet</th>
                  <th scope="col">Duplicate</th>
                </tr>
              </thead>
              <tbody>
                {c.wallets.map((w, i) => (
                  <tr key={w.wallet}>
                    <td>{i + 1}</td>
                    <td>{w.name || '—'}</td>
                    <td>
                      <code>{w.wallet}</code>
                      {w.legacy && <span className="ad-bad ad-legacy"> legacy: not in the allowlist</span>}
                    </td>
                    <td>
                      {w.dupWl && <span className="ad-bad">on the WL </span>}
                      {w.dupCollabs.length > 0 && <span className="ad-bad">in {w.dupCollabs.join(', ')}</span>}
                      {!w.dupWl && w.dupCollabs.length === 0 && <span className="ad-note">no</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {flashNode}
      </div>
    </Sheet>
  );
}

/** Collab applications: list, detail, approve with spots + deadline, reject, extend, unlock, wallets, CSV, duplicates. */
export function CollabsTab({ api }: TabProps) {
  const [status, setStatus] = useState<Filter>('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<CollabAdmin[] | null>(null);
  const [counts, setCounts] = useState<SiteCounts | null>(null);
  const [open, setOpen] = useState<CollabAdmin | null>(null);
  const [flashNode, flash] = useFlash();

  const load = useCallback(async () => {
    try {
      const [list, c] = await Promise.all([api.collabs({ status, q: query }), api.counts()]);
      setItems(list);
      setCounts(c);
    } catch (e) {
      flash('err', errText(e));
    }
  }, [api, status, query, flash]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <section className="ad-card" aria-labelledby="ad-cb-h">
      <div className="ad-card__bar">
        <h2 className="ad-card__title" id="ad-cb-h">
          Collabs
        </h2>
        <InkButton variant="paper" size="sm" onClick={() => void api.allCollabsCsv().catch((e) => flash('err', errText(e)))}>
          CSV: all submitted wallets
        </InkButton>
      </div>
      {counts && (
        <dl className="ad-counts" aria-label="Counts">
          {(
            [
              ['Total', counts.collab.total],
              ['In review', counts.collab.pending],
              ['Approved', counts.collab.approved],
              ['Submitted', counts.collab.submitted],
              ['Closed', counts.collab.closed],
              ['Rejected', counts.collab.rejected],
              ['Wallets', counts.collab.wallets],
            ] as const
          ).map(([l, n]) => (
            <div key={l}>
              <dt className="mono">{l}</dt>
              <dd>{n}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="ad-filters">
        <div className="ad-chips" role="group" aria-label="Status">
          {(['', 'pending', 'approved', 'submitted', 'closed', 'rejected'] as const).map((s) => (
            <Chip key={s || 'all'} tone="ink" selected={status === s} onClick={() => setStatus(s)}>
              {s === 'pending' ? 'in review' : s || 'all'}
            </Chip>
          ))}
        </div>
        <label className="ad-search">
          <span className="kb-sr">Search</span>
          <input className="st-input" type="search" placeholder="Search community, handle, wallet or id" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {flashNode}
      {!items ? (
        <StampSpinner label="Loading" />
      ) : items.length === 0 ? (
        <p className="ad-note">No collabs here yet.</p>
      ) : (
        <div className="ad-tablewrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th scope="col">Community</th>
                <th scope="col">Type</th>
                <th scope="col">Members</th>
                <th scope="col">Contact</th>
                <th scope="col">Phase</th>
                <th scope="col">Wallets</th>
                <th scope="col">Deadline</th>
                <th scope="col">
                  <span className="kb-sr">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.community}</strong>
                    <div>
                      <Ext href={`https://x.com/${c.communityX}`}>@{c.communityX}</Ext>
                    </div>
                  </td>
                  <td>{TYPE_LABEL[c.type]}</td>
                  <td>{c.members.toLocaleString('en-US')}</td>
                  <td>
                    <Ext href={`https://x.com/${c.contactX}`}>@{c.contactX}</Ext>
                  </td>
                  <td>
                    <Chip tone={PHASE_TONE[c.phase]}>{c.phase.replace('_', ' ')}</Chip>
                  </td>
                  <td>
                    {c.wallets.length}
                    {c.spots ? ` / ${c.spots}` : ''} {dupCount(c) > 0 && <span className="ad-bad">· {dupCount(c)} dup</span>}
                  </td>
                  <td>{fmtDate(c.deadline)}</td>
                  <td>
                    <InkButton variant="paper" size="sm" onClick={() => setOpen(c)}>
                      Open
                    </InkButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <Detail
          api={api}
          collab={open}
          onClose={() => setOpen(null)}
          onChanged={(c) => {
            setOpen(c);
            setItems((list) => (list ? list.map((x) => (x.id === c.id ? c : x)) : list));
            void api.counts().then(setCounts, () => {});
          }}
        />
      )}
    </section>
  );
}
