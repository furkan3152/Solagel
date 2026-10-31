import { ELYSIUM, SHADE } from '@elymum/shared';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { SceneCoin, useOffscreenPause, useReducedMotion, type SceneCoinMood } from '../design';
import './launch-scene.css';

export type SceneStageId = 'wl' | 'deploy' | 'allowlist' | 'mint' | 'game';
export type SceneStageState = 'done' | 'now' | 'todo' | 'unknown';
export interface SceneStage {
  id: SceneStageId;
  title: string;
  state: SceneStageState;
}

const INK = ELYSIUM.abyss;
const W = 960;
const H = 300;
/** Where each build site stands on the middle terrace (x, and the ground there). */
const SITE_X = [100, 290, 480, 670, 860];
const groundY = (x: number) => {
  const t = x / W;
  return 232 - 160 * t * (1 - t);
};

/** Phones get a close-up of the site being built instead of the whole plain. */
function useNarrow(): boolean {
  const q = '(max-width: 560px)';
  const [m, setM] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return m;
}

/** No pointer or key for `ms` (or the tab is hidden): the foreman naps. */
export function useIdle(ms: number): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), ms);
    };
    const vis = () => (document.hidden ? setIdle(true) : wake());
    wake();
    const evs = ['pointermove', 'pointerdown', 'keydown', 'scroll', 'wheel'] as const;
    for (const e of evs) window.addEventListener(e, wake, { passive: true });
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearTimeout(t);
      for (const e of evs) window.removeEventListener(e, wake);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [ms]);
  return idle;
}

/* ── the five pieces of the world, drawn from their ground line up ───────── */

const st = { stroke: INK, strokeWidth: 2.6, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };

/** Terrace 1, the whitelist: a camp at the foot of the ring (a tent, a signpost, a queue). */
function Camp({ queue }: { queue: number }) {
  return (
    <g>
      <path d="M-58 0 L-30 -52 L-2 0 Z" fill={ELYSIUM.cream} {...st} />
      <path d="M-30 -52 L-30 0 M-40 0 L-30 -18 L-20 0" fill={SHADE.cream} {...st} />
      <path d="M-30 -52 V-70" {...st} fill="none" />
      <path className="ls-flag" d="M-30 -70 L-12 -65 L-30 -60 Z" fill={ELYSIUM.coral} {...st} />
      <path d="M22 0 V-46" {...st} fill="none" />
      <rect x={4} y={-62} width={44} height={22} rx={4} fill={ELYSIUM.sun} {...st} />
      <text x={26} y={-46} textAnchor="middle" className="ls-sign">WL</text>
      {Array.from({ length: Math.min(queue, 3) }, (_, i) => (
        <g key={i} className="ls-queue" style={{ animationDelay: `${i * 0.35}s` }}>
          <SceneCoin x={62 + i * 20} y={-10} r={9} stroke={2} paint={(['spray', 'cream', 'blush'] as const)[i]} mood="smile" feet />
        </g>
      ))}
    </g>
  );
}

/** Terrace 2, the contracts: the arch of the ring's gate. */
function Arch() {
  return (
    <g>
      <path d="M-50 0 V-74 A50 50 0 0 1 50 -74 V0 H28 V-70 A28 28 0 0 0 -28 -70 V0 Z" fill={ELYSIUM.teal} {...st} />
      <path d="M38 0 V-74 A40 40 0 0 0 30 -98" fill="none" stroke={SHADE.teal} strokeWidth={8} />
      <path d="M-50 -30 H-28 M-50 -56 H-28 M28 -30 H50 M28 -56 H50 M-44 -96 L-26 -84 M44 -96 L26 -84" stroke={INK} strokeWidth={2} />
      <path d="M-10 -126 L10 -126 L7 -98 L-7 -98 Z" fill={ELYSIUM.sun} {...st} />
      <path d="M-40 -90 A44 44 0 0 1 -14 -118" fill="none" stroke="#FFFFFF" strokeWidth={3.5} strokeLinecap="round" opacity={0.6} />
    </g>
  );
}

/** Terrace 3, the allowlist: a gate that only opens for the listed. */
function Gate() {
  return (
    <g>
      <rect x={-48} y={-78} width={14} height={78} rx={3} fill={ELYSIUM.spray} {...st} />
      <rect x={34} y={-78} width={14} height={78} rx={3} fill={ELYSIUM.spray} {...st} />
      <circle cx={-41} cy={-84} r={8} fill={ELYSIUM.sun} {...st} />
      <circle cx={41} cy={-84} r={8} fill={ELYSIUM.sun} {...st} />
      <g className="ls-gate__l">
        <path d="M-34 -62 H-2 V-6 H-34 Z M-26 -62 V-6 M-18 -62 V-6 M-10 -62 V-6" fill="none" {...st} />
      </g>
      <g className="ls-gate__r">
        <path d="M34 -62 H2 V-6 H34 Z M26 -62 V-6 M18 -62 V-6 M10 -62 V-6" fill="none" {...st} />
      </g>
      <path d="M-48 -104 Q0 -124 48 -104" fill="none" {...st} />
      <circle cx={0} cy={-114} r={11} fill={ELYSIUM.cream} {...st} />
      <path d="M-5 -114 l4 4 l7 -8" fill="none" stroke={ELYSIUM.up} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

/** Terrace 4, the mint: a screw press that stamps out emblems. */
function Press({ live }: { live: boolean }) {
  return (
    <g>
      <rect x={-46} y={-14} width={92} height={14} rx={3} fill={ELYSIUM.coral} {...st} />
      <rect x={-40} y={-104} width={12} height={90} fill={ELYSIUM.sand2} {...st} />
      <rect x={28} y={-104} width={12} height={90} fill={ELYSIUM.sand2} {...st} />
      <rect x={-48} y={-116} width={96} height={16} rx={4} fill={ELYSIUM.coral} {...st} />
      <g className={live ? 'ls-press__ram' : undefined}>
        <path d="M-3 -150 V-60" stroke={INK} strokeWidth={7} strokeLinecap="round" />
        <path d="M-3 -150 V-60" stroke={ELYSIUM.stone} strokeWidth={3} strokeDasharray="3 4" />
        <rect x={-22} y={-62} width={38} height={12} rx={3} fill={ELYSIUM.stone} {...st} />
        <g className={live ? 'ls-press__wheel' : undefined} style={{ transformOrigin: '-3px -152px' }}>
          <ellipse cx={-3} cy={-152} rx={30} ry={6} fill="none" {...st} />
          <circle cx={-33} cy={-152} r={4} fill={ELYSIUM.sun} {...st} />
          <circle cx={27} cy={-152} r={4} fill={ELYSIUM.sun} {...st} />
        </g>
      </g>
      <g className={live ? 'ls-press__coin' : undefined}>
        <ellipse cx={-3} cy={-20} rx={13} ry={5} fill={ELYSIUM.sun} {...st} />
      </g>
      {live && (
        <g className="ls-press__out">
          <SceneCoin x={-3} y={-30} r={9} stroke={2} paint="sun" mood="happy" />
        </g>
      )}
    </g>
  );
}

/** Terrace 5, the game: a string of lanterns over the plaza. Lit when the doors open. */
function Lights({ lit }: { lit: boolean }) {
  const lamps = [-42, -21, 0, 21, 42];
  const sag = (x: number) => -92 + 18 * (1 - (x / 54) ** 2);
  return (
    <g className={lit ? 'is-lit' : undefined}>
      <ellipse cx={0} cy={-2} rx={58} ry={7} fill={ELYSIUM.sand} {...st} />
      <path d="M-56 0 V-100 M56 0 V-100" {...st} fill="none" />
      <path d="M-56 -94 Q0 -56 56 -94" fill="none" stroke={INK} strokeWidth={2} />
      {lamps.map((x, i) => (
        <g key={x} className="ls-lamp" style={{ animationDelay: `${i * 0.3}s` }}>
          {lit && <circle className="ls-lamp__glow" cx={x} cy={sag(x) + 8} r={13} fill={ELYSIUM.sun} opacity={0.35} />}
          <rect x={x - 5} y={sag(x)} width={10} height={14} rx={4} fill={lit ? ELYSIUM.sun : ELYSIUM.sand2} {...st} strokeWidth={2} />
        </g>
      ))}
      {lit && (
        <g>
          <g className="ls-dancer">
            <SceneCoin x={-24} y={-14} r={11} stroke={2} paint="cyan" mood="happy" feet />
          </g>
          <g className="ls-dancer ls-dancer--b">
            <SceneCoin x={22} y={-14} r={11} stroke={2} paint="up" mood="happy" feet />
          </g>
        </g>
      )}
    </g>
  );
}

/** The tower crane that stands over the terrace being built, swinging its next block in. */
function Crane({ x, y, reduced }: { x: number; y: number; reduced: boolean }) {
  const top = 44;
  const mast = x + 64;
  const tip = x - 6;
  return (
    <g className="ls-crane">
      <rect x={mast - 14} y={y - 8} width={28} height={10} rx={2} fill={ELYSIUM.stone} {...st} />
      <path d={`M${mast - 7} ${y - 8} V${top} M${mast + 7} ${y - 8} V${top}`} {...st} fill="none" />
      <path
        d={Array.from({ length: Math.floor((y - 8 - top) / 16) }, (_, i) => `M${mast - 7} ${y - 8 - i * 16} L${mast + 7} ${y - 24 - i * 16}`).join(' ')}
        stroke={INK}
        strokeWidth={1.6}
        fill="none"
      />
      <path d={`M${tip} ${top} H${mast + 34} M${tip} ${top + 10} H${mast + 34}`} {...st} fill="none" />
      <path
        d={Array.from({ length: Math.floor((mast + 34 - tip) / 12) }, (_, i) => `M${tip + i * 12} ${top + 10} L${tip + i * 12 + 6} ${top}`).join(' ')}
        stroke={INK}
        strokeWidth={1.4}
      />
      <path d={`M${mast} ${top} L${mast} ${top - 22} L${tip + 10} ${top} M${mast} ${top - 22} L${mast + 34} ${top}`} stroke={INK} strokeWidth={1.6} fill="none" />
      <rect x={mast + 16} y={top + 10} width={18} height={16} rx={2} fill={ELYSIUM.stone} {...st} />
      <rect x={mast - 9} y={top + 12} width={18} height={14} rx={3} fill={ELYSIUM.sun} {...st} />
      <g className={reduced ? undefined : 'ls-crane__trolley'}>
        <rect x={x - 6} y={top + 8} width={16} height={6} rx={2} fill={ELYSIUM.stone} {...st} strokeWidth={2} />
        <g className={reduced ? undefined : 'ls-crane__load'} style={{ transformOrigin: `${x + 2}px ${top + 14}px` }}>
          <path className="ls-crane__cable" d={`M${x + 2} ${top + 14} V${top + 70}`} stroke={INK} strokeWidth={1.6} />
          <g className="ls-crane__block">
            <path d={`M${x - 6} ${top + 70} L${x + 2} ${top + 62} L${x + 10} ${top + 70}`} fill="none" stroke={INK} strokeWidth={1.6} />
            <rect x={x - 12} y={top + 70} width={28} height={18} rx={3} fill={ELYSIUM.sun} {...st} />
            <path d={`M${x - 12} ${top + 79} H${x + 16}`} stroke={SHADE.sun} strokeWidth={3} />
          </g>
        </g>
      </g>
    </g>
  );
}

export type ForemanMood = 'ok' | 'thumbs' | 'worried' | 'sleep';

/** The workshop foreman: a small coin in a hard hat who reacts to how the launch is going. */
export function Foreman({ mood, x = 0, y = 0, r = 18 }: { mood: ForemanMood; x?: number; y?: number; r?: number }) {
  const face: SceneCoinMood = mood === 'thumbs' ? 'happy' : mood === 'worried' ? 'worried' : mood === 'sleep' ? 'sleepy' : 'smile';
  const k = r / 18;
  return (
    <g className={`ls-foreman is-${mood}`} transform={`translate(${x} ${y})`}>
      <g className="ls-foreman__body">
        <ellipse cx={0} cy={r * 1.25} rx={r * 0.85} ry={r * 0.14} fill={INK} opacity={0.18} />
        <SceneCoin r={r} paint="cream" mood={face} hat feet look={mood === 'ok' ? [3, -2] : [0, 0]} blink={mood === 'ok'} />
        {mood === 'thumbs' && (
          <g className="ls-foreman__thumb" transform={`translate(${r * 0.95} ${-r * 0.1}) scale(${k})`}>
            <path d="M-4 6 Q2 -2 6 -4" fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round" />
            <rect x={3} y={-12} width={10} height={9} rx={3.5} fill={ELYSIUM.cream} stroke={INK} strokeWidth={2} />
            <path d="M8 -12 V-19 Q8 -22 11 -21 Q13 -20 12 -12" fill={ELYSIUM.cream} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
          </g>
        )}
        {mood === 'worried' && <path className="kb-coin__sweat" d={`M${r * 0.85} ${-r * 0.75} q${3 * k} ${4.5 * k} 0 ${6.5 * k} q${-3 * k} ${-2 * k} 0 ${-6.5 * k}Z`} fill={ELYSIUM.mist} stroke={INK} strokeWidth={1.6} />}
        {mood === 'sleep' && (
          <g className="kb-coin__zzz" fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d={`M${r * 0.9} ${-r * 1.5} h6 l-6 7 h6`} />
            <path d={`M${r * 1.4} ${-r * 2.1} h4.5 l-4.5 5 h4.5`} opacity={0.7} />
          </g>
        )}
      </g>
    </g>
  );
}

/** A small hand-lettered speech bubble (SVG). */
function Bubble({ x, y, text, flip = false }: { x: number; y: number; text: string; flip?: boolean }) {
  const w = Math.max(54, text.length * 7.4 + 22);
  const left = flip ? x - w + 22 : x - 22;
  return (
    <g className="ls-bubble">
      <path
        d={`M${left} ${y - 30} h${w} a6 6 0 0 1 6 6 v14 a6 6 0 0 1 -6 6 H${x + 8} l-8 9 l-1 -9 H${left} a6 6 0 0 1 -6 -6 v-14 a6 6 0 0 1 6 -6 Z`}
        fill="#FFFFFF"
        {...st}
        strokeWidth={2.2}
      />
      <text x={left + w / 2} y={y - 13} textAnchor="middle" className="ls-bubble__t">
        {text}
      </text>
    </g>
  );
}

/**
 * The Launch checklist as a construction scene on the ring: each terrace of the launch is a
 * building site on the plain (WL = the camp, Deploy = the arch, Allowlist = the gate, Mint =
 * the press, Game = the lanterns). Done sites stand built (dropped in on arrival, a puff of
 * dust); the site being worked on gets the crane; the rest are blueprints. A foreman coin in a
 * hard hat reacts: looks up at the crane, worries on mainnet, gives a thumbs up when all is
 * lit, naps when the tab sits idle. Decorative: the checklist below carries every fact.
 */
export function LaunchScene({ stages, mainnet, wlQueue }: { stages: SceneStage[]; mainnet: boolean; wlQueue: number }) {
  const reduced = useReducedMotion();
  const narrow = useNarrow();
  const [ref, visible] = useOffscreenPause<SVGSVGElement>();
  const idle = useIdle(45_000);
  const nowIdx = stages.findIndex((s) => s.state === 'now');
  const built = stages.filter((s) => s.state === 'done').length;
  const allDone = built === stages.length;
  const mood: ForemanMood = idle ? 'sleep' : allDone ? 'thumbs' : mainnet ? 'worried' : 'ok';
  const fx = nowIdx === 0 ? SITE_X[0] + 112 : nowIdx > 0 ? SITE_X[nowIdx] - 98 : allDone ? SITE_X[4] - 92 : 40;
  const fy = groundY(fx) + 22;
  const speech =
    mood === 'sleep' ? 'zzz…' : mood === 'thumbs' ? 'Lights on!' : mood === 'worried' ? 'Mainnet. Read twice.' : nowIdx >= 0 ? `Next up: ${stages[nowIdx].title}` : 'Reading the plans…';
  // on arrival the built sites drop in one by one; a site finished later drops in at once
  const arriving = useRef(true);
  useEffect(() => {
    const t = setTimeout(() => (arriving.current = false), 2000);
    return () => clearTimeout(t);
  }, []);

  const piece = (s: SceneStage): ReactElement => {
    const live = s.state === 'done';
    switch (s.id) {
      case 'wl':
        return <Camp queue={live ? Math.max(1, wlQueue) : 0} />;
      case 'deploy':
        return <Arch />;
      case 'allowlist':
        return <Gate />;
      case 'mint':
        return <Press live={live && !reduced} />;
      default:
        return <Lights lit={live} />;
    }
  };

  return (
    <figure className="ls" data-testid="launch-scene">
      <svg
        ref={ref}
        className={`ls__svg${reduced ? ' is-reduced' : ''}`}
        viewBox={narrow ? `${Math.min(W - 480, Math.max(0, (nowIdx >= 0 ? SITE_X[nowIdx] : allDone ? SITE_X[4] : W / 2) - 230))} 0 480 ${H}` : `0 0 ${W} ${H}`}
        role="img"
        aria-label={`The ring under construction: ${built} of ${stages.length} terraces built${nowIdx >= 0 ? `, ${stages[nowIdx].title} is next` : ''}.`}
        data-paused={!visible || undefined}
      >
        <defs>
          <linearGradient id="ls-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={ELYSIUM.foam} />
            <stop offset="0.75" stopColor={ELYSIUM.mist} />
          </linearGradient>
        </defs>
        <g>
          <rect width={W} height={H} fill="url(#ls-sky)" />
          {/* the far side of the ring, arching over the sky with its lit windows */}
          <path d={`M-40 260 Q${W / 2} -150 ${W + 40} 260`} fill="none" stroke={ELYSIUM.teal} strokeWidth={16} opacity={0.5} />
          <path d={`M-40 260 Q${W / 2} -150 ${W + 40} 260`} fill="none" stroke={ELYSIUM.cream} strokeWidth={3} strokeDasharray="2 14" opacity={0.9} />
          <circle cx={W / 2} cy={236} r={120} fill={ELYSIUM.spray} stroke={INK} strokeWidth={2.4} opacity={0.9} />
          <path d={`M${W / 2 - 84} 156 q30 -24 70 -10 q20 10 50 -4 q10 20 -30 28 q-60 6 -90 -14Z`} fill={ELYSIUM.verdant} opacity={0.7} />
          <g className="ls-cloud">
            <path d="M120 70 q6 -18 26 -14 q10 -16 30 -6 q20 -2 20 16 q0 10 -12 10 h-56 q-12 0 -8 -6Z" fill="#FFFFFF" {...st} strokeWidth={2.2} />
          </g>
          <g className="ls-cloud ls-cloud--b">
            <path d="M700 52 q6 -14 22 -10 q10 -12 24 -4 q16 0 16 12 q0 8 -10 8 h-46 q-10 0 -6 -6Z" fill="#FFFFFF" {...st} strokeWidth={2.2} />
          </g>
          {/* terraces of the plain, curving up with the ring */}
          <path d={`M0 196 Q${W / 2} 120 ${W} 196 V${H} H0Z`} fill={ELYSIUM.meadow} {...st} />
          <path d={`M0 232 Q${W / 2} 152 ${W} 232 V${H} H0Z`} fill={ELYSIUM.clover} {...st} />
          <path d={`M0 236 Q${W / 2} 156 ${W} 236`} fill="none" stroke="#FFFFFF" strokeWidth={3} strokeDasharray="1 9" strokeLinecap="round" opacity={0.85} />
          <path d={`M0 276 Q${W / 2} 216 ${W} 276 V${H} H0Z`} fill={ELYSIUM.verdant} {...st} />
          {[48, 214, 420, 548, 724, 922].map((tx, i) => (
            <g key={tx} transform={`translate(${tx} ${296 - 120 * (tx / W) * (1 - tx / W) + (i % 2) * 4})`}>
              <path d="M0 0 V-10" {...st} strokeWidth={2} />
              <circle cy={-16} r={8} fill={ELYSIUM.forest} {...st} strokeWidth={2} />
            </g>
          ))}

          {stages.map((s, i) => {
            const x = SITE_X[i];
            const y = groundY(x);
            const fresh = !arriving.current;
            return (
              <g key={s.id} transform={`translate(${x} ${y})`} className={`ls-site is-${s.state}`} data-site={s.id}>
                {s.state === 'done' ? (
                  <g className="ls-piece" style={{ animationDelay: fresh ? '0s' : `${0.25 + i * 0.22}s` }}>
                    {piece(s)}
                  </g>
                ) : (
                  <g className="ls-ghost">{piece(s)}</g>
                )}
                {s.state === 'done' && (
                  <g className="ls-dust" style={{ animationDelay: fresh ? '0.32s' : `${0.57 + i * 0.22}s` }}>
                    <circle cx={-34} cy={-4} r={7} fill="#FFFFFF" stroke={INK} strokeWidth={1.6} />
                    <circle cx={36} cy={-5} r={6} fill="#FFFFFF" stroke={INK} strokeWidth={1.6} />
                    <circle cx={-48} cy={-10} r={4} fill="#FFFFFF" stroke={INK} strokeWidth={1.4} />
                  </g>
                )}
                <g className="ls-plate" transform="translate(0 30)">
                  <rect x={-(s.title.length * 3.3 + 22)} y={-11} width={s.title.length * 6.6 + 44} height={20} rx={6} fill={s.state === 'done' ? ELYSIUM.cream : '#FFFFFF'} {...st} strokeWidth={2} />
                  <text y={4} textAnchor="middle" className="ls-plate__t">
                    {`${i + 1} · ${s.title}`}
                  </text>
                </g>
              </g>
            );
          })}
          {nowIdx >= 0 && <Crane x={SITE_X[nowIdx]} y={groundY(SITE_X[nowIdx])} reduced={reduced} />}
          <Foreman mood={mood} x={fx} y={fy} r={17} />
          <Bubble x={fx + 4} y={fy - 40} text={speech} flip={fx > 260} />
        </g>
      </svg>
    </figure>
  );
}
