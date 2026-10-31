import { ELYSIUM, SHADE } from '@elymum/shared';
import { useEffect, useState, type ReactElement } from 'react';
import { SceneCoin, useOffscreenPause, useReducedMotion } from '../../design';
import type { DocStrip } from './facts';

const INK = ELYSIUM.abyss;
const ln = { stroke: INK, strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

/* ── props the panels share ──────────────────────────────────────────── */

const Ground = ({ y = 112 }: { y?: number }) => <path d={`M-4 ${y} Q100 ${y - 8} 204 ${y}`} fill="none" {...ln} />;

function Token({ x, y, r = 6 }: { x: number; y: number; r?: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={ELYSIUM.sun} {...ln} strokeWidth={2} />
      <path d={`M${x - r * 0.45} ${y} H${x + r * 0.45}`} stroke={SHADE.sun} strokeWidth={2} strokeLinecap="round" />
    </g>
  );
}

function Seed({ x, y, paint = ELYSIUM.up }: { x: number; y: number; paint?: string }) {
  return <ellipse cx={x} cy={y} rx={5} ry={6.5} fill={paint} {...ln} strokeWidth={2} />;
}

function Ticket({ x, y, w = 46, h = 26 }: { x: number; y: number; w?: number; h?: number }) {
  return (
    <g>
      <path
        d={`M${x} ${y} h${w} v${h * 0.32} a${h * 0.18} ${h * 0.18} 0 0 0 0 ${h * 0.36} v${h * 0.32} h${-w} v${-h * 0.32} a${h * 0.18} ${h * 0.18} 0 0 0 0 ${-h * 0.36} Z`}
        fill={ELYSIUM.sun}
        {...ln}
        strokeWidth={2}
      />
      <path d={`M${x + w * 0.7} ${y + 3} V${y + h - 3}`} stroke={INK} strokeWidth={1.4} strokeDasharray="2 3" />
    </g>
  );
}

function Vault({ x, y, w = 62, h = 58 }: { x: number; y: number; w?: number; h?: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8} fill={ELYSIUM.teal} {...ln} />
      <rect x={x + 7} y={y + 7} width={w - 14} height={h - 14} rx={5} fill={SHADE.teal} {...ln} strokeWidth={2} />
      <circle cx={x + w / 2} cy={y + h / 2} r={10} fill={ELYSIUM.cream} {...ln} strokeWidth={2} />
      <path d={`M${x + w / 2} ${y + h / 2 - 10} V${y + h / 2 + 10} M${x + w / 2 - 10} ${y + h / 2} H${x + w / 2 + 10}`} stroke={INK} strokeWidth={1.6} />
      <rect x={x + w / 2 - 14} y={y - 4} width={28} height={6} rx={3} fill={INK} />
    </g>
  );
}

/** A panel's tiny speech bubble (SVG text, short). */
function Say({ x, y, text, w }: { x: number; y: number; text: string; w: number }) {
  return (
    <g className="cs-say">
      <path d={`M${x} ${y} h${w} a5 5 0 0 1 5 5 v12 a5 5 0 0 1 -5 5 H${x + w - 18} l-2 9 l-9 -9 H${x} a5 5 0 0 1 -5 -5 v-12 a5 5 0 0 1 5 -5 Z`} fill="#FFFFFF" {...ln} strokeWidth={2} />
      <text x={x + w / 2} y={y + 15} textAnchor="middle" className="cs-say__t">
        {text}
      </text>
    </g>
  );
}

/* ── the panels: 200 x 130, each a 4.8 s loop (static under reduced motion) ── */

type Panel = () => ReactElement;

const PANELS: Record<string, [Panel, Panel, Panel]> = {
  play: [
    () => (
      <g>
        <Ground />
        {[104, 128, 152].map((x, i) => (
          <g key={x} className={`cs-pop cs-pop--${i + 1}`} style={{ transformOrigin: `${x}px 96px` }}>
            <Seed x={x} y={96} paint={[ELYSIUM.up, ELYSIUM.sun, ELYSIUM.coral][i]} />
          </g>
        ))}
        <g className="cs-graze">
          <g className="cs-grow" style={{ transformOrigin: '50px 88px' }}>
            <SceneCoin x={50} y={84} r={22} paint="cyan" mood="chomp" look={[4, 0]} feet />
          </g>
        </g>
      </g>
    ),
    () => (
      <g>
        <Ground />
        <g className="cs-gulp" style={{ transformOrigin: '64px 70px' }}>
          <SceneCoin x={64} y={70} r={34} paint="sun" mood="chomp" look={[4, 1]} feet />
        </g>
        <g className="cs-slurp">
          <SceneCoin x={150} y={92} r={13} paint="spray" mood="scared" look={[-3, 0]} feet />
        </g>
      </g>
    ),
    () => (
      <g>
        <Ground />
        <g className="cs-chase">
          <SceneCoin x={14} y={58} r={46} paint="coral" mood="chomp" look={[4, 0]} />
        </g>
        <g className="cs-run">
          <path d="M120 84 h-16 M124 94 h-22 M118 104 h-14" {...ln} strokeWidth={2} className="cs-lines" />
          <SceneCoin x={146} y={94} r={14} paint="cyan" mood="scared" look={[4, 0]} feet />
        </g>
      </g>
    ),
  ],
  rooms: [
    () => (
      <g>
        <Ground />
        <g className="cs-bounce">
          <SceneCoin x={100} y={84} r={20} paint="cyan" mood="happy" feet />
        </g>
        <g className="cs-bounce" style={{ animationDelay: '-0.4s' }}>
          <SceneCoin x={46} y={92} r={13} paint="bot" mood="smile" antenna feet />
        </g>
        <g className="cs-bounce" style={{ animationDelay: '-0.8s' }}>
          <SceneCoin x={154} y={92} r={13} paint="bot" mood="smile" antenna feet />
        </g>
        <g transform="rotate(-8 150 34)">
          <rect x={126} y={22} width={50} height={22} rx={5} fill={ELYSIUM.up} {...ln} strokeWidth={2} />
          <text x={151} y={37} textAnchor="middle" className="cs-tag">
            FREE
          </text>
        </g>
      </g>
    ),
    () => (
      <g>
        <Ground />
        <path d="M120 112 V48 A28 28 0 0 1 176 48 V112" fill={ELYSIUM.mist} {...ln} />
        <path d="M130 112 V52 A18 18 0 0 1 166 52 V112" fill={ELYSIUM.trench} {...ln} strokeWidth={2} />
        <SceneCoin x={70} y={88} r={22} paint="spray" mood="smile" look={[4, -1]} feet />
        <g className="cs-hold" style={{ transformOrigin: '96px 72px' }}>
          <Ticket x={86} y={58} w={40} h={24} />
          <circle className="cs-punch" cx={100} cy={70} r={4} fill={INK} />
        </g>
      </g>
    ),
    () => (
      <g>
        <Ground />
        <Vault x={114} y={50} />
        <g className="cs-slot">
          <Ticket x={40} y={34} w={40} h={24} />
        </g>
        <g className="cs-shine">
          <path d="M108 40 l-6 -6 M145 32 v-9 M182 40 l6 -6" {...ln} strokeWidth={2} />
        </g>
      </g>
    ),
  ],
  value: [
    () => (
      <g>
        <Ground />
        <g className="cs-lunge">
          <SceneCoin x={56} y={76} r={28} paint="cyan" mood="chomp" look={[4, 0]} feet />
        </g>
        <SceneCoin x={150} y={92} r={16} paint="blush" mood="scared" look={[-4, 0]} feet />
        <Token x={150} y={62} r={7} />
        <Token x={164} y={56} r={6} />
      </g>
    ),
    () => (
      <g>
        <Ground />
        <SceneCoin x={56} y={74} r={32} paint="cyan" mood="happy" feet />
        {[0, 1, 2].map((i) => (
          <g key={i} className="cs-hop" style={{ animationDelay: `${i * 0.35}s` }}>
            <Token x={156} y={96} r={7} />
          </g>
        ))}
      </g>
    ),
    () => (
      <g>
        <Ground />
        <g className="cs-wobble" style={{ transformOrigin: '96px 92px' }}>
          <SceneCoin x={96} y={86} r={22} paint="bot" mood="smile" antenna feet />
        </g>
        <g transform="rotate(6 152 46)">
          <rect x={132} y={34} width={40} height={24} rx={5} fill={ELYSIUM.cream} {...ln} strokeWidth={2} />
          <text x={152} y={51} textAnchor="middle" className="cs-tag cs-tag--ink">
            0
          </text>
        </g>
        <path d="M128 52 L118 62" {...ln} strokeWidth={2} />
      </g>
    ),
  ],
  payout: [
    () => (
      <g>
        <Ground />
        <circle cx={100} cy={60} r={36} fill={ELYSIUM.cream} {...ln} />
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return <path key={i} d={`M${100 + Math.cos(a) * 29} ${60 + Math.sin(a) * 29} L${100 + Math.cos(a) * 33} ${60 + Math.sin(a) * 33}`} stroke={INK} strokeWidth={i % 3 === 0 ? 2.6 : 1.4} strokeLinecap="round" />;
        })}
        <path d="M100 60 L100 40" {...ln} strokeWidth={3} />
        <g className="cs-hand" style={{ transformOrigin: '100px 60px' }}>
          <path d="M100 60 L100 32" stroke={ELYSIUM.down} strokeWidth={2.4} strokeLinecap="round" />
        </g>
        <circle cx={100} cy={60} r={3.5} fill={INK} />
        <g className="cs-trot">
          <SceneCoin x={40} y={102} r={10} paint="sun" mood="smile" feet />
          <SceneCoin x={160} y={102} r={10} paint="teal" mood="smile" feet />
        </g>
      </g>
    ),
    () => (
      <g>
        <Ground />
        <path d="M100 8 V18" {...ln} />
        <g className="cs-bell" style={{ transformOrigin: '100px 18px' }}>
          <path d="M72 76 Q72 30 100 22 Q128 30 128 76 Q134 82 100 82 Q66 82 72 76 Z" fill={ELYSIUM.sun} {...ln} />
          <path d="M82 70 Q82 42 96 32" fill="none" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" opacity={0.7} />
          <circle cx={100} cy={88} r={6} fill={SHADE.sun} {...ln} strokeWidth={2} />
        </g>
        <g className="cs-ring" fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round">
          <path d="M56 40 Q46 54 56 68 M44 34 Q30 54 44 74" />
          <path d="M144 40 Q154 54 144 68 M156 34 Q170 54 156 74" />
        </g>
        <SceneCoin x={36} y={102} r={11} paint="cyan" mood="happy" feet />
        <SceneCoin x={166} y={102} r={11} paint="spray" mood="happy" feet />
      </g>
    ),
    () => (
      <g>
        <Ground />
        {/* the till at the bell: the entry back, the profit on top; a thin slice of profit goes to the fee wallet */}
        <rect x={40} y={64} width={64} height={44} rx={4} fill={ELYSIUM.sand2} {...ln} strokeWidth={2} />
        <rect x={40} y={26} width={64} height={38} rx={4} fill={ELYSIUM.sun} {...ln} strokeWidth={2} />
        <g className="cs-slice">
          <rect x={40} y={20} width={64} height={7} rx={2} fill={ELYSIUM.coral} {...ln} strokeWidth={2} />
        </g>
        <path d="M112 86 h12 M112 45 h12" stroke={INK} strokeWidth={1.4} strokeDasharray="2 3" />
        <text x={128} y={90} className="cs-note">
          entry
        </text>
        <text x={128} y={49} className="cs-note">
          profit
        </text>
        <rect x={118} y={6} width={42} height={20} rx={5} fill={ELYSIUM.cream} {...ln} strokeWidth={2} />
        <text x={139} y={20} textAnchor="middle" className="cs-note">
          fee
        </text>
      </g>
    ),
  ],
  fair: [
    () => (
      <g>
        <Ground />
        <Vault x={68} y={44} w={64} h={62} />
        <g fill="none" stroke={INK} strokeWidth={2.2}>
          {[24, 40, 56, 144, 160, 176].map((x, i) => (i % 2 ? <ellipse key={x} cx={x} cy={74} rx={8} ry={3} fill={ELYSIUM.sand2} /> : <ellipse key={x} cx={x} cy={74} rx={8} ry={5.5} />))}
        </g>
        <g className="cs-lock">
          <path d="M92 36 V26 a8 8 0 0 1 16 0 V36" fill="none" {...ln} strokeWidth={3} />
        </g>
        <rect x={88} y={34} width={24} height={18} rx={4} fill={ELYSIUM.sun} {...ln} strokeWidth={2} />
      </g>
    ),
    () => (
      <g>
        <Ground />
        <rect x={56} y={28} width={88} height={78} rx={8} fill={ELYSIUM.reef} {...ln} />
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <rect x={66} y={38 + i * 22} width={68} height={16} rx={3} fill={ELYSIUM.trench} {...ln} strokeWidth={1.8} />
            <circle className="cs-led" style={{ animationDelay: `${i * 0.4}s` }} cx={76} cy={46 + i * 22} r={3} fill={ELYSIUM.up} />
            <circle className="cs-led" style={{ animationDelay: `${i * 0.4 + 0.2}s` }} cx={86} cy={46 + i * 22} r={3} fill={ELYSIUM.sun} />
            <path d={`M100 ${46 + i * 22} h26`} stroke={ELYSIUM.foam} strokeWidth={2} strokeLinecap="round" />
          </g>
        ))}
        <g className="cs-gear" style={{ transformOrigin: '160px 44px' }}>
          <circle cx={160} cy={44} r={10} fill={ELYSIUM.sand2} {...ln} strokeWidth={2} strokeDasharray="5 3" />
          <circle cx={160} cy={44} r={3.5} fill={INK} />
        </g>
      </g>
    ),
    () => (
      <g>
        <Ground />
        <path d="M110 30 h60 v72 h-60 Z" fill={ELYSIUM.cream} {...ln} />
        <path d="M118 44 h44 M118 54 h40 M118 64 h44 M118 74 h30 M118 84 h38" stroke={ELYSIUM.stone} strokeWidth={2} strokeLinecap="round" />
        <SceneCoin x={56} y={86} r={22} paint="up" mood="smile" look={[4, -2]} feet />
        <g className="cs-lens">
          <path d="M98 76 L84 90" stroke={INK} strokeWidth={5} strokeLinecap="round" />
          <circle cx={106} cy={66} r={13} fill={ELYSIUM.mist} fillOpacity={0.6} {...ln} />
        </g>
      </g>
    ),
  ],
  wallet: [
    () => (
      <g>
        <Ground />
        <SceneCoin x={150} y={86} r={22} paint="coral" mood="smile" look={[-4, 0]} feet />
        <path d="M124 70 h52 v-6 a4 4 0 0 0 -4 -4 h-44 a4 4 0 0 0 -4 4 Z" fill={INK} />
        <path d="M134 79 h12 M154 79 h12" stroke={INK} strokeWidth={6} strokeLinecap="round" />
        <Say x={74} y={14} w={96} text="your phrase?" />
        <SceneCoin x={46} y={94} r={14} paint="cyan" mood="scared" look={[4, 0]} feet />
      </g>
    ),
    () => (
      <g>
        <Ground />
        <SceneCoin x={70} y={84} r={26} paint="cyan" mood="worried" look={[3, 0]} feet />
        <g className="cs-stamp" style={{ transformOrigin: '146px 54px' }}>
          <g transform="rotate(-10 146 54)">
            <rect x={116} y={36} width={60} height={36} rx={7} fill="none" stroke={ELYSIUM.down} strokeWidth={4} />
            <text x={146} y={63} textAnchor="middle" className="cs-no">
              NO
            </text>
          </g>
        </g>
      </g>
    ),
    () => (
      <g>
        <Ground />
        <path d="M100 24 h64 v80 h-64 Z" fill="#FFFFFF" {...ln} />
        <path d="M108 38 h48 M108 48 h40 M108 58 h46" stroke={ELYSIUM.stone} strokeWidth={2} strokeLinecap="round" />
        <path className="cs-check" d="M112 80 l10 10 l22 -24" fill="none" stroke={ELYSIUM.up} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
        <SceneCoin x={56} y={86} r={22} paint="cyan" mood="happy" feet />
      </g>
    ),
  ],
};

/**
 * The comic strip that opens a handbook section: three small panels of coins acting out the
 * rule (eat smaller, the ticket, the bell, the fee on profit...). Each panel loops a short
 * scene while it is on screen; under reduced motion the panels stand still. The captions are
 * real text (content.en.ts), the drawings are decoration.
 */
export function ComicStrip({ id, strip }: { id: string; strip: DocStrip }) {
  const reduced = useReducedMotion();
  const [ref, visible] = useOffscreenPause<HTMLElement>();
  // the drawings mount the first time the strip comes near the screen (a long page stays light)
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return setSeen(true);
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  const panels = PANELS[id];
  if (!panels) return null;
  return (
    <figure ref={ref} className={`cs${reduced ? ' is-still' : ''}`} data-paused={!visible || undefined} data-strip={id}>
      <figcaption className="cs__label mono">{strip.label}</figcaption>
      <ol className="cs__row" tabIndex={0} aria-label={strip.label}>
        {panels.map((Art, i) => (
          <li key={i} className="cs__panel" style={{ ['--tilt' as string]: `${[-1.2, 0.6, -0.4][i]}deg` }}>
            <svg className="cs__art" viewBox="0 0 200 130" aria-hidden="true" focusable="false">
              <rect width={200} height={130} fill={[ELYSIUM.mist, ELYSIUM.cream, ELYSIUM.linen][i]} />
              {seen && <Art />}
            </svg>
            <span className="cs__no mono" aria-hidden="true">
              {i + 1}
            </span>
            <p className="cs__cap">{strip.panels[i]}</p>
          </li>
        ))}
      </ol>
    </figure>
  );
}
