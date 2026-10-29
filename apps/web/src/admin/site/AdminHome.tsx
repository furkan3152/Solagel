import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CoinCharacter, CoinMark, StatusPill, Tabs, TabPanel, tabId, type TabItem } from '../../design';
import { adminApi } from '../../site/api';
import { AdminPanel, type ChainTab } from '../AdminPanel';
import type { AdminNetwork } from '../net';
import { AdminSessionBar, useAdminSession, type OwnerRole } from './AdminSession';
import { CollabsTab } from './CollabsTab';
import { IntegrityTab } from './IntegrityTab';
import { PlayTab } from './PlayTab';
import { SettingsTab } from './SettingsTab';
import { TasksTab } from './TasksTab';
import { WlTab } from './WlTab';
import './admin-site.css';

export type AdminTab = ChainTab | 'play' | 'wl' | 'tasks' | 'collabs' | 'integrity' | 'settings';
const TABS: TabItem<AdminTab>[] = [
  { id: 'launch', label: 'Launch' },
  { id: 'deploy', label: 'Deploy' },
  { id: 'mint', label: 'Mint' },
  { id: 'arena', label: 'Arena' },
  { id: 'play', label: 'Play' },
  { id: 'wl', label: 'WL' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'collabs', label: 'Collabs' },
  { id: 'integrity', label: 'Integrity' },
  { id: 'settings', label: 'Settings' },
];
const IDS = TABS.map((t) => t.id);
const CHAIN_TABS: readonly AdminTab[] = ['launch', 'deploy', 'mint', 'arena'];
const fromHash = (): AdminTab => {
  const h = location.hash.replace(/^#/, '') as AdminTab;
  return IDS.includes(h) ? h : 'launch';
};

/** Each drawer's heading: a title and one honest line under it. */
const BENCH: Record<AdminTab, { title: string; lede: string }> = {
  launch: { title: 'Launch', lede: 'WL, then mint, then lunch. What is done, what is left, and which drawer fixes it.' },
  deploy: { title: 'Deploy', lede: 'Every contract leaves from your wallet, and your wallet becomes its owner. Read each preview like a contract, because it is one.' },
  mint: { title: 'Mint', lede: 'The phase, the allowlist, the $1 price and the small print of the Elymum NFT.' },
  arena: { title: 'Arena', lede: 'The token, the four tiers, the fee and the big red switches of ElymumArena.' },
  play: { title: 'Play', lede: 'Walk the floor as the admin wallet before anyone else does.' },
  wl: { title: 'Whitelist', lede: 'Who asked to come in, and what they did for it.' },
  tasks: { title: 'Tasks', lede: 'The chores applicants do before the feast.' },
  collabs: { title: 'Collabs', lede: 'Communities asking for spots, and the wallets they bring.' },
  integrity: { title: 'Integrity', lede: 'Farming, feeding and bots. Evidence for a person to weigh, never a verdict.' },
  settings: { title: 'Settings', lede: 'Who may play, which doors are open, and the X handle.' },
};

/** The network as a pill: MAINNET red, TESTNET sun, LOCALNET and no chain idle. */
export function NetPill({ net }: { net: AdminNetwork }) {
  if (!net.info)
    return (
      <StatusPill tone="danger" data-testid="net-pill">
        No chain
      </StatusPill>
    );
  const local = net.info.id === 31337 || /local/i.test(net.info.name);
  const tone = net.mainnet ? 'mainnet' : local ? 'idle' : 'testnet';
  const word = net.mainnet ? 'Mainnet' : local ? 'Localnet' : 'Testnet';
  return (
    <StatusPill tone={tone} data-testid="net-pill" title={`${net.info.name} (${net.info.id})`}>
      {word} · {net.info.id}
    </StatusPill>
  );
}

/**
 * `/admin`: the operator's workshop. A top bar (network, wallet, owner and admin badges), a rail
 * of drawers on the left and the open drawer on the right. The chain drawers (Launch, Deploy,
 * Mint, Arena; status for everyone, writes for the contract owner) sit above the site drawers.
 * The site drawers (and the server steps of the chain drawers: registering contracts, the
 * allowlist, the $1 price) need an admin session (SIWE with a wallet in ADMIN_WALLETS); every
 * call sends it as a Bearer token.
 */
export function AdminHome({ net, reloadNet }: { net: AdminNetwork; reloadNet: () => Promise<void> }) {
  const [tab, setTab] = useState<AdminTab>(fromHash);
  const [role, setRole] = useState<OwnerRole>({ arena: null, nft: null });
  const state = useAdminSession();
  const api = useMemo(() => (state.kind === 'admin' ? adminApi(state.session.token) : null), [state]);

  useEffect(() => {
    const on = () => setTab(fromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (t: AdminTab) => {
    setTab(t);
    history.replaceState(null, '', t === 'launch' ? location.pathname : `#${t}`);
  };
  // the rail is vertical on wide screens: Up / Down move too
  const onRailKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = IDS.indexOf(tab);
    const next = IDS[(i + (e.key === 'ArrowDown' ? 1 : -1) + IDS.length) % IDS.length];
    go(next);
    document.getElementById(tabId('ad', next))?.focus();
  };

  let panel: ReactNode;
  if (CHAIN_TABS.includes(tab)) panel = <AdminPanel net={net} api={api} tab={tab as ChainTab} go={go} reloadNet={reloadNet} onRole={setRole} />;
  else if (!api)
    panel = (
      <section className="ad-gate" role="status">
        <CoinCharacter paint="cream" mood="sleepy" size={96} feet />
        <div>
          <h2 className="ad-gate__title">{state.kind === 'checking' ? 'Checking the session…' : 'This drawer is locked.'}</h2>
          <p>The WL, collab, task, integrity and site settings drawers open for the admin wallet. Sign in at the top right: one free signature, no transaction.</p>
        </div>
      </section>
    );
  else if (tab === 'play') panel = <PlayTab api={api} />;
  else if (tab === 'wl') panel = <WlTab api={api} />;
  else if (tab === 'tasks') panel = <TasksTab api={api} />;
  else if (tab === 'collabs') panel = <CollabsTab api={api} />;
  else if (tab === 'integrity') panel = <IntegrityTab api={api} />;
  else panel = <SettingsTab api={api} />;

  const bench = BENCH[tab];
  const no = String(IDS.indexOf(tab) + 1).padStart(2, '0');

  return (
    <div className={`ad-shell${net.mainnet ? ' is-mainnet' : ''}`}>
      {net.mainnet && (
        <div className="ad-mainstrip mono" role="note">
          Mainnet · every signature here moves real HYPE
        </div>
      )}
      <header className="ad-top">
        <a className="ad-brand" href="/" aria-label="Elymum: back to the site">
          <CoinMark size={40} />
          <span className="ad-brand__text">
            <span className="ad-brand__name">Elymum</span>
            <span className="ad-brand__sub mono">Workshop</span>
          </span>
        </a>
        <div className="ad-top__net">
          <NetPill net={net} />
          {net.info && <span className="ad-top__chain">{net.info.name}</span>}
        </div>
        <AdminSessionBar state={state} role={role} />
      </header>
      <div className="ad-body">
        <nav className="ad-rail" aria-label="Admin drawers">
          <span className="ad-rail__group mono" aria-hidden="true">
            On chain
          </span>
          <Tabs items={TABS} value={tab} onChange={go} label="Admin sections" idBase="ad" className="ad-tabs" onKeyDown={onRailKey} />
          <a className="ad-rail__site" href="/">
            Back to the site
          </a>
        </nav>
        <main className="ad-main">
          <header className="ad-bench">
            <span className="kicker ad-bench__no">
              Drawer {no} · {CHAIN_TABS.includes(tab) ? 'on chain' : 'the site'}
            </span>
            <h1 className="ad-bench__title">{bench.title}</h1>
            <p className="ad-bench__lede">{bench.lede}</p>
          </header>
          <TabPanel idBase="ad" id={tab} className="ad-panel">
            {panel}
          </TabPanel>
        </main>
      </div>
    </div>
  );
}
