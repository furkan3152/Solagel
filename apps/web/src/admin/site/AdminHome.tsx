import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { StampSpinner, Tabs, TabPanel, type TabItem } from '../../design';
import { adminApi } from '../../site/api';
import { AdminPanel } from '../AdminPanel';
import type { AdminNetwork } from '../net';
import { AdminSessionBar, useAdminSession } from './AdminSession';
import { CollabsTab } from './CollabsTab';
import { IntegrityTab } from './IntegrityTab';
import { PlayTab } from './PlayTab';
import { SettingsTab } from './SettingsTab';
import { TasksTab } from './TasksTab';
import { WlTab } from './WlTab';
import './admin-site.css';

export type AdminTab = 'chain' | 'play' | 'wl' | 'tasks' | 'collabs' | 'integrity' | 'settings';
const TABS: TabItem<AdminTab>[] = [
  { id: 'chain', label: 'Chain' },
  { id: 'play', label: 'Play' },
  { id: 'wl', label: 'WL' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'collabs', label: 'Collabs' },
  { id: 'integrity', label: 'Integrity' },
  { id: 'settings', label: 'Settings' },
];
const IDS = TABS.map((t) => t.id);
const fromHash = (): AdminTab => {
  const h = location.hash.replace(/^#/, '') as AdminTab;
  return IDS.includes(h) ? h : 'chain';
};

/**
 * `/admin`: the chain admin (unchanged) next to the slana.io tabs. The site tabs need an admin
 * session (SIWS with a wallet in ADMIN_WALLETS); every call sends it as a Bearer token.
 */
export function AdminHome({ net }: { net: AdminNetwork | null }) {
  const [tab, setTab] = useState<AdminTab>(fromHash);
  const state = useAdminSession();
  const api = useMemo(() => (state.kind === 'admin' ? adminApi(state.session.token) : null), [state]);

  useEffect(() => {
    const on = () => setTab(fromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (t: AdminTab) => {
    setTab(t);
    history.replaceState(null, '', t === 'chain' ? location.pathname : `#${t}`);
  };

  let panel: ReactNode;
  if (tab === 'chain') panel = net ? <AdminPanel net={net} embedded /> : <StampSpinner label="Loading" />;
  else if (!api)
    panel = (
      <section className="ad-gate" role="status">
        <h2 className="ad-gate__title">{state.kind === 'checking' ? 'Checking the session…' : 'Sign in as the admin'}</h2>
        <p>The WL, collab, task, integrity and site settings tabs need the admin wallet signed in (above).</p>
      </section>
    );
  else if (tab === 'play') panel = <PlayTab api={api} />;
  else if (tab === 'wl') panel = <WlTab api={api} />;
  else if (tab === 'tasks') panel = <TasksTab api={api} />;
  else if (tab === 'collabs') panel = <CollabsTab api={api} />;
  else if (tab === 'integrity') panel = <IntegrityTab api={api} />;
  else panel = <SettingsTab api={api} />;

  return (
    <div className="ad-page">
      <header className="ad-head">
        <div>
          <span className="mono ad-kicker">Slana · operator copy</span>
          <h1 className="ad-title">Admin panel</h1>
        </div>
        <a className="ad-note" href="/">
          slana.io
        </a>
      </header>
      <AdminSessionBar state={state} />
      <Tabs items={TABS} value={tab} onChange={go} label="Admin sections" idBase="ad" className="ad-tabs" />
      <TabPanel idBase="ad" id={tab} className="ad-panel">
        {panel}
      </TabPanel>
    </div>
  );
}
