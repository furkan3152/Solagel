import { ELYSIUM } from '@elymum/shared';
import { motion, useScroll, useTransform, type MotionValue } from 'motion/react';
import { useOffscreenPause, useReducedMotion } from '../../design';

/**
 * The seam between the day plates and the night plates: dusk on the plain, driven by the scroll.
 * As the visitor scrolls through it the sun sinks behind the terraces, the sky deepens, the
 * planet rises over the far rim, stars blink on one by one and the windows of the little houses
 * light up, while a clock in the corner runs from 18:10 to 21:40. Decoration (aria-hidden).
 * Transform and opacity only. Reduced motion: one fixed frame at early night.
 */

const INK = ELYSIUM.abyss;
const W = 1440;
const H = 340;

/** Stars: x, y, radius, the scroll point (0..1) where each switches on. */
const STARS: [number, number, number, number][] = [
  [90, 60, 3, 0.36], [210, 120, 2, 0.5], [330, 40, 2.6, 0.42], [470, 96, 2, 0.6], [560, 30, 3.2, 0.33],
  [700, 70, 2, 0.55], [820, 34, 2.4, 0.46], [960, 110, 2, 0.64], [1050, 52, 3, 0.4], [1180, 88, 2.2, 0.58],
  [1290, 36, 2.8, 0.48], [1380, 120, 2, 0.68], [150, 170, 1.8, 0.7], [640, 150, 1.8, 0.72], [1110, 160, 1.8, 0.74],
];

/** Houses on the terraces: x, y (ground), scale, the scroll point where the window lights. */
const HOUSES: [number, number, number, number][] = [
  [150, 0, 1, 0.42], [236, 0, 0.8, 0.56], [430, 0, 0.9, 0.5], [640, 0, 0.85, 0.66], [1010, 0, 1, 0.62], [1120, 0, 0.8, 0.46], [1300, 0, 1, 0.7],
];

/** The terraces dip in the middle and climb at both ends: the inside of the ring. */
const dip = (edge: number, mid: number) => (x: number) => edge + (mid - edge) * (1 - ((x - W / 2) / (W / 2)) ** 2);
const midY = dip(200, 264);
const frontY = dip(250, 299);

function Star({ p, s }: { p: MotionValue<number>; s: (typeof STARS)[number] }) {
  const [x, y, r, at] = s;
  const o = useTransform(p, [at - 0.06, at], [0, 1]);
  const sc = useTransform(p, [at - 0.06, at, at + 0.04], [0.2, 1.5, 1]);
  return (
    <motion.g style={{ opacity: o, scale: sc, x, y }}>
      <path d={`M0 ${-r * 2.4} L${r * 0.6} ${-r * 0.6} L${r * 2.4} 0 L${r * 0.6} ${r * 0.6} L0 ${r * 2.4} L${-r * 0.6} ${r * 0.6} L${-r * 2.4} 0 L${-r * 0.6} ${-r * 0.6}Z`} fill={ELYSIUM.cream} />
    </motion.g>
  );
}

function House({ p, h }: { p: MotionValue<number>; h: (typeof HOUSES)[number] }) {
  const [x, , k, at] = h;
  const y = midY(x) + 3;
  const lit = useTransform(p, [at - 0.02, at], [0, 1]);
  const halo = useTransform(lit, [0, 1], [0, 0.22]);
  return (
    <g transform={`translate(${x} ${y}) scale(${k})`}>
      <path d="M-16 0 v-20 l16 -14 l16 14 v20z" fill={ELYSIUM.cream} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <path d="M-20 -18 l20 -18 l20 18" fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <rect x={-6} y={-16} width={12} height={10} rx={2} fill={ELYSIUM.reef} stroke={INK} strokeWidth={2.4} />
      <motion.rect x={-6} y={-16} width={12} height={10} rx={2} fill={ELYSIUM.sun} stroke={INK} strokeWidth={2.4} style={{ opacity: lit }} />
      <motion.circle cx={0} cy={-11} r={16} fill={ELYSIUM.sun} style={{ opacity: halo }} />
    </g>
  );
}

export function DuskSeam() {
  const reduced = useReducedMotion();
  const [ref, visible] = useOffscreenPause<HTMLDivElement>();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const still = useTransform(scrollYProgress, () => 0.72);
  const p = reduced ? still : scrollYProgress;

  const sunY = useTransform(p, [0.1, 0.6], [80, 300]);
  const sunScale = useTransform(p, [0.1, 0.62], [1, 1.18]);
  const glow = useTransform(p, [0.1, 0.55], [1, 0]);
  const dusk = useTransform(p, [0.12, 0.36, 0.62], [0, 1, 0.4]);
  const night = useTransform(p, [0.36, 0.72], [0, 1]);
  const planetY = useTransform(p, [0.2, 0.75], [190, -96]);
  const minutes = useTransform(p, [0.1, 0.9], [18 * 60 + 10, 21 * 60 + 40]);
  const clock = useTransform(minutes, (m) => {
    const q = Math.round(m / 5) * 5;
    return `${String(Math.floor(q / 60)).padStart(2, '0')}:${String(q % 60).padStart(2, '0')}`;
  });

  return (
    <div ref={ref} className="ld-dusk" aria-hidden="true" data-paused={!visible || undefined}>
      <svg className="ld-dusk__art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" focusable="false">
        <defs>
          <linearGradient id="ld-dusk-day" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={ELYSIUM.plain} />
            <stop offset="0.45" stopColor="#F6D9A8" />
            <stop offset="1" stopColor="#EE9F7A" />
          </linearGradient>
          <linearGradient id="ld-dusk-night" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={ELYSIUM.trench} />
            <stop offset="1" stopColor={ELYSIUM.current} />
          </linearGradient>
          <linearGradient id="ld-dusk-dusk" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={ELYSIUM.teal} />
            <stop offset="0.6" stopColor="#C98A7E" />
            <stop offset="1" stopColor={ELYSIUM.coral} />
          </linearGradient>
          <radialGradient id="ld-dusk-glow">
            <stop offset="0" stopColor="#FFE7A8" stopOpacity="0.9" />
            <stop offset="1" stopColor="#FFE7A8" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={W} height={H} fill="url(#ld-dusk-day)" />
        <motion.rect width={W} height={H} fill="url(#ld-dusk-dusk)" style={{ opacity: dusk }} />
        <motion.rect width={W} height={H} fill="url(#ld-dusk-night)" style={{ opacity: night }} />
        {STARS.map((s, i) => (
          <Star key={i} p={p} s={s} />
        ))}
        {/* the far side of the ring arching overhead: it shows once the sky darkens, lights crawling */}
        <motion.g style={{ opacity: night }}>
          <path d={`M-80 ${H} C 220 -70, ${W - 220} -70, ${W + 80} ${H}`} fill="none" stroke={INK} strokeWidth={34} />
          <path d={`M-80 ${H} C 220 -70, ${W - 220} -70, ${W + 80} ${H}`} fill="none" stroke={ELYSIUM.current} strokeWidth={28} />
          <path className="ld-dusk__lights" d={`M-80 ${H} C 220 -70, ${W - 220} -70, ${W + 80} ${H}`} fill="none" stroke={ELYSIUM.sun} strokeWidth={5} strokeDasharray="3 22" strokeLinecap="round" />
        </motion.g>
        {/* the planet rising over the far rim */}
        <motion.g style={{ y: planetY }}>
          <circle cx={930} cy={290} r={130} fill={ELYSIUM.teal} stroke={INK} strokeWidth={3} />
          <path d="M840 236 q34 -34 80 -16 q34 16 12 40 q-46 22 -92 -24z" fill={ELYSIUM.up} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
          <path d="M968 196 q46 -12 62 22 q-22 18 -62 -22z" fill={ELYSIUM.up} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
          <path d="M830 214 a120 120 0 0 1 64 -50" fill="none" stroke={ELYSIUM.mist} strokeWidth={6} strokeLinecap="round" opacity={0.75} />
        </motion.g>
        {/* the sun going down behind the plain */}
        <motion.circle cx={520} cy={0} r={160} fill="url(#ld-dusk-glow)" style={{ y: sunY, opacity: glow }} />
        <motion.g style={{ y: sunY, scale: sunScale, x: 520 }}>
          <circle r={46} fill={ELYSIUM.sun} stroke={INK} strokeWidth={3} />
          <path d="M-30 -14 a34 34 0 0 1 20 -22" fill="none" stroke="#FFF6D8" strokeWidth={5} strokeLinecap="round" />
        </motion.g>
        {/* the terraces, back to front: they dip in the middle and climb at the ends */}
        <Terrace d={`M0 150 C 360 250, ${W - 360} 250, ${W} 150 V ${H} H0Z`} day={ELYSIUM.clover} night={ELYSIUM.current} fade={night} />
        <Terrace d={`M0 200 C 400 285, ${W - 400} 285, ${W} 200 V ${H} H0Z`} day={ELYSIUM.verdant} night={ELYSIUM.reef} fade={night} />
        {HOUSES.map((h, i) => (
          <House key={i} p={p} h={h} />
        ))}
        <Terrace d={`M0 250 C 420 315, ${W - 420} 315, ${W} 250 V ${H} H0Z`} day={ELYSIUM.forest} night={ELYSIUM.trench} fade={night} />
        {/* lamp-posts along the front terrace: they come on with the windows */}
        {[110, 360, 600, 840, 1080, 1330].map((x, i) => (
          <g key={x} transform={`translate(${x} ${frontY(x) + 2})`}>
            <path d="M0 0 v-30" stroke={INK} strokeWidth={3} strokeLinecap="round" />
            <circle cy={-34} r={6} fill={ELYSIUM.reef} stroke={INK} strokeWidth={2.6} />
            <Lamp p={p} at={0.4 + ((i * 3) % 6) * 0.05} />
          </g>
        ))}
      </svg>
      <motion.span className="ld-dusk__clock num">{clock}</motion.span>
      <span className="ld-dusk__note mono">Dusk on the plain · the lights come on along the ring</span>
    </div>
  );
}

/** A terrace in its day green, darkening to its night paint as the sky does. */
function Terrace({ d, day, night, fade }: { d: string; day: string; night: string; fade: MotionValue<number> }) {
  return (
    <g>
      <path d={d} fill={day} />
      <motion.path d={d} fill={night} style={{ opacity: fade }} />
      <path d={d} fill="none" stroke={INK} strokeWidth={3} />
    </g>
  );
}

function Lamp({ p, at }: { p: MotionValue<number>; at: number }) {
  const o = useTransform(p, [at - 0.03, at], [0, 1]);
  return (
    <motion.g style={{ opacity: o }}>
      <circle cy={-34} r={18} fill={ELYSIUM.sun} opacity={0.25} />
      <circle cy={-34} r={6} fill={ELYSIUM.sun} stroke={INK} strokeWidth={2.6} />
    </motion.g>
  );
}
