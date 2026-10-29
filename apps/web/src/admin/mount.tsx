import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Kb, StampSpinner } from '../design';
import { initWallets } from '../wallet/store';
import { AdminHome } from './site/AdminHome';
import { fetchServerChain, resolveNetwork, type AdminNetwork } from './net';

function AdminApp() {
  const [net, setNet] = useState<AdminNetwork | null>(null);
  const reloadNet = useCallback(async () => setNet(resolveNetwork(await fetchServerChain({ fresh: true }))), []);
  useEffect(() => {
    initWallets();
    let live = true;
    void fetchServerChain().then((chain) => live && setNet(resolveNetwork(chain)));
    return () => {
      live = false;
    };
  }, []);
  const theme = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'night' : 'paper';
  return (
    <Kb theme={theme} className="ad-root">
      {net ? (
        <AdminHome net={net} reloadNet={reloadNet} />
      ) : (
        <div className="ad-page">
          <StampSpinner label="Loading" />
        </div>
      )}
    </Kb>
  );
}

/** `/admin`: the operator's panel (contracts + site tabs), a separate lazily loaded entry (main.tsx). */
export function mount(root: HTMLElement): void {
  document.title = 'Elymum admin';
  createRoot(root).render(
    <StrictMode>
      <AdminApp />
    </StrictMode>,
  );
}
