import { motion } from 'motion/react';
import type { AnchorHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { CoinCharacter, FoodBit, Icon, useReducedMotion, type CoinMood, type FoodKind, type IconName, type SeedPaint } from '../../design';
import { Link } from '../router';
import { WaxSeal } from './MintRitual';

/* ------------------------------------------------------------------ */
/* The night sky of the mint plate                                    */
/* ------------------------------------------------------------------ */

const STARS: [number, number, number][] = [
  [120, 80, 2],
  [380, 40, 1.6],
  [700, 70, 2.2],
  [1010, 40, 1.8],
  [1330, 110, 2],
  [260, 200, 1.6],
  [1240, 260, 1.6],
  [60, 330, 1.4],
  [880, 150, 1.3],
  [530, 260, 1.2],
];

/** Four-point sparkle, the reference's little star. */
const sparkle = (r: number) => `M0 ${-r} Q${r * 0.15} ${-r * 0.15} ${r} 0 Q${r * 0.15} ${r * 0.15} 0 ${r} Q${-r * 0.15} ${r * 0.15} ${-r} 0 Q${-r * 0.15} ${-r * 0.15} 0 ${-r}Z`;

/** Stars, two sparkles and the far ring drawn as one dotted arc. Decorative. */
export function MintSky() {
  return (
    <svg className="mt-sky" viewBox="0 0 1440 760" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <path className="mt-sky__ring" d="M-80 520 C 220 -40, 1220 -40, 1520 520" />
      <path className="mt-sky__ring mt-sky__ring--lights" d="M-80 520 C 220 -40, 1220 -40, 1520 520" />
      <g className="mt-sky__stars">
        {STARS.map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} style={{ animationDelay: `${-(i * 0.7) % 4}s` }} />
        ))}
      </g>
      <path className="mt-sky__spark mt-sky__spark--sun" d={sparkle(9)} transform="translate(1380 60)" />
      <path className="mt-sky__spark mt-sky__spark--foam" d={sparkle(7)} transform="translate(560 120)" />
      <path className="mt-sky__spark mt-sky__spark--foam" d={sparkle(5)} transform="translate(1180 330)" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* WL -> MINT -> PLAY                                                 */
/* ------------------------------------------------------------------ */

export type TrackStage = 'wl' | 'mint' | 'play';
const STAGES: { id: TrackStage; label: string }[] = [
  { id: 'wl', label: 'WL' },
  { id: 'mint', label: 'Mint' },
  { id: 'play', label: 'Play' },
];

/** The three stops of the journey, the current one a sun sticker, the ones behind ticked. */
export function MintTrack({ at }: { at: TrackStage }) {
  const idx = STAGES.findIndex((s) => s.id === at);
  return (
    <ol className="mt-track" aria-label="WL, then mint, then play">
      {STAGES.map((s, i) => (
        <li key={s.id} className={`mt-track__stop${i === idx ? ' is-on' : ''}${i < idx ? ' is-past' : ''}`} aria-current={i === idx ? 'step' : undefined}>
          {i < idx && <Icon name="check" size={14} />}
          {s.label}
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* The sealed emblem panel                                            */
/* ------------------------------------------------------------------ */

/** The emblem panel of the mint sticker: a coin on concentric rings over a seigaiha back, a NO. tag and a ribbon. */
export function EmblemPanel({
  no,
  mood = 'smug',
  ribbon,
  ribbonAs = 'span',
  phase,
  phaseTone = 'idle',
  seal = null,
}: {
  no: string;
  mood?: CoinMood;
  ribbon: ReactNode;
  /** The ribbon is the state heading in some states. */
  ribbonAs?: 'span' | 'h2';
  phase: ReactNode;
  phaseTone?: 'idle' | 'live' | 'done';
  /** The wax seal on the ribbon: pressed, trembling (a mint in flight), or none. */
  seal?: 'sealed' | 'trembling' | null;
}) {
  const Rib = ribbonAs;
  return (
    <div className="mt-emblem">
      <svg className="mt-emblem__rays" viewBox="0 0 260 346" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
        <g fill="none" strokeWidth="3">
          <circle cx="130" cy="150" r="70" />
          <circle cx="130" cy="150" r="100" />
          <circle cx="130" cy="150" r="130" strokeDasharray="2 12" strokeLinecap="round" />
          <circle cx="130" cy="150" r="160" />
        </g>
      </svg>
      <EmblemWaves />
      <span className="mt-emblem__no num">{no}</span>
      <span className={`mt-emblem__phase mt-emblem__phase--${phaseTone} mono`} data-testid="mt-phase">
        {phase}
      </span>
      <div className="mt-emblem__seal">
        <CoinCharacter paint="sun" mood={mood} size={176} look={[2, 0]} bob blink={mood !== 'sleepy'} />
      </div>
      <Rib className="mt-emblem__rib display">{ribbon}</Rib>
      {seal && <WaxSeal className="mt-emblem__wax" size={56} state={seal} />}
    </div>
  );
}

/** The seigaiha back of the emblem, in teal shade lines. */
function EmblemWaves() {
  const r = 26;
  const rowH = r * 0.85;
  const rows = 4;
  const out: ReactNode[] = [];
  for (let row = 0; row < rows; row++) {
    const y = r + row * rowH;
    const off = (row % 2) * r;
    for (let x = -2 * r + off; x < 260 + 2 * r; x += 2 * r) {
      out.push(
        <g key={`${row}:${x}`}>
          <path className="mt-waves__fill" d={`M${x - r} ${y} A${r} ${r} 0 0 1 ${x + r} ${y} Z`} />
          <path d={`M${x - r} ${y} A${r} ${r} 0 0 1 ${x + r} ${y}`} />
          <path d={`M${x - r * 0.64} ${y} A${r * 0.64} ${r * 0.64} 0 0 1 ${x + r * 0.64} ${y}`} />
          <path d={`M${x - r * 0.3} ${y} A${r * 0.3} ${r * 0.3} 0 0 1 ${x + r * 0.3} ${y}`} />
        </g>,
      );
    }
  }
  return (
    <svg className="mt-waves" viewBox={`0 0 260 ${rows * rowH + r * 0.3}`} preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <g fill="none" strokeWidth="3" strokeLinecap="round">
        {out}
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Links that look like buttons                                       */
/* ------------------------------------------------------------------ */

type LinkBtnProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> & {
  href: string;
  variant?: 'primary' | 'secondary' | 'teal' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  lead?: IconName;
  block?: boolean;
  /** A site route: client-side navigation. */
  route?: boolean;
  children: ReactNode;
};

/** A link drawn as a `Button` sticker (same classes, so it presses and focuses the same). */
export function LinkButton({ href, variant = 'secondary', size = 'md', icon, lead, block, route, className, children, ...rest }: LinkBtnProps) {
  const iconSize = size === 'lg' ? 24 : size === 'md' ? 20 : 16;
  const cls = `kb-btn kb-btn--${variant} kb-btn--${size}${block ? ' kb-btn--block' : ''} mt-linkbtn${className ? ` ${className}` : ''}`;
  const inner = (
    <>
      {lead && <Icon name={lead} size={iconSize} className="kb-btn__lead" />}
      <span className="kb-btn__label">
        <span className="kb-btn__text">{children}</span>
      </span>
      {icon && <Icon name={icon} size={iconSize} className="kb-btn__icon" />}
    </>
  );
  if (route)
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  return (
    <a href={href} className={cls} {...rest}>
      {inner}
    </a>
  );
}

/* ------------------------------------------------------------------ */
/* Confetti of food bits (the success moment)                         */
/* ------------------------------------------------------------------ */

const BITS: { kind: FoodKind; paint: SeedPaint }[] = [
  { kind: 'seed', paint: 'sun' },
  { kind: 'pear', paint: 'sun' },
  { kind: 'seed', paint: 'foam' },
  { kind: 'grapes', paint: 'sun' },
  { kind: 'seed', paint: 'blush' },
  { kind: 'seed', paint: 'up' },
  { kind: 'seed', paint: 'cream' },
  { kind: 'pear', paint: 'sun' },
  { kind: 'seed', paint: 'spray' },
];

function seeded(seed: number) {
  let h = seed * 9301 + 49297;
  return () => (h = (h * 16807) % 2147483647) / 2147483647;
}

/**
 * Food bits burst out from behind the emblems and rain down past them, spinning. Reduced motion:
 * they are simply scattered around the pile, still.
 */
export function FoodConfetti({ count = 40, seed = 11, delay = 0 }: { count?: number; seed?: number; delay?: number }) {
  const reduced = useReducedMotion();
  const rnd = seeded(seed);
  const bits = Array.from({ length: count }, (_, i) => {
    const b = BITS[i % BITS.length];
    const angle = (i / count) * Math.PI * 2 + rnd() * 0.5;
    const dist = 140 + rnd() * 260;
    return {
      ...b,
      size: 20 + rnd() * 22,
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist * 0.75 - 90,
      fall: 260 + rnd() * 320,
      spin: (rnd() - 0.5) * 900,
      delay: delay + 0.3 + rnd() * 0.25,
      dur: 2 + rnd() * 1.4,
    };
  });
  if (reduced)
    return (
      <div className="mt-confetti mt-confetti--still" aria-hidden="true">
        {bits
          .filter((_, i) => i % 3 === 0)
          .map((b, i) => (
            <span key={i} className="mt-confetti__bit" style={{ transform: `translate(${b.x * 1.35}px, ${b.y * 0.95}px) rotate(${b.spin / 4}deg)` } as CSSProperties}>
              <FoodBit kind={b.kind} paint={b.paint} size={b.size} />
            </span>
          ))}
      </div>
    );
  return (
    <div className="mt-confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <motion.span
          key={i}
          className="mt-confetti__bit"
          initial={{ x: 0, y: 0, scale: 0.2, rotate: 0, opacity: 0 }}
          animate={{
            x: [0, b.x, b.x * 1.08],
            y: [0, b.y, b.y + b.fall],
            scale: [0.2, 1, 1],
            rotate: [0, b.spin / 2, b.spin],
            opacity: [0, 1, 0],
          }}
          transition={{ duration: b.dur, delay: b.delay, times: [0, 0.32, 1], ease: ['easeOut', 'easeIn'] }}
        >
          <FoodBit kind={b.kind} paint={b.paint} size={b.size} />
        </motion.span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The ta-da starburst behind the minted stickers                     */
/* ------------------------------------------------------------------ */

function burstPath(points: number, outer: number, inner: number): string {
  const d: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    d.push(`${i ? 'L' : 'M'}${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`);
  }
  return `${d.join(' ')}Z`;
}

/** A chunky sun starburst (ink edge, one shade ring) that pops in behind the stickers and turns slowly. */
export function Starburst({ delay = 0 }: { delay?: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className="mt-burst"
      aria-hidden="true"
      initial={reduced ? { opacity: 0 } : { scale: 0.2, opacity: 0, rotate: -30 }}
      animate={reduced ? { opacity: 1 } : { scale: 1, opacity: 1, rotate: 0 }}
      transition={reduced ? { duration: 0.12 } : { type: 'spring', stiffness: 260, damping: 16, mass: 0.9, delay: delay + 0.1 }}
    >
      <svg className="mt-burst__art" viewBox="-260 -260 520 520" focusable="false">
        <path d={burstPath(18, 250, 196)} className="mt-burst__outer" />
        <path d={burstPath(18, 196, 160)} className="mt-burst__inner" transform="rotate(10)" />
        <circle r="120" className="mt-burst__core" />
      </svg>
    </motion.div>
  );
}
