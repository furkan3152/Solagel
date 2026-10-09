import { EMOTES, PowerUpType, RULES, formatSol, getSkin } from '@solagel/shared';
import { useEffect, useRef, useState } from 'react';
import { engine } from '../game/instance';
import { useT } from '../i18n';
import { useUi } from '../store';
import { compact, useTicker } from './common';

const PU_ICON: Record<PowerUpType, string> = {
  [PowerUpType.Magnet]: '🧲',
  [PowerUpType.Pump]: '🚀',
  [PowerUpType.Shield]: '🛡️',
  [PowerUpType.Bag]: '💰',
};
const PU_MS: Record<PowerUpType, number> = {
  [PowerUpType.Magnet]: RULES.magnetMs,
  [PowerUpType.Pump]: RULES.pumpMs,
  [PowerUpType.Shield]: RULES.shieldMs,
  [PowerUpType.Bag]: 1,
};

const isTouch = () => typeof window !== 'undefined' && window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;

function ScoreCard() {
  const t = useT();
  const hud = useUi((s) => s.hud);
  const room = useUi((s) => s.room);
  const screen = useUi((s) => s.screen);
  if (screen !== 'playing') return null;
  return (
    <div className="card score-card">
      <div className="score-label">{t('hud.mass')}</div>
      <div className="score-big">{compact(hud.mass)}</div>
      <div className="small muted" style={{ fontWeight: 600 }}>
        {t('hud.rank')} #{hud.rank || '–'} / {hud.players}
      </div>
      {room?.mode === 'stake' && hud.value !== null && <div className="value-chip">{formatSol(hud.value)}</div>}
      {room?.mode === 'private' && room.code && (
        <button className="btn btn-sm btn-ghost" style={{ marginTop: 6 }} onClick={() => navigator.clipboard?.writeText(room.code!)}>
          🔑 {room.code}
        </button>
      )}
    </div>
  );
}

function LiveLeaderboard() {
  const t = useT();
  const lb = useUi((s) => s.lb);
  const me = useUi((s) => s.me);
  const screen = useUi((s) => s.screen);
  const hud = useUi((s) => s.hud);
  const room = useUi((s) => s.room);
  const inTop = lb.some((e) => e.pid === me?.pid);
  return (
    <div className="card live-lb">
      <h4>
        <span>👑 {t('hud.top')}</span>
        <span className="muted small">{t('hud.players', { n: hud.players })}</span>
      </h4>
      {lb.map((e, i) => (
        <div key={e.pid} className={`live-row ${screen === 'playing' && e.pid === me?.pid ? 'me' : ''}`}>
          <span style={{ fontWeight: 700 }}>{i + 1}.</span>
          <span className="swatch" style={{ background: getSkin(e.skin).colors.base }} />
          <span className="lb-name">
            {e.name}
            {e.verified ? ' ✓' : ''}
          </span>
          <span className="lb-score">{room?.mode === 'stake' && e.value !== undefined ? formatSol(e.value) : compact(e.score)}</span>
        </div>
      ))}
      {screen === 'playing' && !inTop && hud.rank > 0 && (
        <div className="live-row me">
          <span style={{ fontWeight: 700 }}>{hud.rank}.</span>
          <span className="swatch" style={{ background: getSkin(me?.skin ?? 0).colors.base }} />
          <span className="lb-name">{me?.name}</span>
          <span className="lb-score">{compact(hud.mass)}</span>
        </div>
      )}
    </div>
  );
}

function Minimap() {
  const ref = useRef<HTMLCanvasElement>(null);
  const show = useUi((s) => s.settings.showMinimap);
  useEffect(() => {
    engine()?.setMinimap(show ? ref.current : null);
    return () => engine()?.setMinimap(null);
  }, [show]);
  if (!show) return null;
  return (
    <div className="card minimap">
      <canvas ref={ref} />
    </div>
  );
}

function Feed() {
  const t = useT();
  const killfeed = useUi((s) => s.killfeed);
  const chat = useUi((s) => s.chat);
  const chatOpen = useUi((s) => s.chatOpen);
  const showChat = useUi((s) => s.settings.showChat);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chat]);
  useEffect(() => {
    if (chatOpen) inputRef.current?.focus();
  }, [chatOpen]);

  const send = () => {
    engine()?.chat(text);
    setText('');
    useUi.setState({ chatOpen: false });
  };

  return (
    <div className="feed">
      {killfeed.map((k) => (
        <div key={k.id} className="kill">
          <span className="swatch" style={{ background: getSkin(k.killerSkin).colors.base }} />
          <b>{k.killer}</b>
          <span>{k.cause === 'virus' ? '🌵' : '😋'}</span>
          <span className="swatch" style={{ background: getSkin(k.victimSkin).colors.base }} />
          <span>{k.victim}</span>
        </div>
      ))}
      {showChat && (chat.length > 0 || chatOpen) && (
        <div className="chat-box">
          <div ref={listRef} className="scroll" style={{ maxHeight: 120 }}>
            {chat.slice(-30).map((c) => (
              <div key={c.id} className={`chat-line ${c.system ? 'system' : ''}`}>
                {!c.system && <b style={{ color: getSkin(c.skin).colors.rim }}>{c.from}: </b>}
                {c.text}
              </div>
            ))}
          </div>
          {chatOpen && (
            <input
              ref={inputRef}
              className="input chat-input"
              value={text}
              maxLength={100}
              placeholder={t('hud.chat')}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') send();
                if (e.key === 'Escape') useUi.setState({ chatOpen: false });
                e.stopPropagation();
              }}
              onBlur={() => useUi.setState({ chatOpen: false })}
            />
          )}
        </div>
      )}
    </div>
  );
}

function PowerUpTimers() {
  const t = useT();
  const powerups = useUi((s) => s.powerups);
  const [, force] = useState(0);
  useTicker(() => force((x) => (x + 1) % 1000), powerups.length > 0);
  if (powerups.length === 0) return null;
  const now = Date.now();
  return (
    <div className="pu-row">
      {powerups
        .filter((p) => p.type !== PowerUpType.Bag)
        .map((p) => {
          const frac = Math.max(0, Math.min(1, (p.until - now) / PU_MS[p.type]));
          return (
            <div key={p.type} className="pu" title={t(`pu.${p.type}` as 'pu.1')}>
              {PU_ICON[p.type]}
              <svg viewBox="0 0 46 46">
                <circle cx="23" cy="23" r="20" fill="none" stroke="#14F195" strokeWidth="5" strokeDasharray={`${frac * 125.6} 200`} strokeLinecap="round" />
              </svg>
            </div>
          );
        })}
    </div>
  );
}

function Banner() {
  const t = useT();
  const banner = useUi((s) => s.banner);
  if (!banner) return null;
  if (banner.kind === 'coinrain')
    return (
      <div className="banner">
        🌧️ {t('event.coinrain')} 🪙
        <small>{t('event.coinrainSub')}</small>
      </div>
    );
  return <div className="banner" style={{ background: 'linear-gradient(90deg,#ffd1e1,#c9b6ff,#ffd1e1)' }}>🪂 {t('event.airdrop')}</div>;
}

function CashoutButton() {
  const t = useT();
  const room = useUi((s) => s.room);
  const cashout = useUi((s) => s.cashout);
  const screen = useUi((s) => s.screen);
  const [, force] = useState(0);
  useTicker(() => force((x) => (x + 1) % 1000), cashout.state === 'channel');
  if (room?.mode !== 'stake' || screen !== 'playing') return null;
  const left = Math.max(0, cashout.until - performance.now());
  const pct = cashout.state === 'channel' ? 1 - left / RULES.cashoutMs : 0;
  return (
    <button className="btn btn-mint btn-xl cashout-btn" onClick={() => engine()?.cashout()} disabled={cashout.state === 'channel'}>
      <span className="fill" style={{ transform: `scaleX(${pct})` }} />
      <span style={{ position: 'relative' }}>
        💸 {cashout.state === 'channel' ? t('hud.cashing', { s: (left / 1000).toFixed(1) }) : t('hud.cashout')} <span className="kbd">C</span>
      </span>
    </button>
  );
}

function EmoteBar() {
  return (
    <div className="card emote-bar">
      {EMOTES.map((e) => (
        <button key={e.id} className="emote-chip" onClick={() => engine()?.emote(e.id)} title={e.label.en}>
          {e.text}
          <small>{e.id + 1}</small>
        </button>
      ))}
    </div>
  );
}

function SpectateBar() {
  const t = useT();
  const lb = useUi((s) => s.lb);
  const target = useUi((s) => s.spectateTarget);
  const name = lb.find((e) => e.pid === target)?.name ?? lb[0]?.name ?? '…';
  return (
    <div className="card spectate-bar">
      <span>
        👀 {t('hud.spectating')} <b>{name}</b>
      </span>
      <button className="btn btn-sm btn-ghost" onClick={() => engine()?.spectateNext()} title="Q">
        ⏭ {t('hud.next')}
      </button>
      <button className="btn btn-sm btn-gold" onClick={() => engine()?.play('free')}>
        ▶ {t('lobby.play')}
      </button>
      <button className="btn btn-sm btn-ghost" onClick={() => engine()?.backToLobby()}>
        🏠 {t('hud.menu')}
      </button>
    </div>
  );
}

function MobileControls() {
  const t = useT();
  const room = useUi((s) => s.room);
  const knob = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLDivElement>(null);
  const [emotes, setEmotes] = useState(false);

  const move = (clientX: number, clientY: number) => {
    const b = base.current!.getBoundingClientRect();
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const max = b.width / 2;
    const d = Math.hypot(dx, dy);
    if (d > max) {
      dx = (dx / d) * max;
      dy = (dy / d) * max;
    }
    knob.current!.style.transform = `translate(${dx}px, ${dy}px)`;
    const e = engine();
    if (e) e.input.stick = { x: dx / max, y: dy / max, active: true };
  };
  const end = () => {
    knob.current!.style.transform = '';
    const e = engine();
    if (e) e.input.stick = { x: 0, y: 0, active: false };
  };

  return (
    <>
      <div
        ref={base}
        className="joystick"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          move(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => e.buttons && move(e.clientX, e.clientY)}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div ref={knob} className="knob" />
      </div>
      <div className="touch-buttons">
        <button className="btn btn-pink touch-btn" onPointerDown={() => engine()?.split()}>
          {t('hud.split')}
        </button>
        <button
          className="btn btn-sky touch-btn"
          onPointerDown={() => engine()?.input.startEject()}
          onPointerUp={() => engine()?.input.stopEject()}
          onPointerLeave={() => engine()?.input.stopEject()}
        >
          {t('hud.eject')}
        </button>
        <button className="btn btn-ghost touch-btn" onClick={() => setEmotes((v) => !v)}>
          😊
        </button>
        {room?.mode === 'stake' ? (
          <button className="btn btn-mint touch-btn" onClick={() => engine()?.cashout()}>
            💸
          </button>
        ) : (
          <button className="btn btn-ghost touch-btn" onClick={() => useUi.setState({ chatOpen: true })}>
            💬
          </button>
        )}
      </div>
      {emotes && (
        <div className="card emote-bar" style={{ position: 'absolute', right: 18, bottom: 200, display: 'flex', flexWrap: 'wrap', width: 200 }}>
          {EMOTES.map((e) => (
            <button
              key={e.id}
              className="emote-chip"
              onClick={() => {
                engine()?.emote(e.id);
                setEmotes(false);
              }}
            >
              {e.text}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export function Hud() {
  const t = useT();
  const screen = useUi((s) => s.screen);
  const showFps = useUi((s) => s.settings.showFps);
  const fps = useUi((s) => s.fps);
  const ping = useUi((s) => s.ping);
  const touch = isTouch();
  return (
    <div className="hud">
      <ScoreCard />
      <LiveLeaderboard />
      <div className="top-center">
        {screen === 'playing' && (
          <div className="hud-buttons hide-sm">
            <button className="btn btn-sm btn-ghost" onClick={() => engine()?.backToLobby()}>
              🏠 {t('hud.menu')}
            </button>
          </div>
        )}
        {screen === 'spectating' && <SpectateBar />}
        <Banner />
        <PowerUpTimers />
      </div>
      {screen === 'playing' && (
        <button className="btn btn-sm btn-ghost menu-mobile" onClick={() => engine()?.backToLobby()} aria-label={t('hud.menu')}>
          🏠
        </button>
      )}
      <Minimap />
      <Feed />
      {screen === 'playing' && (
        <div className="cashout-wrap">
          <CashoutButton />
          {!touch && <EmoteBar />}
        </div>
      )}
      {screen === 'playing' && touch && <MobileControls />}
      {showFps && (
        <div className="netstats">
          {fps} fps · {ping} ms
        </div>
      )}
    </div>
  );
}
