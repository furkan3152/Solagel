import { isSkinUnlocked, sanitizeName } from '@solagel/shared';
import { useState } from 'react';
import { engine } from '../game/instance';
import { sound } from '../game/sound';
import { useT } from '../i18n';
import { ProfileCard } from '../solana/ProfileCard';
import { StakePanel } from '../solana/StakePanel';
import { WalletButton } from '../solana/WalletButton';
import { openModal, toast, updateSettings, useUi } from '../store';
import { Logo } from './common';
import { LeaderboardsCard } from './Leaderboards';
import { SkinPicker, useOwnership } from './SkinPicker';

type Mode = 'free' | 'stakes' | 'private';

function TopBar() {
  const t = useT();
  const online = useUi((s) => s.online);
  const connected = useUi((s) => s.connected);
  const settings = useUi((s) => s.settings);
  return (
    <div className="topbar">
      <div className="row">
        <span className="pill">
          <span className={`dot ${connected ? '' : 'off'}`} />
          {connected ? t('lobby.online', { n: online }) : <span className="hide-sm">{t('lobby.connecting')}</span>}
        </span>
      </div>
      <div className="topbar-right">
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => updateSettings({ lang: settings.lang === 'tr' ? 'en' : 'tr' })}
          aria-label={t('settings.lang')}
        >
          {settings.lang === 'tr' ? '🇹🇷' : '🇬🇧'}
          <span className="hide-sm">{settings.lang === 'tr' ? 'TR' : 'EN'}</span>
        </button>
        <button className="btn btn-icon btn-ghost" onClick={() => updateSettings({ sound: !settings.sound })} aria-label={t('settings.sound')}>
          {settings.sound ? '🔊' : '🔈'}
        </button>
        <button className="btn btn-icon btn-ghost" onClick={() => openModal('settings')} aria-label={t('settings.title')}>
          ⚙️
        </button>
        <WalletButton />
      </div>
    </div>
  );
}

function FreePanel({ onPlay }: { onPlay: (room: string) => void }) {
  const t = useT();
  const rooms = useUi((s) => s.rooms);
  const connected = useUi((s) => s.connected);
  const free = rooms.filter((r) => r.mode === 'free').sort((a, b) => b.players - a.players)[0];
  return (
    <div className="mode-panel">
      <button className="btn btn-gold btn-xl" disabled={!connected} onClick={() => onPlay('free')}>
        ▶ {t('lobby.play')}
      </button>
      {free && (
        <div className="room-line">
          <span className="dot" /> {free.name} · {t('lobby.roomLine', { p: free.players, b: free.bots })}
        </div>
      )}
      <div className="muted small center">{t('lobby.freeDesc')}</div>
    </div>
  );
}

function PrivatePanel({ onPlay }: { onPlay: (room: string) => void }) {
  const t = useT();
  const [code, setCode] = useState('');
  const connected = useUi((s) => s.connected);
  return (
    <div className="mode-panel">
      <div className="muted small center">{t('lobby.privateDesc')}</div>
      <button className="btn btn-pink" disabled={!connected} onClick={() => onPlay('private:new')}>
        ✨ {t('lobby.createRoom')}
      </button>
      <div className="row">
        <input
          className="input"
          value={code}
          maxLength={5}
          placeholder={t('lobby.code')}
          style={{ textTransform: 'uppercase', letterSpacing: 4, textAlign: 'center' }}
          onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && code.length === 5 && onPlay(`private:${code}`)}
        />
        <button className="btn btn-sky" disabled={code.length !== 5 || !connected} onClick={() => onPlay(`private:${code}`)}>
          {t('lobby.joinRoom')}
        </button>
      </div>
    </div>
  );
}

export function Lobby() {
  const t = useT();
  const [mode, setMode] = useState<Mode>('free');
  const settings = useUi((s) => s.settings);
  const auth = useUi((s) => s.auth);
  const own = useOwnership();
  const verifiedName = auth?.profile?.name;

  const play = (room: string) => {
    sound.click();
    if (!isSkinUnlocked(settings.skin, own)) {
      toast('warn', t('err.skin_locked'));
      openModal('shop');
      return;
    }
    const name = sanitizeName(settings.name, '');
    updateSettings({ name });
    engine()?.play(room);
  };

  return (
    <div className="lobby">
      <TopBar />
      <div className="lobby-grid">
        <div className="side-left">
          <LeaderboardsCard />
        </div>
        <div className="main-col">
          <div className="card lobby-main">
            <div className="hero">
              <Logo big />
              <div className="tagline">{t('brand.tagline')}</div>
            </div>
            <input
              className="input"
              value={verifiedName ?? settings.name}
              disabled={!!verifiedName}
              maxLength={16}
              placeholder={t('lobby.name')}
              onChange={(e) => updateSettings({ name: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && mode === 'free' && play('free')}
              style={{ textAlign: 'center' }}
            />
            <SkinPicker />
            <div className="tabs">
              <button className={`tab ${mode === 'free' ? 'active' : ''}`} onClick={() => setMode('free')}>
                🎮 {t('lobby.tab.free')}
              </button>
              <button className={`tab ${mode === 'stakes' ? 'active' : ''}`} onClick={() => setMode('stakes')}>
                ◎ {t('lobby.tab.stakes')}
              </button>
              <button className={`tab ${mode === 'private' ? 'active' : ''}`} onClick={() => setMode('private')}>
                👯 {t('lobby.tab.private')}
              </button>
            </div>
            {mode === 'free' && <FreePanel onPlay={play} />}
            {mode === 'stakes' && <StakePanel onPlay={play} />}
            {mode === 'private' && <PrivatePanel onPlay={play} />}
            <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-ghost" onClick={() => engine()?.watch()}>
                👀 {t('lobby.spectate')}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => openModal('howto')}>
                ❓ {t('lobby.howto')}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => openModal('shop')}>
                🎨 {t('skins.shop')}
              </button>
            </div>
          </div>
        </div>
        <div className="side-right">
          <ProfileCard />
        </div>
      </div>
      <div className="keys">
        <span className="kbd">Space</span> {t('hud.split')} · <span className="kbd">W</span> {t('hud.eject')} · <span className="kbd">1–8</span>{' '}
        {t('hud.emotes')} · <span className="kbd">Enter</span> chat · <span className="kbd">C</span> {t('hud.cashout')}
      </div>
    </div>
  );
}
