import { NIGHT, PAPER } from '@elymum/shared';
import { useEffect, useRef } from 'react';
import { startAudio } from './audio';
import { GameEngine } from './game/engine';
import { setEngine } from './game/instance';
import { useChainSync } from './wallet/chain';
import { useWalletAuth } from './wallet/useWalletAuth';
import { useUi } from './store';
import { AnimatePresence } from 'motion/react';
import { Kb, ScreenTransition, themeFromSettings, type Box } from './design';
import { Lobby } from './ui/lobby/Lobby';
import { Toasts } from './ui/Toasts';
import { WalletModal } from './wallet/WalletModal';
import { BellMoment, DeathMoment, DeathSheet, GameHud, HowToSheet, RoundOverSheet, SettingsSheet } from './ui/game';
import { GameClosedSheet } from './ui/gate/GameClosedSheet';

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
  // the floor is drawn flat, like the picture book: no grain over it
  return <canvas ref={ref} className="game-canvas" />;
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
      {/* lobby <-> game: the page opens onto the world and closes around it on the way back */}
      <ScreenTransition show={screen === 'lobby'} home={lobbyWindow}>
        <Lobby />
      </ScreenTransition>
      {/* the HUD stickers, sheets and toasts (portalled; themed from this root) */}
      <Kb theme={themeFromSettings(theme)} paper={false} className="g-root">
        <AnimatePresence>{screen !== 'lobby' && <GameHud key="hud" />}</AnimatePresence>
        {/* the eater's mouth and the bell: beats over the world before their sheets */}
        <DeathMoment />
        <BellMoment />
        <DeathSheet />
        <RoundOverSheet />
        <SettingsSheet />
        <HowToSheet />
        <WalletModal />
        <GameClosedSheet />
        <Toasts />
      </Kb>
    </>
  );
}

export function App() {
  const theme = useUi((s) => s.settings.theme);
  // sound: levels from settings, music by screen, paper sounds on every control (silent until a gesture)
  useEffect(() => startAudio(), []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? NIGHT.paper : PAPER);
  }, [theme]);
  return (
    <div className="app" data-theme={theme}>
      <GameCanvas />
      <ChainSync />
      <Screens />
    </div>
  );
}
