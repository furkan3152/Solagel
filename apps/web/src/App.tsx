import { useEffect, useRef } from 'react';
import { GameEngine } from './game/engine';
import { setEngine } from './game/instance';
import { useChainSync } from './solana/chain';
import { SolanaProvider } from './solana/provider';
import { useWalletAuth } from './solana/useWalletAuth';
import { useUi } from './store';
import { Kb, themeFromSettings } from './design';
import { Lobby } from './ui/Lobby';
import { Modals, Toasts } from './ui/Modals';
import { CashoutSheet, DeathSheet, GameHud, SettingsSheet } from './ui/game';

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

function Screens() {
  const screen = useUi((s) => s.screen);
  const theme = useUi((s) => s.settings.theme);
  return (
    <>
      {screen === 'lobby' && <Lobby />}
      {/* Kâğıt Bilet game view (the legacy lobby keeps its own styles until Task 14) */}
      <Kb theme={themeFromSettings(theme)} paper={false} className="g-root">
        {screen !== 'lobby' && <GameHud />}
        <DeathSheet />
        <CashoutSheet />
        <SettingsSheet />
      </Kb>
    </>
  );
}

export function App() {
  const theme = useUi((s) => s.settings.theme);
  const lang = useUi((s) => s.settings.lang);
  useEffect(() => {
    // uppercase mono labels follow the language rules (Turkish i → İ)
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#1A1330' : '#FFF6E9');
  }, [theme]);
  return (
    <SolanaProvider>
      <div className="app" data-theme={theme}>
        <GameCanvas />
        <ChainSync />
        <Screens />
        <Modals />
        <Toasts />
      </div>
    </SolanaProvider>
  );
}
