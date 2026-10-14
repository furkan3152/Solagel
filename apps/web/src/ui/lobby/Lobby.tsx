import { useWallet } from '@solana/wallet-adapter-react';
import { useEffect, useState } from 'react';
import { Chip, Dateline, Icon, Kb, Rule, Sheet, Tabs, themeFromSettings, type TabItem } from '../../design';
import { engine } from '../../game/instance';
import { sound } from '../../game/sound';
import { useT } from '../../i18n';
import { useChainData } from '../../solana/chain';
import { ProfileCard } from '../../solana/ProfileCard';
import { signInWithWallet } from '../../solana/siws';
import { TicketFlow, type FlowMode } from '../../solana/TicketFlow';
import type { TicketKey } from '../../solana/ticket';
import { WalletButton } from '../../solana/WalletButton';
import { openModal, updateSettings, useUi } from '../../store';
import { LiveFrame } from './LiveFrame';
import './lobby.css';
import { PassCard, PassDesk } from './PassCard';
import { PendingBanner } from './PendingBanner';
import { QuickPlay } from './QuickPlay';
import { SeasonColumn } from './SeasonColumn';
import { TicketList } from './TicketList';
import { useLobbyModel, useMedia, useTokenText } from './useLobby';

type Tab = 'play' | 'ranks' | 'pass' | 'profile';

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
  const [tab, setTab] = useState<Tab>('play');
  const [flow, setFlow] = useState<{ mode: FlowMode; key: TicketKey; open: boolean } | null>(null);
  const [passSheet, setPassSheet] = useState(false);

  const has = (k: TicketKey | null | undefined): k is TicketKey => !!k && model.tickets.some((x) => x.key === k);
  const selectedKey: TicketKey = has(picked) ? picked : model.quick;
  const ticket = model.tickets.find((x) => x.key === selectedKey);
  const gate = model.gates[selectedKey];

  // "Yeni bilet" from the death / receipt sheets: select that ticket, open its confirm sheet
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
        sound.click();
        engine()?.play('practice');
        return;
      case 'connect':
        openModal('wallet');
        return;
      case 'verify':
        void signInWithWallet(wallet, true);
        return;
      case 'resume': {
        sound.click();
        const s = id !== null ? model.sessions[id] : null;
        updateSettings({ lastArena: id });
        // no transaction: the ticket is already open on chain
        engine()?.play(`arena:${id}`, s?.hasPass && s.passAsset ? { pass: s.passAsset } : {});
        return;
      }
      case 'needAta':
        setFlow({ mode: 'ata', key: ticket.key, open: true });
        return;
      case 'refund':
        setFlow({ mode: 'refund', key: ticket.key, open: true });
        return;
      case 'needPass':
        if (mid) setPassSheet(true);
        else setTab('pass');
        return;
      case 'buy':
        setFlow({ mode: 'buy', key: ticket.key, open: true });
        return;
      default:
        return;
    }
  };

  const createAta = () => {
    const pending = useChainData.getState().pending.find((p) => p.needsTokenAccount);
    const key = (pending?.arenaId != null ? `arena:${pending.arenaId}` : model.tickets.find((x) => x.arenaId !== null)?.key) as TicketKey | undefined;
    if (key) setFlow({ mode: 'ata', key, open: true });
  };

  const flowTicket = flow ? (model.tickets.find((x) => x.key === flow.key) ?? null) : null;

  const tickets = (
    <section className="kl-col kl-col--tickets" aria-labelledby="kl-tickets-h">
      {mid && <PendingBanner onCreateAta={createAta} />}
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
        <PassCard onApply={() => setPassSheet(true)} />
      </div>
      <SeasonColumn limit={wide ? 6 : 10} />
      <ProfileCard />
    </aside>
  );

  return (
    <Kb theme={themeFromSettings(theme)} className={`kl-root${wide ? ' is-wide has-hole' : mid ? ' is-mid' : ' is-phone'}`}>
      <div className="kl-sheet-page">
        <Masthead full={mid} wide={wide} />

        {mid ? (
          <main className={`kl-front${wide ? ' has-photo' : ''}`}>
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
          </main>
        ) : (
          <main className="kl-phone-main">
            {tab === 'play' && (
              <>
                <PendingBanner onCreateAta={createAta} />
                <PassCard onApply={() => setTab('pass')} />
                {tickets}
              </>
            )}
            {tab === 'ranks' && <SeasonColumn />}
            {tab === 'pass' && <PassDesk />}
            {tab === 'profile' && <ProfileCard />}
          </main>
        )}
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

      <Sheet
        open={passSheet && mid}
        onClose={() => setPassSheet(false)}
        closeLabel={t('lo.close')}
        kicker={t('lo.tab.pass')}
        title={t('lo.pass.perks')}
        className="kl-sheet"
      >
        <PassDesk />
      </Sheet>
      <TicketFlow open={!!flow?.open} mode={flow?.mode ?? 'buy'} ticket={flowTicket} onClose={() => setFlow((f) => (f ? { ...f, open: false } : f))} />
    </Kb>
  );
}

function PhoneTabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const t = useT();
  const items: TabItem<Tab>[] = [
    { id: 'play', label: t('lo.tab.play'), icon: 'ticket' },
    { id: 'ranks', label: t('lo.tab.ranks'), icon: 'trophy' },
    { id: 'pass', label: t('lo.tab.pass'), icon: 'passport' },
    { id: 'profile', label: t('lo.tab.profile'), icon: 'user' },
  ];
  return <Tabs variant="nav" items={items} value={tab} onChange={setTab} label={t('lo.nav')} className="kl-tabs" />;
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
  const today = new Date().toLocaleDateString(s.lang === 'tr' ? 'tr-TR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

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
              <div className="kl-seg" role="group" aria-label={t('lo.lang')}>
                <Chip selected={s.lang === 'tr'} onClick={() => updateSettings({ lang: 'tr' })} lang="tr" aria-label="Türkçe">
                  TR
                </Chip>
                <Chip selected={s.lang === 'en'} onClick={() => updateSettings({ lang: 'en' })} lang="en" aria-label="English">
                  EN
                </Chip>
              </div>
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
