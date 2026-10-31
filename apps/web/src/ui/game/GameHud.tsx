import { lookForBasicSkin } from '@elymum/art';
import { PowerUpType, RULES } from '@elymum/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Counter, DUR, Icon, Stamp, springs, useReducedMotion } from '../../design';
import { engine } from '../../game/instance';
import { useT } from '../../i18n';
import { openModal, useUi } from '../../store';
import { useTicker } from '../ticker';
import { EmoteBar } from './EmoteBar';
import { Feed } from './Feed';
import { counterFrac, roomName, sectorOf, useTokenFormat } from './format';
import { MobileControls, useIsTouch } from './MobileControls';
import { RoundIntro, SunsetSky, ValueFlyers } from './Moments';
import { RoundChip, RoundCountdown } from './RoundChip';
import { SpectateBar } from './SpectateBar';

/* ───────────────────────── "You're worth" (top centre) ───────────────────────── */

/**
 * The sun sticker: what my coin is worth right now (tokens in arenas, mass in practice), the
 * last bite under it, and a "+X" tag that pops off its corner on every change. `.g-till` is
 * where the round-over report flies out from.
 */
function WorthSticker() {
  const t = useT();
  const tf = useTokenFormat();
  const hud = useUi((s) => s.hud);
  const room = useUi((s) => s.room);
  const delta = useUi((s) => s.valueDelta);
  const reduced = useReducedMotion();
  const arena = room?.mode === 'arena' && hud.value !== null;
  const [shown, setShown] = useState<typeof delta>(null);
  /** The last bite stays printed under the value until the next one. */
  const [bite, setBite] = useState<typeof delta>(null);

  useEffect(() => {
    // a change that rounds to "0" gets no tag
    if (!delta || tf.signed(delta.delta, { compact: true, maxFrac: 1 }) === '0') return;
    setShown(delta);
    setBite(delta);
    const id = setTimeout(() => setShown((d) => (d?.id === delta.id ? null : d)), 1700);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delta]);

  const frac = arena ? counterFrac(hud.value!, tf.decimals) : 0;
  const rank = hud.rank > 0 ? t('g.rankOf', { rank: hud.rank, n: hud.players }) : null;
  const sub = arena && bite ? t(bite.delta > 0 ? 'g.lastBite' : 'g.lastLoss', { d: tf.signed(bite.delta, { compact: true, maxFrac: 2 }) }) : rank;
  return (
    <section className="g-till" aria-label={arena ? t('g.till') : t('g.mass')}>
      <AnimatePresence>
        {arena && shown && (
          <motion.span
            key={shown.id}
            className={`g-till__delta num ${shown.delta > 0 ? 'is-gain' : 'is-loss'}`}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.4, rotate: -14, y: 10 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, rotate: 7, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -14, transition: { duration: 0.25 } }}
            transition={reduced ? { duration: 0.12 } : springs.pop}
          >
            {tf.signed(shown.delta, { compact: true, maxFrac: 1 })}
          </motion.span>
        )}
      </AnimatePresence>
      <span className="g-till__label mono">{arena ? t('g.till') : t('g.mass')}</span>
      <span className="g-till__value num" aria-live="off">
        {arena ? (
          <Counter value={hud.value!} format={(n) => tf.fmt(n, { maxFrac: frac })} unit={tf.symbol} />
        ) : (
          <Counter value={hud.mass} format={(n) => Math.floor(n).toLocaleString('en-US')} />
        )}
        {arena && <span className="g-till__sym mono">{tf.symbol}</span>}
      </span>
      {sub && <span className={`g-till__bite mono${arena && bite ? (bite.delta > 0 ? ' is-gain' : ' is-loss') : ''}`}>{sub}</span>}
    </section>
  );
}

/* ───────────────────────── practice / private room tag (top left) ───────────────────────── */

/** Outside arenas there is no bell: the timer's place says which pond this is. */
function PondTag() {
  const t = useT();
  const room = useUi((s) => s.room);
  if (!room || room.mode === 'arena') return null;
  return (
    <div className="g-pond">
      <svg className="g-pond__coin" viewBox="0 0 46 46" width={40} height={40} aria-hidden="true">
        <circle cx="23" cy="23" r="17" className="g-pond__body" />
        <path d="M14 26c3 4 15 4 18 0" className="g-pond__wave" />
        <path d="M12 20c3 3 6 3 9 0s6-3 9 0 6 3 9 0" className="g-pond__wave" />
      </svg>
      <span className="g-pond__text">
        <b className="g-pond__name">{roomName(room)}</b>
        <span className="g-pond__label mono">{t('g.practiceTag')}</span>
      </span>
      {room.mode === 'private' && room.code && (
        <button
          type="button"
          className="g-pond__code mono"
          onClick={() => void navigator.clipboard?.writeText(room.code!)}
          aria-label={t('g.copyCode', { code: room.code })}
        >
          <Icon name="key" size={14} /> {room.code}
        </button>
      )}
    </div>
  );
}

/* ───────────────────────── top of the food chain (top right) ───────────────────────── */

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
  const rows = lb.slice(0, compact ? 3 : 5);
  const playing = screen === 'playing';
  const inTop = rows.some((e) => e.pid === me?.pid);
  // climbing a place: my row flashes sun once (a new key restarts the flash)
  const prevRank = useRef(0);
  const [climb, setClimb] = useState(0);
  useEffect(() => {
    const r = hud.rank;
    if (playing && r > 0 && prevRank.current > 0 && r < prevRank.current) setClimb((n) => n + 1);
    prevRank.current = playing ? r : 0;
  }, [hud.rank, playing]);
  const score = (value: number | undefined, mass: number) =>
    arena && value !== undefined ? tf.fmt(value, { compact: true, maxFrac: 1 }) : Math.floor(mass).toLocaleString('en-US');
  return (
    <section className={`g-standings${compact ? ' is-compact' : ''}`} aria-label={t('g.standings')}>
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
            {playing && e.pid === me?.pid && climb > 0 && !reduced && <span key={climb} className="g-standings__flash" aria-hidden="true" />}
            <span className="g-standings__rank mono">
              {i === 0 && (
                <svg className="g-standings__crown" viewBox="0 0 24 16" aria-hidden="true">
                  <path d="M2 14 L1 4 L7 8 L12 1 L17 8 L23 4 L22 14Z" />
                </svg>
              )}
              {i + 1}
            </span>
            <span className="g-standings__sw" aria-hidden="true" style={{ background: lookForBasicSkin(e.skin).body }} />
            <span className="g-standings__name">
              <span className="g-standings__nm">{playing && e.pid === me?.pid ? t('g.youName') : e.name}</span>
              {e.bot && <span className="kb-sr">{t('g.bot')}</span>}
              {e.verified && <Icon name="check" size={12} className="g-standings__ver" />}
            </span>
            <span className="g-standings__score num">{score(e.value, e.score)}</span>
          </motion.li>
        ))}
        {playing && !inTop && hud.rank > 0 && (
          <li className="g-standings__row is-me is-detached">
            <span className="g-standings__rank mono">{hud.rank}</span>
            <span className="g-standings__sw" aria-hidden="true" style={{ background: lookForBasicSkin(me?.skin ?? 0).body }} />
            <span className="g-standings__name">
              <span className="g-standings__nm">{t('g.youName')}</span>
            </span>
            <span className="g-standings__score num">{score(hud.value ?? undefined, hud.mass)}</span>
          </li>
        )}
      </ol>
    </section>
  );
}

/* ───────────────────────── the round minimap (bottom right) ───────────────────────── */

function MapSheet({ size }: { size: number }) {
  const t = useT();
  const ref = useRef<HTMLCanvasElement>(null);
  const show = useUi((s) => s.settings.showMinimap);
  const [sector, setSector] = useState('—');
  useEffect(() => {
    engine()?.setMinimap(show ? ref.current : null);
    return () => engine()?.setMinimap(null);
  }, [show]);
  // the tag follows my sector (cheap poll; the map itself is drawn by the engine)
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
    <section className="g-map" aria-label={t('g.mapLabel')}>
      <div className="g-map__disc" style={{ width: size, height: size }}>
        <canvas ref={ref} className="g-map__canvas" style={{ width: size, height: size }} />
      </div>
      <span className="g-map__tag mono">{t('g.sheet', { sector })}</span>
    </section>
  );
}

/* ───────────────────────── power-ups, banner, buttons, keys ───────────────────────── */

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
              <circle cx="20" cy="20" r="16" pathLength="100" strokeDasharray={`${(frac * 100).toFixed(1)} 100`} />
            </svg>
            <svg className="g-pu__icon" viewBox="0 0 24 24" width={16} height={16} aria-hidden="true">
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
              tone={banner.kind === 'coinrain' ? 'mustard' : 'teal'}
              rotate={-4}
              text={banner.kind === 'coinrain' ? t('event.coinrain') : t('event.airdrop')}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TopButtons() {
  const t = useT();
  const screen = useUi((s) => s.screen);
  return (
    <div className="g-topbar">
      {screen === 'playing' && (
        <button type="button" className="kb-iconbtn g-topbar__btn" onClick={() => engine()?.backToLobby()} aria-label={t('g.menu')} title={t('g.menu')}>
          <Icon name="menu" size={20} />
        </button>
      )}
      <button type="button" className="kb-iconbtn g-topbar__btn" onClick={() => openModal('settings')} aria-label={t('g.settings')} title={t('g.settings')}>
        <Icon name="settings" size={20} />
      </button>
    </div>
  );
}

/** Keyboard help as key stickers (desktop). The chat key opens the chat line. */
function KeyHints() {
  const t = useT();
  const showChat = useUi((s) => s.settings.showChat);
  const chatOpen = useUi((s) => s.chatOpen);
  return (
    <div className="g-keys mono" aria-label={t('g.keysLabel')}>
      <span className="g-keys__item">
        <kbd className="kb-key">{t('g.key.mouse')}</kbd> {t('g.key.steer')}
      </span>
      <span className="g-keys__item">
        <kbd className="kb-key">{t('g.key.space')}</kbd> {t('hud.split').toLowerCase()}
      </span>
      <span className="g-keys__item">
        <kbd className="kb-key">W</kbd> {t('hud.eject').toLowerCase()}
      </span>
      <span className="g-keys__item">
        <kbd className="kb-key">1–8</kbd> {t('g.emotes').toLowerCase()}
      </span>
      {showChat && !chatOpen && (
        <button type="button" className="g-keys__item g-keys__chat" onClick={() => useUi.setState({ chatOpen: true })}>
          <kbd className="kb-key">{t('g.key.enter')}</kbd> {t('g.chat').toLowerCase()}
        </button>
      )}
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

/** The in-game HUD: cream instrument stickers pressed onto the night floor of the ring. */
export function GameHud() {
  const screen = useUi((s) => s.screen);
  const touch = useIsTouch();
  const narrow = useNarrow();
  const playing = screen === 'playing';
  // the round's report flies out of the worth sticker: it stays on the frozen world under the sheet
  const roundOver = screen === 'roundover';
  const reduced = useReducedMotion();
  const drop = (tilt: number, delay: number) =>
    reduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: DUR.fade } } }
      : {
          initial: { opacity: 0, y: -22, rotate: tilt - 4 },
          animate: { opacity: 1, y: 0, rotate: tilt, transition: { ...springs.drop, delay: HUD_IN_DELAY + delay } },
        };
  return (
    // the stickers drop on once the page has opened onto the world, and lift off before it closes
    <motion.div
      className={`g-hud${touch ? ' is-touch' : ''}${narrow ? ' is-narrow' : ''}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: reduced ? { duration: DUR.fade } : { delay: HUD_IN_DELAY, duration: 0.12 } }}
      exit={{ opacity: 0, transition: { duration: reduced ? DUR.fade : 0.14 } }}
    >
      {/* behind the stickers: the final minute's sunset at the edges of the sky */}
      <SunsetSky />
      <motion.div className="g-corner g-corner--tl" {...drop(0, 0)}>
        <div className="g-corner__row">
          {!roundOver && <RoundChip />}
          <PondTag />
          {!narrow && <TopButtons />}
        </div>
        {narrow && <Standings compact />}
        <Feed narrow={narrow} />
      </motion.div>

      <div className="g-center">
        {(playing || roundOver) && (
          <motion.div className="g-center__worth" {...drop(-1.5, 0.05)}>
            <WorthSticker />
          </motion.div>
        )}
        {/* in the column's flow, so it never covers a banner or my coin */}
        {!roundOver && <RoundCountdown />}
        <Banner />
        <PowerUps />
        <NetStats />
      </div>

      {!narrow && (
        <motion.div className="g-corner g-corner--tr" {...drop(0.8, 0.1)}>
          <Standings compact={false} />
        </motion.div>
      )}
      {narrow && (
        <div className="g-corner g-corner--tr">
          <TopButtons />
        </div>
      )}

      {!narrow && <MapSheet size={140} />}
      {playing && !touch && (
        <>
          <div className="g-dock">
            <EmoteBar />
          </div>
          {!narrow && <KeyHints />}
        </>
      )}
      {playing && touch && <MobileControls />}
      {screen === 'spectating' && <SpectateBar />}
      <RoundIntro />
      <ValueFlyers />
    </motion.div>
  );
}

/** The HUD waits for the page to open onto the world (s). */
const HUD_IN_DELAY = 0.34;

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
