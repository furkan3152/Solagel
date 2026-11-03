import { normalizeXHandle, type PublicWlTask, type SiteSettings, type WlEntryPublic } from '@elymum/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, CoinCharacter, Field, Icon, Stamp, StampSpinner, StatusPill, Sticker, Tape, useReducedMotion } from '../../design';
import { SiteApiError, site } from '../api';
import { ticketNo } from '../coinLook';
import { Link } from '../router';
import { dropExpired, signOut } from '../session';
import { X_HANDLE, X_URL, shortWallet, siteHost, useSiteSettings, xIntent } from '../settings';
import { intlLocale, t, useT, type TKey } from '../../i18n';
import { T } from '../../i18n/rich';
import { SitePage, XIcon } from '../Shell';
import { SiteWalletProvider, WalletSignIn, useSiteSession } from '../wallet/SiteWallet';
import { Ascent } from './Ascent';
import { CardPreview, SaveCardButton } from './CardPreview';
import { ChoreArt, Moon, handlePaint } from './ChoreArt';
import { InkSplat, StickerAlbum } from './Juice';
import { StoryPlate } from './Plate';
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

/** Plate IV of the book: the WL. */
export function WlPlate({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <StoryPlate numeral="IV" title={title} aside="/wl" className={className}>
      {children}
    </StoryPlate>
  );
}

function Wl() {
  const t = useT();
  const { settings, loaded } = useSiteSettings();
  const [tasks, setTasks] = useState<PublicWlTask[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Bumped by "Try again" after the tasks failed to load (the server was down or waking up). */
  const [attempt, setAttempt] = useState(0);
  const session = useSiteSession();
  /** undefined: not looked up yet (or no session). */
  const [entry, setEntry] = useState<WlEntryPublic | null | undefined>(undefined);
  const [fresh, setFresh] = useState(false);
  /** A returning visitor: their status is looked up before the form is shown (later sign-ins keep the form mounted). */
  const [booting, setBooting] = useState(() => !!session);

  useEffect(() => {
    let live = true;
    setLoadError(null);
    site.tasks().then(
      (list) => live && setTasks(list),
      (e: SiteApiError) => live && setLoadError(e.message),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

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
      <WlPlate title={t('wp.plate.few')}>
        <Sticker className="wl-error" tone="white" tilt={-1}>
          <p className="st-err" role="alert">
            {loadError}
          </p>
          <Button variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
            {t('tf.retry')}
          </Button>
        </Sticker>
      </WlPlate>
    );
  if (!tasks || !loaded || (booting && session))
    return (
      <WlPlate title={t('wp.plate.few')}>
        <div className="wl-loading">
          <StampSpinner label={t('mn.loading')} />
        </div>
      </WlPlate>
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
  const t = useT();
  return (
    <WlPlate title={t('wp.closed.plate')} className="wl-plate--closed">
      <div className="wl-closed">
        <div className="wl-closed__text">
          <span className="kicker wl-kicker">{t('wp.closed.kicker')}</span>
          <h1 className="wl-title">{t('wp.closed.h')}</h1>
          <p className="wl-deck">
            <T
              k="wp.closed.body"
              tags={{
                x: (c) => (
                  <a href={X_URL} target="_blank" rel="noreferrer">
                    {c}
                  </a>
                ),
              }}
            />
          </p>
          <div className="wl-row">
            <a className="kb-btn kb-btn--teal kb-btn--md" href={X_URL} target="_blank" rel="noreferrer">
              <XIcon /> {t('pg.follow')}
            </a>
            <button type="button" className="wl-textlink" onClick={() => setSignin((v) => !v)} aria-expanded={signin}>
              {t('wp.closed.signin')}
            </button>
          </div>
          {signin && (
            <Sticker className="wl-signin-card" tone="white" pad="sm">
              <p className="wl-signin-card__lede">{t('wp.closed.signinLede')}</p>
              <WalletSignIn label={t('wp.signinStatus')} />
            </Sticker>
          )}
        </div>
        <div className="wl-closed__art" aria-hidden="true">
          <span className="wl-closed__moon">
            <Moon size={92} />
          </span>
          <Sticker className="wl-closed__sign" tone="sun" tilt={-4} pad="sm" lift="md">
            <span className="mono">{t('wp.closed.gate')}</span>
            <strong>{t('wp.closed.soon')}</strong>
          </Sticker>
          <span className="wl-closed__coin">
            <CoinCharacter paint="cream" mood="sleepy" size={150} feet ground />
          </span>
          <span className="wl-closed__ledge" />
        </div>
      </div>
    </WlPlate>
  );
}

const STATUS_COPY = {
  pending: { tone: 'sun', pill: 'warn', mood: 'smile' },
  approved: { tone: 'up', pill: 'ok', mood: 'happy' },
  rejected: { tone: 'down', pill: 'danger', mood: 'scared' },
} as const;
const statusKey = (s: WlEntryPublic['status'], part: 'title' | 'stamp' | 'sticker' | 'body' | 'pill') => `wp.st.${s}.${part}` as TKey;

export function WlStatus({ entry, fresh = false }: { entry: WlEntryPublic; fresh?: boolean }) {
  const c = STATUS_COPY[entry.status];
  const reduced = useReducedMotion();
  const t = useT();
  const k = (part: Parameters<typeof statusKey>[1]) => t(statusKey(entry.status, part));
  return (
    <WlPlate title={t('wp.st.plate')}>
      <div className="wl-status" data-status={entry.status}>
        <div className="wl-status__text">
          <span className="kicker wl-kicker">{fresh ? t('wp.st.received') : t('wp.st.yours')}</span>
          <h1 className="wl-title">{k('title')}</h1>
          <p className="wl-deck">{k('body')}</p>
          <dl className="wl-manifest">
            <div>
              <dt>{t('mn.na.status')}</dt>
              <dd>
                <StatusPill tone={c.pill} data-testid="wl-status">
                  {k('pill')}
                </StatusPill>
              </dd>
            </div>
            <div>
              <dt>{t('wp.st.passenger')}</dt>
              <dd className="wl-manifest__handle">@{entry.xHandle}</dd>
            </div>
            <div>
              <dt>{t('wp.st.wallet')}</dt>
              <dd>
                <code title={entry.wallet}>{shortWallet(entry.wallet)}</code>
              </dd>
            </div>
            <div>
              <dt>{t('wp.st.sent')}</dt>
              <dd className="num">{new Date(entry.createdAt).toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short', year: 'numeric' })}</dd>
            </div>
          </dl>
          <div className="wl-row wl-status__actions">
            <SaveCardButton handle={entry.xHandle} label={t('wp.st.save')} />
            <a className="kb-btn kb-btn--teal kb-btn--sm" href={X_URL} target="_blank" rel="noreferrer">
              <XIcon /> {t('pg.follow')}
            </a>
          </div>
          <div className="wl-row">
            <Link className="wl-textlink" href="/">
              {t('pg.home')}
            </Link>
            <button type="button" className="wl-textlink" onClick={() => signOut()}>
              {t('wp.st.signOut')}
            </button>
          </div>
        </div>
        <div className="wl-status__card">
          <Sticker tone="night" lift="lg" pad="sm" round="lg" className="wl-status__frame">
            <CardPreview handle={entry.xHandle} assemble />
          </Sticker>
          <Stamp className="wl-status__stamp" text={k('stamp')} tone={c.tone} size="lg" rotate={-9} animateIn={fresh && !reduced} />
          <span className="wl-status__coin" aria-hidden="true">
            <CoinCharacter paint={handlePaint(entry.xHandle)} mood={c.mood} size={112} feet ground bob={entry.status === 'approved'} sweat={entry.status === 'rejected'} look={[-3, -1]} />
          </span>
          <Sticker className={`wl-status__sticker is-${entry.status}`} tone={entry.status === 'approved' ? 'mint' : entry.status === 'rejected' ? 'white' : 'sun'} tilt={3} pad="sm" lift="sm" aria-hidden="true">
            <span className="mono">{k('sticker')}</span>
          </Sticker>
        </div>
      </div>
    </WlPlate>
  );
}

function joinPlace(url: string | null): string {
  if (!url) return t('wp.meta.invite');
  if (/discord/i.test(url)) return 'Discord';
  if (/t\.me|telegram/i.test(url)) return 'Telegram';
  return t('wp.meta.invite');
}

/** The mono line over a chore's title: where it happens and roughly how long it takes. */
function metaFor(step: Step): string {
  switch (step.kind) {
    case 'handle':
      return t('wp.meta.handle');
    case 'follow_x':
      return t('wp.meta.follow');
    case 'post_x':
      return t('wp.meta.post');
    case 'engage_x':
      return step.task.available ? t('wp.meta.engage') : t('wp.meta.engageSoon');
    case 'join_link':
      return t('wp.meta.join', { place: joinPlace(step.task.target) });
    case 'text':
      return t('wp.meta.text');
    case 'sign':
      return t('wp.meta.sign');
    default:
      return '';
  }
}

/** A line for a chore that is done (shown while it is folded). */
function doneLine(step: Step, handle: string): string {
  switch (step.kind) {
    case 'handle':
      return t('wp.done.handle', { handle: `@${normalizeXHandle(handle) ?? handle}` });
    case 'follow_x':
      return t('wp.done.follow');
    case 'post_x':
      return t('wp.done.post');
    case 'engage_x':
      return step.task.available ? t('wp.done.engage') : t('wp.done.engageSkip');
    case 'join_link':
      return t('wp.done.join');
    case 'text':
      return t('wp.done.text');
    default:
      return t('wp.done.default');
  }
}

/** Default body copy for chores the admin left blank. */
function bodyFor(step: Step): string {
  if (step.body) return step.body;
  switch (step.kind) {
    case 'engage_x':
      return t('wp.body.engage');
    case 'join_link':
      return t('wp.body.join');
    case 'text':
      return t('wp.body.text');
    default:
      return '';
  }
}

function StepHead({ i, step, state, handle, fresh = false, as: Title = 'h2' }: { i: number; step: Step; state: 'done' | 'active' | 'todo'; handle: string; fresh?: boolean; as?: 'h2' | 'span' }) {
  const soon = step.kind === 'engage_x' && !step.task.available;
  const t = useT();
  return (
    <span className="wl-step__head">
      <span className="wl-step__art" aria-hidden="true">
        <ChoreArt kind={step.kind} handle={step.kind === 'handle' ? (normalizeXHandle(handle) ?? '') : ''} />
      </span>
      <span className="wl-step__text">
        <span className="wl-step__meta mono">
          {t('wp.chore', { n: i + 1, meta: metaFor(step) })}
        </span>
        <Title className="wl-step__title">{step.title}</Title>
        {state === 'done' && <span className="wl-step__done">{doneLine(step, handle)}</span>}
      </span>
      <span className="wl-step__act">
        {state === 'done' ? (
          <>
            <span className={`wl-step__stamp${fresh ? ' is-fresh' : ''}`}>
              <Stamp text={t('wp.stamp.done')} tone="up" rotate={-7} animateIn={fresh} />
              {fresh && <InkSplat seed={i + 2} reach={40} className="kb-tone-up" />}
            </span>
            <span className="wl-step__edit mono" aria-hidden="true">
              {t('pf.edit')}
            </span>
          </>
        ) : soon ? (
          <span className="kb-chip mono kb-tone-sun">{t('ld.soon')}</span>
        ) : !step.required ? (
          <span className="kb-chip mono kb-tone-ink">{t('wp.optional')}</span>
        ) : null}
      </span>
    </span>
  );
}

function WlStepper({ tasks, settings, onEntry }: { tasks: PublicWlTask[]; settings: SiteSettings; onEntry: (e: WlEntryPublic) => void }) {
  const t = useT();
  const steps = useMemo(() => buildSteps(tasks), [tasks, t]);
  const [active, setActive] = useState(0);
  const [done, setDone] = useState<Set<string>>(() => new Set());
  /** The chore that was just finished (its DONE stamp thumps on, once). */
  const [justDone, setJustDone] = useState<string | null>(null);
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
    if (!done.has(s.key)) setJustDone(s.key);
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
        setFormError(t('wp.expired'));
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
        setFormError(e.message || t('wp.wrong'));
      }
    } finally {
      setSending(false);
    }
  };

  const total = steps.length;
  // the wallet chore counts as done once signed in (it is the last terrace before the feast)
  const doneCount = steps.filter((s) => done.has(s.key) || (s.kind === 'sign' && !!session)).length;
  const postText = `${no ? t('wp.post.no', { no }) : t('wp.post')} ${siteHost()}/wl`;

  return (
    <WlPlate title={t('wp.plate.n', { n: total })}>
      <div className="wl-layout">
        <aside className="wl-aside" aria-label={t('wp.aside')}>
          <div className="wl-aside__sticky">
            <span className="kicker wl-kicker">{t('wp.kicker')}</span>
            <h1 className="wl-title">
              <T k="wp.h" vars={{ n: total }} tags={{ w: (c) => <span className="wonk">{c}</span> }} />
            </h1>
            <p className="wl-deck">{t('wp.deck')}</p>
            <div className="kb-stepper__prog wl-prog">
              <span className="kb-stepper__bar" role="progressbar" aria-label={t('wp.progress')} aria-valuemin={0} aria-valuemax={total} aria-valuenow={doneCount}>
                <i style={{ width: `${total ? (doneCount / total) * 100 : 0}%` }} />
              </span>
              <span className="kb-stepper__count num">
                {t('wp.doneCount', { done: doneCount, total })}
              </span>
            </div>
            <Ascent total={total} done={doneCount} paint={handlePaint(norm ?? '')} active={active} goal={t('wp.feast')} />
            <StickerAlbum slots={steps.map((s) => ({ key: s.key, kind: s.kind, done: done.has(s.key) || (s.kind === 'sign' && !!session) }))} handle={norm ?? ''} title={t('wp.album')} />
            <div className="wl-aside__card wl-desk-only">
              <Sticker tone="night" lift="md" pad="sm" round="lg" tilt={-1} className="wl-pass">
                <CardPreview handle={handle} assemble />
              </Sticker>
              <div className="wl-row">
                <SaveCardButton handle={handle} />
                <span className="wl-note">{t('wp.saveNote')}</span>
              </div>
            </div>
            <div className="wl-row">
              <button type="button" className="wl-textlink" aria-expanded={showSignin} onClick={() => setShowSignin((v) => !v)}>
                {t('wp.appliedBefore')}
              </button>
            </div>
            {showSignin && !session && (
              <Sticker className="wl-signin-card" tone="white" pad="sm" lift="sm">
                <WalletSignIn label={t('wp.signinStatus')} />
              </Sticker>
            )}
          </div>
        </aside>

        <ol className="wl-steps" ref={list} style={{ ['--steps' as string]: total }}>
          {steps.map((s, i) => {
            const state = i === active ? 'active' : done.has(s.key) ? 'done' : 'todo';
            const err = errors[s.key] ?? null;
            const errId = `wl-err-${s.key}`;
            const body = bodyFor(s);
            return (
              <li key={s.key} className={`wl-step is-${state}`} data-kind={s.kind} style={{ ['--terrace' as string]: i }} aria-current={state === 'active' ? 'step' : undefined}>
                {state === 'active' ? (
                  <StepHead i={i} step={s} state={state} handle={handle} />
                ) : (
                  <button type="button" className="wl-step__toggle" onClick={() => { setActive(i); setJustDone(null); }} aria-label={state === 'done' ? t('wp.stepDone', { n: i + 1, title: s.title }) : t('wp.step', { n: i + 1, title: s.title })}>
                    <StepHead i={i} step={s} state={state} handle={handle} fresh={justDone === s.key} as="span" />
                  </button>
                )}
                <AnimatePresence initial={false}>
                  {state === 'active' && (
                    <motion.div
                      className="wl-step__panel"
                      initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                      animate={reduced ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
                      exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                      transition={{ duration: reduced ? 0.12 : 0.32, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <div className="wl-step__inner">
                        {body && <p className="wl-step__body">{body}</p>}
                        <StepBody step={s} i={i} answers={answers} set={set} handle={handle} setHandle={(v) => { setHandle(v); if (errors.handle) setErrors((e) => ({ ...e, handle: null })); }} err={err} errId={errId} postText={postText} no={no} settings={settings} />
                        {s.kind !== 'handle' && s.kind !== 'post_x' && s.kind !== 'engage_x' && s.kind !== 'text' && err && (
                          <p className="wl-note is-error" id={errId} role="alert">
                            {err}
                          </p>
                        )}
                        {s.kind === 'sign' ? (
                          <div className="wl-submit">
                            <label className="st-honey" aria-hidden="true">
                              Website
                              <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" />
                            </label>
                            <Button variant="primary" size="lg" icon="arrow" onClick={() => void submit()} disabled={sending || !session} loading={sending}>
                              {t('ld.cta.wl')}
                            </Button>
                            <p className="wl-note">{t('wp.privacy')}</p>
                            {formError && (
                              <p className="wl-note is-error" role="alert">
                                {formError}
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="wl-row wl-step__actions">
                            <Button variant="teal" size="sm" icon="arrow" onClick={() => next(i)}>
                              {s.kind === 'engage_x' && !s.task.available ? t('wp.skip') : t('g.next')}
                            </Button>
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
    </WlPlate>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" className={`wl-tick${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => onChange(!on)}>
      <span className="wl-tick__box" aria-hidden="true">
        {on && <Icon name="check" size={18} />}
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
  const xHandle = settings.xHandle || X_HANDLE;
  const t = useT();
  switch (step.kind) {
    case 'handle':
      return (
        <div className="wl-grid">
          <Field
            label={t('wp.handle.title')}
            prefix="@"
            value={handle.replace(/^@/, '')}
            onChange={(e) => setHandle(e.target.value)}
            placeholder={t('wp.handle.ph')}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={100}
            error={err ?? undefined}
            hint={t('wp.handle.hint')}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.closest('.wl-step__inner')?.querySelector<HTMLButtonElement>('.wl-step__actions button')?.click())}
          />
          <div className="wl-mobile-only">
            <CardPreview handle={handle} compact />
          </div>
        </div>
      );
    case 'follow_x': {
      const target = step.task.target || `https://x.com/${xHandle}`;
      const who = /x\.com\/([^/?#]+)/.exec(target)?.[1] ?? xHandle;
      return (
        <div className="wl-row">
          <a className="kb-btn kb-btn--secondary kb-btn--sm" href={target} target="_blank" rel="noreferrer">
            <XIcon /> {t('wp.follow', { who: `@${who}` })}
          </a>
          <Toggle on={answers[step.key] === true} onChange={(v) => set(step.key, v)} label={t('wp.iFollow')} />
        </div>
      );
    }
    case 'join_link':
      return (
        <div className="wl-row">
          {step.task.target && (
            <a className="kb-btn kb-btn--secondary kb-btn--sm" href={step.task.target} target="_blank" rel="noreferrer">
              {t('wp.openInvite')} <Icon name="arrow" size={16} />
            </a>
          )}
          <Toggle on={answers[step.key] === true} onChange={(v) => set(step.key, v)} label={t('wp.iJoined')} />
        </div>
      );
    case 'post_x':
      return (
        <div className="wl-grid">
          <div className="wl-mobile-only">
            <CardPreview handle={handle} compact />
          </div>
          <ol className="wl-howto">
            <li>
              <span className="wl-howto__n num">1</span>
              <SaveCardButton handle={handle} />
            </li>
            <li>
              <span className="wl-howto__n num">2</span>
              <a className="kb-btn kb-btn--secondary kb-btn--sm" href={xIntent(postText)} target="_blank" rel="noreferrer">
                <XIcon /> {t('wp.postX')}
              </a>
            </li>
          </ol>
          <p className="wl-note">{t('wp.attach', { handle: `@${xHandle}` })}</p>
          <Field
            label={t('wp.linkPost')}
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
            <div className="wl-soon">
              <span className="wl-soon__coin" aria-hidden="true">
                <CoinCharacter paint="foam" mood="sleepy" size={56} />
              </span>
              <p>
                <T k="wp.soon" vars={{ handle: `@${xHandle}` }} tags={{ strong: (c) => <strong>{c}</strong> }} />
              </p>
            </div>
            <div className="wl-row">
              <a className="kb-btn kb-btn--ghost kb-btn--sm" href={`https://x.com/${xHandle}`} target="_blank" rel="noreferrer">
                <XIcon /> {t('wp.watch', { handle: `@${xHandle}` })}
              </a>
            </div>
          </div>
        );
      }
      const id = tweetId(step.task.target);
      return (
        <div className="wl-grid">
          <div className="wl-row">
            {id ? (
              <>
                <a className="kb-btn kb-btn--secondary kb-btn--sm" href={`https://x.com/intent/like?tweet_id=${id}`} target="_blank" rel="noreferrer">
                  {t('wp.like')}
                </a>
                <a className="kb-btn kb-btn--secondary kb-btn--sm" href={`https://x.com/intent/retweet?tweet_id=${id}`} target="_blank" rel="noreferrer">
                  {t('wp.repost')}
                </a>
                <a className="kb-btn kb-btn--secondary kb-btn--sm" href={xIntent(t('wp.replyText', { no: no || '0000', handle: `@${xHandle}` }), id)} target="_blank" rel="noreferrer">
                  <XIcon /> {t('wp.replyCard')}
                </a>
              </>
            ) : (
              <a className="kb-btn kb-btn--secondary kb-btn--sm" href={step.task.target ?? `https://x.com/${xHandle}`} target="_blank" rel="noreferrer">
                <XIcon /> {t('wp.openPost')}
              </a>
            )}
          </div>
          <Field
            label={t('wp.linkReply')}
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
        <div className="kb-field wl-textarea">
          <label className="kb-field__label mono" htmlFor={`wl-${step.key}`}>
            {step.required ? t('wp.answer') : t('wp.answerOpt')}
          </label>
          <textarea
            id={`wl-${step.key}`}
            className="wl-input"
            value={v}
            maxLength={600}
            onChange={(e) => set(step.key, e.target.value)}
            aria-invalid={err ? true : undefined}
            aria-describedby={errId}
          />
          <p className={`wl-note${err ? ' is-error' : ' num'}`} id={errId} role={err ? 'alert' : undefined}>
            {err ?? `${v.trim().length} / 500`}
          </p>
        </div>
      );
    }
    case 'sign':
      return <SignStep />;
    default:
      return null;
  }
}

/** The wallet step: sign in, then the EVM address that goes on the list, in full. */
function SignStep() {
  const session = useSiteSession();
  const t = useT();
  return (
    <div className="wl-grid">
      <WalletSignIn />
      {session && (
        <p className="wl-wallet" data-testid="wl-wallet">
          <span className="mono wl-wallet__k">{t('wp.walletGoes')}</span>
          <code>{session.address}</code>
        </p>
      )}
    </div>
  );
}
