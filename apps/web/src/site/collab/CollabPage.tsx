import { COLLAB_ROLES, COLLAB_TYPES, SITE_LIMITS, isXStatusUrl, type CollabPublic, type CollabWalletRow } from '@elymum/shared';
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type ReactNode } from 'react';
import { Button, CoinCharacter, Field, FoodBit, Icon, Stamp, StampSpinner, Sticker, Tape, useOffscreenPause, type CoinMood, type CoinPaint, type StampTone } from '../../design';
import { SiteApiError, site } from '../api';
import { dropExpired } from '../session';
import { X_URL, useSiteSettings, xProfile } from '../settings';
import { intlLocale, useT, type TKey } from '../../i18n';
import { renderRich, strong, T } from '../../i18n/rich';
import { SitePage, XIcon } from '../Shell';
import { SiteWalletProvider, WalletSignIn, useSiteSession } from '../wallet/SiteWallet';
import { Ascent } from '../wl/Ascent';
import { ChoreArt, Moon } from '../wl/ChoreArt';
import { Courier, FlyingLetter, Inspection, RainyCloud, SeatRow, Snores } from './CollabArt';
import { StoryPlate } from '../wl/Plate';
import { CollabGuide } from './CollabGuide';
import {
  EMPTY_DRAFT,
  roleLabel,
  typeLabel,
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
import '../wl/wl.css';
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

const PHASE: Record<CollabPublic['phase'], { label: TKey; tone: 'sun' | 'down' | 'up' | 'teal' | 'ink' }> = {
  in_review: { label: 'cb.ph.in_review', tone: 'sun' },
  rejected: { label: 'cb.ph.rejected', tone: 'down' },
  approved: { label: 'cb.ph.approved', tone: 'up' },
  submitted: { label: 'cb.ph.submitted', tone: 'teal' },
  closed: { label: 'cb.ph.closed', tone: 'ink' },
};
const fmtDate = (ms: number, time = false) =>
  new Date(ms).toLocaleString(intlLocale(), time ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' });
const xLink = (c: ReactNode) => (
  <a className="cb-link" href={X_URL} target="_blank" rel="noreferrer">
    {c}
  </a>
);

function stepOf(view: 'new' | CollabPublic | null): number {
  if (!view || view === 'new') return 0;
  if (view.phase === 'in_review' || view.phase === 'rejected') return 1;
  return 2;
}

function Collab() {
  const t = useT();
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
    const id = setInterval(() => {
      if (!document.hidden) void refresh(session.token);
    }, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, reviewing]);

  const current: CollabPublic | 'new' | null = !session || collabs === null ? (session && !dirty ? null : 'new') : selected === 'new' || collabs.length === 0 ? 'new' : (collabs.find((c) => c.id === selected) ?? collabs[0]);
  const step = stepOf(current);
  const replace = (c: CollabPublic) => setCollabs((list) => (list ? list.map((x) => (x.id === c.id ? c : x)) : [c]));
  const guideFor = current && current !== 'new' ? current : null;

  const STEPS = [t('cb.step.apply'), t('cb.step.review'), t('cb.step.wallets')];
  return (
    <StoryPlate numeral="V" title={t('cb.plate')} aside="/collab" className="cb-plate">
      <div className="cb-page">
        <header className="cb-head">
          <div className="cb-head__text">
            <span className="kicker wl-kicker">{t('cb.kicker')}</span>
            <h1 className="wl-title">
              <T k="cb.h" tags={{ w: (c) => <span className="wonk">{c}</span> }} />
            </h1>
            <p className="wl-deck">{t('cb.deck')}</p>
          </div>
          <div className="cb-head__map">
            <Ascent total={3} done={current && current !== 'new' && current.phase === 'submitted' ? 3 : step} active={step} paint="sun" labels={[t('cb.map.apply'), t('cb.map.review'), t('cb.map.wallets')]} goal={t('cb.map.goal')} />
            <ol className="cb-progress" aria-label={t('cb.steps')}>
              {STEPS.map((label, i) => (
                <li key={label} className={i === step ? 'is-on' : i < step ? 'is-done' : ''} aria-current={i === step ? 'step' : undefined}>
                  <span className="cb-progress__n num" aria-hidden="true">
                    {i < step ? <Icon name="check" size={14} /> : i + 1}
                  </span>{' '}
                  {label}
                </li>
              ))}
            </ol>
          </div>
        </header>

        <div className="cb-layout">
          <aside className="cb-side">
            <button type="button" className="cb-guidecard" onClick={() => setGuide(true)}>
              <Tape className="cb-guidecard__tape" rotate={-5} width={80} />
              <span className="cb-guidecard__art" aria-hidden="true">
                <ChoreArt kind="text" />
              </span>
              <span className="cb-guidecard__k mono">{t('cb.g.kicker')}</span>
              <strong>{t('cb.gc.read')}</strong>
              <span>{t('cb.gc.body')}</span>
              <span className="cb-guidecard__open mono">
                {t('cb.gc.open')} <Icon name="arrow" size={16} />
              </span>
            </button>

            <Sticker as="section" className="cb-mine" tone="white" pad="sm" lift="sm" aria-labelledby="cb-mine-h">
              <h2 id="cb-mine-h" className="cb-mine__h mono">
                {t('cb.mine.h')}
              </h2>
              {!session ? (
                <>
                  <p className="wl-note">{t('cb.mine.before')}</p>
                  {signin ? (
                    <WalletSignIn label={t('site.hc.signIn')} />
                  ) : (
                    <Button variant="secondary" size="sm" lead="wallet" onClick={() => setSignin(true)}>
                      {t('site.hc.signIn')}
                    </Button>
                  )}
                </>
              ) : collabs === null ? (
                <StampSpinner label={t('mn.loading')} />
              ) : (
                <>
                  {collabs.length === 0 && <p className="wl-note">{t('cb.mine.none')}</p>}
                  <ul className="cb-mine__list">
                    {collabs.map((c) => (
                      <li key={c.id}>
                        <button type="button" className={`cb-mine__item${current !== 'new' && current?.id === c.id ? ' is-on' : ''}`} onClick={() => setSelected(c.id)} aria-current={current !== 'new' && current?.id === c.id ? 'true' : undefined}>
                          <span className="cb-mine__name">{c.community}</span>
                          <span className={`kb-chip mono kb-tone-${PHASE[c.phase].tone}`}>{t(PHASE[c.phase].label)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {collabs.length > 0 && (
                    <button type="button" className="wl-textlink" onClick={() => setSelected('new')} disabled={!settings.collabOpen}>
                      {t('cb.mine.add')}
                    </button>
                  )}
                  <WalletSignIn />
                </>
              )}
              {loadErr && (
                <p className="wl-note is-error" role="alert">
                  {loadErr}
                </p>
              )}
            </Sticker>
            <p className="wl-note">
              <T k="cb.questions" tags={{ x: xLink }} />
            </p>
          </aside>

          <section className="cb-main" aria-live="polite">
            {!loaded || current === null ? (
              <div className="cb-loading">
                <StampSpinner label={t('mn.loading')} />
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
    </StoryPlate>
  );
}

/** The picture at the top of a state card: a small storybook plate with a coin, a prop and a caption. */
function Vignette({
  tone,
  plate,
  caption,
  coin,
  mood,
  prop,
  second,
  night = false,
  coinSize = 104,
}: {
  tone: 'mist' | 'linen' | 'mint' | 'sand' | 'night' | 'sun';
  plate: string;
  caption: string;
  coin: CoinPaint;
  mood: CoinMood;
  prop?: ReactNode;
  second?: { paint: CoinPaint; mood: CoinMood };
  night?: boolean;
  /** A smaller coin leaves room for a prop over its head. */
  coinSize?: number;
}) {
  const [ref, visible] = useOffscreenPause<HTMLElement>();
  return (
    <figure ref={ref} className={`cb-vig cb-vig--${tone}${visible ? '' : ' is-paused'}`} aria-hidden="true">
      <span className="cb-vig__ground" />
      {night && (
        <span className="cb-vig__stars">
          <i />
          <i />
          <i />
          <i />
        </span>
      )}
      <span className="cb-vig__coin">
        <CoinCharacter paint={coin} mood={mood} size={coinSize} feet ground sweat={mood === 'scared'} bob={mood === 'happy'} look={[3, 0]} />
      </span>
      {second && (
        <span className="cb-vig__coin cb-vig__coin--2">
          <CoinCharacter paint={second.paint} mood={second.mood} size={72} feet ground bob={second.mood === 'happy'} phase={0.8} look={[-3, 0]} />
        </span>
      )}
      {prop && <span className="cb-vig__prop">{prop}</span>}
      {mood === 'sleepy' && <Snores />}
      <figcaption className="cb-vig__cap mono">
        <span>{plate}</span>
        <span>{caption}</span>
      </figcaption>
    </figure>
  );
}

function ClosedCard({ onSignIn }: { onSignIn?: () => void }) {
  const t = useT();
  return (
    <Sticker tone="white" lift="lg" pad="none" round="lg" className="cb-state" data-phase="shut">
      <Vignette tone="night" plate={t('cb.vig.plate', { n: '0' })} caption={t('cb.vig.after')} coin="cream" mood="sleepy" prop={<Moon size={84} />} night />
      <div className="cb-state__body">
        <Stamp text={t('cb.ph.closed')} tone="ink" size="lg" rotate={-6} className="cb-state__stamp" />
        <h2 className="cb-state__title">{t('wp.closed.h')}</h2>
        <p className="cb-state__text">
          <T k="cb.closed.body" tags={{ x: xLink }} />
        </p>
        <div className="wl-row">
          <a className="kb-btn kb-btn--teal kb-btn--md" href={X_URL} target="_blank" rel="noreferrer">
            <XIcon /> {t('pg.follow')}
          </a>
          {onSignIn && (
            <button type="button" className="wl-textlink" onClick={onSignIn}>
              {t('wp.closed.signin')}
            </button>
          )}
        </div>
      </div>
    </Sticker>
  );
}

function Select({ id, label, value, onChange, options, error }: { id: string; label: string; value: string; onChange: (v: string) => void; options: [string, string][]; error?: string }) {
  const t = useT();
  return (
    <div className={`kb-field cb-field${error ? ' is-error' : ''}`}>
      <label className="kb-field__label mono" htmlFor={id}>
        {label}
      </label>
      <span className="cb-select">
        <select id={id} className="cb-input" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-err` : undefined}>
          <option value="">{t('cb.pick')}</option>
          {options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <Icon name="chevron" size={18} className="cb-select__chev" />
      </span>
      {error && (
        <p className="kb-field__note cb-err" id={`${id}-err`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const FIELD_OF: Record<string, keyof ApplyDraft> = { community: 'community', type: 'type', members: 'members', communityX: 'communityX', contactX: 'contactX', discord: 'discord', role: 'role', postUrl: 'postUrl', about: 'about' };

export function ApplyForm({ d, setD, onApplied, onCancel }: { d: ApplyDraft; setD: (f: (x: ApplyDraft) => ApplyDraft) => void; onApplied: (c: CollabPublic) => void; onCancel?: () => void }) {
  const session = useSiteSession();
  const t = useT();
  const [errors, setErrors] = useState<ApplyErrors>({});
  const [website, setWebsite] = useState('');
  const [sending, setSending] = useState(false);
  // a double click or Enter while sending must not send a second application
  const inFlight = useRef(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const set = (k: keyof ApplyDraft) => (v: string) => {
    setD((x) => ({ ...x, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const submit = async () => {
    if (inFlight.current) return;
    setFormErr(null);
    const e = applyErrors(d);
    setErrors(e);
    if (Object.keys(e).length > 0) {
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    if (!session) {
      setFormErr(t('cb.f.signFirst'));
      return;
    }
    setSending(true);
    inFlight.current = true;
    try {
      onApplied(await site.applyCollab(session.token, applyBody(d, website)));
    } catch (err) {
      if (dropExpired(err)) {
        setFormErr(t('wp.expired'));
        return;
      }
      const se = err as SiteApiError;
      const k = se.field ? FIELD_OF[se.field] : undefined;
      if (k) setErrors((x) => ({ ...x, [k]: se.code === 'collab_limit' ? t('cb.f.limit') : se.message }));
      else setFormErr(se.message);
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  return (
    <form
      ref={form}
      className="kb-sticker kb-sticker--white kb-sticker--lift-lg kb-sticker--pad-none kb-sticker--round cb-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      aria-labelledby="cb-form-h"
    >
      <div className="cb-form__top">
        <span className="cb-form__art" aria-hidden="true">
          <CoinCharacter paint="cyan" mood="smile" size={84} feet look={[3, -2]} />
          <span className="cb-form__art2">
            <CoinCharacter paint="sun" mood="happy" size={58} feet phase={1.2} look={[-3, -1]} />
          </span>
        </span>
        <div>
          <span className="kicker cb-form__k">{t('cb.f.kicker')}</span>
          <h2 className="cb-form__h" id="cb-form-h">
            {t('cb.f.h')}
          </h2>
          <p className="cb-form__lede">{t('cb.f.lede')}</p>
        </div>
      </div>
      <div className="cb-form__grid">
        <Field className="cb-span2" label={t('cb.f.name')} value={d.community} onChange={(e) => set('community')(e.target.value)} maxLength={SITE_LIMITS.community + 20} error={errors.community} autoComplete="off" />
        <Select id="cb-type" label={t('cb.f.type')} value={d.type} onChange={set('type')} options={COLLAB_TYPES.map((k) => [k, typeLabel(k)])} error={errors.type} />
        <Field label={t('cb.f.members')} value={d.members} onChange={(e) => set('members')(e.target.value)} inputMode="numeric" error={errors.members} placeholder="2500" autoComplete="off" />
        <Field label={t('cb.f.communityX')} prefix="@" value={d.communityX.replace(/^@/, '')} onChange={(e) => set('communityX')(e.target.value)} error={errors.communityX} autoCapitalize="off" spellCheck={false} autoComplete="off" />
        <Field label={t('cb.f.yourX')} prefix="@" value={d.contactX.replace(/^@/, '')} onChange={(e) => set('contactX')(e.target.value)} error={errors.contactX} autoCapitalize="off" spellCheck={false} autoComplete="off" />
        <Field label={t('cb.f.discord')} value={d.discord} onChange={(e) => set('discord')(e.target.value)} error={errors.discord} maxLength={SITE_LIMITS.discord + 10} autoComplete="off" />
        <Select id="cb-role" label={t('cb.f.role')} value={d.role} onChange={set('role')} options={COLLAB_ROLES.map((r) => [r, roleLabel(r)])} error={errors.role} />
        <Field
          className="cb-span2"
          label={t('cb.f.post')}
          value={d.postUrl}
          onChange={(e) => set('postUrl')(e.target.value)}
          error={errors.postUrl}
          hint={t('cb.f.postHint')}
          placeholder="https://x.com/yourcommunity/status/…"
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
        />
        <div className={`kb-field cb-span2${errors.about ? ' is-error' : ''}`}>
          <label className="kb-field__label mono" htmlFor="cb-about">
            {t('cb.f.about')}
          </label>
          <textarea id="cb-about" className="wl-input" value={d.about} onChange={(e) => set('about')(e.target.value)} maxLength={SITE_LIMITS.about + 50} aria-invalid={errors.about ? true : undefined} aria-describedby="cb-about-note" />
          <p className={`kb-field__note${errors.about ? ' cb-err' : ' num'}`} id="cb-about-note" role={errors.about ? 'alert' : undefined}>
            {errors.about ?? `${d.about.trim().length} / ${SITE_LIMITS.about}`}
          </p>
        </div>
        <label className="st-honey" aria-hidden="true">
          Company
          <input tabIndex={-1} autoComplete="off" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>
      <div className="cb-form__sign">
        <span className="cb-form__signart" aria-hidden="true">
          <ChoreArt kind="wallet" />
        </span>
        <div className="wl-grid">
          <p className="wl-note">{t('cb.f.signNote')}</p>
          {!session && <WalletSignIn label={t('cb.f.signIn')} />}
        </div>
      </div>
      <div className="wl-row cb-form__actions">
        <Button type="submit" variant="primary" icon="arrow" disabled={!session} loading={sending}>
          {t('cb.f.apply')}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            {t('tf.cancel')}
          </Button>
        )}
      </div>
      {formErr && (
        <p className="wl-note is-error cb-form__err" role="alert">
          {formErr}
        </p>
      )}
    </form>
  );
}

function Summary({ c }: { c: CollabPublic }) {
  const t = useT();
  return (
    <dl className="cb-summary">
      <div>
        <dt>{t('cb.s.community')}</dt>
        <dd>{c.community}</dd>
      </div>
      <div>
        <dt>{t('cb.f.type')}</dt>
        <dd>{typeLabel(c.type)}</dd>
      </div>
      <div>
        <dt>{t('cb.f.members')}</dt>
        <dd className="num">{c.members.toLocaleString(intlLocale())}</dd>
      </div>
      <div>
        <dt>{t('cb.f.communityX')}</dt>
        <dd>
          <a className="cb-link" href={xProfile(c.communityX)} target="_blank" rel="noreferrer">
            @{c.communityX}
          </a>
        </dd>
      </div>
    </dl>
  );
}

const when = (ms: number | null | undefined) => (ms && ms > 1e11 ? fmtDate(ms) : null);

/** The mission log: what happened to this application so far, one line per leg. */
function MissionLog({ c }: { c: CollabPublic }) {
  const t = useT();
  type Leg = { k: string; text: ReactNode; at?: string | null; state: 'done' | 'now' | 'bad' | 'todo' };
  const legs: Leg[] = [{ k: 'applied', text: t('cb.log.applied'), at: when(c.createdAt), state: 'done' }];
  if (c.phase === 'in_review') {
    legs.push({ k: 'review', text: t('cb.log.review', { handle: `@${c.contactX}` }), state: 'now' });
    legs.push({ k: 'wallets', text: t('cb.log.raffle'), state: 'todo' });
  } else if (c.phase === 'rejected') {
    legs.push({ k: 'review', text: t('cb.log.rejected'), at: when(c.updatedAt), state: 'bad' });
  } else {
    legs.push({ k: 'review', text: t('cb.log.approved', { n: c.spots ?? 0 }), state: 'done' });
    if (c.phase === 'approved') legs.push({ k: 'wallets', text: t('cb.log.due', { when: c.deadline ? fmtDate(c.deadline, true) : t('cb.deadline') }), state: 'now' });
    if (c.phase === 'submitted') legs.push({ k: 'wallets', text: t('cb.log.locked', { n: c.wallets.length }), at: when(c.submittedAt), state: 'done' });
    if (c.phase === 'closed') legs.push({ k: 'wallets', text: t('cb.log.closed'), state: 'bad' });
  }
  return (
    <ol className="cb-log" aria-label={t('cb.log')}>
      {legs.map((l) => (
        <li key={l.k} className={`cb-log__leg is-${l.state}`}>
          <span className="cb-log__dot" aria-hidden="true">
            {l.state === 'done' ? <Icon name="check" size={12} /> : l.state === 'bad' ? <Icon name="close" size={12} /> : l.state === 'now' ? <Courier /> : null}
          </span>
          <span className="cb-log__text">{l.text}</span>
          {l.at && <span className="cb-log__at num">{l.at}</span>}
        </li>
      ))}
    </ol>
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

function StateCard({ stamp, tone, title, children, c, vignette }: { stamp: string; tone: StampTone; title: string; children: ReactNode; c: CollabPublic; vignette: ReactNode }) {
  return (
    <Sticker tone="white" lift="lg" pad="none" round="lg" className="cb-state" data-phase={c.phase}>
      {vignette}
      <div className="cb-state__body">
        <Stamp text={stamp} tone={tone} size="lg" rotate={-6} className="cb-state__stamp" />
        <h2 className="cb-state__title">{title}</h2>
        <div className="cb-state__text">{children}</div>
        <MissionLog c={c} />
        <Summary c={c} />
      </div>
    </Sticker>
  );
}

export function CollabView({ collab: c, onChange, onGuide, onExpired }: { collab: CollabPublic; onChange: (c: CollabPublic) => void; onGuide: () => void; onExpired: () => void }) {
  const t = useT();
  if (c.phase === 'in_review')
    return (
      <StateCard
        stamp={t('cb.ph.in_review')}
        tone="sun"
        title={t('cb.rev.title')}
        c={c}
        vignette={<Vignette tone="mist" plate={t('cb.vig.plate', { n: 'ii' })} caption={t('cb.vig.reading')} coin="cyan" mood="smug" prop={<Inspection size={116} />} />}
      >
        <T k="cb.rev.body" vars={{ handle: `@${c.contactX}` }} tags={{ strong }} />
      </StateCard>
    );
  if (c.phase === 'rejected')
    return (
      <StateCard
        stamp={t('cb.ph.rejected')}
        tone="down"
        title={t('cb.rej.title')}
        c={c}
        vignette={<Vignette tone="linen" plate={t('cb.vig.plate', { n: 'ii' })} caption={t('cb.vig.rain')} coin="foam" mood="scared" coinSize={88} prop={<RainyCloud size={84} />} />}
      >
        <T k="cb.rej.body" tags={{ x: xLink }} />
      </StateCard>
    );
  return <SpotsView c={c} onChange={onChange} onGuide={onGuide} onExpired={onExpired} />;
}

/** The time left, as Geist Mono keys (a digit that changes flips in). Its text is the plain countdown. */
function Clock({ text }: { text: string }) {
  const chars = [...text];
  return (
    <span className="kb-count kb-count--lg kb-count--sun cb-clock" data-testid="cb-countdown">
      <span className="kb-count__digits">
        {chars.map((ch, i) => {
          const place = chars.length - i;
          if (!/[0-9]/.test(ch)) {
            return (
              <span key={`s${place}`} className={ch === ' ' ? 'kb-count__gap cb-clock__gap' : ch === ':' ? 'kb-count__sep' : 'cb-clock__unit'}>
                {ch}
              </span>
            );
          }
          return (
            <span key={`d${place}`} className="kb-count__cell">
              <span key={ch} className="kb-count__digit cb-clock__digit">
                {ch}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}

function SpotsView({ c, onChange, onGuide, onExpired }: { c: CollabPublic; onChange: (c: CollabPublic) => void; onGuide: () => void; onExpired: () => void }) {
  const session = useSiteSession();
  const t = useT();
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
    setMsg({ kind: dropped > 0 ? 'err' : 'ok', text: dropped > 0 ? t('cb.paste.over', { n: parsed.length - dropped, dropped, spots }) : t('cb.paste.ok', { n: parsed.length }) });
  };

  const fail = (err: unknown) => {
    if (dropExpired(err)) {
      setMsg({ kind: 'err', text: t('cb.expired') });
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
      setMsg({ kind: 'err', text: t('cb.fixRows') });
      return;
    }
    const url = raffle.trim();
    if (url && !isXStatusUrl(url)) {
      setRaffleErr(t('cb.notPost'));
      return;
    }
    setBusy('save');
    try {
      const next = await site.saveWallets(session.token, c.id, filled, url || null);
      onChange(next);
      setMsg({ kind: 'ok', text: t('cb.saved', { n: filled.length }) });
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
      setRaffleErr(url ? t('cb.notPost') : t('cb.raffleFirst'));
      return;
    }
    if (errs.some(Boolean)) {
      setMsg({ kind: 'err', text: t('cb.fixRows') });
      return;
    }
    if (filled.length === 0) {
      setMsg({ kind: 'err', text: t('cb.oneWinner') });
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

  const vignette =
    c.phase === 'submitted' ? (
      <Vignette tone="sand" plate={t('cb.vig.plate', { n: 'iv' })} caption={t('cb.vig.sent')} coin="teal" mood="happy" prop={<FlyingLetter size={104} />} />
    ) : c.phase === 'closed' ? (
      <Vignette tone="night" plate={t('cb.vig.plate', { n: 'iv' })} caption={t('cb.vig.bell')} coin="cream" mood="sleepy" prop={<Moon size={80} />} night />
    ) : (
      <Vignette
        tone="mint"
        plate={t('cb.vig.plate', { n: 'iii' })}
        caption={t('cb.vig.spots')}
        coin="sun"
        mood="happy"
        second={{ paint: 'cyan', mood: 'happy' }}
        prop={
          <span className="cb-vig__feast">
            <FoodBit kind="pear" size={40} />
            <FoodBit kind="grapes" size={44} />
            <FoodBit kind="seed" paint="blush" size={22} />
          </span>
        }
      />
    );

  const head =
    c.phase === 'submitted' ? (
      <>
        <Stamp text={t('cb.ph.submitted')} tone="teal" size="lg" rotate={-6} className="cb-state__stamp" />
        <h2 className="cb-state__title">{t('cb.sub.title')}</h2>
        <p className="cb-state__text">{renderRich(t('cb.sub.body', { n: c.wallets.length }), { x: xLink })}</p>
      </>
    ) : c.phase === 'closed' ? (
      <>
        <Stamp text={t('cb.ph.closed')} tone="ink" size="lg" rotate={-6} className="cb-state__stamp" />
        <h2 className="cb-state__title">{t('cb.late.title')}</h2>
        <p className="cb-state__text">
          <T k="cb.late.body" tags={{ x: xLink }} />
        </p>
      </>
    ) : (
      <>
        <div className="cb-spots">
          <Stamp text={t('cb.spots', { n: spots })} sub={t('cb.spotsSub')} tone="up" round size="lg" rotate={-8} />
          <div className="cb-timer" role="timer" aria-live="off">
            <Clock text={countdown(c.deadline ?? 0, now)} />
            <span className="cb-timer__l mono">{t('cb.left')}</span>
          </div>
        </div>
        <h2 className="cb-state__title">{t('cb.ap.title')}</h2>
        <p className="cb-state__text">
          <T
            k="cb.ap.body"
            vars={{ when: c.deadline ? fmtDate(c.deadline, true) : t('cb.deadline') }}
            tags={{
              guide: (g) => (
                <button type="button" className="wl-textlink cb-inline" onClick={onGuide}>
                  {g}
                </button>
              ),
            }}
          />
        </p>
      </>
    );

  return (
    <Sticker tone="white" lift="lg" pad="none" round="lg" className="cb-state cb-spotsview" data-phase={c.phase}>
      {vignette}
      <div className="cb-state__body">
        {head}
        <MissionLog c={c} />
        <div className="cb-raffle">
          {locked ? (
            c.raffleUrl && (
              <p className="cb-raffle__locked">
                <span className="mono cb-raffle__k">{t('cb.g.postLabel')}</span>{' '}
                <a className="cb-link" href={c.raffleUrl} target="_blank" rel="noreferrer">
                  {c.raffleUrl}
                </a>
              </p>
            )
          ) : (
            <Field
              label={t('cb.r.label')}
              value={raffle}
              onChange={(e) => {
                setRaffle(e.target.value);
                setRaffleErr(null);
              }}
              error={raffleErr ?? undefined}
              hint={t('cb.r.hint')}
              placeholder="https://x.com/yourcommunity/status/…"
              inputMode="url"
              spellCheck={false}
              autoComplete="off"
            />
          )}
        </div>

        <div className="cb-table-head">
          <h3 className="cb-table-h">
            {locked ? t('cb.t.locked') : t('cb.t.add')}
            {locked && <Icon name="lock" size={18} className="cb-table-h__lock" />}
          </h3>
          <span className="num cb-count" aria-live="polite">
            {locked ? c.wallets.length : filled.length} / {spots}
          </span>
        </div>
        <SeatRow spots={spots} filled={locked ? c.wallets.length : filled.length} locked={locked} />
        {!locked && (
          <p className="cb-paste">
            <T k="cb.t.paste" tags={{ key: (k) => <span className="kb-key">{k}</span> }} />
          </p>
        )}
        <div className={`cb-tablewrap${locked ? ' is-locked' : ''}`}>
          <table className="cb-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">{t('cb.t.name')}</th>
                <th scope="col">{t('wp.st.wallet')}</th>
              </tr>
            </thead>
            <tbody>
              {(locked ? c.wallets : table).map((r, i) => {
                const err = locked ? null : serverRowErr[i] || errs[i];
                return (
                  <tr key={i} className={err ? 'is-error' : r.wallet ? 'is-filled' : undefined}>
                    <td className="num cb-table__no">{String(i + 1).padStart(2, '0')}</td>
                    <td>
                      {locked ? (
                        <span className="cb-name">{r.name || '—'}</span>
                      ) : (
                        <input className="cb-cell" aria-label={t('cb.t.rowName', { n: i + 1 })} value={r.name} maxLength={SITE_LIMITS.walletName + 10} onChange={(e) => setCell(i, 'name', e.target.value)} onPaste={onPaste(i)} placeholder={t('cb.t.namePh')} />
                      )}
                    </td>
                    <td>
                      {locked ? (
                        <code className="cb-wallet">{r.wallet}</code>
                      ) : (
                        <>
                          <input
                            className="cb-cell cb-cell--wallet"
                            aria-label={t('cb.t.rowWallet', { n: i + 1 })}
                            aria-invalid={err ? true : undefined}
                            value={r.wallet}
                            onChange={(e) => setCell(i, 'wallet', e.target.value.trim())}
                            onPaste={onPaste(i)}
                            spellCheck={false}
                            autoComplete="off"
                            placeholder={t('cb.t.walletPh')}
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
            {table.length < spots && (
              <button type="button" className="wl-textlink" onClick={() => setShown((s) => Math.min(spots, s + 10))}>
                {t('cb.t.more', { n: spots - table.length })}
              </button>
            )}
            <div className="wl-row cb-actions">
              <Button variant="secondary" onClick={() => void save()} disabled={busy !== null} loading={busy === 'save'}>
                {t('cb.t.save')}
              </Button>
              {confirm ? (
                <div className="cb-confirm" role="group" aria-label={t('cb.t.confirm')}>
                  <span>
                    {t('cb.t.confirmQ', { n: filled.length })}
                  </span>
                  <div className="wl-row">
                    <Button variant="primary" size="sm" onClick={() => void submit()}>
                      {t('cb.t.yes')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>
                      {t('cb.t.no')}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="primary" icon="arrow" onClick={() => setConfirm(true)} disabled={busy !== null} loading={busy === 'submit'}>
                  {t('cb.t.submit')}
                </Button>
              )}
            </div>
          </>
        )}
        {msg && (
          <p className={`wl-note${msg.kind === 'err' ? ' is-error' : ' cb-ok'}`} role={msg.kind === 'err' ? 'alert' : 'status'}>
            {msg.text}
          </p>
        )}
        <Summary c={c} />
      </div>
    </Sticker>
  );
}
