import type { SiteCounts, SiteSettings } from '@elymum/shared';
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CoinCharacter, CoinMark, StatusPill, Tabs, TabPanel, tabId, type TabItem } from '../../design';
import { adminApi } from '../../site/api';
import { AdminPanel, type ChainTab } from '../AdminPanel';
import { ADMIN_GROUPS, CHAIN_GROUPS, GROUP_LABEL, adminHash, groupSummary, parseAdminHash, type AdminGroup, type CommunityTab } from '../groups';
import type { AdminNetwork } from '../net';
import { SummaryBar } from '../SummaryBar';
import { AdminSessionBar, useAdminSession, type OwnerRole } from './AdminSession';
import { CollabsTab } from './CollabsTab';
import { IntegrityTab } from './IntegrityTab';
import { SettingsTab } from './SettingsTab';
import { TasksTab } from './TasksTab';
import { WlTab } from './WlTab';
import './admin-site.css';

export type AdminTab = AdminGroup;
const TABS: TabItem<AdminGroup>[] = ADMIN_GROUPS.map((id) => ({ id, label: GROUP_LABEL[id] }));
const IDS = TABS.map((t) => t.id);
const COMMUNITY_ITEMS: TabItem<CommunityTab>[] = [
  { id: 'wl', label: 'WL' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'collabs', label: 'Collabs' },
];

/** Each drawer's heading: a title and one honest line under it. */
const BENCH: Record<AdminGroup, { title: string; lede: string }> = {
  network: { title: 'Network', lede: 'The chain the server follows, its RPC, the server key, the contracts, and the way to mainnet.' },
  setup: { title: 'Setup', lede: 'Every contract leaves from your wallet, and your wallet becomes its owner. Then the emblem perks and the TestToken.' },
  mint: { title: 'Mint', lede: 'Start and stop the mint, the allowlist, the $1 price and the small print of the Elymum NFT.' },
  game: { title: 'Game', lede: 'Who may play, the arena switches, the bots and the rooms right now.' },
  community: { title: 'Community', lede: 'The WL, the chores applicants do, and the communities asking for spots.' },
  safety: { title: 'Safety', lede: 'Farming, feeding and collusion. Evidence for a person to weigh, never a verdict.' },
  settings: { title: 'Settings', lede: 'Who may play (the same switch as in Game), which doors are open, and the X handle.' },
};

import { NetPill } from '../NetPill';

export { NetPill };

/**
 * `/admin`: the operator's workshop. A top bar (network, wallet, owner and admin badges), a rail
 * of drawers on the left and the open drawer on the right. The chain drawers (Launch, Deploy,
 * Mint, Arena; status for everyone, writes for the contract owner) sit above the site drawers.
 * The site drawers (and the server steps of the chain drawers: registering contracts, the
 * allowlist, the $1 price) need an admin session (SIWE with a wallet in ADMIN_WALLETS); every
 * call sends it as a Bearer token.
 */
export function AdminHome({ net, reloadNet }: { net: AdminNetwork; reloadNet: () => Promise<void> }) {
  const [tab, setTab] = useState<AdminGroup>(() => parseAdminHash(location.hash).group);
  const [sub, setSub] = useState<CommunityTab>(() => parseAdminHash(location.hash).sub);
  const [role, setRole] = useState<OwnerRole>({ arena: null, nft: null });
  const state = useAdminSession();
  const api = useMemo(() => (state.kind === 'admin' ? adminApi(state.session.token) : null), [state]);

  useEffect(() => {
    const on = () => {
      const h = parseAdminHash(location.hash);
      setTab(h.group);
      setSub(h.sub);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  /** Opens a drawer; old drawer ids (the launch checklist's links: deploy, arena, wl…) land in their group. */
  const go = (t: string, s?: CommunityTab) => {
    const h = (ADMIN_GROUPS as readonly string[]).includes(t) ? { group: t as AdminGroup, sub: s ?? sub } : parseAdminHash(`#${t}`);
    setTab(h.group);
    setSub(h.sub);
    history.replaceState(null, '', adminHash(h.group, h.sub) || location.pathname);
  };
  // the site drawers' opening lines read the server's counts and settings
  const [siteInfo, setSiteInfo] = useState<{ counts: SiteCounts | null; settings: SiteSettings | null }>({ counts: null, settings: null });
  useEffect(() => {
    if (!api || CHAIN_GROUPS.includes(tab)) return;
    let live = true;
    void Promise.all([api.counts().catch(() => null), api.settings().then((r) => r.settings).catch(() => null)]).then(([counts, settings]) => live && setSiteInfo({ counts, settings }));
    return () => {
      live = false;
    };
  }, [api, tab]);
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
  if (CHAIN_GROUPS.includes(tab)) panel = <AdminPanel net={net} api={api} tab={tab as ChainTab} go={(t) => go(t)} reloadNet={reloadNet} onRole={setRole} />;
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
  else if (tab === 'community')
    panel = (
      <>
        <SummaryBar summary={groupSummary('community', { net, status: null, counts: siteInfo.counts })} />
        <Tabs items={COMMUNITY_ITEMS} value={sub} onChange={(s) => go('community', s)} label="Community" idBase="ad-com" className="ad-subtabs" />
        <TabPanel idBase="ad-com" id={sub} className="ad-subpanel">
          {sub === 'wl' ? <WlTab api={api} /> : sub === 'tasks' ? <TasksTab api={api} /> : <CollabsTab api={api} />}
        </TabPanel>
      </>
    );
  else if (tab === 'safety')
    panel = (
      <>
        <SummaryBar summary={groupSummary('safety', { net, status: null })} />
        <IntegrityTab api={api} />
      </>
    );
  else
    panel = (
      <>
        <SummaryBar summary={groupSummary('settings', { net, status: null, settings: siteInfo.settings })} />
        <SettingsTab api={api} />
      </>
    );

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
          <Tabs items={TABS} value={tab} onChange={go} label="Admin sections" idBase="ad" className="ad-tabs" onKeyDown={onRailKey} />
          <a className="ad-rail__site" href="/">
            Back to the site
          </a>
        </nav>
        <main className="ad-main">
          <header className="ad-bench">
            <span className="kicker ad-bench__no">
              Drawer {no} · {CHAIN_GROUPS.includes(tab) ? 'on chain' : 'the site'}
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
