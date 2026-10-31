import { ELYSIUM } from '@elymum/shared';
import { useOffscreenPause, useReducedMotion } from '../design';

const INK = ELYSIUM.abyss;

/** The front terrace's top edge in RingScene coordinates (band 4: y 548 at the ends, dipping to 1030). */
const WALK = 'M-40 552 Q 720 1034 1480 552';
/** Where the windmill stands on that terrace. */
const MILL: [number, number] = [452, 760];
/** Lit windows of the RingScene houses on the front terraces (window centre). */
const WINDOWS: [number, number][] = [
  [1010, 631],
  [1230, 657],
];
/** Fireflies over the sand: x, y, drift delay (s). */
const FLIES: [number, number, number][] = [
  [380, 800, 0],
  [520, 836, 1.6],
  [880, 840, 0.8],
  [1110, 790, 2.4],
  [1290, 760, 1.2],
];

/**
 * Small night life on the footer's front terraces, drawn in the RingScene's own coordinates and
 * framing (viewBox 0 640 1440 240, xMidYMax slice) so it sits on the painted ground: a windmill
 * turning, a coin walking home along the terrace with a lantern (and turning round at the ends),
 * windows glowing warmer, fireflies over the sand. SMIL and CSS loops, paused off screen; reduced
 * motion: the same picture standing still. Decoration (aria-hidden).
 */
export function FooterLife() {
  const reduced = useReducedMotion();
  const [ref, visible] = useOffscreenPause<SVGSVGElement>();
  const live = !reduced;
  return (
    <svg
      ref={ref}
      className="st-life"
      viewBox="0 640 1440 240"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable="false"
      data-paused={!visible || reduced || undefined}
    >
      {/* windows glowing */}
      {WINDOWS.map(([x, y], i) => (
        <circle key={x} className="st-life__glow" cx={x} cy={y} r={18} fill={ELYSIUM.sun} style={{ animationDelay: `${i * 1.3}s` }} />
      ))}
      {/* the windmill */}
      <g transform={`translate(${MILL[0]} ${MILL[1]})`} stroke={INK} strokeWidth={2.6} strokeLinejoin="round">
        <path d="M-11 0 L-7 -40 H7 L11 0Z" fill={ELYSIUM.cream} />
        <path d="M-9 -38 Q0 -52 9 -38Z" fill={ELYSIUM.coral} />
        <rect x={-3} y={-14} width={6} height={14} rx={2} fill={ELYSIUM.reef} />
        <rect x={-3} y={-30} width={6} height={6} rx={1.5} fill={ELYSIUM.sun} />
        <g transform="translate(0 -40)">
          <g>
            {[0, 90, 180, 270].map((a) => (
              <g key={a} transform={`rotate(${a})`}>
                <path d="M0 -2 V-30" />
                <path d="M1 -8 h9 v-20 h-9z" fill={ELYSIUM.mist} strokeWidth={2} />
              </g>
            ))}
            {live && <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="10s" repeatCount="indefinite" />}
          </g>
          <circle r={3.5} fill={ELYSIUM.sun} />
        </g>
      </g>
      {/* a coin walking home with a lantern */}
      <g>
        <g>
          <g className={live ? 'st-life__step' : undefined}>
            <path d="M6 -16 L16 -26" stroke={INK} strokeWidth={2.4} strokeLinecap="round" />
            <circle cx={17} cy={-21} r={9} fill={ELYSIUM.sun} opacity={0.3} className="st-life__lantern" />
            <rect x={13} y={-25} width={8} height={9} rx={2.5} fill={ELYSIUM.sun} stroke={INK} strokeWidth={2} />
            <path d="M-6 -1 v-3 M6 -1 v-3" stroke={INK} strokeWidth={3} strokeLinecap="round" />
            <circle cy={-14} r={11} fill={ELYSIUM.cyan} stroke={INK} strokeWidth={2.6} />
            <circle cx={-2} cy={-16} r={2.2} fill={INK} />
            <circle cx={5} cy={-16} r={2.2} fill={INK} />
            <path d="M-1 -9 q3 2 6 0" fill="none" stroke={INK} strokeWidth={1.8} strokeLinecap="round" />
          </g>
          {live && <animateTransform attributeName="transform" type="scale" values="1 1;-1 1" keyTimes="0;0.5" calcMode="discrete" dur="36s" repeatCount="indefinite" />}
        </g>
        {live ? (
          <animateMotion dur="36s" repeatCount="indefinite" path={WALK} keyPoints="0.3;0.68;0.3" keyTimes="0;0.5;1" calcMode="linear" />
        ) : (
          <animateMotion dur="1s" fill="freeze" path={WALK} keyPoints="0.36;0.36" keyTimes="0;1" calcMode="linear" />
        )}
      </g>
      {/* fireflies over the sand */}
      {FLIES.map(([x, y, d]) => (
        <g key={x} className="st-life__fly" style={{ animationDelay: `${-d}s` }}>
          <circle cx={x} cy={y} r={7} fill={ELYSIUM.sun} opacity={0.25} />
          <circle cx={x} cy={y} r={2.6} fill={ELYSIUM.sun} />
        </g>
      ))}
    </svg>
  );
}
