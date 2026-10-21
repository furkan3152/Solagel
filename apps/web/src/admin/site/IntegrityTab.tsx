import {
  INTEGRITY_FLAG_KINDS,
  INTEGRITY_THRESHOLD_RANGES,
  formatToken,
  type ChainStatus,
  type IntegrityFlag,
  type IntegrityFlagKind,
  type IntegrityFlagStatus,
  type IntegrityHeld,
  type IntegrityOverview,
  type IntegritySettings,
  type IntegrityThresholds,
  type IntegrityWalletView,
} from '@slana/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Chip, InkButton, Sheet, StampSpinner } from '../../design';
import { request, type IntegrityApi, type IntegrityFilter } from '../../site/api';
import { errText, fmtDate, useFlash, type TabProps } from './common';

const KIND_LABEL: Record<IntegrityFlagKind, string> = {
  pair_transfer: 'Pair transfer',
  eject_feed: 'Eject feeding',
  suicide_feed: 'Suicide feeding',
  shared_device: 'Shared IP or browser',
  bot_input: 'Bot-like input',
  bell_abuse: 'Round-bell pattern',
};

const STATUS_TONE: Record<IntegrityFlagStatus, 'mustard' | 'teal' | 'ink'> = { open: 'mustard', reviewed: 'teal', dismissed: 'ink' };

const THRESHOLD_LABEL: Record<keyof IntegrityThresholds, string> = {
  flagMinScore: 'Keep flags scoring at least',
  pairMinEvents: 'Pair: occasions',
  pairMinRounds: 'Pair: distinct rounds',
  pairMaxPValue: 'Pair: chance at most (p-value)',
  pairMinNetFees: 'Pair: net value (entry fees)',
  ejectMinEaten: 'Eject: blobs eaten by others',
  ejectMinShare: 'Eject: share eaten by one wallet',
  suicideMinDeaths: 'Suicide: deaths to the same wallet',
  suicideMinApproach: 'Suicide: share moving toward it',
  sharedMinOverlapMs: 'Shared: overlap (ms)',
  sharedIpScore: 'Shared: score for one IP',
  sharedFpScore: 'Shared: score for one browser',
  sharedBothScore: 'Shared: score for both',
  botMinInputs: 'Bot: inputs needed',
  botMaxIntervalCv: 'Bot: timing variation at most (CV)',
  botMaxTurnEntropy: 'Bot: turn entropy at most (bits)',
  botMinIntegerShare: 'Bot: whole-number aims at least',
  botMaxReactionMs: 'Bot: median reaction under (ms)',
  botMinReactionSamples: 'Bot: reaction samples needed',
  botMaxActiveHours: 'Bot: active hours of 24',
  bellMinSessions: 'Bell: suspicious tickets',
  bellLateJoinMs: 'Bell: late join window (ms)',
  bellMinAfkShare: 'Bell: idle share',
};

const HOUR = 3_600_000;
const shortW = (w: string) => (w.length > 12 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w);
const scoreTone = (s: number): 'pink' | 'mustard' | 'ink' => (s >= 80 ? 'pink' : s >= 60 ? 'mustard' : 'ink');

/** Token amounts in the game token's units when the chain reports them (raw units otherwise). */
function useMoney(): (raw: number) => string {
  const [token, setToken] = useState<ChainStatus['token']>(null);
  useEffect(() => {
    request<{ chain: ChainStatus }>('/api/config').then(
      (r) => setToken(r.chain.token),
      () => {},
    );
  }, []);
  return useCallback((raw: number) => (token ? `${formatToken(raw, token.decimals)} ${token.symbol}` : `${raw} (raw units)`), [token]);
}

function Wallet({ w }: { w: string }) {
  return (
    <code title={w} className="ad-int__wallet">
      {shortW(w)}
    </code>
  );
}

function evidenceValue(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ') || '—';
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

function Timeline({ api, wallet, other, money }: { api: IntegrityApi; wallet: string; other?: string; money: (n: number) => string }) {
  const [view, setView] = useState<IntegrityWalletView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setView(null);
    api.wallet(wallet, other).then(setView, (e) => setErr(errText(e)));
  }, [api, wallet, other]);
  if (err) return <p className="ad-bad">{err}</p>;
  if (!view) return <StampSpinner label="Loading" />;
  const rows = [...view.transfers].sort((a, b) => b.at - a.at);
  let net = 0;
  for (const t of view.transfers) net += t.to === wallet ? t.amount : -t.amount;
  const max = rows.reduce((m, t) => Math.max(m, t.amount), 1);
  return (
    <div className="ad-int__timeline">
      <p className="ad-note">
        {rows.length} value transfer{rows.length === 1 ? '' : 's'} {other ? <>between <Wallet w={wallet} /> and <Wallet w={other} /></> : <>involving <Wallet w={wallet} /></>} in
        the detection window · net to <Wallet w={wallet} />: <strong>{money(net)}</strong> · {view.sessions.length} tickets · risk {view.risk}
      </p>
      {rows.length === 0 ? null : (
        <div className="ad-tablewrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Round</th>
                <th scope="col">From → to</th>
                <th scope="col">Amount</th>
                <th scope="col">
                  <span className="kb-sr">Size</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((t, i) => (
                <tr key={`${t.at}-${i}`}>
                  <td>{fmtDate(t.at)}</td>
                  <td className="mono">
                    #{t.arenaId} · {t.round}
                  </td>
                  <td>
                    <Wallet w={t.from} /> → <Wallet w={t.to} />
                    {t.afkEater && (
                      <>
                        {' '}
                        <Chip tone="pink">idle eater</Chip>
                      </>
                    )}
                  </td>
                  <td className="mono">{money(t.amount)}</td>
                  <td aria-hidden="true">
                    <span className="ad-int__bar" style={{ width: `${Math.max(4, (t.amount / max) * 120)}px` }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Flag detail                                                         */
/* ------------------------------------------------------------------ */

function FlagSheet({
  api,
  flag,
  banned,
  money,
  onClose,
  onChanged,
  onBan,
}: {
  api: IntegrityApi;
  flag: IntegrityFlag;
  banned: Set<string>;
  money: (n: number) => string;
  onClose: () => void;
  onChanged: (f: IntegrityFlag) => void;
  onBan: (wallet: string) => void;
}) {
  const [note, setNote] = useState(flag.note);
  const [flashNode, flash] = useFlash();
  useEffect(() => setNote(flag.note), [flag.id, flag.note]);
  const set = async (status: IntegrityFlagStatus, label: string) => {
    try {
      onChanged(await api.setStatus(flag.id, status, note));
      flash('ok', label);
    } catch (e) {
      flash('err', errText(e));
    }
  };
  const pair = flag.wallets.length === 2 && flag.kind !== 'bot_input' && flag.kind !== 'bell_abuse';
  return (
    <Sheet open onClose={onClose} title={KIND_LABEL[flag.kind]} kicker={`Flag · score ${flag.score}`} closeLabel="Close" className="ad-sheet">
      <div className="ad-form">
        <p>{flag.summary}</p>
        <dl className="ad-kv">
          <div>
            <dt className="mono">Status</dt>
            <dd>
              <Chip tone={STATUS_TONE[flag.status]}>{flag.status}</Chip>
              {flag.statusBy && (
                <span className="ad-note">
                  {' '}
                  by <Wallet w={flag.statusBy} /> · {fmtDate(flag.statusAt)}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="mono">Seen</dt>
            <dd>
              {fmtDate(flag.firstSeen)} → {fmtDate(flag.lastSeen)}
            </dd>
          </div>
          {flag.arenaId !== null && (
            <div>
              <dt className="mono">Arena</dt>
              <dd>#{flag.arenaId}</dd>
            </div>
          )}
          {flag.wallets.map((w) => (
            <div key={w}>
              <dt className="mono">{w === flag.beneficiary ? 'Beneficiary' : 'Wallet'}</dt>
              <dd className="ad-int__walletrow">
                <code>{w}</code>
                {banned.has(w) ? (
                  <Chip tone="pink">banned</Chip>
                ) : (
                  <InkButton variant="paper" size="sm" onClick={() => onBan(w)}>
                    Ban…
                  </InkButton>
                )}
              </dd>
            </div>
          ))}
        </dl>
        <h3 className="ad-h3">Evidence</h3>
        <dl className="ad-kv">
          {Object.entries(flag.evidence).map(([k, v]) => (
            <div key={k}>
              <dt className="mono">{k}</dt>
              <dd className="mono">{evidenceValue(v)}</dd>
            </div>
          ))}
        </dl>
        <h3 className="ad-h3">Value transfers</h3>
        <Timeline api={api} wallet={flag.beneficiary ?? flag.wallets[0]} other={pair ? flag.wallets.find((w) => w !== (flag.beneficiary ?? flag.wallets[0])) : undefined} money={money} />
        <div>
          <label className="mono ad-cap" htmlFor="ad-int-note">
            Review note
          </label>
          <textarea id="ad-int-note" className="st-input" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="ad-actions">
          <InkButton variant="pink" size="sm" onClick={() => void set('reviewed', 'Marked reviewed.')} disabled={flag.status === 'reviewed' && note === flag.note}>
            Mark reviewed
          </InkButton>
          <InkButton variant="paper" size="sm" onClick={() => void set('dismissed', 'Dismissed.')} disabled={flag.status === 'dismissed' && note === flag.note}>
            Dismiss
          </InkButton>
          <InkButton variant="paper" size="sm" onClick={() => void set('open', 'Re-opened.')} disabled={flag.status === 'open'}>
            Re-open
          </InkButton>
        </div>
        <p className="ad-note">A flag is evidence for a person to weigh, never a verdict. A dismissed flag opens again only if its score rises by 20 or more.</p>
        {flashNode}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Held settlements                                                    */
/* ------------------------------------------------------------------ */

function HeldCard({ api, held, money, onChanged }: { api: IntegrityApi; held: IntegrityHeld[]; money: (n: number) => string; onChanged: () => void }) {
  const [zero, setZero] = useState<IntegrityHeld | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [flashNode, flash] = useFlash();
  const release = async (h: IntegrityHeld) => {
    if (!window.confirm(`Pay ${money(h.payout)} to ${h.player} as settled at the bell?`)) return;
    setBusy(true);
    try {
      await api.release(h.key);
      flash('ok', 'Released: the settlement is paid as it was.');
      onChanged();
    } catch (e) {
      flash('err', errText(e));
    } finally {
      setBusy(false);
    }
  };
  const settleZero = async () => {
    if (!zero) return;
    setBusy(true);
    try {
      const r = await api.settleZero(zero.key, reason);
      flash('ok', `Settled at 0. ${money(r.forfeited)} stays in the arena vault (journaled as forfeited).`);
      setZero(null);
      setReason('');
      onChanged();
    } catch (e) {
      flash('err', errText(e));
    } finally {
      setBusy(false);
    }
  };
  const now = Date.now();
  return (
    <section className="ad-card" aria-labelledby="ad-int-held-h">
      <h2 className="ad-card__title" id="ad-int-held-h">
        Held settlements
      </h2>
      <p className="ad-note">
        Payouts the auto-hold kept for review. They are owed, not paid and not lost. Decide within 24 hours: after that the player can refund the unsettled ticket on chain at the
        entry fee.
      </p>
      {flashNode}
      {held.length === 0 ? (
        <p className="ad-note">Nothing is held.</p>
      ) : (
        <div className="ad-tablewrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th scope="col">Wallet</th>
                <th scope="col">Arena</th>
                <th scope="col">Payout</th>
                <th scope="col">Risk</th>
                <th scope="col">Why</th>
                <th scope="col">Held</th>
                <th scope="col">
                  <span className="kb-sr">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {held.map((h) => {
                const age = now - h.heldAt;
                return (
                  <tr key={h.key}>
                    <td>
                      <Wallet w={h.player} />
                    </td>
                    <td className="mono">#{h.arenaId ?? '?'}</td>
                    <td className="mono">{money(h.payout)}</td>
                    <td>
                      <Chip tone={scoreTone(h.score)}>{h.score}</Chip>
                    </td>
                    <td>{h.why}</td>
                    <td className={age > 12 * HOUR ? 'ad-bad' : undefined}>
                      {fmtDate(h.heldAt)}
                      {age > 12 * HOUR && <span className="ad-note"> · {Math.floor(age / HOUR)} h old</span>}
                    </td>
                    <td>
                      <div className="ad-actions">
                        <InkButton variant="pink" size="sm" disabled={busy} onClick={() => void release(h)}>
                          Release
                        </InkButton>
                        <InkButton variant="paper" size="sm" disabled={busy} onClick={() => setZero(h)}>
                          Settle at 0…
                        </InkButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {zero && (
        <Sheet open onClose={() => setZero(null)} title="Settle at 0" kicker="Held settlement" closeLabel="Cancel" className="ad-sheet">
          <div className="ad-form">
            <p>
              <Wallet w={zero.player} /> gets nothing for this ticket. {money(zero.payout)} stays in the arena vault, recorded in the journal as forfeited. This cannot be undone once
              the chain settles it.
            </p>
            <div>
              <label className="mono ad-cap" htmlFor="ad-int-zero">
                Reason (kept in the journal)
              </label>
              <textarea id="ad-int-zero" className="st-input" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <div className="ad-actions">
              <InkButton variant="pink" size="sm" disabled={busy || reason.trim().length < 3} onClick={() => void settleZero()}>
                Settle at 0
              </InkButton>
              <InkButton variant="paper" size="sm" onClick={() => setZero(null)}>
                Cancel
              </InkButton>
            </div>
          </div>
        </Sheet>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

function SettingsCard({ api, overview, onSaved }: { api: IntegrityApi; overview: IntegrityOverview; onSaved: (s: IntegritySettings) => void }) {
  const [draft, setDraft] = useState<IntegritySettings>(overview.settings);
  const [busy, setBusy] = useState(false);
  const [flashNode, flash] = useFlash();
  useEffect(() => setDraft(overview.settings), [overview.settings]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(overview.settings);
  const save = async (patch: Parameters<IntegrityApi['saveSettings']>[0], label: string) => {
    setBusy(true);
    try {
      onSaved(await api.saveSettings(patch));
      flash('ok', label);
    } catch (e) {
      flash('err', errText(e));
    } finally {
      setBusy(false);
    }
  };
  const keys = Object.keys(THRESHOLD_LABEL) as (keyof IntegrityThresholds)[];
  return (
    <section className="ad-card" aria-labelledby="ad-int-set-h">
      <h2 className="ad-card__title" id="ad-int-set-h">
        Detector settings
      </h2>
      <label className="ad-check">
        <input type="checkbox" checked={draft.autoHold} onChange={() => setDraft({ ...draft, autoHold: !draft.autoHold })} />
        <span>
          Auto-hold risky payouts
          <span className="ad-note" style={{ display: 'block', fontWeight: 400 }}>
            Off by default. When on, a profitable settlement whose wallet scores at or above the hold score waits here for a decision instead of being paid. Nothing on chain changes.
          </span>
        </span>
      </label>
      <label className="ad-int__field">
        <span className="mono ad-cap">Hold score (50 to 100)</span>
        <input className="st-input" type="number" min={50} max={100} value={draft.holdScore} onChange={(e) => setDraft({ ...draft, holdScore: Number(e.target.value) })} />
      </label>
      <details className="ad-int__details">
        <summary className="mono">Thresholds</summary>
        <div className="ad-int__grid">
          {keys.map((k) => {
            const [lo, hi] = INTEGRITY_THRESHOLD_RANGES[k];
            return (
              <label key={k} className="ad-int__field">
                <span className="mono ad-cap">{THRESHOLD_LABEL[k]}</span>
                <input
                  className="st-input"
                  type="number"
                  min={lo}
                  max={hi}
                  step="any"
                  value={draft.thresholds[k]}
                  onChange={(e) => setDraft({ ...draft, thresholds: { ...draft.thresholds, [k]: Number(e.target.value) } })}
                />
                <span className="ad-note">default {overview.defaults.thresholds[k]}</span>
              </label>
            );
          })}
        </div>
      </details>
      <div className="ad-actions">
        <InkButton
          variant="pink"
          onClick={() => {
            if (draft.autoHold && !overview.settings.autoHold && !window.confirm('Turn auto-hold on? Risky payouts will wait for your decision in this tab.')) return;
            void save({ autoHold: draft.autoHold, holdScore: draft.holdScore, thresholds: draft.thresholds }, 'Settings saved.');
          }}
          disabled={busy || !dirty}
        >
          {busy ? 'Saving…' : 'Save settings'}
        </InkButton>
        {dirty && (
          <InkButton variant="paper" size="sm" onClick={() => setDraft(overview.settings)}>
            Undo changes
          </InkButton>
        )}
        <InkButton variant="paper" size="sm" disabled={busy} onClick={() => window.confirm('Restore every default (auto-hold off)?') && void save({ reset: true }, 'Defaults restored.')}>
          Restore defaults
        </InkButton>
      </div>
      {flashNode}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* The tab                                                             */
/* ------------------------------------------------------------------ */

/** Integrity: flags with evidence and transfer timelines, bans, held settlements, detector settings. */
export function IntegrityTab({ api: adminApi }: TabProps) {
  const api = adminApi.integrity;
  const money = useMoney();
  const [overview, setOverview] = useState<IntegrityOverview | null>(null);
  const [flags, setFlags] = useState<IntegrityFlag[] | null>(null);
  const [status, setStatus] = useState<IntegrityFlagStatus | ''>('open');
  const [kind, setKind] = useState<IntegrityFlagKind | ''>('');
  const [minScore, setMinScore] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<IntegrityFlag | null>(null);
  const [banFor, setBanFor] = useState<string | null>(null);
  const [banWallet, setBanWallet] = useState('');
  const [banReason, setBanReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [flashNode, flash] = useFlash();

  const filter: IntegrityFilter = useMemo(() => ({ status, kind, minScore: minScore === '' ? null : Number(minScore), q: query }), [status, kind, minScore, query]);
  const loadOverview = useCallback(() => api.overview().then(setOverview, (e) => flash('err', errText(e))), [api, flash]);
  const loadFlags = useCallback(() => api.flags(filter).then(setFlags, (e) => flash('err', errText(e))), [api, filter, flash]);
  useEffect(() => void loadOverview(), [loadOverview]);
  useEffect(() => void loadFlags(), [loadFlags]);
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const banned = useMemo(() => new Set((overview?.bans ?? []).map((b) => b.wallet)), [overview]);

  const scan = async () => {
    setBusy(true);
    try {
      setOverview(await api.scan());
      await loadFlags();
      flash('ok', 'Detectors ran over the whole window.');
    } catch (e) {
      flash('err', errText(e));
    } finally {
      setBusy(false);
    }
  };
  const ban = async () => {
    const w = (banFor ?? banWallet).trim();
    setBusy(true);
    try {
      await api.ban(w, banReason);
      flash('ok', `Banned ${shortW(w)} from paid arenas. Practice still works.`);
      setBanFor(null);
      setBanWallet('');
      setBanReason('');
      await loadOverview();
    } catch (e) {
      flash('err', errText(e));
    } finally {
      setBusy(false);
    }
  };
  const unban = async (w: string) => {
    if (!window.confirm(`Unban ${w}?`)) return;
    try {
      await api.unban(w);
      flash('ok', `Unbanned ${shortW(w)}.`);
      await loadOverview();
    } catch (e) {
      flash('err', errText(e));
    }
  };
  const csv = async () => {
    try {
      await api.flagsCsv(filter);
    } catch (e) {
      flash('err', errText(e));
    }
  };

  if (!overview) return <StampSpinner label="Loading" />;
  const c = overview.counts;

  return (
    <div className="ad-stack">
      <section className="ad-card" aria-labelledby="ad-int-h">
        <div className="ad-card__bar">
          <h2 className="ad-card__title" id="ad-int-h">
            Integrity
          </h2>
          <div className="ad-actions">
            <InkButton variant="paper" size="sm" disabled={busy} onClick={() => void scan()}>
              Run detectors now
            </InkButton>
          </div>
        </div>
        <p className="ad-note">
          Cheat and collusion signals from arena play: repeated value between the same wallets, feeding, shared IP or browser, bot-like input and round-bell patterns. Scores are
          evidence for review. The detectors run every minute{overview.scannedAt ? ` (last ${fmtDate(overview.scannedAt)})` : ''}.
        </p>
        <dl className="ad-counts" aria-label="Integrity counts">
          {(
            [
              ['Open', c.open],
              ['Reviewed', c.reviewed],
              ['Dismissed', c.dismissed],
              ['Held', c.held],
              ['Banned', c.bans],
              ['Tickets', c.sessions],
              ['Transfers', c.transfers],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="mono">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className={overview.settings.autoHold ? 'ad-bad' : 'ad-note'}>
          Auto-hold is {overview.settings.autoHold ? `ON (hold score ${overview.settings.holdScore})` : 'off'}.
        </p>
        {flashNode}
      </section>

      <HeldCard api={api} held={overview.held} money={money} onChanged={() => void loadOverview()} />

      <section className="ad-card" aria-labelledby="ad-int-flags-h">
        <div className="ad-card__bar">
          <h2 className="ad-card__title" id="ad-int-flags-h">
            Flags
          </h2>
          <InkButton variant="paper" size="sm" onClick={() => void csv()}>
            CSV
          </InkButton>
        </div>
        <div className="ad-filters">
          <div className="ad-chips" role="group" aria-label="Status">
            {(['open', 'reviewed', 'dismissed', ''] as const).map((s) => (
              <Chip key={s || 'all'} tone={s ? STATUS_TONE[s] : 'ink'} selected={status === s} onClick={() => setStatus(s)}>
                {s || 'all'}
              </Chip>
            ))}
          </div>
          <label className="ad-int__field">
            <span className="kb-sr">Kind</span>
            <select className="st-input" value={kind} onChange={(e) => setKind(e.target.value as IntegrityFlagKind | '')}>
              <option value="">Every kind</option>
              {INTEGRITY_FLAG_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="ad-int__field ad-int__narrow">
            <span className="kb-sr">Minimum score</span>
            <input className="st-input" type="number" min={0} max={100} placeholder="Min score" value={minScore} onChange={(e) => setMinScore(e.target.value)} />
          </label>
          <label className="ad-search">
            <span className="kb-sr">Search</span>
            <input className="st-input" type="search" placeholder="Search wallet, summary, note or id" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
        {!flags ? (
          <StampSpinner label="Loading" />
        ) : flags.length === 0 ? (
          <p className="ad-note">No flags{status ? ` with status ${status}` : ''}.</p>
        ) : (
          <div className="ad-tablewrap">
            <table className="ad-table">
              <thead>
                <tr>
                  <th scope="col">Score</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Summary</th>
                  <th scope="col">Wallets</th>
                  <th scope="col">Last seen</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="kb-sr">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {flags.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <Chip tone={scoreTone(f.score)}>{f.score}</Chip>
                    </td>
                    <td>{KIND_LABEL[f.kind]}</td>
                    <td>{f.summary}</td>
                    <td>
                      {f.wallets.map((w) => (
                        <div key={w}>
                          <Wallet w={w} />
                          {banned.has(w) && <span className="ad-bad"> banned</span>}
                        </div>
                      ))}
                    </td>
                    <td>{fmtDate(f.lastSeen)}</td>
                    <td>
                      <Chip tone={STATUS_TONE[f.status]}>{f.status}</Chip>
                    </td>
                    <td>
                      <InkButton variant="paper" size="sm" onClick={() => setOpen(f)}>
                        Open
                      </InkButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="ad-card" aria-labelledby="ad-int-bans-h">
        <h2 className="ad-card__title" id="ad-int-bans-h">
          Banned wallets
        </h2>
        <p className="ad-note">A banned wallet cannot start a paid arena game (error “banned”). A ticket already in play finishes normally; practice is open.</p>
        {overview.bans.length === 0 ? (
          <p className="ad-note">No wallet is banned.</p>
        ) : (
          <ul className="ad-int__bans">
            {overview.bans.map((b) => (
              <li key={b.wallet}>
                <code>{b.wallet}</code>
                <span className="ad-note">
                  {fmtDate(b.at)} · by <Wallet w={b.by} /> · {b.reason}
                </span>
                <InkButton variant="paper" size="sm" onClick={() => void unban(b.wallet)}>
                  Unban
                </InkButton>
              </li>
            ))}
          </ul>
        )}
        <div className="ad-int__banform">
          <label className="ad-int__field">
            <span className="mono ad-cap">Wallet</span>
            <input className="st-input" value={banWallet} onChange={(e) => setBanWallet(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <label className="ad-int__field">
            <span className="mono ad-cap">Reason</span>
            <input className="st-input" value={banReason} maxLength={500} onChange={(e) => setBanReason(e.target.value)} />
          </label>
          <InkButton variant="pink" size="sm" disabled={busy || !banWallet.trim() || !banReason.trim()} onClick={() => void ban()}>
            Ban wallet
          </InkButton>
        </div>
      </section>

      <SettingsCard api={api} overview={overview} onSaved={(s) => setOverview({ ...overview, settings: s })} />

      {open && (
        <FlagSheet
          api={api}
          flag={open}
          banned={banned}
          money={money}
          onClose={() => setOpen(null)}
          onBan={(w) => {
            setOpen(null);
            setBanFor(w);
          }}
          onChanged={(f) => {
            setOpen(f);
            setFlags((list) => (list ? list.map((x) => (x.id === f.id ? f : x)) : list));
            void loadOverview();
          }}
        />
      )}
      {banFor && (
        <Sheet open onClose={() => setBanFor(null)} title="Ban wallet" kicker="Paid arenas" closeLabel="Cancel" className="ad-sheet">
          <div className="ad-form">
            <p>
              <code>{banFor}</code> will not be able to start a paid arena game. Practice still works, and you can unban later.
            </p>
            <div>
              <label className="mono ad-cap" htmlFor="ad-int-banreason">
                Reason
              </label>
              <textarea id="ad-int-banreason" className="st-input" rows={3} maxLength={500} value={banReason} onChange={(e) => setBanReason(e.target.value)} />
            </div>
            <div className="ad-actions">
              <InkButton variant="pink" size="sm" disabled={busy || !banReason.trim()} onClick={() => void ban()}>
                Ban wallet
              </InkButton>
              <InkButton variant="paper" size="sm" onClick={() => setBanFor(null)}>
                Cancel
              </InkButton>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
