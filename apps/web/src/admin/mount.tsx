import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Kb, StampSpinner } from '../design';
import { AdminPanel } from './AdminPanel';
import { fetchServerChain, resolveNetwork, type AdminNetwork } from './net';

function AdminApp() {
  const [net, setNet] = useState<AdminNetwork | null>(null);
  useEffect(() => {
    let live = true;
    void fetchServerChain().then((chain) => live && setNet(resolveNetwork(chain)));
    return () => {
      live = false;
    };
  }, []);
  const wallets = useMemo(() => [], []);
  const theme = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'night' : 'paper';
  return (
    <Kb theme={theme} className="ad-root">
      {net ? (
        <ConnectionProvider endpoint={net.rpcUrl} config={{ commitment: 'confirmed' }}>
          <WalletProvider wallets={wallets} autoConnect onError={(e) => console.warn('wallet error', e)}>
            <AdminPanel net={net} />
          </WalletProvider>
        </ConnectionProvider>
      ) : (
        <div className="ad-page">
          <StampSpinner label="Loading" />
        </div>
      )}
    </Kb>
  );
}

/** `/admin`: the operator's panel, a separate lazily loaded entry (main.tsx), never linked from the lobby. */
export function mount(root: HTMLElement): void {
  document.title = 'Slana admin';
  createRoot(root).render(
    <StrictMode>
      <AdminApp />
    </StrictMode>,
  );
}
