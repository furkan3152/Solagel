import { COLLAB_ROLES, COLLAB_TYPES, SITE_LIMITS, isXStatusUrl, type CollabPublic, type CollabWalletRow } from '@elymum/shared';
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type ReactNode } from 'react';
import { Field, Icon, InkButton, Stamp, StampSpinner } from '../../design';
import { SiteApiError, site } from '../api';
import { dropExpired } from '../session';
import { X_URL, useSiteSettings, xProfile } from '../settings';
import { SitePage, XIcon } from '../Shell';
import { SiteWalletProvider, WalletSignIn, useSiteSession } from '../wallet/SiteWallet';
import { CollabGuide } from './CollabGuide';
import {
  EMPTY_DRAFT,
  ROLE_LABEL,
  TYPE_LABEL,
  applyBody,
  applyErrors,
  countdown,
  fillRows,
  filledRows,
  parsePastedList,
  rowErrors,
  type ApplyDraft,
  type ApplyErrors,
} from './logic';
import './collab.css';

/** `/collab`: apply with a community, follow its review, and hand out the spots. */
export function CollabPage() {
  return (
    <SitePage className="cb-root">
      <SiteWalletProvider>
        <Collab />
      </SiteWalletProvider>
    </SitePage>
  );
}

const PHASE: Record<CollabPublic['phase'], { label: string; tone: 'mustard' | 'red' | 'teal' | 'ink' | 'pink' }> = {
  in_review: { label: 'In review', tone: 'mustard' },
  rejected: { label: 'Not this time', tone: 'red' },
  approved: { label: 'Approved', tone: 'teal' },
  submitted: { label: 'Submitted', tone: 'ink' },
  closed: { label: 'Closed', tone: 'pink' },
};

function stepOf(view: 'new' | CollabPublic | null): number {
  if (!view || view === 'new') return 0;
  if (view.phase === 'in_review' || view.phase === 'rejected') return 1;
  return 2;
}

function Collab() {
  const { settings, loaded } = useSiteSettings();
  const session = useSiteSession();
  const [collabs, setCollabs] = useState<CollabPublic[] | null>(null);
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [guide, setGuide] = useState(false);
  const [signin, setSignin] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // the apply form's draft lives here, so signing in (which reloads the list) never loses it
  const [draft, setDraft] = useState<ApplyDraft>(EMPTY_DRAFT);
  const dirty = JSON.stringify(draft) !== JSON.stringify(EMPTY_DRAFT);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const refresh = async (token: string) => {
    try {
      const list = await site.myCollabs(token);
      setCollabs(list);
      setLoadErr(null);
      return list;
    } catch (err) {
      if (!dropExpired(err)) setLoadErr((err as Error).message);
      setCollabs([]);
      return [];
    }
  };

  useEffect(() => {
    if (!session) {
      setCollabs(null);
      return;
    }
    let live = true;
    void site.myCollabs(session.token).then(
      (list) => {
        if (!live) return;
        setCollabs(list);
        setSelected((s) => (dirtyRef.current ? 'new' : s && s !== 'new' && list.some((c) => c.id === s) ? s : (list[0]?.id ?? 'new')));
      },
      (err) => {
        if (!live) return;
        if (!dropExpired(err)) setLoadErr((err as Error).message);
        setCollabs([]);
      },
    );
    return () => {
      live = false;
    };
  }, [session]);

  // "this page updates by itself": while something is in review, look again every minute
  const reviewing = collabs?.some((c) => c.phase === 'in_review') ?? false;
  useEffect(() => {
    if (!session || !reviewing) return;
    const t = setInterval(() => {
      if (!document.hidden) void refresh(session.token);
    }, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, reviewing]);

  const current: CollabPublic | 'new' | null = !session || collabs === null ? (session && !dirty ? null : 'new') : selected === 'new' || collabs.length === 0 ? 'new' : (collabs.find((c) => c.id === selected) ?? collabs[0]);
  const step = stepOf(current);
  const replace = (c: CollabPublic) => setCollabs((list) => (list ? list.map((x) => (x.id === c.id ? c : x)) : [c]));
  const guideFor = current && current !== 'new' ? current : null;

  return (
    <div className="st-page cb-page">
      <header className="cb-head">
        <div>
          <span className="st-kicker mono">Collab · Slana NFT</span>
          <h1 className="st-title">Bring your community.</h1>
          <p className="st-deck">DAOs, guilds, alpha groups and NFT projects can get Slana WL spots to raffle to their members. Tell us about yours.</p>
        </div>
        <ol className="cb-progress" aria-label="Collab steps">
          {['Apply', 'Review', 'Add wallets'].map((label, i) => (
            <li key={label} className={i === step ? 'is-on' : i < step ? 'is-done' : ''} aria-current={i === step ? 'step' : undefined}>
              <span className="mono">{i + 1}</span> {label}
            </li>
          ))}
        </ol>
      </header>

      <div className="cb-layout">
        <aside className="cb-side">
          <button type="button" className="cb-guidecard" onClick={() => setGuide(true)}>
            <span className="cb-guidecard__k mono">Collab guide</span>
            <strong>Read this first</strong>
            <span>How to run your raffle and hand out your spots.</span>
            <span className="cb-guidecard__open mono">
              Open <Icon name="arrow" size={16} />
            </span>
          </button>

          <section className="cb-mine" aria-labelledby="cb-mine-h">
            <h2 id="cb-mine-h" className="cb-mine__h mono">
              Your communities
            </h2>
            {!session ? (
              <>
                <p className="st-note">Applied before? Sign in with the same wallet to see your communities.</p>
                {signin ? (
                  <WalletSignIn label="Sign in" />
                ) : (
                  <InkButton variant="paper" size="sm" lead="wallet" onClick={() => setSignin(true)}>
                    Sign in
                  </InkButton>
                )}
              </>
            ) : collabs === null ? (
              <StampSpinner label="Loading" />
            ) : (
              <>
                {collabs.length === 0 && <p className="st-note">No communities yet. Fill in the form to apply.</p>}
                <ul className="cb-mine__list">
                  {collabs.map((c) => (
                    <li key={c.id}>
                      <button type="button" className={`cb-mine__item${current !== 'new' && current?.id === c.id ? ' is-on' : ''}`} onClick={() => setSelected(c.id)} aria-current={current !== 'new' && current?.id === c.id ? 'true' : undefined}>
                        <span className="cb-mine__name">{c.community}</span>
                        <span className={`kb-chip mono kb-tone-${PHASE[c.phase].tone}`}>{PHASE[c.phase].label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {collabs.length > 0 && (
                  <button type="button" className="st-textlink" onClick={() => setSelected('new')} disabled={!settings.collabOpen}>
                    + Add another community
                  </button>
                )}
                <WalletSignIn />
              </>
            )}
            {loadErr && (
              <p className="st-note is-error" role="alert">
                {loadErr}
              </p>
            )}
          </section>
          <p className="st-note">
            Questions? DM <a href={X_URL} target="_blank" rel="noreferrer">@slanaio</a> on X.
          </p>
        </aside>

        <section className="cb-main" aria-live="polite">
          {!loaded || current === null ? (
            <div className="cb-loading">
              <StampSpinner label="Loading" />
            </div>
          ) : current === 'new' ? (
            settings.collabOpen ? (
              <ApplyForm
                d={draft}
                setD={setDraft}
                onApplied={(c) => {
                  setDraft(EMPTY_DRAFT);
                  window.scrollTo({ top: 0 });
                  setCollabs((list) => [c, ...(list ?? [])]);
                  setSelected(c.id);
                }}
                onCancel={collabs && collabs.length > 0 ? () => setSelected(collabs[0].id) : undefined}
              />
            ) : (
              <ClosedCard onSignIn={session ? undefined : () => setSignin(true)} />
            )
          ) : (
            <CollabView key={current.id} collab={current} onChange={replace} onGuide={() => setGuide(true)} onExpired={() => session && void refresh(session.token)} />
          )}
        </section>
      </div>
      <CollabGuide open={guide} onClose={() => setGuide(false)} community={guideFor?.community ?? ''} spots={guideFor?.spots ?? null} deadline={guideFor?.deadline ?? null} />
    </div>
  );
}

function ClosedCard({ onSignIn }: { onSignIn?: () => void }) {
  return (
    <div className="st-card cb-state">
      <Stamp text="Closed" tone="pink" size="md" rotate={-8} />
      <h2 className="cb-state__title">Applications are closed.</h2>
      <p className="cb-state__text">
        We are not taking new communities right now. Follow <a href={X_URL} target="_blank" rel="noreferrer">@slanaio</a> on X for the next round.
      </p>
      <div className="st-row">
        <a className="st-linkbtn st-linkbtn--ink" href={X_URL} target="_blank" rel="noreferrer">
          <XIcon /> Follow @slanaio
        </a>
        {onSignIn && (
          <button type="button" className="st-textlink" onClick={onSignIn}>
            Applied before? Sign in
          </button>
        )}
      </div>
    </div>
  );
}

function Select({ id, label, value, onChange, options, error }: { id: string; label: string; value: string; onChange: (v: string) => void; options: [string, string][]; error?: string }) {
  return (
    <div className={`cb-field${error ? ' is-error' : ''}`}>
      <label className="st-label mono" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="st-input" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-err` : undefined}>
        <option value="">Pick one</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      {error && (
        <p className="st-note is-error" id={`${id}-err`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const FIELD_OF: Record<string, keyof ApplyDraft> = { community: 'community', type: 'type', members: 'members', communityX: 'communityX', contactX: 'contactX', discord: 'discord', role: 'role', postUrl: 'postUrl', about: 'about' };

export function ApplyForm({ d, setD, onApplied, onCancel }: { d: ApplyDraft; setD: (f: (x: ApplyDraft) => ApplyDraft) => void; onApplied: (c: CollabPublic) => void; onCancel?: () => void }) {
  const session = useSiteSession();
  const [errors, setErrors] = useState<ApplyErrors>({});
  const [website, setWebsite] = useState('');
  const [sending, setSending] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const set = (k: keyof ApplyDraft) => (v: string) => {
    setD((x) => ({ ...x, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const submit = async () => {
    setFormErr(null);
    const e = applyErrors(d);
    setErrors(e);
    if (Object.keys(e).length > 0) {
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    if (!session) {
      setFormErr('Sign in with your wallet below to send it.');
      return;
    }
    setSending(true);
    try {
      onApplied(await site.applyCollab(session.token, applyBody(d, website)));
    } catch (err) {
      if (dropExpired(err)) {
        setFormErr('Your sign-in expired. Sign in again to send it.');
        return;
      }
      const se = err as SiteApiError;
      const k = se.field ? FIELD_OF[se.field] : undefined;
      if (k) setErrors((x) => ({ ...x, [k]: se.code === 'collab_limit' ? 'This X account has already applied twice.' : se.message }));
      else setFormErr(se.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      ref={form}
      className="st-card cb-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      aria-labelledby="cb-form-h"
    >
      <h2 className="cb-form__h" id="cb-form-h">
        Apply with your community
      </h2>
      <div className="cb-form__grid">
        <Field className="cb-span2" label="Community name" value={d.community} onChange={(e) => set('community')(e.target.value)} maxLength={SITE_LIMITS.community + 20} error={errors.community} autoComplete="off" />
        <Select id="cb-type" label="Type" value={d.type} onChange={set('type')} options={COLLAB_TYPES.map((t) => [t, TYPE_LABEL[t]])} error={errors.type} />
        <Field label="Members" value={d.members} onChange={(e) => set('members')(e.target.value)} inputMode="numeric" error={errors.members} placeholder="2500" autoComplete="off" />
        <Field label="Community X" prefix="@" value={d.communityX.replace(/^@/, '')} onChange={(e) => set('communityX')(e.target.value)} error={errors.communityX} autoCapitalize="off" spellCheck={false} autoComplete="off" />
        <Field label="Your X" prefix="@" value={d.contactX.replace(/^@/, '')} onChange={(e) => set('contactX')(e.target.value)} error={errors.contactX} autoCapitalize="off" spellCheck={false} autoComplete="off" />
        <Field label="Your Discord (optional)" value={d.discord} onChange={(e) => set('discord')(e.target.value)} error={errors.discord} maxLength={SITE_LIMITS.discord + 10} autoComplete="off" />
        <Select id="cb-role" label="Your role" value={d.role} onChange={set('role')} options={COLLAB_ROLES.map((r) => [r, ROLE_LABEL[r]])} error={errors.role} />
        <Field
          className="cb-span2"
          label="Your post about Slana on X"
          value={d.postUrl}
          onChange={(e) => set('postUrl')(e.target.value)}
          error={errors.postUrl}
          hint="Post about Slana on your community's X (tag @slanaio), then paste the link here. You cannot apply without it."
          placeholder="https://x.com/yourcommunity/status/…"
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
        />
        <div className="cb-field cb-span2">
          <label className="st-label mono" htmlFor="cb-about">
            About your community
          </label>
          <textarea id="cb-about" className="st-input" value={d.about} onChange={(e) => set('about')(e.target.value)} maxLength={SITE_LIMITS.about + 50} aria-invalid={errors.about ? true : undefined} aria-describedby="cb-about-note" />
          <p className={`st-note${errors.about ? ' is-error' : ''}`} id="cb-about-note" role={errors.about ? 'alert' : undefined}>
            {errors.about ?? `${d.about.trim().length} / ${SITE_LIMITS.about}`}
          </p>
        </div>
        <label className="st-honey" aria-hidden="true">
          Company
          <input tabIndex={-1} autoComplete="off" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>
      <div className="cb-form__sign">
        <p className="st-note">Your wallet signs once to send this: free, no transaction. Use the wallet you will come back with: it is how you add your winners later.</p>
        {!session && <WalletSignIn label="Sign in to apply" />}
      </div>
      <div className="st-row cb-form__actions">
        <InkButton type="submit" variant="pink" icon="arrow" disabled={sending || !session}>
          {sending ? 'Sending…' : 'Apply'}
        </InkButton>
        {onCancel && (
          <InkButton variant="paper" onClick={onCancel}>
            Cancel
          </InkButton>
        )}
      </div>
      {formErr && (
        <p className="st-note is-error" role="alert">
          {formErr}
        </p>
      )}
    </form>
  );
}

function Summary({ c }: { c: CollabPublic }) {
  return (
    <dl className="cb-summary">
      <div>
        <dt className="mono">Community</dt>
        <dd>{c.community}</dd>
      </div>
      <div>
        <dt className="mono">Type</dt>
        <dd>{TYPE_LABEL[c.type]}</dd>
      </div>
      <div>
        <dt className="mono">Members</dt>
        <dd>{c.members.toLocaleString('en-US')}</dd>
      </div>
      <div>
        <dt className="mono">Community X</dt>
        <dd>
          <a href={xProfile(c.communityX)} target="_blank" rel="noreferrer">
            @{c.communityX}
          </a>
        </dd>
      </div>
    </dl>
  );
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function StateCard({ stamp, tone, title, children, c }: { stamp: string; tone: 'mustard' | 'red' | 'teal' | 'ink' | 'pink'; title: string; children: ReactNode; c: CollabPublic }) {
  return (
    <div className="st-card cb-state" data-phase={c.phase}>
      <Stamp text={stamp} tone={tone} size="md" rotate={-8} />
      <h2 className="cb-state__title">{title}</h2>
      <div className="cb-state__text">{children}</div>
      <Summary c={c} />
    </div>
  );
}

export function CollabView({ collab: c, onChange, onGuide, onExpired }: { collab: CollabPublic; onChange: (c: CollabPublic) => void; onGuide: () => void; onExpired: () => void }) {
  if (c.phase === 'in_review')
    return (
      <StateCard stamp="In review" tone="mustard" title="Thanks for applying." c={c}>
        We are reviewing it and will DM <strong>@{c.contactX}</strong> on X. This page updates by itself once your spots are ready.
      </StateCard>
    );
  if (c.phase === 'rejected')
    return (
      <StateCard stamp="Not this time" tone="red" title="Not this time." c={c}>
        Thanks for applying. We cannot offer spots to this community this round. DM <a href={X_URL} target="_blank" rel="noreferrer">@slanaio</a> on X if something changed.
      </StateCard>
    );
  return <SpotsView c={c} onChange={onChange} onGuide={onGuide} onExpired={onExpired} />;
}

function SpotsView({ c, onChange, onGuide, onExpired }: { c: CollabPublic; onChange: (c: CollabPublic) => void; onGuide: () => void; onExpired: () => void }) {
  const session = useSiteSession();
  const spots = c.spots ?? 0;
  const locked = c.phase !== 'approved';
  const now = useNow(c.phase === 'approved');
  const left = c.deadline ? c.deadline - now : 0;
  const [rows, setRows] = useState<CollabWalletRow[]>(() => c.wallets.map((w) => ({ ...w })));
  const [raffle, setRaffle] = useState(c.raffleUrl ?? '');
  const [shown, setShown] = useState(() => Math.min(spots, Math.max(10, c.wallets.length + 2)));
  const [serverRowErr, setServerRowErr] = useState<Record<number, string>>({});
  const [raffleErr, setRaffleErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null);
  const [confirm, setConfirm] = useState(false);
  const expiredOnce = useRef(false);

  useEffect(() => {
    if (c.phase === 'approved' && c.deadline && left <= 0 && !expiredOnce.current) {
      expiredOnce.current = true;
      onExpired();
    }
  }, [c.phase, c.deadline, left, onExpired]);

  const table = useMemo(() => {
    const out = rows.slice(0, spots);
    while (out.length < Math.max(shown, rows.length)) out.push({ name: '', wallet: '' });
    return out.slice(0, Math.max(shown, Math.min(rows.length, spots)));
  }, [rows, shown, spots]);
  const errs = rowErrors(table);
  const filled = filledRows(table);

  const setCell = (i: number, k: keyof CollabWalletRow, v: string) => {
    setRows((r) => {
      const next = table.map((x) => ({ ...x }));
      next[i] = { ...next[i], [k]: v };
      return next;
    });
    if (serverRowErr[i]) setServerRowErr((e) => ({ ...e, [i]: '' }));
    setMsg(null);
  };

  const onPaste = (i: number) => (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!/\n/.test(text.trim()) && !/\s/.test(text.trim())) return; // one plain value: a normal paste
    const parsed = parsePastedList(text);
    if (parsed.length === 0) return;
    e.preventDefault();
    const next = fillRows(table, i, parsed, spots);
    setRows(next);
    setShown((s) => Math.min(spots, Math.max(s, i + parsed.length + 1)));
    const dropped = i + parsed.length - spots;
    setMsg({ kind: dropped > 0 ? 'err' : 'ok', text: dropped > 0 ? `Pasted ${parsed.length - dropped} rows. ${dropped} did not fit in your ${spots} spots.` : `Pasted ${parsed.length} rows.` });
  };

  const fail = (err: unknown) => {
    if (dropExpired(err)) {
      setMsg({ kind: 'err', text: 'Your sign-in expired. Sign in again with the same wallet.' });
      return;
    }
    const se = err as SiteApiError;
    const m = /^wallets\[(\d+)\]/.exec(se.field ?? '');
    if (m) {
      // the server indexes the filled rows it was sent: map back to the table
      const idx = Number(m[1]);
      let seen = -1;
      const at = table.findIndex((r) => (r.wallet.trim() || r.name.trim() ? ++seen === idx : false));
      setServerRowErr({ [at >= 0 ? at : idx]: se.message });
    } else if (se.field === 'raffleUrl') setRaffleErr(se.message);
    else if (se.code === 'deadline_passed' || se.code === 'wrong_state') onExpired();
    setMsg({ kind: 'err', text: se.message });
  };

  const save = async () => {
    if (!session || errs.some(Boolean)) {
      setMsg({ kind: 'err', text: 'Fix the rows marked in red first.' });
      return;
    }
    const url = raffle.trim();
    if (url && !isXStatusUrl(url)) {
      setRaffleErr('That is not a link to an X post. It looks like https://x.com/yourcommunity/status/1234567890.');
      return;
    }
    setBusy('save');
    try {
      const next = await site.saveWallets(session.token, c.id, filled, url || null);
      onChange(next);
      setMsg({ kind: 'ok', text: `Saved ${filled.length} ${filled.length === 1 ? 'wallet' : 'wallets'}.` });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    setConfirm(false);
    if (!session) return;
    const url = raffle.trim();
    if (!isXStatusUrl(url)) {
      setRaffleErr(url ? 'That is not a link to an X post. It looks like https://x.com/yourcommunity/status/1234567890.' : 'Post the raffle on X first, then paste its link. You cannot submit without it.');
      return;
    }
    if (errs.some(Boolean)) {
      setMsg({ kind: 'err', text: 'Fix the rows marked in red first.' });
      return;
    }
    if (filled.length === 0) {
      setMsg({ kind: 'err', text: 'Add at least one winner first.' });
      return;
    }
    setBusy('submit');
    try {
      const next = await site.submitWallets(session.token, c.id, filled, url);
      onChange(next);
      setMsg(null);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const head =
    c.phase === 'submitted' ? (
      <>
        <Stamp text="Submitted" tone="ink" size="md" rotate={-7} />
        <h2 className="cb-state__title">The list is in.</h2>
        <p className="cb-state__text">
          {c.wallets.length} {c.wallets.length === 1 ? 'wallet is' : 'wallets are'} on the way to the Slana WL. The list is locked; DM <a href={X_URL} target="_blank" rel="noreferrer">@slanaio</a> if you need a change.
        </p>
      </>
    ) : c.phase === 'closed' ? (
      <>
        <Stamp text="Closed" tone="pink" size="md" rotate={-7} />
        <h2 className="cb-state__title">The deadline passed.</h2>
        <p className="cb-state__text">
          The list was not submitted in time. DM <a href={X_URL} target="_blank" rel="noreferrer">@slanaio</a> on X if you need more time.
        </p>
      </>
    ) : (
      <>
        <div className="cb-spots">
          <Stamp text={`${spots} spots`} sub="approved" tone="teal" round size="md" rotate={-8} />
          <div className="cb-timer" role="timer" aria-live="off">
            <span className="cb-timer__n" data-testid="cb-countdown">
              {countdown(c.deadline ?? 0, now)}
            </span>
            <span className="cb-timer__l mono">left to submit</span>
          </div>
        </div>
        <h2 className="cb-state__title">You have spots. Run your raffle.</h2>
        <p className="cb-state__text">
          Post the raffle on your community&apos;s X (the{' '}
          <button type="button" className="st-textlink" onClick={onGuide}>
            collab guide
          </button>{' '}
          has a post ready), then add your winners here before{' '}
          {c.deadline ? new Date(c.deadline).toLocaleString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'the deadline'}.
        </p>
      </>
    );

  return (
    <div className="st-card cb-state cb-spotsview" data-phase={c.phase}>
      {head}
      <div className="cb-raffle">
        {locked ? (
          c.raffleUrl && (
            <p>
              <span className="mono cb-raffle__k">Raffle post</span>{' '}
              <a href={c.raffleUrl} target="_blank" rel="noreferrer">
                {c.raffleUrl}
              </a>
            </p>
          )
        ) : (
          <Field
            label="Your raffle post on X"
            value={raffle}
            onChange={(e) => {
              setRaffle(e.target.value);
              setRaffleErr(null);
            }}
            error={raffleErr ?? undefined}
            hint="Post the raffle on your community's X, then paste its link. You cannot submit without it."
            placeholder="https://x.com/yourcommunity/status/…"
            inputMode="url"
            spellCheck={false}
            autoComplete="off"
          />
        )}
      </div>

      <div className="cb-table-head">
        <h3 className="cb-table-h">{locked ? 'Your WL winners' : 'Add your WL winners'}</h3>
        <span className="mono cb-count" aria-live="polite">
          {locked ? c.wallets.length : filled.length} / {spots}
        </span>
      </div>
      <div className="cb-tablewrap">
        <table className="cb-table">
          <thead>
            <tr>
              <th scope="col" className="mono">
                #
              </th>
              <th scope="col" className="mono">
                Name
              </th>
              <th scope="col" className="mono">
                Wallet
              </th>
            </tr>
          </thead>
          <tbody>
            {(locked ? c.wallets : table).map((r, i) => {
              const err = locked ? null : serverRowErr[i] || errs[i];
              return (
                <tr key={i} className={err ? 'is-error' : undefined}>
                  <td className="mono cb-table__no">{i + 1}</td>
                  <td>
                    {locked ? (
                      <span className="cb-name">{r.name || '—'}</span>
                    ) : (
                      <input className="cb-cell" aria-label={`Row ${i + 1} name`} value={r.name} maxLength={SITE_LIMITS.walletName + 10} onChange={(e) => setCell(i, 'name', e.target.value)} onPaste={onPaste(i)} placeholder="Discord or X" />
                    )}
                  </td>
                  <td>
                    {locked ? (
                      <code className="cb-wallet">{r.wallet}</code>
                    ) : (
                      <>
                        <input
                          className="cb-cell cb-cell--wallet"
                          aria-label={`Row ${i + 1} wallet`}
                          aria-invalid={err ? true : undefined}
                          value={r.wallet}
                          onChange={(e) => setCell(i, 'wallet', e.target.value.trim())}
                          onPaste={onPaste(i)}
                          spellCheck={false}
                          autoComplete="off"
                          placeholder="Solana wallet"
                        />
                        {err && (
                          <span className="cb-cell__err" role="alert">
                            {err}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!locked && (
        <>
          <p className="st-note">One person per row. Paste a list (a name and a wallet on each line) into any row to fill the rows below it.</p>
          {table.length < spots && (
            <button type="button" className="st-textlink" onClick={() => setShown((s) => Math.min(spots, s + 10))}>
              + Show more rows ({spots - table.length} left)
            </button>
          )}
          <div className="st-row cb-actions">
            <InkButton variant="paper" onClick={() => void save()} disabled={busy !== null}>
              {busy === 'save' ? 'Saving…' : 'Save wallets'}
            </InkButton>
            {confirm ? (
              <div className="cb-confirm" role="group" aria-label="Confirm submit">
                <span>Submitting locks the list. Submit {filled.length} {filled.length === 1 ? 'wallet' : 'wallets'}?</span>
                <InkButton variant="pink" size="sm" onClick={() => void submit()}>
                  Yes, submit
                </InkButton>
                <InkButton variant="paper" size="sm" onClick={() => setConfirm(false)}>
                  Not yet
                </InkButton>
              </div>
            ) : (
              <InkButton variant="pink" icon="arrow" onClick={() => setConfirm(true)} disabled={busy !== null}>
                {busy === 'submit' ? 'Submitting…' : 'Submit wallets'}
              </InkButton>
            )}
          </div>
        </>
      )}
      {msg && (
        <p className={`st-note${msg.kind === 'err' ? ' is-error' : ' cb-ok'}`} role={msg.kind === 'err' ? 'alert' : 'status'}>
          {msg.text}
        </p>
      )}
      <Summary c={c} />
    </div>
  );
}
