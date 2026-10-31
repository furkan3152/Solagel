import { normalizeXHandle, type PublicWlTask, type SiteSettings, type WlEntryPublic } from '@elymum/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, CoinCharacter, Field, Icon, Stamp, StampSpinner, StatusPill, Sticker, Tape, useReducedMotion } from '../../design';
import { SiteApiError, site } from '../api';
import { ticketNo } from '../coinLook';
import { Link } from '../router';
import { dropExpired, signOut } from '../session';
import { X_HANDLE, X_URL, shortWallet, siteHost, useSiteSettings, xIntent } from '../settings';
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
      <WlPlate title="Three small chores">
        <Sticker className="wl-error" tone="white" tilt={-1}>
          <p className="st-err" role="alert">
            {loadError}
          </p>
        </Sticker>
      </WlPlate>
    );
  if (!tasks || !loaded || (booting && session))
    return (
      <WlPlate title="Three small chores">
        <div className="wl-loading">
          <StampSpinner label="Loading" />
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
  return (
    <WlPlate title="The gate, shut for now" className="wl-plate--closed">
      <div className="wl-closed">
        <div className="wl-closed__text">
          <span className="kicker wl-kicker">Whitelist · closed</span>
          <h1 className="wl-title">Applications are closed.</h1>
          <p className="wl-deck">
            We are not taking new WL entries right now. The next round gets announced on{' '}
            <a href={X_URL} target="_blank" rel="noreferrer">
              @elymumio
            </a>{' '}
            first. Nobody gets in early by asking nicely. We checked.
          </p>
          <div className="wl-row">
            <a className="kb-btn kb-btn--teal kb-btn--md" href={X_URL} target="_blank" rel="noreferrer">
              <XIcon /> Follow @elymumio
            </a>
            <button type="button" className="wl-textlink" onClick={() => setSignin((v) => !v)} aria-expanded={signin}>
              Applied before? Sign in
            </button>
          </div>
          {signin && (
            <Sticker className="wl-signin-card" tone="white" pad="sm">
              <p className="wl-signin-card__lede">Sign in with the wallet you applied with to see your status.</p>
              <WalletSignIn label="Sign in to see my status" />
            </Sticker>
          )}
        </div>
        <div className="wl-closed__art" aria-hidden="true">
          <span className="wl-closed__moon">
            <Moon size={92} />
          </span>
          <Sticker className="wl-closed__sign" tone="sun" tilt={-4} pad="sm" lift="md">
            <span className="mono">Gate WL</span>
            <strong>Back soon</strong>
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
  pending: {
    title: "You're in the queue.",
    stamp: 'Pending',
    tone: 'sun',
    pill: 'warn',
    mood: 'smile',
    sticker: 'Checked by hand',
    body: 'Every entry is checked by a person: the follow, your post and your reply. Sign in with the same wallet any time to see where it stands.',
  },
  approved: {
    title: "You're on the list.",
    stamp: 'Approved',
    tone: 'up',
    pill: 'ok',
    mood: 'happy',
    sticker: 'Mint spot held',
    body: 'Your wallet is on the Elymum WL. The mint date lands on @elymumio first. Keep the pass; it looks good on you.',
  },
  rejected: {
    title: 'Not this time.',
    stamp: 'Rejected',
    tone: 'down',
    pill: 'danger',
    mood: 'scared',
    sticker: 'Try next round',
    body: 'We could not verify every chore on this entry. Follow @elymumio for the next round; the ring is patient.',
  },
} as const;

export function WlStatus({ entry, fresh = false }: { entry: WlEntryPublic; fresh?: boolean }) {
  const c = STATUS_COPY[entry.status];
  const reduced = useReducedMotion();
  return (
    <WlPlate title="Your boarding pass">
      <div className="wl-status" data-status={entry.status}>
        <div className="wl-status__text">
          <span className="kicker wl-kicker">{fresh ? 'Entry received' : 'Your WL entry'}</span>
          <h1 className="wl-title">{c.title}</h1>
          <p className="wl-deck">{c.body}</p>
          <dl className="wl-manifest">
            <div>
              <dt>Status</dt>
              <dd>
                <StatusPill tone={c.pill} data-testid="wl-status">
                  {entry.status}
                </StatusPill>
              </dd>
            </div>
            <div>
              <dt>Passenger</dt>
              <dd className="wl-manifest__handle">@{entry.xHandle}</dd>
            </div>
            <div>
              <dt>Wallet</dt>
              <dd>
                <code title={entry.wallet}>{shortWallet(entry.wallet)}</code>
              </dd>
            </div>
            <div>
              <dt>Sent</dt>
              <dd className="num">{new Date(entry.createdAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</dd>
            </div>
          </dl>
          <div className="wl-row wl-status__actions">
            <SaveCardButton handle={entry.xHandle} label="Save my pass" />
            <a className="kb-btn kb-btn--teal kb-btn--sm" href={X_URL} target="_blank" rel="noreferrer">
              <XIcon /> Follow @elymumio
            </a>
          </div>
          <div className="wl-row">
            <Link className="wl-textlink" href="/">
              Back home
            </Link>
            <button type="button" className="wl-textlink" onClick={() => signOut()}>
              Sign out
            </button>
          </div>
        </div>
        <div className="wl-status__card">
          <Sticker tone="night" lift="lg" pad="sm" round="lg" className="wl-status__frame">
            <CardPreview handle={entry.xHandle} assemble />
          </Sticker>
          <Stamp className="wl-status__stamp" text={c.stamp} tone={c.tone} size="lg" rotate={-9} animateIn={fresh && !reduced} />
          <span className="wl-status__coin" aria-hidden="true">
            <CoinCharacter paint={handlePaint(entry.xHandle)} mood={c.mood} size={112} feet ground bob={entry.status === 'approved'} sweat={entry.status === 'rejected'} look={[-3, -1]} />
          </span>
          <Sticker className={`wl-status__sticker is-${entry.status}`} tone={entry.status === 'approved' ? 'mint' : entry.status === 'rejected' ? 'white' : 'sun'} tilt={3} pad="sm" lift="sm" aria-hidden="true">
            <span className="mono">{c.sticker}</span>
          </Sticker>
        </div>
      </div>
    </WlPlate>
  );
}

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
const countWord = (n: number) => WORDS[n] ?? String(n);

function joinPlace(url: string | null): string {
  if (!url) return 'invite';
  if (/discord/i.test(url)) return 'Discord';
  if (/t\.me|telegram/i.test(url)) return 'Telegram';
  return 'invite';
}

/** The mono line over a chore's title: where it happens and roughly how long it takes. */
function metaFor(step: Step): string {
  switch (step.kind) {
    case 'handle':
      return 'you · ten seconds';
    case 'follow_x':
      return 'X · five seconds';
    case 'post_x':
      return 'X · about a minute';
    case 'engage_x':
      return step.task.available ? 'X · about 20 seconds' : 'X · not live yet';
    case 'join_link':
      return `${joinPlace(step.task.target)} · a minute`;
    case 'text':
      return 'a sentence or two';
    case 'sign':
      return 'wallet · free, no transaction';
    default:
      return '';
  }
}

/** A line for a chore that is done (shown while it is folded). */
function doneLine(step: Step, handle: string): string {
  switch (step.kind) {
    case 'handle':
      return `@${normalizeXHandle(handle) ?? handle}. Your coin has a face now.`;
    case 'follow_x':
      return 'Done. The ring noticed, and so did our follower count.';
    case 'post_x':
      return 'Posted. Your coin is a little bit famous.';
    case 'engage_x':
      return step.task.available ? 'Liked, reposted, replied. Very social of you.' : 'Skipped for now. It opens when the post is live.';
    case 'join_link':
      return 'In. Say hi when you are ready.';
    case 'text':
      return 'Noted. Someone will actually read it.';
    default:
      return 'Done.';
  }
}

/** Default body copy for chores the admin left blank. */
function bodyFor(step: Step): string {
  if (step.body) return step.body;
  switch (step.kind) {
    case 'engage_x':
      return 'The pinned feast post: like it, repost it, reply with your card.';
    case 'join_link':
      return 'Come say hi. Lurking also counts, mostly.';
    case 'text':
      return 'Short is fine. Funny is better.';
    default:
      return '';
  }
}

function StepHead({ i, step, state, handle, fresh = false, as: Title = 'h2' }: { i: number; step: Step; state: 'done' | 'active' | 'todo'; handle: string; fresh?: boolean; as?: 'h2' | 'span' }) {
  const soon = step.kind === 'engage_x' && !step.task.available;
  return (
    <span className="wl-step__head">
      <span className="wl-step__art" aria-hidden="true">
        <ChoreArt kind={step.kind} handle={step.kind === 'handle' ? (normalizeXHandle(handle) ?? '') : ''} />
      </span>
      <span className="wl-step__text">
        <span className="wl-step__meta mono">
          Chore {i + 1} · {metaFor(step)}
        </span>
        <Title className="wl-step__title">{step.title}</Title>
        {state === 'done' && <span className="wl-step__done">{doneLine(step, handle)}</span>}
      </span>
      <span className="wl-step__act">
        {state === 'done' ? (
          <>
            <span className={`wl-step__stamp${fresh ? ' is-fresh' : ''}`}>
              <Stamp text="Done" tone="up" rotate={-7} animateIn={fresh} />
              {fresh && <InkSplat seed={i + 2} reach={40} className="kb-tone-up" />}
            </span>
            <span className="wl-step__edit mono" aria-hidden="true">
              Edit
            </span>
          </>
        ) : soon ? (
          <span className="kb-chip mono kb-tone-sun">Soon</span>
        ) : !step.required ? (
          <span className="kb-chip mono kb-tone-ink">Optional</span>
        ) : null}
      </span>
    </span>
  );
}

function WlStepper({ tasks, settings, onEntry }: { tasks: PublicWlTask[]; settings: SiteSettings; onEntry: (e: WlEntryPublic) => void }) {
  const steps = useMemo(() => buildSteps(tasks), [tasks]);
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
  // the wallet chore counts as done once signed in (it is the last terrace before the feast)
  const doneCount = steps.filter((s) => done.has(s.key) || (s.kind === 'sign' && !!session)).length;
  const postText = `I'm on my way to the @elymumio WL. Coins eat coins on Elysium, and the arena opens soon.${no ? ` Boarding pass No. ${no}.` : ''} ${siteHost()}/wl`;

  return (
    <WlPlate title={`${countWord(total)} small chores`}>
      <div className="wl-layout">
        <aside className="wl-aside" aria-label="Your progress and boarding pass">
          <div className="wl-aside__sticky">
            <span className="kicker wl-kicker">Whitelist · the ascent</span>
            <h1 className="wl-title">
              {countWord(total)} small chores, then the <span className="wonk">feast.</span>
            </h1>
            <p className="wl-deck">
              Each chore lifts you one terrace up the ring. Finish them all and your wallet goes on the list, with a boarding pass to flex. Every entry is checked by hand.
            </p>
            <div className="kb-stepper__prog wl-prog">
              <span className="kb-stepper__bar" role="progressbar" aria-label="WL chores done" aria-valuemin={0} aria-valuemax={total} aria-valuenow={doneCount}>
                <i style={{ width: `${total ? (doneCount / total) * 100 : 0}%` }} />
              </span>
              <span className="kb-stepper__count num">
                {doneCount} of {total} done
              </span>
            </div>
            <Ascent total={total} done={doneCount} paint={handlePaint(norm ?? '')} active={active} />
            <StickerAlbum slots={steps.map((s) => ({ key: s.key, kind: s.kind, done: done.has(s.key) || (s.kind === 'sign' && !!session) }))} handle={norm ?? ''} title="Chore stickers" />
            <div className="wl-aside__card wl-desk-only">
              <Sticker tone="night" lift="md" pad="sm" round="lg" tilt={-1} className="wl-pass">
                <CardPreview handle={handle} assemble />
              </Sticker>
              <div className="wl-row">
                <SaveCardButton handle={handle} />
                <span className="wl-note">Save it, then attach it to your post on X.</span>
              </div>
            </div>
            <div className="wl-row">
              <button type="button" className="wl-textlink" aria-expanded={showSignin} onClick={() => setShowSignin((v) => !v)}>
                Applied before? Sign in to see your status
              </button>
            </div>
            {showSignin && !session && (
              <Sticker className="wl-signin-card" tone="white" pad="sm" lift="sm">
                <WalletSignIn label="Sign in to see my status" />
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
                  <button type="button" className="wl-step__toggle" onClick={() => { setActive(i); setJustDone(null); }} aria-label={`Step ${i + 1}: ${s.title}${state === 'done' ? ', done. Edit' : ''}`}>
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
                              Join the WL
                            </Button>
                            <p className="wl-note">We keep your handle, wallet and links only to run the WL. A person checks every entry before the mint.</p>
                            {formError && (
                              <p className="wl-note is-error" role="alert">
                                {formError}
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="wl-row wl-step__actions">
                            <Button variant="teal" size="sm" icon="arrow" onClick={() => next(i)}>
                              {s.kind === 'engage_x' && !s.task.available ? 'Skip for now' : 'Next'}
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
  switch (step.kind) {
    case 'handle':
      return (
        <div className="wl-grid">
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
            hint="Your pass, its number and its coin are made from your handle."
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
            <XIcon /> Follow @{who}
          </a>
          <Toggle on={answers[step.key] === true} onChange={(v) => set(step.key, v)} label="I follow" />
        </div>
      );
    }
    case 'join_link':
      return (
        <div className="wl-row">
          {step.task.target && (
            <a className="kb-btn kb-btn--secondary kb-btn--sm" href={step.task.target} target="_blank" rel="noreferrer">
              Open the invite <Icon name="arrow" size={16} />
            </a>
          )}
          <Toggle on={answers[step.key] === true} onChange={(v) => set(step.key, v)} label="I joined" />
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
                <XIcon /> Post on X
              </a>
            </li>
          </ol>
          <p className="wl-note">Attach the card you saved: X cannot add images for you. Tag @{xHandle} so we can find it.</p>
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
            <div className="wl-soon">
              <span className="wl-soon__coin" aria-hidden="true">
                <CoinCharacter paint="foam" mood="sleepy" size={56} />
              </span>
              <p>
                <strong>Opens when the post is live.</strong> Our launch post drops soon on @{xHandle}. This chore opens the moment it is up; you can send your entry
                without it.
              </p>
            </div>
            <div className="wl-row">
              <a className="kb-btn kb-btn--ghost kb-btn--sm" href={`https://x.com/${xHandle}`} target="_blank" rel="noreferrer">
                <XIcon /> Watch @{xHandle}
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
                  Like
                </a>
                <a className="kb-btn kb-btn--secondary kb-btn--sm" href={`https://x.com/intent/retweet?tweet_id=${id}`} target="_blank" rel="noreferrer">
                  Repost
                </a>
                <a className="kb-btn kb-btn--secondary kb-btn--sm" href={xIntent(`Boarding pass No. ${no || '0000'} is in. @${xHandle}`, id)} target="_blank" rel="noreferrer">
                  <XIcon /> Reply with card
                </a>
              </>
            ) : (
              <a className="kb-btn kb-btn--secondary kb-btn--sm" href={step.task.target ?? `https://x.com/${xHandle}`} target="_blank" rel="noreferrer">
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
        <div className="kb-field wl-textarea">
          <label className="kb-field__label mono" htmlFor={`wl-${step.key}`}>
            Your answer{step.required ? '' : ' (optional)'}
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
  return (
    <div className="wl-grid">
      <WalletSignIn />
      {session && (
        <p className="wl-wallet" data-testid="wl-wallet">
          <span className="mono wl-wallet__k">This EVM address goes on the list</span>
          <code>{session.address}</code>
        </p>
      )}
    </div>
  );
}
