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
        <span className="beta-pill">SOL BETA</span>
        <span className="pill">
          <span className={`dot ${connected ? '' : 'off'}`} />
          {connected ? t('lobby.online', { n: online }) : t('lobby.connecting')}
        </span>
      </div>
      <div className="topbar-right">
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
  const paused = useUi((s) => s.admissionsPaused);
  const free = rooms.filter((r) => r.mode === 'free').sort((a, b) => b.players - a.players)[0];
  return (
    <div className="mode-panel">
      <button className="btn btn-gold btn-xl" disabled={!connected || paused} onClick={() => onPlay('free')}>
        ▶ {t('lobby.playFree')}
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
  const paused = useUi((s) => s.admissionsPaused);
  return (
    <div className="mode-panel">
      <div className="muted small center">{t('lobby.privateDesc')}</div>
      <button className="btn btn-pink" disabled={!connected || paused} onClick={() => onPlay('private:new')}>
        ✨ {t('lobby.createRoom')}
      </button>
      <div className="row">
        <input
          className="input"
          value={code}
          maxLength={5}
          placeholder={t('lobby.code')}
          aria-label="Private practice room code"
          style={{ textTransform: 'uppercase', letterSpacing: 4, textAlign: 'center' }}
          onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && connected && !paused && code.length === 5 && onPlay(`private:${code}`)}
        />
        <button className="btn btn-sky" disabled={code.length !== 5 || !connected || paused} onClick={() => onPlay(`private:${code}`)}>
          {t('lobby.joinRoom')}
        </button>
      </div>
    </div>
  );
}

function ReleaseRoadmap() {
  const release = useUi((s) => s.release);
  const tokenLive = release.token.status === 'launched';
  return (
    <section className="card side-card release-card" aria-labelledby="release-title">
      <h2 className="side-title" id="release-title">✦ Little coins, big plans</h2>
      <ol className="release-steps">
        <li>
          <span className="release-icon release-now" aria-hidden="true">◎</span>
          <div>
            <div className="release-heading">SOL beta <span className="badge mint">NOW</span></div>
            <p>Enter with SOL. Gobble rivals, grow your value, and cash out. Join an ongoing arena at any time.</p>
          </div>
        </li>
        <li>
          <span className="release-icon release-token" aria-hidden="true">✧</span>
          <div>
            <div className="release-heading">{release.token.symbol || 'Game token'} <span className="badge sky">{tokenLive ? 'TOKEN LIVE' : 'NEXT'}</span></div>
            <p>{tokenLive ? 'Token launched. Arenas still use SOL while token gameplay is prepared.' : `The token comes first: launch on ${release.token.platform}, then game integration. Beta entry and payouts remain in SOL.`}</p>
            {tokenLive && release.token.launchUrl && <a className="small" href={release.token.launchUrl} target="_blank" rel="noreferrer">Official token ↗</a>}
          </div>
        </li>
        <li>
          <span className="release-icon release-nft" aria-hidden="true">✿</span>
          <div>
            <div className="release-heading">NFT character skins <span className="badge pink">AFTER TOKEN</span></div>
            <p>A free mint is planned on {release.nft.platform} after the token launch. Your NFT will unlock a cosmetic round-character skin once collection ownership is connected.</p>
          </div>
        </li>
      </ol>
      <div className="release-note">SOL beta → token launch → NFT skins. NFT minting and token gameplay are not active in the game yet. Free mint excludes network fees.</div>
    </section>
  );
}

export function Lobby() {
  const t = useT();
  const [mode, setMode] = useState<Mode>('stakes');
  const settings = useUi((s) => s.settings);
  const auth = useUi((s) => s.auth);
  const paused = useUi((s) => s.admissionsPaused);
  const own = useOwnership();
  const verifiedName = auth?.profile?.name;

  const play = (room: string) => {
    if (useUi.getState().admissionsPaused && !room.startsWith('stake:')) return;
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
              aria-label={t('lobby.name')}
              onChange={(e) => updateSettings({ name: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && mode === 'free' && play('free')}
              style={{ textAlign: 'center' }}
            />
            <SkinPicker />
            {paused && <div className="notice" role="status">New games are temporarily paused. Active games, reconnects and cash-outs remain available.</div>}
            <div className="tabs" aria-label="Game mode">
              <button className={`tab ${mode === 'stakes' ? 'active' : ''}`} aria-pressed={mode === 'stakes'} onClick={() => setMode('stakes')}>
                ◎ {t('lobby.tab.stakes')}
              </button>
              <button className={`tab ${mode === 'free' ? 'active' : ''}`} aria-pressed={mode === 'free'} onClick={() => setMode('free')}>
                🎮 {t('lobby.tab.free')}
              </button>
              <button className={`tab ${mode === 'private' ? 'active' : ''}`} aria-pressed={mode === 'private'} onClick={() => setMode('private')}>
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
          <ReleaseRoadmap />
        </div>
      </div>
      <div className="keys">
        <span className="kbd">Space</span> {t('hud.split')} · <span className="kbd">W</span> {t('hud.eject')} · <span className="kbd">1–8</span>{' '}
        {t('hud.emotes')} · <span className="kbd">Enter</span> chat · <span className="kbd">C</span> {t('hud.cashout')} · <a href="/admin">Admin</a>
      </div>
    </div>
  );
}
