import { ELYSIUM, SHADE } from '@elymum/shared';
import type { CSSProperties, ReactElement } from 'react';
import { CoinCharacter, useReducedMotion, type CoinPaint } from '../../design';
import { hash32 } from '../coinLook';

/**
 * The collab plates' little stories (decorative, aria-hidden): the inspector coin's magnifier
 * sweeping over your application, a rain cloud that actually rains, a letter that flies off, the
 * courier coin carrying your application down the mission log, and the spots as a bench of
 * seats that fill with coins as winners are added. Loops are CSS (transform/opacity) and stop for
 * reduced motion.
 */

const INK = ELYSIUM.abyss;
const S = { stroke: INK, strokeWidth: 3, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };

/** In review: the application on a clipboard, and a magnifier that sweeps over it line by line. */
export function Inspection({ size = 116 }: { size?: number }): ReactElement {
  return (
    <svg className="cb-art cb-inspect" viewBox="0 0 120 100" width={size} height={(size * 100) / 120} aria-hidden="true" focusable="false" overflow="visible">
      {/* the clipboard with the application */}
      <g transform="rotate(-6 50 56)">
        <rect x={18} y={20} width={62} height={74} rx={7} fill={INK} transform="translate(3 3)" />
        <rect x={18} y={20} width={62} height={74} rx={7} fill={ELYSIUM.coral} {...S} />
        <rect x={25} y={29} width={48} height={59} rx={3} fill={ELYSIUM.cream} {...S} strokeWidth={2.5} />
        <rect x={38} y={14} width={22} height={11} rx={3} fill={ELYSIUM.sand2} {...S} strokeWidth={2.5} />
        <g stroke={INK} strokeWidth={2.4} strokeLinecap="round">
          <path className="cb-inspect__line cb-inspect__line--1" d="M31 40 H66" />
          <path className="cb-inspect__line cb-inspect__line--2" d="M31 50 H61" />
          <path className="cb-inspect__line cb-inspect__line--3" d="M31 60 H65" />
          <path className="cb-inspect__line cb-inspect__line--4" d="M31 70 H54" />
        </g>
        {/* the ticks the inspector leaves */}
        <g className="cb-inspect__ticks" fill="none" stroke={ELYSIUM.up} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <path className="cb-inspect__tick cb-inspect__tick--1" d="M67 38 l2.5 2.5 5 -5" />
          <path className="cb-inspect__tick cb-inspect__tick--2" d="M64 48 l2.5 2.5 5 -5" />
          <path className="cb-inspect__tick cb-inspect__tick--3" d="M67 58 l2.5 2.5 5 -5" />
        </g>
      </g>
      {/* the magnifier, sweeping */}
      <g className="cb-inspect__glass">
        <path d="M78 62 L96 80" stroke={INK} strokeWidth={12} strokeLinecap="round" />
        <path d="M78 62 L96 80" stroke={ELYSIUM.sun} strokeWidth={6} strokeLinecap="round" />
        <circle cx={66} cy={50} r={17} fill={INK} transform="translate(2.5 2.5)" />
        <circle cx={66} cy={50} r={17} fill={ELYSIUM.mist} fillOpacity={0.82} {...S} />
        <path className="cb-inspect__glint" d="M56 46 a10 10 0 0 1 8 -7" stroke="#FFFFFF" strokeWidth={3.5} fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** Not this time: a cloud that rains on the coin, drops falling and splashing in a puddle. */
export function RainyCloud({ size = 112 }: { size?: number }): ReactElement {
  const drops = [26, 40, 54, 33, 48];
  return (
    <svg className="cb-art cb-rain" viewBox="0 0 84 150" width={size} height={(size * 150) / 84} aria-hidden="true" focusable="false" overflow="visible">
      <g className="cb-rain__drops">
        {drops.map((x, i) => (
          <path key={i} className="cb-rain__drop" style={{ animationDelay: `${(i * 0.27).toFixed(2)}s` } as CSSProperties} d={`M${x} 50 q-3 6 0 8 q3 -2 0 -8Z`} fill={ELYSIUM.teal} stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
        ))}
      </g>
      <g className="cb-rain__cloud">
        <path d="M18 46 a12 12 0 0 1 4 -23 a16 16 0 0 1 30 -4 a12 12 0 0 1 12 27Z" fill={INK} transform="translate(3 3)" />
        <path d="M18 46 a12 12 0 0 1 4 -23 a16 16 0 0 1 30 -4 a12 12 0 0 1 12 27Z" fill="#E8EEF0" {...S} />
        <path d="M20 43 H62" stroke={ELYSIUM.mist} strokeWidth={5} strokeLinecap="round" />
        {/* a grumpy little face: the cloud is sorry too */}
        <path d="M32 31 q2 -2 4 0 M46 31 q2 -2 4 0" stroke={INK} strokeWidth={2.2} fill="none" strokeLinecap="round" />
        <path d="M37 38 q4 -3 8 0" stroke={INK} strokeWidth={2.2} fill="none" strokeLinecap="round" />
      </g>
      {/* the puddle where it lands */}
      <ellipse cx={40} cy={144} rx={30} ry={5} fill={ELYSIUM.spray} stroke={INK} strokeWidth={2.4} />
      <ellipse className="cb-rain__ripple" cx={40} cy={144} rx={12} ry={2.4} fill="none" stroke="#FFFFFF" strokeWidth={2} />
    </svg>
  );
}

/** Submitted: the sealed letter, on its way (little wings, speed lines). */
export function FlyingLetter({ size = 100 }: { size?: number }): ReactElement {
  return (
    <svg className="cb-art cb-letter" viewBox="0 0 100 80" width={size} height={(size * 80) / 100} aria-hidden="true" focusable="false" overflow="visible">
      <g className="cb-letter__speed" stroke={INK} strokeWidth={3} strokeLinecap="round">
        <path d="M4 34 H14" />
        <path d="M0 46 H12" />
        <path d="M6 58 H16" />
      </g>
      <g className="cb-letter__body">
        <path className="cb-letter__wing cb-letter__wing--back" d="M52 24 C46 6 64 0 74 8 C68 12 62 18 60 24Z" fill="#FFFFFF" {...S} strokeWidth={2.6} />
        <rect x={22} y={24} width={66} height={44} rx={6} fill={INK} transform="translate(3 3)" />
        <rect x={22} y={24} width={66} height={44} rx={6} fill={ELYSIUM.cream} {...S} />
        <path d="M22 28 L55 50 L88 28" fill="none" {...S} />
        <circle cx={55} cy={50} r={9} fill={ELYSIUM.sun} {...S} />
        <path d="M51 50 l3 3 6 -6" fill="none" stroke={INK} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        <path className="cb-letter__wing cb-letter__wing--front" d="M40 26 C30 8 46 -2 58 6 C52 10 48 18 48 26Z" fill="#FFFFFF" {...S} strokeWidth={2.6} />
      </g>
    </svg>
  );
}

/** Three "z"s floating up off a sleeping coin. */
export function Snores(): ReactElement {
  return (
    <span className="cb-zzz" aria-hidden="true">
      <i>z</i>
      <i>z</i>
      <i>Z</i>
    </span>
  );
}

/** The courier: a tiny coin carrying your application (the dot of the mission log leg in motion). */
export function Courier(): ReactElement {
  return (
    <span className="cb-courier" aria-hidden="true">
      <CoinCharacter paint="sun" mood="happy" size={30} feet className="cb-courier__coin" />
      <svg className="cb-courier__letter" viewBox="0 0 22 16" width={18} height={13} focusable="false">
        <rect x={1.5} y={1.5} width={19} height={13} rx={2} fill={ELYSIUM.cream} stroke={INK} strokeWidth={2} />
        <path d="M1.5 3 L11 9.5 L20.5 3" fill="none" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      </svg>
    </span>
  );
}

const SEAT_PAINTS: CoinPaint[] = ['cyan', 'sun', 'teal', 'up', 'foam', 'coral', 'spray', 'cream', 'blush'];
const MAX_SEATS = 24;

/**
 * The spots as a row of seats at the feast: one stool per spot (a stool stands for several spots
 * when there are more than 24), a coin hopping onto each one as a winner is added. Locked lists
 * keep their coins seated and still.
 */
export function SeatRow({ spots, filled, locked = false }: { spots: number; filled: number; locked?: boolean }): ReactElement | null {
  const reduced = useReducedMotion();
  if (spots <= 0) return null;
  const per = Math.max(1, Math.ceil(spots / MAX_SEATS));
  const seats = Math.ceil(spots / per);
  const taken = Math.min(seats, Math.ceil(filled / per));
  return (
    <div className={`cb-seats${locked ? ' is-locked' : ''}${reduced ? ' is-still' : ''}`} aria-hidden="true">
      <ol className="cb-seats__row" style={{ ['--seats' as string]: seats }}>
        {Array.from({ length: seats }, (_, i) => {
          const on = i < taken;
          const paint = SEAT_PAINTS[hash32(`seat:${i}`) % SEAT_PAINTS.length];
          return (
            <li key={i} className={`cb-seat${on ? ' is-on' : ''}`}>
              {on && (
                <span className="cb-seat__coin" style={{ ['--hop' as string]: `${(i % 3) * 40}ms` }}>
                  <CoinCharacter paint={paint} mood={i % 4 === 0 ? 'happy' : 'smile'} size={26} blink={false} />
                </span>
              )}
              <svg className="cb-seat__stool" viewBox="0 0 30 22" focusable="false">
                <path d="M7 9 L5 21 M23 9 L25 21" stroke={INK} strokeWidth={2.6} strokeLinecap="round" />
                <rect x={2} y={4} width={26} height={7} rx={3.5} fill={on ? ELYSIUM.sun : ELYSIUM.cream} stroke={INK} strokeWidth={2.4} />
                <path d="M5 9 H25" stroke={on ? SHADE.sun : ELYSIUM.sand2} strokeWidth={2} strokeLinecap="round" />
              </svg>
            </li>
          );
        })}
      </ol>
      {per > 1 && <span className="cb-seats__key mono">1 stool = {per} spots</span>}
    </div>
  );
}
