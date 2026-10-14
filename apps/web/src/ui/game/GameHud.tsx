import { PowerUpType, RULES } from '@slana/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Counter, Icon, Stamp, Tape, springs, useReducedMotion } from '../../design';
import { engine } from '../../game/instance';
import { useT } from '../../i18n';
import { openModal, useUi } from '../../store';
import { useTicker } from '../common';
import { CashoutButton } from './CashoutButton';
import { EmoteBar } from './EmoteBar';
import { Feed } from './Feed';
import { counterFrac, sectorOf, useTokenFormat } from './format';
import { MobileControls, useIsTouch } from './MobileControls';
import { SpectateBar } from './SpectateBar';

/* ───────────────────────── KASA receipt (top left) ───────────────────────── */

/** The till: a taped receipt slip with a mechanical counter (tokens in arenas, mass in practice). */
function TillSlip() {
  const t = useT();
  const tf = useTokenFormat();
  const hud = useUi((s) => s.hud);
  const room = useUi((s) => s.room);
  const ticket = useUi((s) => s.ticket);
  const delta = useUi((s) => s.valueDelta);
  const reduced = useReducedMotion();
  const arena = room?.mode === 'arena' && hud.value !== null;
  const [shown, setShown] = useState<typeof delta>(null);

  // the "+X" stamp next to the counter lives ~1.6 s per value message
  useEffect(() => {
    if (!delta) return;
    setShown(delta);
    const id = setTimeout(() => setShown((d) => (d?.id === delta.id ? null : d)), 1700);
    return () => clearTimeout(id);
  }, [delta]);

  const frac = arena ? counterFrac(hud.value!, tf.decimals) : 0;
  return (
    <section className="g-slip g-till" aria-label={arena ? t('g.till') : t('g.mass')}>
      <Tape rotate={-5} width={78} style={{ left: 22, top: -11 }} />
      <AnimatePresence>
        {arena && shown && (
          <motion.span
            key={shown.id}
            className={`g-till__delta mono ${shown.delta > 0 ? 'is-gain' : 'is-loss'}`}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.5, rotate: -14, y: 4 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, rotate: -6, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -10, transition: { duration: 0.25 } }}
            transition={reduced ? { duration: 0.12 } : springs.stamp}
          >
            {tf.signed(shown.delta, { compact: true, maxFrac: 1 })}
          </motion.span>
        )}
      </AnimatePresence>
      <div className="g-slip__paper">
        <div className="g-till__row mono">
          <span>{arena ? t('g.till') : t('g.mass')}</span>
          <span className="g-till__rank">{hud.rank > 0 ? t('g.rankOf', { rank: hud.rank, n: hud.players }) : '—'}</span>
        </div>
        <div className="g-till__value" aria-live="off">
          {arena ? (
            <Counter value={hud.value!} format={(n) => tf.fmt(n, { maxFrac: frac })} unit={tf.symbol} />
          ) : (
            <Counter value={hud.mass} format={(n) => Math.floor(n).toLocaleString(tf.lang === 'tr' ? 'tr-TR' : 'en-US')} />
          )}
        </div>
        {arena && ticket && (
          <div className="g-till__foot mono">
            <span>{t('g.ticket', { fee: tf.fmt(ticket.entryFee, { compact: true }) })}</span>
            {ticket.hasPass && <span className="g-till__pass">PASS</span>}
          </div>
        )}
        {room?.mode === 'private' && room.code && (
          <button type="button" className="g-till__code mono" onClick={() => void navigator.clipboard?.writeText(room.code!)} aria-label={t('g.copyCode', { code: room.code })}>
            <Icon name="key" size={14} /> {room.code}
          </button>
        )}
      </div>
    </section>
  );
}

/* ───────────────────────── standings column (top right) ───────────────────────── */

function Standings({ compact }: { compact: boolean }) {
  const t = useT();
  const tf = useTokenFormat();
  const lb = useUi((s) => s.lb);
  const me = useUi((s) => s.me);
  const screen = useUi((s) => s.screen);
  const hud = useUi((s) => s.hud);
  const room = useUi((s) => s.room);
  const reduced = useReducedMotion();
  const arena = room?.mode === 'arena';
  const rows = compact ? lb.slice(0, 3) : lb.slice(0, 10);
  const playing = screen === 'playing';
  const inTop = rows.some((e) => e.pid === me?.pid);
  const score = (value: number | undefined, mass: number) =>
    arena && value !== undefined ? tf.fmt(value, { compact: true, maxFrac: 1 }) : Math.floor(mass).toLocaleString(tf.lang === 'tr' ? 'tr-TR' : 'en-US');
  return (
    <section className={`g-slip g-standings${compact ? ' is-compact' : ''}`} aria-label={t('g.standings')}>
      <Tape rotate={6} width={66} tone="pink" style={{ right: 18, top: -10 }} />
      <div className="g-slip__paper">
        <header className="g-standings__head">
          <h2 className="g-standings__title">{t('g.standings')}</h2>
          <span className="mono g-standings__count">{t('g.inRoom', { n: hud.players })}</span>
        </header>
        <ol className="g-standings__list">
          {rows.map((e, i) => (
            <motion.li
              key={e.pid}
              layout={reduced ? false : 'position'}
              transition={springs.press}
              className={`g-standings__row${playing && e.pid === me?.pid ? ' is-me' : ''}`}
            >
              <span className="g-standings__rank mono">{String(i + 1).padStart(2, '0')}</span>
              <span className="g-standings__name">
                <span className="g-standings__nm">{e.name}</span>
                {e.bot && !compact && <span className="g-bot mono">{t('g.bot')}</span>}
                {e.bot && compact && <Icon name="bot" size={13} className="g-standings__boticon" title={t('g.bot')} />}
                {e.verified && <Icon name="check" size={13} className="g-standings__ver" />}
              </span>
              <span className="g-standings__score mono">{score(e.value, e.score)}</span>
            </motion.li>
          ))}
          {playing && !inTop && hud.rank > 0 && (
            <li className="g-standings__row is-me is-detached">
              <span className="g-standings__rank mono">{String(hud.rank).padStart(2, '0')}</span>
              <span className="g-standings__name">
                <span className="g-standings__nm">{me?.name}</span>
                <span className="g-you mono">{t('g.you')}</span>
              </span>
              <span className="g-standings__score mono">{score(hud.value ?? undefined, hud.mass)}</span>
            </li>
          )}
        </ol>
      </div>
    </section>
  );
}

/* ───────────────────────── map sheet (bottom right) ───────────────────────── */

function MapSheet({ size }: { size: number }) {
  const t = useT();
  const ref = useRef<HTMLCanvasElement>(null);
  const show = useUi((s) => s.settings.showMinimap);
  const [sector, setSector] = useState('—');
  useEffect(() => {
    engine()?.setMinimap(show ? ref.current : null);
    return () => engine()?.setMinimap(null);
  }, [show]);
  // the sheet label follows my sector (cheap poll; the canvas itself is drawn by the engine)
  useEffect(() => {
    if (!show) return;
    const id = setInterval(() => {
      const e = engine();
      const me = e?.world.myStats();
      const c = me ?? (e ? { x: e.camera.x, y: e.camera.y } : null);
      if (e && c) setSector(sectorOf(c.x, c.y, e.world.width, e.world.height));
    }, 400);
    return () => clearInterval(id);
  }, [show]);
  if (!show) return null;
  return (
    <section className="g-slip g-map" aria-label={t('g.mapLabel')}>
      <Tape rotate={-38} width={54} tone="teal" style={{ left: -16, top: 2 }} />
      <div className="g-slip__paper g-map__paper">
        <div className="g-map__head mono">
          <span>{t('g.sheet', { sector })}</span>
          <span aria-hidden="true">N↑</span>
        </div>
        <canvas ref={ref} className="g-map__canvas" style={{ width: size, height: size }} />
      </div>
    </section>
  );
}

/* ───────────────────────── power-ups, banner, top bar ───────────────────────── */

/** Power-up glyphs in the icon set's hand (24 grid, 2.2 px round strokes). */
const PU_PATH: Record<PowerUpType, string> = {
  [PowerUpType.Magnet]: 'M6.5 4.5v8a5.5 5.5 0 0 0 11 0v-8h-3.6v8a1.9 1.9 0 0 1-3.8 0v-8zM6.5 8.2h3.6M13.9 8.2h3.6',
  [PowerUpType.Pump]: 'M12 3.5c3.4 2.6 4.6 6.4 3.4 11.2H8.6C7.4 9.9 8.6 6.1 12 3.5zM9.2 14.7l-2.4 3.1 3.1-.4M14.8 14.7l2.4 3.1-3.1-.4M12 17.4v3',
  [PowerUpType.Shield]: 'M12 3.5l7 2.6v5.2c0 4.4-3 7.6-7 9.2-4-1.6-7-4.8-7-9.2V6.1z',
  [PowerUpType.Bag]: 'M9 6.5h6l-1.5-3h-3zM8.5 6.5C5 9 4 14 6 17.5c1.2 2 3.4 3 6 3s4.8-1 6-3c2-3.5 1-8.5-2.5-11z',
};
const PU_MS: Record<PowerUpType, number> = {
  [PowerUpType.Magnet]: RULES.magnetMs,
  [PowerUpType.Pump]: RULES.pumpMs,
  [PowerUpType.Shield]: RULES.shieldMs,
  [PowerUpType.Bag]: 1,
};

function PowerUps() {
  const t = useT();
  const powerups = useUi((s) => s.powerups);
  const [, force] = useState(0);
  useTicker(() => force((x) => (x + 1) % 1000), powerups.length > 0);
  const list = powerups.filter((p) => p.type !== PowerUpType.Bag);
  if (list.length === 0) return null;
  const now = Date.now();
  return (
    <ul className="g-pu" aria-label={t('g.powerups')}>
      {list.map((p) => {
        const left = Math.max(0, p.until - now);
        const frac = Math.min(1, left / PU_MS[p.type]);
        return (
          <li key={p.type} className={`g-pu__chip g-pu--${p.type}`}>
            <svg className="g-pu__ring" viewBox="0 0 40 40" aria-hidden="true">
              <circle cx="20" cy="20" r="17" pathLength="100" strokeDasharray={`${(frac * 100).toFixed(1)} 100`} />
            </svg>
            <svg className="g-pu__icon" viewBox="0 0 24 24" width={18} height={18} aria-hidden="true">
              <path d={PU_PATH[p.type]} />
            </svg>
            <span className="mono">
              {t(`pu.${p.type}` as 'pu.1')} · {t('g.secondsLeft', { s: Math.ceil(left / 1000) })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Banner() {
  const t = useT();
  const banner = useUi((s) => s.banner);
  return (
    <div className="g-banner" aria-live="polite">
      <AnimatePresence>
        {banner && (
          <motion.div
            key={banner.kind}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <Stamp
              animateIn
              size="md"
              tone={banner.kind === 'coinrain' ? 'mustard' : 'pink'}
              rotate={-4}
              text={banner.kind === 'coinrain' ? t('event.coinrain') : t('event.airdrop')}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TopBar() {
  const t = useT();
  const screen = useUi((s) => s.screen);
  return (
    <div className="g-topbar">
      {screen === 'playing' && (
        <button type="button" className="kb-iconbtn g-topbar__btn" onClick={() => engine()?.backToLobby()} aria-label={t('g.menu')} title={t('g.menu')}>
          <Icon name="menu" size={22} />
        </button>
      )}
      <button type="button" className="kb-iconbtn g-topbar__btn" onClick={() => openModal('settings')} aria-label={t('g.settings')} title={t('g.settings')}>
        <Icon name="settings" size={22} />
      </button>
    </div>
  );
}

function NetStats() {
  const t = useT();
  const show = useUi((s) => s.settings.showFps);
  const fps = useUi((s) => s.fps);
  const ping = useUi((s) => s.ping);
  if (!show) return null;
  return <div className="g-net mono">{t('g.netstats', { fps, ping })}</div>;
}

/* ───────────────────────── layout ───────────────────────── */

/** The in-game HUD: paper scraps taped over the riso world. */
export function GameHud() {
  const screen = useUi((s) => s.screen);
  const room = useUi((s) => s.room);
  const touch = useIsTouch();
  const narrow = useNarrow();
  const playing = screen === 'playing';
  return (
    <div className={`g-hud${touch ? ' is-touch' : ''}${narrow ? ' is-narrow' : ''}`}>
      {playing && <TillSlip />}
      <Standings compact={narrow} />
      <div className="g-center">
        <TopBar />
        <Banner />
        <PowerUps />
        <NetStats />
      </div>
      {!narrow && <MapSheet size={150} />}
      <Feed narrow={narrow} />
      {playing && !touch && (
        <div className="g-dock">
          {room?.mode === 'arena' && <CashoutButton />}
          <EmoteBar />
        </div>
      )}
      {playing && touch && <MobileControls />}
      {screen === 'spectating' && <SpectateBar />}
    </div>
  );
}

function useNarrow(): boolean {
  const q = '(max-width: 720px)';
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(q).matches === true);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}
