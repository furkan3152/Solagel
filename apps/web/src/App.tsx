import { useEffect, useRef } from 'react';
import { GameEngine } from './game/engine';
import { setEngine } from './game/instance';
import { useChainSync } from './solana/chain';
import { SolanaProvider } from './solana/provider';
import { useWalletAuth } from './solana/useWalletAuth';
import { useUi } from './store';
import { AnimatePresence } from 'motion/react';
import { Kb, ScreenTransition, themeFromSettings, type Box } from './design';
import { Lobby } from './ui/lobby/Lobby';
import { Toasts } from './ui/Toasts';
import { WalletModal } from './solana/WalletModal';
import { CashoutSheet, DeathSheet, GameHud, HowToSheet, SettingsSheet } from './ui/game';

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
  const theme = useUi((s) => s.settings.theme);
  const quality = useUi((s) => s.settings.quality);
  return (
    <>
      <canvas ref={ref} className="game-canvas" />
      {/* paper grain over the world: a static composited layer (a per-frame canvas fill cost ~10 fps) */}
      {quality === 'high' && <div className="kb g-grain" data-theme={themeFromSettings(theme)} aria-hidden="true" />}
    </>
  );
}

function ChainSync() {
  useChainSync();
  useWalletAuth();
  return null;
}

/** The lobby's front-page photo (the window onto the live world), when the paper has one. */
function lobbyWindow(): Box | null {
  const el = document.querySelector('.kl-root.has-hole .kl-live__window');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
}

function Screens() {
  const screen = useUi((s) => s.screen);
  const theme = useUi((s) => s.settings.theme);
  return (
    <>
      {/* lobby ↔ game: the paper wipes open onto the world and closes around it on the way back */}
      <ScreenTransition show={screen === 'lobby'} home={lobbyWindow}>
        <Lobby />
      </ScreenTransition>
      {/* Paper Ticket game view, sheets and toasts (portalled; themed from this root) */}
      <Kb theme={themeFromSettings(theme)} paper={false} className="g-root">
        <AnimatePresence>{screen !== 'lobby' && <GameHud key="hud" />}</AnimatePresence>
        <DeathSheet />
        <CashoutSheet />
        <SettingsSheet />
        <HowToSheet />
        <WalletModal />
        <Toasts />
      </Kb>
    </>
  );
}

export function App() {
  const theme = useUi((s) => s.settings.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#1B1924' : '#F1EADB');
  }, [theme]);
  return (
    <SolanaProvider>
      <div className="app" data-theme={theme}>
        <GameCanvas />
        <ChainSync />
        <Screens />
      </div>
    </SolanaProvider>
  );
}
