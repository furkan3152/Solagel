import { normalizeXHandle, type PublicWlTask, type SiteSettings, type WlEntryPublic } from '@slana/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Field, Icon, InkButton, Stamp, StampSpinner, useReducedMotion } from '../../design';
import { SiteApiError, site } from '../api';
import { ticketNo } from '../coinLook';
import { Link } from '../router';
import { dropExpired, signOut } from '../session';
import { X_URL, shortWallet, useSiteSettings, xIntent } from '../settings';
import { SitePage, XIcon } from '../Shell';
import { SiteWalletProvider, WalletSignIn, useSiteSession } from '../wallet/SiteWallet';
import { CardPreview, SaveCardButton } from './CardPreview';
import { buildSteps, stepError, stepForField, submitBody, tweetId, type Answers, type Step } from './steps';
import './wl.css';

/** `/wl`: the WL application (a stepper of the admin's tasks), or the applicant's status. */
export function WlPage() {
  return (
    <SitePage className="wl-root">
      <SiteWalletProvider>
        <Wl />
      </SiteWalletProvider>
    </SitePage>
  );
}

function Wl() {
  const { settings, loaded } = useSiteSettings();
  const [tasks, setTasks] = useState<PublicWlTask[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const session = useSiteSession();
  /** undefined: not looked up yet (or no session). */
  const [entry, setEntry] = useState<WlEntryPublic | null | undefined>(undefined);
  const [fresh, setFresh] = useState(false);
  /** A returning visitor: their status is looked up before the form is shown (later sign-ins keep the form mounted). */
  const [booting, setBooting] = useState(() => !!session);

  useEffect(() => {
    let live = true;
    site.tasks().then(
      (t) => live && setTasks(t),
      (e: SiteApiError) => live && setLoadError(e.message),
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setEntry(undefined);
      return;
    }
    let live = true;
    setEntry(undefined);
    site.myWl(session.token).then(
      (e) => {
        if (!live) return;
        setEntry(e);
        setBooting(false);
      },
      (err) => {
        if (!live) return;
        dropExpired(err);
        setEntry(null);
        setBooting(false);
      },
    );
    return () => {
      live = false;
    };
  }, [session]);

  if (entry) return <WlStatus entry={entry} fresh={fresh} />;
  if (loadError)
    return (
      <div className="st-page">
        <p className="st-err" role="alert">
          {loadError}
        </p>
      </div>
    );
  if (!tasks || !loaded || (booting && session))
    return (
      <div className="st-page wl-loading">
        <StampSpinner label="Loading" />
      </div>
    );
  if (!settings.wlOpen) return <WlClosed />;
  return (
    <WlStepper
      tasks={tasks}
      settings={settings}
      onEntry={(e) => {
        setFresh(true);
        setEntry(e);
        window.scrollTo({ top: 0 });
      }}
    />
  );
}

function WlClosed() {
  const [signin, setSignin] = useState(false);
  return (
    <div className="st-page wl-closed">
      <span className="st-kicker mono">WL · Slana NFT</span>
      <h1 className="st-title">Applications are closed.</h1>
      <p className="st-deck">
        We are not taking new WL entries right now. Follow <a href={X_URL} target="_blank" rel="noreferrer">@slanaio</a> on X for the next round.
      </p>
      <div className="st-row" style={{ marginTop: 24 }}>
        <a className="st-linkbtn st-linkbtn--ink" href={X_URL} target="_blank" rel="noreferrer">
          <XIcon /> Follow @slanaio
        </a>
        <button type="button" className="st-textlink" onClick={() => setSignin((v) => !v)} aria-expanded={signin}>
          Applied before? Sign in
        </button>
      </div>
      {signin && (
        <div className="st-card wl-signin-card">
          <p className="wl-step__body">Sign in with the wallet you applied with to see your status.</p>
          <WalletSignIn label="Sign in to see my status" />
        </div>
      )}
    </div>
  );
}

const STATUS_COPY = {
  pending: {
    title: "You're in the queue.",
    stamp: 'Pending',
    tone: 'mustard',
    body: 'Every entry is checked by hand: the follow, your post and your reply. Sign in with the same wallet any time to see your status.',
  },
  approved: { title: "You're on the list.", stamp: 'Approved', tone: 'teal', body: 'Your wallet is on the Slana WL. The mint date lands on @slanaio first.' },
  rejected: {
    title: 'Not this time.',
    stamp: 'Rejected',
    tone: 'red',
    body: 'We could not verify every task on this entry. Follow @slanaio for the next round.',
  },
} as const;

export function WlStatus({ entry, fresh = false }: { entry: WlEntryPublic; fresh?: boolean }) {
  const c = STATUS_COPY[entry.status];
  const reduced = useReducedMotion();
  return (
    <div className="st-page wl-status" data-status={entry.status}>
      <div className="wl-status__grid">
        <div>
          <span className="st-kicker mono">{fresh ? 'Entry received' : 'Your WL entry'}</span>
          <h1 className="st-title">{c.title}</h1>
          <p className="st-deck">{c.body}</p>
          <dl className="wl-facts">
            <div>
              <dt className="mono">Status</dt>
              <dd>
                <span className={`kb-chip mono kb-tone-${entry.status === 'approved' ? 'teal' : entry.status === 'rejected' ? 'red' : 'mustard'}`} data-testid="wl-status">
                  {entry.status}
                </span>
              </dd>
            </div>
            <div>
              <dt className="mono">X handle</dt>
              <dd>@{entry.xHandle}</dd>
            </div>
            <div>
              <dt className="mono">Wallet</dt>
              <dd>
                <code title={entry.wallet}>{shortWallet(entry.wallet)}</code>
              </dd>
            </div>
            <div>
              <dt className="mono">Sent</dt>
              <dd>{new Date(entry.createdAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</dd>
            </div>
          </dl>
          <div className="st-row" style={{ marginTop: 24 }}>
            <SaveCardButton handle={entry.xHandle} label="Save card again" />
            <a className="st-linkbtn" href={X_URL} target="_blank" rel="noreferrer">
              <XIcon /> Follow @slanaio
            </a>
            <Link className="st-textlink" href="/">
              Back to slana.io
            </Link>
            <button type="button" className="st-textlink" onClick={() => signOut()}>
              Sign out
            </button>
          </div>
        </div>
        <div className="wl-status__card">
          <CardPreview handle={entry.xHandle} />
          <Stamp className="wl-status__stamp" text={c.stamp} tone={c.tone} size="lg" rotate={-9} animateIn={fresh && !reduced} />
        </div>
      </div>
    </div>
  );
}

function StepHead({ i, step, state }: { i: number; step: Step; state: 'done' | 'active' | 'todo' }) {
  const soon = step.kind === 'engage_x' && !step.task.available;
  return (
    <div className="wl-step__head">
      <span className={`wl-step__no mono is-${state}`} aria-hidden="true">
        {state === 'done' ? <Icon name="check" size={16} /> : i + 1}
      </span>
      <h2 className="wl-step__title">{step.title}</h2>
      {soon ? <span className="kb-chip mono kb-tone-mustard">Soon</span> : !step.required ? <span className="kb-chip mono kb-tone-ink">Optional</span> : null}
    </div>
  );
}

function WlStepper({ tasks, settings, onEntry }: { tasks: PublicWlTask[]; settings: SiteSettings; onEntry: (e: WlEntryPublic) => void }) {
  const steps = useMemo(() => buildSteps(tasks), [tasks]);
  const [active, setActive] = useState(0);
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [answers, setAnswers] = useState<Answers>({});
  const [handle, setHandle] = useState('');
  const [website, setWebsite] = useState('');
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [showSignin, setShowSignin] = useState(false);
  const session = useSiteSession();
  const reduced = useReducedMotion();
  const list = useRef<HTMLOListElement>(null);
  const norm = normalizeXHandle(handle);
  const no = norm ? ticketNo(norm) : '';

  const focusStep = (i: number) => {
    requestAnimationFrame(() => list.current?.querySelectorAll<HTMLElement>('.wl-step')[i]?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' }));
  };

  const next = (i: number) => {
    const s = steps[i];
    const err = stepError(s, answers, handle, !!session);
    setErrors((e) => ({ ...e, [s.key]: err }));
    if (err) return;
    setDone((d) => new Set(d).add(s.key));
    const n = Math.min(i + 1, steps.length - 1);
    setActive(n);
    focusStep(n);
  };

  const set = (key: string, v: string | boolean) => {
    setAnswers((a) => ({ ...a, [key]: v }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: null }));
  };

  const submit = async () => {
    setFormError(null);
    for (let i = 0; i < steps.length; i++) {
      const err = stepError(steps[i], answers, handle, !!session);
      if (err) {
        setErrors((e) => ({ ...e, [steps[i].key]: err }));
        setActive(i);
        focusStep(i);
        return;
      }
    }
    if (!session) return;
    setSending(true);
    try {
      onEntry(await site.submitWl(session.token, submitBody(steps, answers, handle, website)));
    } catch (err) {
      if (dropExpired(err)) {
        setFormError('Your sign-in expired. Sign in again to send it.');
        return;
      }
      const e = err as SiteApiError;
      if (e.code === 'already_applied') {
        try {
          const mine = await site.myWl(session.token);
          if (mine) return onEntry(mine);
        } catch {
          /* fall through */
        }
      }
      const at = e.code === 'handle_taken' ? stepForField(steps, 'xHandle') : stepForField(steps, e.field);
      if (at >= 0) {
        setErrors((x) => ({ ...x, [steps[at].key]: e.message }));
        setActive(at);
        focusStep(at);
      } else {
        setFormError(e.message || 'Something went wrong. Try again.');
      }
    } finally {
      setSending(false);
    }
  };

  const total = steps.length;
  const postText = `I'm on my way to the @slanaio WL. Coins eat coins on Solana, and the arena opens soon.${no ? ` Ticket No. ${no}.` : ''} slana.io/wl`;

  return (
    <div className="st-page wl-page">
      <header className="wl-intro">
        <span className="st-kicker mono">WL · Slana NFT · Round 001</span>
        <h1 className="st-title">Join the WL.</h1>
        <p className="st-deck">
          {total} short steps. You get a riso ticket card with your own coin on it, and your wallet goes on the list. Every entry is checked by hand.
        </p>
        <div className="st-row">
          <button type="button" className="st-textlink" aria-expanded={showSignin} onClick={() => setShowSignin((v) => !v)}>
            Applied before? Sign in to see your status
          </button>
        </div>
        {showSignin && !session && (
          <div className="st-card st-card--flat wl-signin-card">
            <WalletSignIn label="Sign in to see my status" />
          </div>
        )}
      </header>

      <div className="wl-layout">
        <aside className="wl-aside" aria-label="Your ticket card">
          <div className="wl-aside__sticky">
            <CardPreview handle={handle} />
            <div className="st-row">
              <SaveCardButton handle={handle} />
              <span className="st-note">Save it, then attach it to your post on X.</span>
            </div>
          </div>
        </aside>

        <ol className="wl-steps" ref={list}>
          {steps.map((s, i) => {
            const state = i === active ? 'active' : done.has(s.key) ? 'done' : 'todo';
            const err = errors[s.key] ?? null;
            const errId = `wl-err-${s.key}`;
            return (
              <li key={s.key} className={`wl-step is-${state}`} data-kind={s.kind}>
                {state === 'active' ? (
                  <StepHead i={i} step={s} state={state} />
                ) : (
                  <button type="button" className="wl-step__toggle" onClick={() => setActive(i)} aria-label={`Step ${i + 1}: ${s.title}${state === 'done' ? ', done. Edit' : ''}`}>
                    <StepHead i={i} step={s} state={state} />
                    {state === 'done' && <span className="wl-step__edit mono">Edit</span>}
                  </button>
                )}
                <AnimatePresence initial={false}>
                  {state === 'active' && (
                    <motion.div
                      className="wl-step__panel"
                      initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                      animate={reduced ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
                      exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                      transition={{ duration: reduced ? 0.12 : 0.26, ease: [0.2, 0.9, 0.25, 1] }}
                    >
                      <div className="wl-step__inner">
                        {s.body && <p className="wl-step__body">{s.body}</p>}
                        <StepBody step={s} i={i} answers={answers} set={set} handle={handle} setHandle={(v) => { setHandle(v); if (errors.handle) setErrors((e) => ({ ...e, handle: null })); }} err={err} errId={errId} postText={postText} no={no} settings={settings} />
                        {s.kind !== 'handle' && s.kind !== 'post_x' && s.kind !== 'engage_x' && s.kind !== 'text' && err && (
                          <p className="st-note is-error" id={errId} role="alert">
                            {err}
                          </p>
                        )}
                        {s.kind === 'sign' ? (
                          <div className="wl-submit">
                            <label className="st-honey" aria-hidden="true">
                              Website
                              <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" />
                            </label>
                            <InkButton variant="pink" size="lg" icon="arrow" onClick={() => void submit()} disabled={sending || !session}>
                              {sending ? 'Sending…' : 'Join the WL'}
                            </InkButton>
                            <p className="st-note">We keep your handle, wallet and links only to run the WL. Every entry is checked by hand before the mint.</p>
                            {formError && (
                              <p className="st-note is-error" role="alert">
                                {formError}
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="st-row wl-step__actions">
                            <InkButton variant="ink" size="sm" icon="arrow" onClick={() => next(i)}>
                              {s.kind === 'engage_x' && !s.task.available ? 'Skip for now' : 'Next'}
                            </InkButton>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" className={`wl-tick${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => onChange(!on)}>
      <span className="wl-tick__box" aria-hidden="true">
        {on && <Icon name="check" size={16} />}
      </span>
      {label}
    </button>
  );
}

function StepBody({
  step,
  answers,
  set,
  handle,
  setHandle,
  err,
  errId,
  postText,
  no,
  settings,
}: {
  step: Step;
  i: number;
  answers: Answers;
  set: (k: string, v: string | boolean) => void;
  handle: string;
  setHandle: (v: string) => void;
  err: string | null;
  errId: string;
  postText: string;
  no: string;
  settings: SiteSettings;
}) {
  const xHandle = settings.xHandle || 'slanaio';
  switch (step.kind) {
    case 'handle':
      return (
        <Field
          label="Your X handle"
          prefix="@"
          value={handle.replace(/^@/, '')}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="yourname"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={100}
          error={err ?? undefined}
          hint="Your card, its number and its coin are made from your handle."
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.closest('.wl-step__inner')?.querySelector<HTMLButtonElement>('.wl-step__actions button')?.click())}
        />
      );
    case 'follow_x': {
      const target = step.task.target || `https://x.com/${xHandle}`;
      const who = /x\.com\/([^/?#]+)/.exec(target)?.[1] ?? xHandle;
      return (
        <div className="st-row">
          <a className="st-linkbtn st-linkbtn--ink" href={target} target="_blank" rel="noreferrer">
            <XIcon /> Follow @{who}
          </a>
          <Toggle on={answers[step.key] === true} onChange={(v) => set(step.key, v)} label="I follow" />
        </div>
      );
    }
    case 'join_link':
      return (
        <div className="st-row">
          {step.task.target && (
            <a className="st-linkbtn st-linkbtn--ink" href={step.task.target} target="_blank" rel="noreferrer">
              Open the invite <Icon name="arrow" size={18} />
            </a>
          )}
          <Toggle on={answers[step.key] === true} onChange={(v) => set(step.key, v)} label="I joined" />
        </div>
      );
    case 'post_x':
      return (
        <div className="wl-grid">
          <div className="st-row">
            <SaveCardButton handle={handle} />
            <a className="st-linkbtn st-linkbtn--ink" href={xIntent(postText)} target="_blank" rel="noreferrer">
              <XIcon /> Post on X
            </a>
          </div>
          <p className="st-note">Attach the card you saved: X cannot add images for you. Tag @{xHandle} so we can find it.</p>
          <Field
            label="Link to your post"
            value={String(answers[step.key] ?? '')}
            onChange={(e) => set(step.key, e.target.value)}
            placeholder="https://x.com/yourname/status/…"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            error={err ?? undefined}
          />
        </div>
      );
    case 'engage_x': {
      if (!step.task.available) {
        return (
          <div className="wl-grid">
            <p className="wl-soon">
              <strong>Opens when the post is live.</strong> Our launch post drops soon on @{xHandle}. This step opens the moment it is up; you can send your
              entry without it.
            </p>
            <div className="st-row">
              <a className="st-linkbtn" href={`https://x.com/${xHandle}`} target="_blank" rel="noreferrer">
                <XIcon /> Watch @{xHandle}
              </a>
            </div>
          </div>
        );
      }
      const id = tweetId(step.task.target);
      return (
        <div className="wl-grid">
          <div className="st-row">
            {id ? (
              <>
                <a className="st-linkbtn" href={`https://x.com/intent/like?tweet_id=${id}`} target="_blank" rel="noreferrer">
                  Like
                </a>
                <a className="st-linkbtn" href={`https://x.com/intent/retweet?tweet_id=${id}`} target="_blank" rel="noreferrer">
                  Repost
                </a>
                <a className="st-linkbtn st-linkbtn--ink" href={xIntent(`Ticket No. ${no || '0000'} is in. @${xHandle}`, id)} target="_blank" rel="noreferrer">
                  <XIcon /> Reply with card
                </a>
              </>
            ) : (
              <a className="st-linkbtn st-linkbtn--ink" href={step.task.target ?? `https://x.com/${xHandle}`} target="_blank" rel="noreferrer">
                <XIcon /> Open the post
              </a>
            )}
          </div>
          <Field
            label="Link to your reply"
            value={String(answers[step.key] ?? '')}
            onChange={(e) => set(step.key, e.target.value)}
            placeholder="https://x.com/yourname/status/…"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            error={err ?? undefined}
          />
        </div>
      );
    }
    case 'text': {
      const v = String(answers[step.key] ?? '');
      return (
        <div>
          <label className="st-label mono" htmlFor={`wl-${step.key}`}>
            Your answer{step.required ? '' : ' (optional)'}
          </label>
          <textarea
            id={`wl-${step.key}`}
            className="st-input"
            value={v}
            maxLength={600}
            onChange={(e) => set(step.key, e.target.value)}
            aria-invalid={err ? true : undefined}
            aria-describedby={errId}
          />
          <p className={`st-note${err ? ' is-error' : ''}`} id={errId} role={err ? 'alert' : undefined}>
            {err ?? `${v.trim().length} / 500`}
          </p>
        </div>
      );
    }
    case 'sign':
      return <WalletSignIn />;
    default:
      return null;
  }
}
