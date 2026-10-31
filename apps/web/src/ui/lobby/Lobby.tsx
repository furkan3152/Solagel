import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import {
  CoinCharacter,
  CoinMark,
  DUR,
  Icon,
  Kb,
  PlateLabel,
  Seigaiha,
  StatusPill,
  Tabs,
  Wordmark,
  presets,
  springs,
  themeFromSettings,
  useReducedMotion,
  type IconName,
  type TabItem,
} from '../../design';
import { formatCountdown, useRound } from '../../game/round';
import { engine } from '../../game/instance';
import { sound } from '../../audio';
import { useT, type TKey } from '../../i18n';
import { ProfileCard } from '../../wallet/ProfileCard';
import { signInWithWallet } from '../../wallet/signIn';
import { TicketFlow, type FlowMode } from '../../wallet/TicketFlow';
import { bpsPercent, feeBps, sessionsToCollect, type TicketKey } from '../../wallet/ticket';
import { WalletButton } from '../../wallet/WalletButton';
import { goPage, openModal, updateSettings, useUi, type LobbyPage } from '../../store';
import { DocsPage } from '../docs/DocsPage';
import { Leaderboards } from '../news/Leaderboards';
import { ProfilePage } from '../profile/ProfilePage';
import { LiveFrame } from './LiveFrame';
import './lobby.css';
import { HeldBanner } from './HeldBanner';
import { PendingBanner } from './PendingBanner';
import { QuickPlay } from './QuickPlay';
import { SplitFlap } from './SplitFlap';
import { TicketList } from './TicketList';
import { useLobbyModel, useMedia } from './useLobby';

/**
 * The lobby, a page of the picture book: the masthead (mark, page tabs, wallet), a plate
 * caption with the arena's status, then the departures board of the four Elysian arenas
 * (and practice) with the one primary button under it. Wide screens add the live window
 * onto the floor and the membership sticker on the right; phones dock the button and the
 * page tabs at the bottom.
 */
export function Lobby() {
  const t = useT();
  const theme = useUi((s) => s.settings.theme);
  const connected = useUi((s) => s.connected);
  const intent = useUi((s) => s.lobbyIntent);
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

  // a ticket held for the next round: show it selected (its button says it is held)
  const heldArena = useUi((s) => s.held?.arenaId ?? null);
  useEffect(() => {
    if (heldArena !== null) setPicked(`arena:${heldArena}`);
  }, [heldArena]);

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
        void signInWithWallet(true);
        return;
      case 'resume': {
        sound.punch();
        updateSettings({ lastArena: id });
        setPunched(ticket.key);
        // no transaction: the ticket is already open on chain
        engine()?.play(`arena:${id}`);
        return;
      }
      case 'collect':
        setFlow({ mode: 'collect', key: ticket.key, open: true });
        return;
      case 'refund':
        setFlow({ mode: 'refund', key: ticket.key, open: true });
        return;
      case 'buy':
        setFlow({ mode: 'buy', key: ticket.key, open: true });
        return;
      default:
        return;
    }
  };

  // the first arena whose settled game waits to be collected
  const collect = () => {
    const first = sessionsToCollect(model.sessions)[0];
    const key = first ? (`arena:${first.arenaId}` as TicketKey) : undefined;
    if (key && model.tickets.some((x) => x.key === key)) setFlow({ mode: 'collect', key, open: true });
  };

  const flowTicket = flow ? (model.tickets.find((x) => x.key === flow.key) ?? null) : null;

  const tickets = (
    <section className="kl-col kl-col--tickets" aria-labelledby="kl-tickets-h">
      {mid && <PendingBanner onCollect={collect} />}
      <HeldBanner />
      <div className="kl-board">
        <div className="kl-board__head">
          <div className="kl-board__titles">
            <span className="kl-board__kicker mono">{t('lo.ticketsSub')}</span>
            <h2 id="kl-tickets-h" className="kl-board__title">
              {t('lo.boardTitle')}
            </h2>
          </div>
          <NextBell />
        </div>
        {mid && (
          <div className="kl-board__cols mono" aria-hidden="true">
            <span>{t('lo.col.arena')}</span>
            <span>{t('lo.col.round')}</span>
            <span>{t('lo.col.fee')}</span>
          </div>
        )}
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
      </div>
    </section>
  );

  const side = (
    <aside className="kl-col kl-col--side">
      {wide && (
        <section className="kl-col--photo" aria-label={t('lo.live')}>
          <LiveFrame />
        </section>
      )}
      <ProfileCard onEdit={() => setTab('profile')} />
      {wide && <Deck />}
    </aside>
  );

  return (
    <Kb
      ref={root}
      theme={themeFromSettings(theme)}
      className={`kl-root${wide ? ` is-wide${tab === 'play' ? ' has-hole' : ''}` : mid ? ' is-mid' : ' is-phone'}`}
    >
      <div className="kl-sheet-page">
        <Masthead full={mid} wide={wide} page={tab} onPage={setTab} />
        <Plate page={tab} inline={mid} />

        <AnimatePresence mode="wait" initial={false} custom={dir}>
          {mid && tab !== 'play' ? (
            <motion.main key={tab} className="kl-section" {...pageMotion}>
              <SectionPage page={tab} />
            </motion.main>
          ) : mid ? (
            <motion.main key="play" className={`kl-front${wide ? ' has-photo' : ''}`} {...pageMotion}>
              {tickets}
              {side}
            </motion.main>
          ) : (
            <motion.main key={tab} className="kl-phone-main" {...pageMotion}>
              {tab === 'play' ? (
                <>
                  <PendingBanner onCollect={collect} />
                  {tickets}
                  <ProfileCard onEdit={() => setTab('profile')} />
                </>
              ) : (
                <SectionPage page={tab} />
              )}
            </motion.main>
          )}
        </AnimatePresence>
        <Colophon onDocs={() => setTab('docs')} night={themeFromSettings(theme) === 'night'} />
      </div>

      {!mid && (
        <footer className="kl-dock">
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

/** The bell every arena shares: a sun badge on the departures board. */
function NextBell() {
  const t = useT();
  const round = useRound(null);
  if (!round) return null;
  const closed = round.phase === 'closing';
  return (
    <span className={`kl-bell${closed ? ' is-closed' : ''}`} aria-hidden="true">
      <SplitFlap text={formatCountdown(round.msLeft)} className="kl-bell__time num" />
      <span className="kl-bell__label mono">{closed ? t('lo.bell.closed') : t('lo.bell')}</span>
    </span>
  );
}

/** The plate caption under the masthead: which page of the book this is, and the arena's status. */
function Plate({ page, inline }: { page: LobbyPage; inline: boolean }) {
  const t = useT();
  const online = useUi((st) => st.online);
  const connected = useUi((st) => st.connected);
  const chain = useUi((st) => st.chain);
  const items = [
    chain?.enabled ? (chain.tokenReady ? t('lo.arenasOpen') : t('lo.arenasSoon')) : null,
    chain?.enabled ? t('lo.feeDate', { pct: bpsPercent(feeBps(chain.feeBps)) }) : null,
    connected ? t('lo.online', { n: online }) : t('lo.live.connecting'),
  ].filter((x): x is string => x !== null);
  const titles: Record<LobbyPage, TKey> = { play: 'lo.plate.play', ranks: 'lo.plate.ranks', profile: 'lo.plate.profile', docs: 'lo.plate.docs' };
  const numerals: Record<LobbyPage, string> = { play: 'III', ranks: 'V', profile: 'VI', docs: 'VII' };
  const status = (
    <ul className="kl-status" aria-label={t('lo.dateline')}>
      {items.map((x, i) => (
        <li key={x}>
          {i === 0 && chain?.enabled ? (
            <StatusPill tone={chain.tokenReady ? 'live' : 'warn'} size="sm">
              {x}
            </StatusPill>
          ) : (
            <span className="kl-status__item mono">{x}</span>
          )}
        </li>
      ))}
    </ul>
  );
  return (
    <div className="kl-plate">
      <PlateLabel numeral={numerals[page]} title={t(titles[page])} aside={inline ? status : undefined} />
      {!inline && status}
    </div>
  );
}

function SectionPage({ page }: { page: LobbyPage }) {
  if (page === 'ranks') return <Leaderboards />;
  if (page === 'profile') return <ProfilePage />;
  if (page === 'docs') return <DocsPage />;
  return null;
}

/** Left-to-right order of the lobby's pages (the page turn's direction). */
const PAGE_ORDER: readonly LobbyPage[] = ['play', 'ranks', 'profile', 'docs'];

const SECTIONS: { id: LobbyPage; key: 'lo.tickets' | 'lo.tab.ranks' | 'lo.tab.profile' | 'lo.tab.docs'; icon: IconName }[] = [
  { id: 'play', key: 'lo.tickets', icon: 'ticket' },
  { id: 'ranks', key: 'lo.tab.ranks', icon: 'trophy' },
  { id: 'profile', key: 'lo.tab.profile', icon: 'user' },
  { id: 'docs', key: 'lo.tab.docs', icon: 'docs' },
];

/** Desktop page tabs in the masthead: a sun sticker slides under the open page. */
function SectionNav({ page, onChange }: { page: LobbyPage; onChange: (p: LobbyPage) => void }) {
  const t = useT();
  const reduced = useReducedMotion();
  return (
    <nav className="kl-sections" aria-label={t('nav.sections')}>
      {SECTIONS.map((s) => {
        const on = s.id === page;
        return (
          <button
            key={s.id}
            type="button"
            className={`kl-sections__item${on ? ' is-on' : ''}`}
            aria-current={on ? 'page' : undefined}
            onClick={() => onChange(s.id)}
          >
            {on && <motion.span layoutId="kl-sections-ink" className="kl-sections__ink" transition={reduced ? { duration: 0 } : springs.pop} />}
            <Icon name={s.icon} size={18} />
            <span className="kl-sections__label">{t(s.key)}</span>
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
    { id: 'profile', label: t('lo.tab.profile'), icon: 'user' },
  ];
  return <Tabs variant="nav" items={items} value={tab} onChange={setTab} label={t('lo.nav')} className="kl-tabs" />;
}

/** The page footer: the ring's horizon with the link to the player guide (also at `/docs`). */
function Colophon({ onDocs, night }: { onDocs: () => void; night: boolean }) {
  const t = useT();
  return (
    <footer className="kl-colophon">
      <div className="kl-colophon__row">
        <span className="kl-colophon__name mono">
          <CoinMark size={22} />
          {t('lo.colophon')}
        </span>
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
      <Seigaiha rows={2} r={26} tone={night ? 'night' : 'day'} className="kl-colophon__waves" />
    </footer>
  );
}

/** A short note under the live window: how a round goes, with three coins acting it out. */
function Deck() {
  const t = useT();
  return (
    <div className="kl-deck">
      <div className="kl-deck__cast" aria-hidden="true">
        <CoinCharacter paint="sun" mood="chomp" size={58} bob />
        <CoinCharacter paint="foam" mood="scared" size={34} sweat />
      </div>
      <div>
        <h2 className="kl-deck__title">{t('lo.deck.title')}</h2>
        <p className="kl-deck__body">{t('lo.deck.body')}</p>
      </div>
    </div>
  );
}

function Masthead({ full, wide, page, onPage }: { full: boolean; wide: boolean; page: LobbyPage; onPage: (p: LobbyPage) => void }) {
  const t = useT();
  const s = useUi((st) => st.settings);
  return (
    <header className="kl-mast">
      <a className="kl-mast__brand" href="/" aria-label={t('lo.home')}>
        <CoinMark size={wide ? 44 : 36} />
        <Wordmark height={wide ? 40 : full ? 32 : 24} className="kl-mast__word" title="Elymum" />
        {wide && <span className="kl-mast__kicker mono">{t('lo.kicker')}</span>}
      </a>
      {full && <SectionNav page={page} onChange={onPage} />}
      <div className="kl-mast__right">
        {full && (
          <>
            <button
              type="button"
              className="kb-iconbtn"
              aria-label={`${t('lo.theme')}: ${s.theme === 'dark' ? t('lo.theme.night') : t('lo.theme.paper')}`}
              aria-pressed={s.theme === 'dark'}
              onClick={() => updateSettings({ theme: s.theme === 'dark' ? 'light' : 'dark' })}
            >
              <Icon name={s.theme === 'dark' ? 'moon' : 'sun'} size={20} />
            </button>
            <button type="button" className="kb-iconbtn" aria-label={t('lo.sound')} aria-pressed={s.sound} onClick={() => updateSettings({ sound: !s.sound })}>
              <Icon name={s.sound ? 'sound' : 'mute'} size={20} />
            </button>
          </>
        )}
        {full && (
          <button type="button" className="kb-iconbtn" aria-label={t('lo.settings')} onClick={() => openModal('settings')}>
            <Icon name="settings" size={20} />
          </button>
        )}
        <WalletButton />
      </div>
    </header>
  );
}
