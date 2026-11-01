import { lookForSkin as lookForBasicSkin } from '../../render/looks';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { springs, useReducedMotion } from '../../design';
import { VALUE_FLY_EVENT, type ValueFlyDetail } from '../../game/moments';
import { roundStartLabel, useRound } from '../../game/round';
import { useT } from '../../i18n';
import { useUi } from '../../store';
import { ArenaVignette } from '../lobby/ArenaVignette';
import { roomName } from './format';
import './moments.css';

/**
 * The game's authored beats, drawn over the canvas (all decoration: aria-hidden, no pointer
 * events, transform / opacity only, and each has a still or no version under reduced motion):
 *
 * - `RoundIntro`: entering a room, its title card tilts in and out ("The 14:05 round · Asphodel
 *   Meadow", with the arena's stamp from the departures board).
 * - `SunsetSky`: the final minute; the sky band at the edges of the screen turns to sunset and a
 *   sun sinks behind the bottom edge as the bell comes.
 * - `BellMoment`: the bell itself swings in over the frozen world and rings out its shock rings
 *   before the landing report prints.
 * - `DeathMoment`: the eater's open mouth fills the screen for a beat and shuts.
 * - `ValueFlyers`: every gain is a sun sticker that pops off my coin and flies into the till.
 */

/* ───────────────────────── the round's title card ───────────────────────── */

/** Card on screen (ms) once it has landed. */
const INTRO_HOLD_MS = 2300;
/** It waits for the coin to land first (ms). */
const INTRO_DELAY_MS = 750;

export function RoundIntro() {
  const t = useT();
  const room = useUi((s) => s.room);
  const playing = useUi((s) => s.screen === 'playing');
  const reduced = useReducedMotion();
  const n = room?.mode === 'arena' ? (room.round?.n ?? null) : null;
  const key = playing && room ? `${room.id}:${n ?? '-'}` : null;
  const [shown, setShown] = useState<string | null>(null);
  const seen = useRef<string | null>(null);

  useEffect(() => {
    if (!key) {
      setShown(null);
      return;
    }
    // once per room and round: a respawn in the same pond does not repeat it
    if (seen.current === key) return;
    const wait = reduced ? 150 : INTRO_DELAY_MS;
    // marked as seen when it shows (an effect re-run before then must not lose it)
    const a = setTimeout(() => {
      seen.current = key;
      setShown(key);
    }, wait);
    const b = setTimeout(() => setShown((k) => (k === key ? null : k)), wait + INTRO_HOLD_MS);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [key, reduced]);

  const arena = room?.mode === 'arena';
  const kicker = arena && n !== null ? t('g.intro.round', { time: roundStartLabel(n, room?.round) }) : t('g.intro.practice');
  const sub = arena ? t('g.intro.sub') : t('g.intro.practiceSub');
  return (
    <div className="gm-intro" aria-hidden="true">
      <AnimatePresence>
        {shown && shown === key && room && (
          <motion.div
            key={shown}
            className="gm-intro__card kb-island"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -70, rotate: -14, scale: 0.82 }}
            animate={reduced ? { opacity: 1, transition: { duration: 0.12 } } : { opacity: 1, y: 0, rotate: -2.5, scale: 1, transition: springs.drop }}
            exit={reduced ? { opacity: 0, transition: { duration: 0.12 } } : { opacity: 0, y: -46, rotate: 9, scale: 0.9, transition: { duration: 0.32, ease: [0.5, 0, 0.75, 0] } }}
          >
            <span className="gm-intro__tape" />
            <ArenaVignette arenaId={arena ? (room.arenaId ?? 1) : null} />
            <span className="gm-intro__text">
              <span className="gm-intro__kicker mono">{kicker}</span>
              <span className="gm-intro__title">{roomName(room)}</span>
              <span className="gm-intro__sub">{sub}</span>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ───────────────────────── the final minute: sunset ───────────────────────── */

/** The final minute's length (ms): the sun sets across it. */
const FINAL_MS = 60_000;

export function SunsetSky() {
  const room = useUi((s) => s.room);
  const screen = useUi((s) => s.screen);
  const on = room?.mode === 'arena' && (screen === 'playing' || screen === 'dead' || screen === 'spectating');
  const round = useRound(on ? (room?.arenaId ?? null) : null, on);
  const closing = on && round?.phase === 'closing';
  const late = closing && round!.msLeft <= 10_000;
  // 0 when the final minute starts, 1 at the bell
  const p = closing ? Math.min(1, Math.max(0, 1 - round!.msLeft / FINAL_MS)) : 0;
  return (
    <div className={`gm-sunset${closing ? ' is-on' : ''}${late ? ' is-late' : ''}`} style={{ '--set': p.toFixed(3) } as CSSProperties} aria-hidden="true">
      <span className="gm-sunset__band is-top" />
      <span className="gm-sunset__band is-bottom" />
      <span className="gm-sunset__sun" />
    </div>
  );
}

/* ───────────────────────── the bell ───────────────────────── */

/** How long the bell holds the stage (ms): the landing report opens under it at 1.5 s. */
const BELL_MS = 1650;

export function BellMoment() {
  const ringing = useUi((s) => s.screen === 'roundover' && s.roundResult?.kind === 'round');
  const reduced = useReducedMotion();
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!ringing) {
      setOn(false);
      return;
    }
    setOn(true);
    const id = setTimeout(() => setOn(false), reduced ? 700 : BELL_MS);
    return () => clearTimeout(id);
  }, [ringing, reduced]);
  return (
    <AnimatePresence>
      {on && (
        <motion.div
          key="bell"
          className={`gm-bell${reduced ? ' is-still' : ''}`}
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.12 } }}
          exit={{ opacity: 0, transition: { duration: 0.28 } }}
        >
          <span className="gm-bell__hush" />
          <span className="gm-bell__rings">
            <i />
            <i />
            <i />
          </span>
          <motion.span
            className="gm-bell__hang"
            initial={reduced ? false : { y: '-120%' }}
            animate={{ y: 0, transition: { type: 'spring', stiffness: 420, damping: 22 } }}
            exit={reduced ? undefined : { y: '-130%', transition: { duration: 0.3, ease: [0.5, 0, 0.75, 0] } }}
          >
            <span className="gm-bell__swing">
              <span className="gm-bell__rope" />
              <span className="gm-bell__art">
                {/* its hard shadow: the same art in ink, offset (a filter on a swinging layer is redrawn every frame) */}
                <BellArt shadow />
                <BellArt />
              </span>
            </span>
          </motion.span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A small brass bell on its rope: flat sun paint, one shade, ink edge, a clapper that swings late. `shadow`: all ink (its hard shadow). */
function BellArt({ shadow = false }: { shadow?: boolean }) {
  return (
    <svg className={`gm-bell__svg${shadow ? ' gm-bell__svg--shadow' : ''}`} viewBox="0 0 160 220" focusable="false">
      <path d="M80 0 V44" stroke="#04181C" strokeWidth="5" />
      <path d="M80 0 V44" stroke="#DCCDA8" strokeWidth="2" strokeDasharray="4 3" />
      <g className="gm-bell__body">
        <circle cx="80" cy="52" r="11" fill="#F2C14E" stroke="#04181C" strokeWidth="5" />
        <g className="gm-bell__clapper">
          <path d="M80 150 V178" stroke="#04181C" strokeWidth="5" />
          <circle cx="80" cy="184" r="11" fill="#D49A2B" stroke="#04181C" strokeWidth="5" />
        </g>
        <path
          d="M80 60 C50 60 38 84 36 116 C34 140 28 152 14 160 C10 163 12 170 18 170 H142 C148 170 150 163 146 160 C132 152 126 140 124 116 C122 84 110 60 80 60Z"
          fill="#F2C14E"
          stroke="#04181C"
          strokeWidth="6"
          strokeLinejoin="round"
        />
        {/* the one shade, lower right; the shine, upper left */}
        <path d="M104 72 C116 84 118 104 120 122 C122 142 128 152 140 162 H112 C110 130 112 98 104 72Z" fill="#D49A2B" />
        <path d="M58 82 C52 94 50 108 50 120" stroke="#FFFFFF" strokeWidth="7" strokeLinecap="round" fill="none" />
        <path d="M18 170 H142" stroke="#04181C" strokeWidth="6" strokeLinecap="round" />
        <path d="M30 150 H130" stroke="#04181C" strokeWidth="3.5" strokeLinecap="round" opacity="0.55" />
      </g>
      {/* motion strokes either side, as in a picture book */}
      <g className="gm-bell__lines" stroke="#F6EEDA" strokeWidth="6" strokeLinecap="round">
        <path d="M6 92 L-14 84 M4 120 L-18 122 M10 146 L-8 158" />
        <path d="M154 92 L174 84 M156 120 L178 122 M150 146 L168 158" />
      </g>
    </svg>
  );
}

/* ───────────────────────── death: the mouth ───────────────────────── */

/** The mouth's beat (ms): it fills the screen, shuts, and lets go as the Eaten. sheet lands. */
const MOUTH_MS = 820;

export function DeathMoment() {
  const death = useUi((s) => (s.screen === 'dead' ? s.death : null));
  const reduced = useReducedMotion();
  const [on, setOn] = useState<number | null>(null);
  useEffect(() => {
    // a bot or a player ate us: their mouth; a virus or the edge of the map: no one to show
    if (!death || !death.killer || reduced) {
      setOn(null);
      return;
    }
    setOn(death.killerSkin ?? 0);
    const id = setTimeout(() => setOn(null), MOUTH_MS);
    return () => clearTimeout(id);
  }, [death, reduced]);
  const look = on !== null ? lookForBasicSkin(on) : null;
  return (
    <AnimatePresence>
      {look && (
        <motion.div
          key="mouth"
          className="gm-mouth"
          aria-hidden="true"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.22 } }}
          style={{ '--paint': look.body } as CSSProperties}
        >
          {/*
            Three page-level layers (the face, the jaw, the lip), each its own SVG on the same
            viewBox: the gulp scales the stack and the jaw and lip shut, all as compositor
            transforms. Animating elements inside one SVG repainted the whole screen every frame.
          */}
          <div className="gm-mouth__face">
            <svg className="gm-mouth__svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" focusable="false">
              <circle cx="50" cy="40" r="46" className="gm-mouth__body" />
              {/* eyes, looking down at me */}
              <g className="gm-mouth__eyes">
                <ellipse cx="35" cy="22" rx="7" ry="8.5" fill="#FFFFFF" stroke="#04181C" strokeWidth="1.6" />
                <ellipse cx="65" cy="22" rx="7" ry="8.5" fill="#FFFFFF" stroke="#04181C" strokeWidth="1.6" />
                <circle cx="36" cy="26" r="3.6" fill="#04181C" />
                <circle cx="64" cy="26" r="3.6" fill="#04181C" />
                <circle cx="34.6" cy="24.4" r="1.2" fill="#FFFFFF" />
                <circle cx="62.6" cy="24.4" r="1.2" fill="#FFFFFF" />
              </g>
              <ellipse cx="28" cy="38" rx="5" ry="3" fill="#F39B86" opacity="0.85" />
              <ellipse cx="72" cy="38" rx="5" ry="3" fill="#F39B86" opacity="0.85" />
            </svg>
            <div className="gm-mouth__jaw">
              <svg className="gm-mouth__svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" focusable="false">
                <ellipse cx="50" cy="52" rx="22" ry="15" fill="#04181C" />
                <ellipse cx="50" cy="61" rx="13" ry="6" fill="#F39B86" />
                <path d="M50 57 V64" stroke="#D9714F" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </div>
            <div className="gm-mouth__lip">
              <svg className="gm-mouth__svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" focusable="false">
                <ellipse cx="50" cy="52" rx="22" ry="15" className="gm-mouth__lipline" />
              </svg>
            </div>
          </div>
          <span className="gm-mouth__shut" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ───────────────────────── gains fly into the till ───────────────────────── */

export { VALUE_FLY_EVENT, type ValueFlyDetail };

interface Flyer extends ValueFlyDetail {
  id: number;
  dx: number;
  dy: number;
}

/** At most this many in the air at once (a coin rain must not become a swarm). */
const MAX_FLYERS = 5;
const FLY_S = 0.78;

export function ValueFlyers() {
  const reduced = useReducedMotion();
  const [list, setList] = useState<Flyer[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<ValueFlyDetail>).detail;
      const till = document.querySelector('.g-till__value');
      if (!d || !till) return;
      const r = till.getBoundingClientRect();
      const id = ++seq.current;
      const f: Flyer = { ...d, id, dx: r.left + r.width / 2 - d.x, dy: r.top + r.height / 2 - d.y };
      setList((l) => [...l.slice(-(MAX_FLYERS - 1)), f]);
      // the till gulps it down as it arrives (a Web Animation: restarting a CSS class animation
      // needed a forced layout to take)
      window.setTimeout(() => {
        const el = document.querySelector<HTMLElement>('.g-till');
        el?.animate?.(GULP, { duration: 340, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
      }, FLY_S * 1000 - 60);
      window.setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), FLY_S * 1000 + 40);
    };
    window.addEventListener(VALUE_FLY_EVENT, on);
    return () => window.removeEventListener(VALUE_FLY_EVENT, on);
  }, []);
  if (reduced) return null;
  return (
    <div className="gm-flyers" aria-hidden="true">
      {list.map((f) => (
        <Flyer key={f.id} f={f} />
      ))}
    </div>
  );
}

/** The till's gulp (scale only). */
const GULP: Keyframe[] = [{ transform: 'scale(1)' }, { transform: 'scale(1.09, 0.94)', offset: 0.35 }, { transform: 'scale(0.97, 1.03)', offset: 0.7 }, { transform: 'scale(1)' }];

/**
 * One gain sticker: pops on the spot, then arcs up into the till. A Web Animation of transform
 * only, so it runs on the compositor (no React or JS work per frame while it flies).
 */
function Flyer({ f }: { f: Flyer }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el?.animate) return;
    const at = (x: number, y: number, s: number, r: number) => `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${s}) rotate(${r}deg)`;
    const a = el.animate(
      [
        { transform: at(0, 0, 0.4, -12), easing: 'ease-out' },
        { transform: at(0, -18, 1.15, 6), offset: 0.22, easing: 'ease-in-out' },
        { transform: at(f.dx * 0.45, f.dy * 0.35 - 40, 0.95, -4), offset: 0.6, easing: 'ease-in' },
        { transform: at(f.dx, f.dy, 0.5, 0) },
      ],
      { duration: FLY_S * 1000, fill: 'forwards' },
    );
    return () => a.cancel();
  }, [f]);
  return (
    <span ref={ref} className="gm-flyer num" style={{ left: f.x, top: f.y, transform: 'translate(-50%, -50%) scale(0.4) rotate(-12deg)' }}>
      {f.text}
    </span>
  );
}
