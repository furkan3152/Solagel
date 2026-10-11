import { lazy, Suspense, useEffect, useRef } from 'react';
import { RuntimeConfig } from './RuntimeConfig';
import { GameEngine } from './game/engine';
import { setEngine } from './game/instance';
import { useChainSync } from './solana/chain';
import { SolanaProvider } from './solana/provider';
import { useWalletAuth } from './solana/useWalletAuth';
import { useUi } from './store';
import { Hud } from './ui/Hud';
import { Lobby } from './ui/Lobby';
import { CashoutModal, DeathModal, Modals, Toasts } from './ui/Modals';

const AdminPanel = lazy(() => import('./admin/AdminPanel').then((m) => ({ default: m.AdminPanel })));
const adminMode = window.location.pathname.replace(/\/+$/, '') === '/admin';

function AdminChainSync() { useChainSync(); return null; }

function GameCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const engine = new GameEngine(ref.current!);
    setEngine(engine);
    return () => {
      setEngine(null);
      engine.destroy();
    };
  }, []);
  return <canvas ref={ref} className="game-canvas" />;
}

function ChainSync() {
  useChainSync();
  useWalletAuth();
  return null;
}

function Screens() {
  const screen = useUi((s) => s.screen);
  return (
    <>
      {screen === 'lobby' && <Lobby />}
      {(screen === 'playing' || screen === 'spectating' || screen === 'dead' || screen === 'cashedout') && <Hud />}
      {screen === 'dead' && <DeathModal />}
      {screen === 'cashedout' && <CashoutModal />}
    </>
  );
}

export function App() {
  const theme = useUi((s) => s.settings.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#1A1330' : '#FFF6E9');
  }, [theme]);
  return (
    <SolanaProvider>
      <div className="app" data-theme={theme}>
        <RuntimeConfig admin={adminMode} />
        {adminMode ? (
          <>
            <AdminChainSync />
            <Suspense fallback={<div className="notice">Loading admin console…</div>}><AdminPanel /></Suspense>
          </>
        ) : (
          <><GameCanvas /><ChainSync /><Screens /><Modals /></>
        )}
        <Toasts />
      </div>
    </SolanaProvider>
  );
}
