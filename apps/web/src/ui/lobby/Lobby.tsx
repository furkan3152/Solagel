import { useWallet } from '@solana/wallet-adapter-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { DUR, Dateline, Icon, Kb, Rule, Tabs, presets, springs, themeFromSettings, useReducedMotion, type IconName, type TabItem } from '../../design';
import { engine } from '../../game/instance';
import { sound } from '../../audio';
import { useT } from '../../i18n';
import { useChainData } from '../../solana/chain';
import { ProfileCard } from '../../solana/ProfileCard';
import { signInWithWallet } from '../../solana/siws';
import { TicketFlow, type FlowMode } from '../../solana/TicketFlow';
import { sessionsToCollect, type TicketKey } from '../../solana/ticket';
import { WalletButton } from '../../solana/WalletButton';
import { goPage, openModal, updateSettings, useUi, type LobbyPage } from '../../store';
import { DocsPage } from '../docs/DocsPage';
import { Leaderboards } from '../news/Leaderboards';
import { PassPage } from '../pass/PassPage';
import { ProfilePage } from '../profile/ProfilePage';
import { LiveFrame } from './LiveFrame';
import './lobby.css';
import { PassCard } from './PassCard';
import { PendingBanner } from './PendingBanner';
import { QuickPlay } from './QuickPlay';
import { SeasonColumn } from './SeasonColumn';
import { TicketList } from './TicketList';
import { useLobbyModel, useMedia, useTokenText } from './useLobby';

/**
 * The lobby. Phones follow artboard B (masthead, wallet slip, dateline, Pass
 * card, tickets, Quick Play, bottom tabs). Desktop is a newspaper front page:
 * tickets on the left, the live room as the front-page photo in the middle,
 * Pass, season and profile on the right.
 */
export function Lobby() {
  const t = useT();
  const theme = useUi((s) => s.settings.theme);
  const connected = useUi((s) => s.connected);
  const intent = useUi((s) => s.lobbyIntent);
  const wallet = useWallet();
  const model = useLobbyModel();
  const wide = useMedia('(min-width: 1100px)');
  const mid = useMedia('(min-width: 760px)');

  const [picked, setPicked] = useState<TicketKey | null>(null);
  const tab = useUi((s) => s.page);
  const setTab = goPage;
  const [flow, setFlow] = useState<{ mode: FlowMode; key: TicketKey; open: boolean } | null>(null);
  const reduced = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  /** The ticket punched on the way into its room (the screen wipe opens from its hole). */
  const [punched, setPunched] = useState<TicketKey | null>(null);
  useEffect(() => {
    if (!punched) return;
    // the room did not open (no answer, refused): the ticket is whole again
    const id = setTimeout(() => setPunched(null), 2500);
    return () => clearTimeout(id);
  }, [punched]);
  // a new page starts at its top
  useEffect(() => {
    root.current?.scrollTo({ top: 0 });
  }, [tab]);
  // page turn direction: a section to the right turns in from the right
  const order = PAGE_ORDER.indexOf(tab);
  const lastOrder = useRef(order);
  const dir = order === lastOrder.current ? 1 : order > lastOrder.current ? 1 : -1;
  useEffect(() => {
    lastOrder.current = order;
  }, [order]);
  const turn = reduced ? presets.fade : presets.page;
  const pageMotion = {
    custom: dir,
    variants: { enter: turn.enter, center: turn.center, exit: turn.exit },
    initial: 'enter',
    animate: 'center',
    exit: 'exit',
    transition: reduced ? { duration: DUR.fade, ease: 'linear' as const } : { ...springs.page, opacity: { duration: 0.18, ease: 'linear' as const } },
    style: { transformOrigin: dir > 0 ? '100% 0%' : '0% 0%' },
  };

  const has = (k: TicketKey | null | undefined): k is TicketKey => !!k && model.tickets.some((x) => x.key === k);
  const selectedKey: TicketKey = has(picked) ? picked : model.quick;
  const ticket = model.tickets.find((x) => x.key === selectedKey);
  const gate = model.gates[selectedKey];

  // "New ticket" from the death / receipt sheets: select that ticket, open its confirm sheet
  useEffect(() => {
    if (!intent) return;
    if (has(intent.ticket)) {
      setPicked(intent.ticket);
      setTab('play');
      const key = intent.ticket;
      requestAnimationFrame(() => document.querySelector(`[role="radio"][data-kb-value="${key}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      if (intent.open && model.gates[intent.ticket]?.kind === 'buy') setFlow({ mode: 'buy', key: intent.ticket, open: true });
      useUi.setState({ lobbyIntent: null });
    } else if (Date.now() - intent.at > 5000) {
      useUi.setState({ lobbyIntent: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent, model.tickets]);

  const act = () => {
    if (!ticket || !gate) return;
    const id = ticket.arenaId;
    switch (gate.kind) {
      case 'practice':
        sound.punch();
        setPunched(ticket.key);
        engine()?.play('practice');
        return;
      case 'connect':
        openModal('wallet');
        return;
      case 'verify':
        void signInWithWallet(wallet, true);
        return;
      case 'resume': {
        sound.punch();
        const s = id !== null ? model.sessions[id] : null;
        updateSettings({ lastArena: id });
        setPunched(ticket.key);
        // no transaction: the ticket is already open on chain
        engine()?.play(`arena:${id}`, s?.hasPass && s.passAsset ? { pass: s.passAsset } : {});
        return;
      }
      case 'collect':
        setFlow({ mode: 'collect', key: ticket.key, open: true });
        return;
      case 'refund':
        setFlow({ mode: 'refund', key: ticket.key, open: true });
        return;
      case 'needPass':
        setTab('pass');
        return;
      case 'buy':
        setFlow({ mode: 'buy', key: ticket.key, open: true });
        return;
      default:
        return;
    }
  };

  // R24: the first arena whose settled game waits to be collected
  const collect = () => {
    const first = sessionsToCollect(model.sessions)[0];
    const key = first ? (`arena:${first.arenaId}` as TicketKey) : undefined;
    if (key && model.tickets.some((x) => x.key === key)) setFlow({ mode: 'collect', key, open: true });
  };

  const flowTicket = flow ? (model.tickets.find((x) => x.key === flow.key) ?? null) : null;

  const tickets = (
    <section className="kl-col kl-col--tickets" aria-labelledby="kl-tickets-h">
      {mid && <PendingBanner onCollect={collect} />}
      <div className="kl-section-head">
        <h2 id="kl-tickets-h" className="kl-h2">
          {t('lo.tickets')}
        </h2>
        <span className="kl-sub mono">{t('lo.ticketsSub')}</span>
      </div>
      <TicketList
        tickets={model.tickets}
        gates={model.gates}
        openTickets={Object.entries(model.sessions)
          .filter(([, s]) => s !== null)
          .map(([k]) => Number(k))}
        value={selectedKey}
        onChange={setPicked}
        onActivate={act}
        punched={punched}
      />
      {mid && (
        <div className="kl-cta-slot">
          <QuickPlay ticket={ticket} gate={gate} onPress={act} busy={!connected} />
        </div>
      )}
    </section>
  );

  const side = (
    <aside className="kl-col kl-col--side">
      <div id="kl-pass-slot">
        <PassCard onOpen={() => setTab('pass')} />
      </div>
      <SeasonColumn limit={wide ? 6 : 10} onMore={() => setTab('ranks')} />
      <ProfileCard onEdit={() => setTab('profile')} />
    </aside>
  );

  return (
    <Kb ref={root} theme={themeFromSettings(theme)} className={`kl-root${wide ? ` is-wide${tab === 'play' ? ' has-hole' : ''}` : mid ? ' is-mid' : ' is-phone'}`}>
      <div className="kl-sheet-page">
        <Masthead full={mid} wide={wide} />
        {mid && <SectionNav page={tab} onChange={setTab} />}

        <AnimatePresence mode="wait" initial={false} custom={dir}>
        {mid && tab !== 'play' ? (
          <motion.main
            key={tab}
            className="kl-section"
            {...pageMotion}
          >
            <SectionPage page={tab} />
          </motion.main>
        ) : mid ? (
          <motion.main
            key="play"
            className={`kl-front${wide ? ' has-photo' : ''}`}
            {...pageMotion}
          >
            {tickets}
            {wide && (
              <>
                <Rule className="kl-vrule" aria-hidden="true" />
                <section className="kl-col kl-col--photo" aria-label={t('lo.live')}>
                  <LiveFrame />
                  <Deck />
                </section>
              </>
            )}
            <Rule className="kl-vrule" aria-hidden="true" />
            {side}
          </motion.main>
        ) : (
          <motion.main
            key={tab}
            className="kl-phone-main"
            {...pageMotion}
          >
            {tab === 'play' ? (
              <>
                <PendingBanner onCollect={collect} />
                <PassCard onOpen={() => setTab('pass')} />
                {tickets}
              </>
            ) : (
              <SectionPage page={tab} />
            )}
          </motion.main>
        )}
        </AnimatePresence>
        <Colophon onDocs={() => setTab('docs')} />
      </div>

      {!mid && (
        <footer className="kl-dock paper">
          {tab === 'play' && (
            <div className="kl-dock__cta">
              <QuickPlay ticket={ticket} gate={gate} onPress={act} busy={!connected} />
            </div>
          )}
          <PhoneTabs tab={tab} setTab={setTab} />
        </footer>
      )}

      <TicketFlow open={!!flow?.open} mode={flow?.mode ?? 'buy'} ticket={flowTicket} onClose={() => setFlow((f) => (f ? { ...f, open: false } : f))} />
    </Kb>
  );
}

function SectionPage({ page }: { page: LobbyPage }) {
  if (page === 'ranks') return <Leaderboards />;
  if (page === 'pass') return <PassPage />;
  if (page === 'profile') return <ProfilePage />;
  if (page === 'docs') return <DocsPage />;
  return null;
}

/** Left-to-right order of the lobby's pages (the page turn's direction). */
const PAGE_ORDER: readonly LobbyPage[] = ['play', 'ranks', 'pass', 'profile', 'docs'];

const SECTIONS: { id: LobbyPage; key: 'lo.tickets' | 'lo.tab.ranks' | 'lo.tab.pass' | 'lo.tab.profile' | 'lo.tab.docs'; icon: IconName }[] = [
  { id: 'play', key: 'lo.tickets', icon: 'ticket' },
  { id: 'ranks', key: 'lo.tab.ranks', icon: 'trophy' },
  { id: 'pass', key: 'lo.tab.pass', icon: 'passport' },
  { id: 'profile', key: 'lo.tab.profile', icon: 'user' },
  { id: 'docs', key: 'lo.tab.docs', icon: 'docs' },
];

/** Desktop section index under the dateline: the newspaper's pages, A to E. */
function SectionNav({ page, onChange }: { page: LobbyPage; onChange: (p: LobbyPage) => void }) {
  const t = useT();
  const spring = springs.dial;
  return (
    <nav className="kl-sections" aria-label={t('nav.sections')}>
      {SECTIONS.map((s, i) => {
        const on = s.id === page;
        return (
          <button key={s.id} type="button" className={`kl-sections__item${on ? ' is-on' : ''}`} aria-current={on ? 'page' : undefined} onClick={() => onChange(s.id)}>
            <span className="kl-sections__letter mono" aria-hidden="true">
              {String.fromCharCode(65 + i)}
            </span>
            <Icon name={s.icon} size={18} />
            <span className="kl-sections__label">{t(s.key)}</span>
            {on && <motion.span layoutId="kl-sections-ink" className="kl-sections__ink" transition={spring} />}
          </button>
        );
      })}
    </nav>
  );
}

function PhoneTabs({ tab, setTab }: { tab: LobbyPage; setTab: (t: LobbyPage) => void }) {
  const t = useT();
  const items: TabItem<LobbyPage>[] = [
    { id: 'play', label: t('lo.tab.play'), icon: 'ticket' },
    { id: 'ranks', label: t('lo.tab.ranks'), icon: 'trophy' },
    { id: 'pass', label: t('lo.tab.pass'), icon: 'passport' },
    { id: 'profile', label: t('lo.tab.profile'), icon: 'user' },
  ];
  return <Tabs variant="nav" items={items} value={tab} onChange={setTab} label={t('lo.nav')} className="kl-tabs" />;
}

/** The page footer: the paper's colophon with the link to the player guide (also at `/docs`). */
function Colophon({ onDocs }: { onDocs: () => void }) {
  const t = useT();
  return (
    <footer className="kl-colophon">
      <Rule variant="double" />
      <div className="kl-colophon__row">
        <span className="kl-colophon__name mono">{t('lo.colophon')}</span>
        <a
          className="kl-colophon__link"
          href="/docs"
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            onDocs();
          }}
        >
          <Icon name="docs" size={20} />
          <span className="kl-colophon__label">{t('lo.colophon.docs')}</span>
          <span className="kl-colophon__sub mono">{t('lo.colophon.docsSub')}</span>
        </a>
      </div>
    </footer>
  );
}

/** The newspaper deck under the photo. */
function Deck() {
  const t = useT();
  return (
    <div className="kl-deck">
      <h2 className="kl-deck__title">{t('lo.deck.title')}</h2>
      <p className="kl-deck__body">{t('lo.deck.body')}</p>
    </div>
  );
}

function Masthead({ full, wide }: { full: boolean; wide: boolean }) {
  const t = useT();
  const s = useUi((st) => st.settings);
  const online = useUi((st) => st.online);
  const connected = useUi((st) => st.connected);
  const season = useChainData((st) => st.season);
  const currentSeason = useUi((st) => st.chain?.currentSeason ?? null);
  const tok = useTokenText();
  const seasonId = season?.id ?? currentSeason;
  const day = season && season.startedAt > 0 ? Math.max(1, Math.floor((Date.now() / 1000 - season.startedAt) / 86_400) + 1) : null;
  const items = [
    seasonId !== null ? t('lo.season', { n: String(seasonId).padStart(2, '0') }) : null,
    day !== null ? t('lo.seasonDay', { n: day }) : null,
    season ? t('lo.pool', { n: tok.fee(season.prizePool), sym: tok.symbol }) : null,
    wide ? (connected ? t('lo.online', { n: online }) : t('lo.live.connecting')) : null,
  ].filter((x): x is string => x !== null);
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <>
      <header className="kl-mast">
        <div className="kl-mast__brand">
          {wide && <span className="kl-mast__kicker mono">{today}</span>}
          <h1 className="kl-wordmark" aria-label="slana">
            <span className="kl-wordmark__ink" aria-hidden="true">
              slana
            </span>
            <span className="kl-wordmark__pink" aria-hidden="true">
              slana
            </span>
            <CoinMark />
          </h1>
        </div>
        <div className="kl-mast__right">
          {full && (
            <div className="kl-controls">
              <button
                type="button"
                className="kb-iconbtn"
                aria-label={`${t('lo.theme')}: ${s.theme === 'dark' ? t('lo.theme.night') : t('lo.theme.paper')}`}
                aria-pressed={s.theme === 'dark'}
                onClick={() => updateSettings({ theme: s.theme === 'dark' ? 'light' : 'dark' })}
              >
                <Icon name={s.theme === 'dark' ? 'moon' : 'sun'} size={20} />
              </button>
              <button
                type="button"
                className="kb-iconbtn"
                aria-label={t('lo.sound')}
                aria-pressed={s.sound}
                onClick={() => updateSettings({ sound: !s.sound })}
              >
                <Icon name={s.sound ? 'sound' : 'mute'} size={20} />
              </button>
            </div>
          )}
          <button type="button" className="kb-iconbtn" aria-label={t('lo.settings')} onClick={() => openModal('settings')}>
            <Icon name="settings" size={20} />
          </button>
          <WalletButton />
        </div>
      </header>
      <Dateline items={items} label={t('lo.dateline')} className="kl-dateline" />
    </>
  );
}

function CoinMark() {
  return (
    <svg className="kl-wordmark__coin" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="22" cy="22" r="15" style={{ fill: 'var(--teal)' }} />
      <circle cx="19" cy="19" r="15" style={{ fill: 'var(--pink)', mixBlendMode: 'multiply' }} />
      <circle cx="19" cy="19" r="10" fill="none" style={{ stroke: 'var(--ink-fixed)' }} strokeWidth="1.6" opacity="0.5" />
    </svg>
  );
}
