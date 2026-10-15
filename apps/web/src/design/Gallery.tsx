import { motion } from 'motion/react';
import { StrictMode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { translate, type TKey } from '../i18n';
import { useUi } from '../store';
import { ICON_NAMES, Icon } from './icons';
import { Kb, themeFromSettings, useKbTheme, type KbTheme } from './Kb';
import { STAGGER, useReducedMotion } from './motion';
import { Chip } from './components/Chip';
import { Counter } from './components/Counter';
import { Dateline } from './components/Dateline';
import { Field } from './components/Field';
import { InkButton } from './components/InkButton';
import { Passport } from './components/Passport';
import { Receipt } from './components/Receipt';
import { Rule } from './components/Rule';
import { Sheet } from './components/Sheet';
import { Stamp } from './components/Stamp';
import { TabPanel, Tabs } from './components/Tabs';
import { Tape } from './components/Tape';
import { Ticket, TicketGroup, TicketStub } from './components/Ticket';
import { ToastViewport, type ToastItem } from './components/Toast';
import './gallery.css';

type Theme = KbTheme;
type T = (key: TKey, vars?: Record<string, string | number>) => string;

/** Token names only; the printed values are read back from the live CSS. */
const SWATCHES: { key: TKey; v: string; text?: string }[] = [
  { key: 'ds.c.paper', v: '--paper' },
  { key: 'ds.c.card', v: '--card' },
  { key: 'ds.c.ink', v: '--ink' },
  { key: 'ds.c.ink2', v: '--ink-2' },
  { key: 'ds.c.pink', v: '--pink', text: '--pink-text' },
  { key: 'ds.c.teal', v: '--teal', text: '--teal-ink' },
  { key: 'ds.c.mustard', v: '--mustard', text: '--mustard-text' },
  { key: 'ds.c.blue', v: '--blue', text: '--blue-ink' },
  { key: 'ds.c.green', v: '--green', text: '--green-ink' },
  { key: 'ds.c.red', v: '--red', text: '--red-ink' },
];

export function startDesignGallery(root: HTMLElement): void {
  document.body.style.margin = '0';
  createRoot(root).render(
    <StrictMode>
      <Gallery />
    </StrictMode>,
  );
}

export function Gallery() {
  // `?gallery&theme=night` pins the proof for screenshots.
  const [theme, setTheme] = useState<Theme>(() => {
    const q = new URLSearchParams(location.search).get('theme');
    if (q === 'night' || q === 'paper') return q;
    return themeFromSettings(useUi.getState().settings.theme);
  });
  const t: T = translate;
  const fmt = useCallback((n: number) => Math.round(n).toLocaleString('en-US'), []);
  const reduced = useReducedMotion();

  useEffect(() => {
    document.title = t('ds.docTitle');
  }, [t]);
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // body sits outside the .kb root: paint it with the live --paper token.
    const paper = rootRef.current ? getComputedStyle(rootRef.current).getPropertyValue('--paper').trim() : '';
    document.body.style.background = paper;
    document.documentElement.style.colorScheme = theme === 'night' ? 'dark' : 'light';
  }, [theme]);

  return (
    <Kb ref={rootRef} theme={theme} className="g-root">
      <Masthead t={t} theme={theme} setTheme={setTheme} reduced={reduced} fmt={fmt} />
      <main className="g-main">
        <div className="g-band">
          <Section n="01" title={t('ds.s.palette')} note={t('ds.s.palette.note')} className="g-palette">
            <Palette t={t} />
          </Section>
          <Section n="02" title={t('ds.s.type')} className="g-type">
            <TypeSpecimen t={t} />
          </Section>
        </div>
        <Section n="03" title={t('ds.s.icons')} note={t('ds.s.icons.note')} className="g-icons-sec">
          <IconSheet t={t} />
        </Section>
        <Rule variant="double" className="g-rule" />
        <div className="g-cols">
          <div className="g-col">
            <Section n="04" title={t('ds.s.tickets')} note={t('ds.s.tickets.note')}>
              <TicketDemo t={t} fmt={fmt} />
            </Section>
            <Section n="05" title={t('ds.s.buttons')} note={t('ds.s.buttons.note')}>
              <ButtonDemo t={t} fmt={fmt} />
            </Section>
            <Section n="06" title={t('ds.s.tabs')}>
              <TabsDemo t={t} fmt={fmt} />
            </Section>
            <Section n="07" title={t('ds.s.fields')}>
              <FieldDemo t={t} />
            </Section>
          </div>
          <div className="g-col">
            <Section n="08" title={t('ds.s.stamps')} note={t('ds.s.stamps.note')}>
              <StampDemo t={t} />
            </Section>
            <Section n="09" title={t('ds.s.passport')} note={t('ds.s.passport.note')}>
              <PassportDemo t={t} />
            </Section>
            <Section n="10" title={t('ds.s.counter')} note={t('ds.s.counter.note')}>
              <CounterDemo t={t} fmt={fmt} />
            </Section>
          </div>
          <div className="g-col">
            <Section n="11" title={t('ds.s.receipt')} note={t('ds.s.receipt.note')}>
              <ReceiptDemo t={t} fmt={fmt} />
            </Section>
            <Section n="12" title={t('ds.s.paper')}>
              <PaperBits t={t} fmt={fmt} />
            </Section>
            <Section n="13" title={t('ds.s.overlays')} note={t('ds.s.overlays.note')}>
              <OverlayDemo t={t} />
            </Section>
          </div>
        </div>
      </main>
      <footer className="g-foot">
        <Rule variant="thick" />
        <p className="mono">{t('ds.footer')}</p>
      </footer>
    </Kb>
  );
}

/* ── masthead ─────────────────────────────────────────────────────────── */

function Masthead({
  t,
  theme,
  setTheme,
  reduced,
  fmt,
}: {
  t: T;
  theme: Theme;
  setTheme: (t: Theme) => void;
  reduced: boolean;
  fmt: (n: number) => string;
}) {
  return (
    <header className="g-mast">
      <div className="g-mast__top">
        <div className="g-mast__brand">
          <div className="g-mast__kicker mono">{t('ds.kicker')}</div>
          <h1 className="g-wordmark" aria-label={`slana · ${t('ds.title')}`}>
            <span className="g-wordmark__ink" aria-hidden="true">
              slana
            </span>
            <span className="g-wordmark__pink" aria-hidden="true">
              slana
            </span>
            <CoinMark className="g-wordmark__coin" />
          </h1>
          <div className="g-mast__title" aria-hidden="true">
            {t('ds.title')}
          </div>
        </div>
        <div className="g-controls" role="group" aria-label={t('ds.controls')}>
          <div className="g-control">
            <span className="g-control__label mono" id="g-theme-l">
              {t('ds.theme')}
            </span>
            <div className="g-seg" role="group" aria-labelledby="g-theme-l">
              <Chip selected={theme === 'paper'} onClick={() => setTheme('paper')} icon="sun">
                {t('ds.theme.paper')}
              </Chip>
              <Chip selected={theme === 'night'} onClick={() => setTheme('night')} icon="moon">
                {t('ds.theme.night')}
              </Chip>
            </div>
          </div>
        </div>
      </div>
      <Dateline
        label={t('ds.dl.label')}
        items={[
          t('ds.edition'),
          t('ds.date'),
          t('ds.dl.pool', { n: fmt(84200) }),
          reduced ? t('ds.motion.reduced') : t('ds.motion.full'),
        ]}
      />
      <p className="g-intro">{t('ds.intro')}</p>
    </header>
  );
}

function CoinMark({ className, size = 34 }: { className?: string; size?: number }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="22" cy="22" r="15" style={{ fill: 'var(--teal)' }} />
      <circle cx="19" cy="19" r="15" style={{ fill: 'var(--pink)', mixBlendMode: 'multiply' }} />
      <circle cx="19" cy="19" r="10" fill="none" style={{ stroke: 'var(--ink-fixed)' }} strokeWidth="1.6" opacity="0.5" />
    </svg>
  );
}

function Section({ n, title, note, children, className }: { n: string; title: string; note?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`g-sec${className ? ` ${className}` : ''}`} aria-labelledby={`g-s${n}`}>
      <header className="g-sec__head">
        <span className="g-sec__n mono" aria-hidden="true">
          {n}
        </span>
        <h2 id={`g-s${n}`} className="g-sec__title">
          {title}
        </h2>
      </header>
      {note && <p className="g-sec__note">{note}</p>}
      <div className="g-sec__body">{children}</div>
    </section>
  );
}

/* ── foundations ──────────────────────────────────────────────────────── */

function Palette({ t }: { t: T }) {
  const theme = useKbTheme();
  const ref = useRef<HTMLUListElement>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  useLayoutEffect(() => {
    if (!ref.current) return;
    const cs = getComputedStyle(ref.current);
    const next: Record<string, string> = {};
    for (const s of SWATCHES) for (const v of [s.v, s.text]) if (v) next[v] = cs.getPropertyValue(v).trim().toUpperCase();
    setVals(next);
  }, [theme]);
  return (
    <ul className="g-swatches" ref={ref}>
      {SWATCHES.map((s, i) => (
        <motion.li
          key={s.v}
          className="g-swatch"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * STAGGER, duration: 0.24 }}
        >
          <span className="g-swatch__chip" style={{ background: `var(${s.v})` }}>
            <span className="g-swatch__ht halftone" />
          </span>
          <span className="g-swatch__name">{t(s.key)}</span>
          <span className="g-swatch__hex mono">
            {s.v} {vals[s.v]}
          </span>
          {s.text && (
            <span className="g-swatch__hex mono">
              {t('ds.c.textInk')} {s.text} {vals[s.text]}
            </span>
          )}
        </motion.li>
      ))}
    </ul>
  );
}

function TypeSpecimen({ t }: { t: T }) {
  return (
    <div className="g-typespec">
      <div className="g-typespec__row">
        <div className="g-typespec__display">{t('ds.type.sampleDisplay')}</div>
        <div className="g-cap mono">
          {t('ds.type.display')} · {t('ds.type.displaySpec')}
        </div>
      </div>
      <div className="g-typespec__row">
        <p className="g-typespec__body">{t('ds.type.sampleBody')}</p>
        <div className="g-cap mono">
          {t('ds.type.body')} · {t('ds.type.bodySpec')}
        </div>
      </div>
      <div className="g-typespec__row">
        <div className="g-typespec__mono mono">{t('ds.type.sampleMono')}</div>
        <div className="g-cap mono">
          {t('ds.type.mono')} · {t('ds.type.monoSpec')}
        </div>
      </div>
    </div>
  );
}

function IconSheet({ t }: { t: T }) {
  return (
    <ul className="g-icons">
      {ICON_NAMES.map((name, i) => (
        <motion.li
          key={name}
          className="g-icon"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: i * STAGGER * 0.5, duration: 0.2 }}
        >
          <Icon name={name} size={28} />
          <span className="g-cap mono">{t(`ds.icon.${name}` as TKey)}</span>
        </motion.li>
      ))}
    </ul>
  );
}

/* ── components ───────────────────────────────────────────────────────── */

function TicketDemo({ t, fmt }: { t: T; fmt: (n: number) => string }) {
  const [sel, setSel] = useState('penny');
  const rooms = [
    { id: 'practice', title: t('ds.room.practice'), meta: t('ds.room.practiceMeta'), value: t('ds.room.free'), unit: t('ds.room.noTokens') },
    { id: 'penny', title: t('ds.room.penny'), meta: t('ds.room.pennyMeta', { n: 23 }), value: fmt(1000), unit: '$SLANA' },
    { id: 'gold', title: t('ds.room.gold'), meta: t('ds.room.players', { n: 9 }), value: fmt(25000), unit: '$SLANA', pass: true },
    { id: 'whale', title: t('ds.room.whale'), meta: t('ds.room.onFloor', { n: fmt(310400) }), value: fmt(100000), unit: '$SLANA', pass: true },
  ];
  return (
    <TicketGroup className="g-tickets" label={t('ds.rooms')} value={sel} onChange={setSel}>
      {rooms.map((r, i) => (
        <motion.div
          key={r.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 + i * STAGGER, duration: 0.26 }}
        >
          <Ticket
            value={r.id}
            title={r.title}
            meta={r.meta}
            stub={<TicketStub value={r.value} unit={r.unit} />}
            stamp={r.pass ? t('ds.stamp.pass') : undefined}
          />
        </motion.div>
      ))}
    </TicketGroup>
  );
}

function ButtonDemo({ t, fmt }: { t: T; fmt: (n: number) => string }) {
  return (
    <div className="g-buttons">
      <InkButton size="lg" block icon="arrow" sub={t('ds.btn.playSub', { fee: fmt(1000) })}>
        {t('ds.btn.play')}
      </InkButton>
      <div className="g-row">
        <InkButton variant="pink" lead="passport">
          {t('ds.btn.mint')}
        </InkButton>
        <InkButton variant="paper" lead="wallet">
          {t('ds.btn.wallet')}
        </InkButton>
      </div>
      <div className="g-row">
        <InkButton size="sm" lead="bot">
          {t('ds.btn.practice')}
        </InkButton>
        <InkButton size="sm" variant="pink" lead="cashout">
          {t('ds.btn.cashout')}
        </InkButton>
        <InkButton size="sm" variant="paper" disabled>
          {t('ds.btn.soldOut')}
        </InkButton>
      </div>
      <div className="g-cap mono">
        {t('ds.btn.caption.variants')} / {t('ds.btn.caption.sizes')}
      </div>
    </div>
  );
}

function StampDemo({ t }: { t: T }) {
  const [round, setRound] = useState(0);
  return (
    <div className="g-stamps">
      <div className="g-stamps__pad" key={round}>
        <Stamp text={t('ds.stamp.defeated')} tone="red" size="lg" rotate={-7} animateIn />
        <Stamp text={t('ds.stamp.paid')} tone="teal" size="md" rotate={6} animateIn delay={0.25} />
        <Stamp text={t('ds.stamp.valid')} sub={t('ds.stamp.season')} tone="mustard" round rotate={-12} animateIn delay={0.4} />
        <Stamp text={t('ds.stamp.pass')} tone="pink" size="sm" rotate={-11} animateIn delay={0.55} />
        <Stamp text={t('ds.stamp.sealed')} tone="ink" size="md" rotate={-3} animateIn delay={0.65} />
      </div>
      <InkButton size="sm" variant="paper" lead="flame" onClick={() => setRound((r) => r + 1)}>
        {t('ds.stamp.replay')}
      </InkButton>
    </div>
  );
}

function PassportDemo({ t }: { t: T }) {
  const [sealed, setSealed] = useState(false);
  return (
    <div className="g-passports">
      <Passport
        title={t('ds.pp.title')}
        kind={t('ds.pp.kind')}
        number="0412"
        numberLabel={t('ds.pp.no')}
        sealed={sealed}
        sealedLabel={t('ds.stamp.sealed')}
        visa={t('ds.stamp.valid')}
        holderLabel={t('ds.pp.holder')}
        holder={t('ds.pp.holderName')}
        art={<PassArt />}
        traits={[
          { label: t('ds.pp.body'), value: t('ds.pp.bodyV') },
          { label: t('ds.pp.crown'), value: t('ds.pp.crownV') },
          { label: t('ds.pp.rarity'), value: t('ds.pp.rarityV') },
          { label: t('ds.pp.sessions'), value: '3 / 5' },
        ]}
      />
      <InkButton size="sm" variant={sealed ? 'pink' : 'paper'} lead={sealed ? 'key' : 'lock'} onClick={() => setSealed((s) => !s)}>
        {sealed ? t('ds.pp.open') : t('ds.pp.seal')}
      </InkButton>
    </div>
  );
}

/** The crowned coin from artboard B, as Pass art. Printed in fixed inks (art does not invert at night). */
function PassArt() {
  const ink = { stroke: 'var(--ink-fixed)' };
  return (
    <svg className="g-passart" width="92" height="92" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="54" cy="55" r="36" style={{ fill: 'var(--teal)' }} />
      <circle cx="50" cy="51" r="36" style={{ fill: 'var(--pink)', mixBlendMode: 'multiply' }} />
      <circle cx="50" cy="51" r="27" fill="none" style={ink} strokeWidth="2.5" opacity="0.45" />
      <path d="M30 18 L36 6 L44 15 L50 2 L56 15 L64 6 L70 18 Z" style={{ ...ink, fill: 'var(--mustard)' }} strokeWidth="2.5" strokeLinejoin="round" />
      <ellipse cx="40" cy="52" rx="4.5" ry="6.5" style={{ fill: 'var(--ink-fixed)' }} />
      <ellipse cx="60" cy="52" rx="4.5" ry="6.5" style={{ fill: 'var(--ink-fixed)' }} />
      <circle cx="31" cy="62" r="4.5" style={{ fill: 'var(--mustard)' }} opacity="0.9" />
      <circle cx="69" cy="62" r="4.5" style={{ fill: 'var(--mustard)' }} opacity="0.9" />
      <path d="M44 63 Q50 69 56 63" fill="none" style={ink} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function CounterDemo({ t, fmt }: { t: T; fmt: (n: number) => string }) {
  const [v, setV] = useState(12450);
  return (
    <div className="g-counter">
      <div className="g-counter__card">
        <Tape rotate={-5} width={70} style={{ left: -12, top: -10 }} />
        <div className="g-cap mono">{t('ds.ct.vault')}</div>
        <Counter value={v} format={fmt} unit="$SLANA" className="g-counter__num" />
      </div>
      <div className="g-row">
        <InkButton size="sm" lead="coin" onClick={() => setV((x) => x + 137)}>
          {t('ds.ct.eat')}
        </InkButton>
        <InkButton size="sm" variant="pink" lead="crown" onClick={() => setV((x) => x + 48210)}>
          {t('ds.ct.jackpot')}
        </InkButton>
        <InkButton size="sm" variant="paper" lead="close" onClick={() => setV(1000)}>
          {t('ds.ct.reset')}
        </InkButton>
      </div>
    </div>
  );
}

function ReceiptDemo({ t, fmt }: { t: T; fmt: (n: number) => string }) {
  const [run, setRun] = useState(0);
  return (
    <div className="g-receipt">
      <Receipt
        key={run}
        printing
        title={t('ds.rc.title')}
        meta={t('ds.rc.meta')}
        code="5h3Kq9pZ1vXfR2mN"
        lines={[
          { label: t('ds.rc.entry'), value: fmt(1000) },
          { label: t('ds.rc.won'), value: `+${fmt(4250)}` },
          { label: t('ds.rc.fee', { p: t('ds.pct', { n: 2 }) }), value: `−${fmt(85)}`, muted: true },
          { label: t('ds.rc.net'), value: fmt(1000 + 4250 - 85), strong: true },
        ]}
        footer={
          <a href="#tx" onClick={(e) => e.preventDefault()}>
            {t('ds.rc.tx')} 5h3K…mN
          </a>
        }
      />
      <InkButton size="sm" variant="paper" lead="docs" onClick={() => setRun((r) => r + 1)}>
        {t('ds.rc.replay')}
      </InkButton>
    </div>
  );
}

function FieldDemo({ t }: { t: T }) {
  return (
    <div className="g-fields">
      <Field label={t('ds.f.name')} placeholder={t('ds.f.namePh')} hint={t('ds.f.nameHint')} maxLength={16} />
      <Field label={t('ds.f.deposit')} defaultValue="250000" inputMode="numeric" suffix="$SLANA" error={t('ds.f.depositErr')} />
    </div>
  );
}

function PaperBits({ t, fmt }: { t: T; fmt: (n: number) => string }) {
  const [bots, setBots] = useState(true);
  const [mini, setMini] = useState(false);
  const [sound, setSound] = useState(true);
  return (
    <div className="g-bits">
      <Dateline
        label={t('ds.dl.label')}
        items={[t('ds.dl.season'), t('ds.dl.left', { n: 12 }), t('ds.dl.pool', { n: fmt(84200) })]}
      />
      <Rule variant="thin" />
      <Rule variant="double" label={t('ds.rule.today')} />
      <Rule variant="cut" label={t('ds.rule.cut')} />
      <div className="g-bits__tape">
        <Tape inline rotate={-3} width={150}>
          {t('ds.tape.text')}
        </Tape>
        <Tape inline rotate={4} width={70} tone="pink" />
        <Tape inline rotate={-8} width={56} tone="teal" />
      </div>
      <div className="g-chips">
        <Chip>{t('ds.chip.private')}</Chip>
        <Chip tone="pink">{t('ds.chip.fee', { p: t('ds.pct', { n: 2 }) })}</Chip>
        <Chip tone="teal" icon="trophy">
          {t('ds.chip.prize')}
        </Chip>
        <Chip tone="mustard" icon="flame">
          {t('ds.chip.mass')}
        </Chip>
      </div>
      <div className="g-chips">
        <Chip icon="bot" selected={bots} onClick={() => setBots((b) => !b)}>
          {t('ds.chip.bots')}
        </Chip>
        <Chip icon="map" selected={mini} onClick={() => setMini((b) => !b)}>
          {t('ds.chip.minimap')}
        </Chip>
        <Chip icon={sound ? 'sound' : 'mute'} tone="pink" selected={sound} onClick={() => setSound((b) => !b)}>
          {t('ds.chip.sound')}
        </Chip>
      </div>
    </div>
  );
}

function TabsDemo({ t, fmt }: { t: T; fmt: (n: number) => string }) {
  const [period, setPeriod] = useState<'season' | 'today' | 'all'>('season');
  const [nav, setNav] = useState<'play' | 'ranks' | 'pass' | 'profile'>('play');
  const text = useMemo(
    () => ({
      season: t('ds.tab.panel.season', { n: fmt(84200) }),
      today: t('ds.tab.panel.today', { n: fmt(18930) }),
      all: t('ds.tab.panel.all', { n: fmt(402115) }),
    }),
    [t, fmt],
  );
  return (
    <div className="g-tabs">
      <Tabs
        idBase="g-period"
        label={t('ds.tab.periodLabel')}
        value={period}
        onChange={setPeriod}
        items={[
          { id: 'season', label: t('ds.tab.season') },
          { id: 'today', label: t('ds.tab.today') },
          { id: 'all', label: t('ds.tab.all') },
        ]}
      />
      <TabPanel idBase="g-period" id={period} className="g-tabs__panel">
        {text[period]}
      </TabPanel>
      <div className="g-phone">
        <Tabs
          variant="nav"
          label={t('ds.tab.nav')}
          value={nav}
          onChange={setNav}
          items={[
            { id: 'play', label: t('ds.tab.play'), icon: 'ticket' },
            { id: 'ranks', label: t('ds.tab.ranks'), icon: 'trophy' },
            { id: 'pass', label: t('ds.tab.pass'), icon: 'passport' },
            { id: 'profile', label: t('ds.tab.profile'), icon: 'user' },
          ]}
        />
      </div>
    </div>
  );
}

function OverlayDemo({ t }: { t: T }) {
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const push = (tone: ToastItem['tone']) => {
    const id = ++seq.current;
    const item: ToastItem =
      tone === 'error'
        ? { id, tone, title: t('tx.failed'), message: t('ds.to.errorMsg') }
        : tone === 'success'
          ? { id, tone, title: t('tx.confirmed'), message: t('ds.to.successMsg') }
          : { id, tone, title: t('tx.sent'), message: t('ds.to.infoMsg') };
    setToasts((xs) => [item, ...xs].slice(0, 3));
    window.setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), 5200);
  };
  return (
    <div className="g-overlays">
      <InkButton block icon="arrow" onClick={() => setOpen(true)}>
        {t('ds.sh.open')}
      </InkButton>
      <div className="g-row">
        <InkButton size="sm" variant="paper" lead="info" onClick={() => push('info')}>
          {t('ds.to.info')}
        </InkButton>
        <InkButton size="sm" variant="paper" lead="check" onClick={() => push('success')}>
          {t('ds.to.success')}
        </InkButton>
        <InkButton size="sm" variant="paper" lead="close" onClick={() => push('error')}>
          {t('ds.to.error')}
        </InkButton>
      </div>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        kicker={t('ds.sh.kicker')}
        title={t('ds.sh.title')}
        closeLabel={t('common.close')}
        footer={
          <>
            <InkButton variant="paper" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </InkButton>
            <InkButton variant="pink" icon="check" onClick={() => setOpen(false)}>
              {t('ds.sh.confirm')}
            </InkButton>
          </>
        }
      >
        <p className="g-sheet-text">{t('ds.sh.body')}</p>
        <div className="g-sheet-chips">
          <Chip tone="teal" icon="passport">
            {t('ds.chip.fee', { p: t('ds.pct', { n: 2 }) })}
          </Chip>
          <Chip icon="coin">{t('ds.room.penny')}</Chip>
        </div>
      </Sheet>
      <ToastViewport
        toasts={toasts}
        onDismiss={(id) => setToasts((xs) => xs.filter((x) => x.id !== id))}
        closeLabel={t('common.close')}
        label={t('ds.to.region')}
      />
    </div>
  );
}
