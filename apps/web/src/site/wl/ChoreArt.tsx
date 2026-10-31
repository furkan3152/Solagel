import { ELYSIUM, SHADE } from '@elymum/shared';
import type { ReactElement, ReactNode } from 'react';
import { CoinCharacter, type CoinPaint } from '../../design';
import { hash32 } from '../coinLook';

/**
 * Small hand-inked pictures for the WL chores and the collab plates (spec §6.6 craft: flat paint,
 * one hard shade lower-right, a steady 3 px ink outline, no gradients). Decorative: aria-hidden.
 */
const INK = ELYSIUM.abyss;
const S = { stroke: INK, strokeWidth: 3, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };

export type ChoreKind = 'follow_x' | 'post_x' | 'engage_x' | 'join_link' | 'text' | 'sign' | 'wallet' | 'handle';

function Svg({ children, size = 76, view = 80 }: { children: ReactNode; size?: number; view?: number }) {
  return (
    <svg className="wl-art" viewBox={`0 0 ${view} ${view}`} width={size} height={size} aria-hidden="true" focusable="false" overflow="visible">
      {children}
    </svg>
  );
}

/** The coin paints a handle can wear on the site (the same handle always gets the same one). */
const HANDLE_PAINTS: CoinPaint[] = ['cyan', 'sun', 'teal', 'up', 'foam', 'coral', 'spray', 'cream'];
export const handlePaint = (handle: string): CoinPaint => (handle ? HANDLE_PAINTS[hash32(`paint:${handle.toLowerCase()}`) % HANDLE_PAINTS.length] : 'cream');

/** A speech bubble with the X glyph and a sun "+" badge: follow. */
function Follow() {
  return (
    <Svg>
      <path d="M14 14 H62 a6 6 0 0 1 6 6 V48 a6 6 0 0 1 -6 6 H34 L22 66 V54 H14 a6 6 0 0 1 -6 -6 V20 a6 6 0 0 1 6 -6Z" fill={INK} transform="translate(3 3)" />
      <path d="M14 14 H62 a6 6 0 0 1 6 6 V48 a6 6 0 0 1 -6 6 H34 L22 66 V54 H14 a6 6 0 0 1 -6 -6 V20 a6 6 0 0 1 6 -6Z" fill={ELYSIUM.mist} {...S} />
      <path d="M27 24 L45 44 M45 24 L27 44" stroke={INK} strokeWidth={4.5} strokeLinecap="round" />
      <circle cx={66} cy={15} r={11} fill={ELYSIUM.sun} {...S} />
      <path d="M66 9.5 V20.5 M60.5 15 H71.5" stroke={INK} strokeWidth={3} strokeLinecap="round" />
    </Svg>
  );
}

/** A little boarding pass, tilted, with a sun stub and a coin on it: post the card. */
function Post() {
  return (
    <Svg>
      <g transform="rotate(-9 40 40)">
        <path d="M6 22 H48 a5 5 0 0 0 10 0 H74 V58 H58 a5 5 0 0 0 -10 0 H6Z" fill={INK} transform="translate(3 3)" />
        <path d="M6 22 H48 a5 5 0 0 0 10 0 H74 V58 H58 a5 5 0 0 0 -10 0 H6Z" fill={ELYSIUM.cream} {...S} />
        <path d="M58 22 H74 V58 H58 a5 5 0 0 0 -5 -5" fill={ELYSIUM.sun} />
        <path d="M6 22 H48 a5 5 0 0 0 10 0 H74 V58 H58 a5 5 0 0 0 -10 0 H6Z" fill="none" {...S} />
        <path d="M53 30 V50" stroke={INK} strokeWidth={2.5} strokeDasharray="2 4" strokeLinecap="round" />
        <circle cx={24} cy={40} r={9} fill={ELYSIUM.cyan} {...S} />
        <circle cx={21} cy={39} r={1.8} fill={INK} />
        <circle cx={27} cy={39} r={1.8} fill={INK} />
        <path d="M36 35 H46 M36 44 H44" stroke={INK} strokeWidth={2.5} strokeLinecap="round" />
      </g>
      <path d="M58 8 l3 -5 M66 12 l5 -3 M50 6 l-1 -5" stroke={INK} strokeWidth={2.5} strokeLinecap="round" />
    </Svg>
  );
}

/** A heart over a repost loop: like, repost, reply. */
function Engage() {
  return (
    <Svg>
      <rect x={10} y={22} width={50} height={40} rx={20} fill={INK} transform="translate(3 3)" />
      <rect x={10} y={22} width={50} height={40} rx={20} fill={ELYSIUM.foam} {...S} />
      <path d="M22 40 V36 a6 6 0 0 1 6 -6 H44 M40 25 l5 5 -5 5 M48 44 V48 a6 6 0 0 1 -6 6 H26 M30 59 l-5 -5 5 -5" fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M60 30 C52 22 44 30 50 38 L60 48 L70 38 C76 30 68 22 60 30Z" fill={INK} transform="translate(2.5 2.5)" />
      <path d="M60 30 C52 22 44 30 50 38 L60 48 L70 38 C76 30 68 22 60 30Z" fill={ELYSIUM.blush} {...S} />
      <path d="M53 31 q2 -3 5 -1" stroke="#FFFFFF" strokeWidth={2.5} fill="none" strokeLinecap="round" />
    </Svg>
  );
}

/** An arched door left ajar, sun light spilling out: join the server. */
function Join() {
  return (
    <Svg>
      <path d="M14 70 V34 a22 22 0 0 1 44 0 V70Z" fill={INK} transform="translate(3 3)" />
      <path d="M14 70 V34 a22 22 0 0 1 44 0 V70Z" fill={ELYSIUM.sun} {...S} />
      <path d="M14 70 V34 a22 22 0 0 1 22 -22 L30 70Z" fill={ELYSIUM.teal} {...S} />
      <circle cx={25} cy={46} r={2.6} fill={ELYSIUM.cream} stroke={INK} strokeWidth={2} />
      <path d="M58 70 L74 70" {...S} />
      <path d="M4 70 H14" {...S} />
      <circle cx={46} cy={50} r={7} fill={ELYSIUM.cyan} {...S} />
      <circle cx={44} cy={49} r={1.5} fill={INK} />
      <circle cx={49} cy={49} r={1.5} fill={INK} />
      <path d="M63 26 l4 -3 M66 36 h5 M62 16 l2 -4" stroke={INK} strokeWidth={2.5} strokeLinecap="round" />
    </Svg>
  );
}

/** A note card and a pencil: say something. */
function Note() {
  return (
    <Svg>
      <rect x={8} y={14} width={50} height={54} rx={6} fill={INK} transform="translate(3 3)" />
      <rect x={8} y={14} width={50} height={54} rx={6} fill={ELYSIUM.cream} {...S} />
      <path d="M17 28 H48 M17 38 H44 M17 48 H36" stroke={INK} strokeWidth={2.5} strokeLinecap="round" opacity={0.85} />
      <g transform="rotate(38 60 42)">
        <rect x={53} y={14} width={13} height={42} rx={3} fill={INK} transform="translate(2.5 2.5)" />
        <rect x={53} y={14} width={13} height={42} rx={3} fill={ELYSIUM.sun} {...S} />
        <path d="M53 22 H66" {...S} />
        <path d="M53 56 L59.5 68 L66 56Z" fill={ELYSIUM.cream} {...S} />
        <path d="M57.4 64 L59.5 68 L61.6 64Z" fill={INK} />
      </g>
    </Svg>
  );
}

/** A teal pouch with a sun coin poking out: the wallet. */
function Wallet() {
  return (
    <Svg>
      <circle cx={46} cy={20} r={12} fill={ELYSIUM.sun} {...S} />
      <path d="M41 20 h10 M46 15 v10" stroke={INK} strokeWidth={2.5} strokeLinecap="round" opacity={0.8} />
      <rect x={8} y={26} width={62} height={44} rx={9} fill={INK} transform="translate(3 3)" />
      <rect x={8} y={26} width={62} height={44} rx={9} fill={ELYSIUM.teal} {...S} />
      <path d="M8 38 H70" stroke={SHADE.teal} strokeWidth={5} />
      <path d="M8 35 H70" {...S} />
      <path d="M50 44 H72 V58 H50 a7 7 0 0 1 0 -14Z" fill={ELYSIUM.cyan} {...S} />
      <circle cx={52} cy={51} r={3} fill={ELYSIUM.cream} stroke={INK} strokeWidth={2} />
    </Svg>
  );
}

/** The picture for a chore. The handle chore shows the coin your handle makes (asleep until you type one). */
export function ChoreArt({ kind, handle = '' }: { kind: ChoreKind | string; handle?: string }): ReactElement {
  switch (kind) {
    case 'handle':
      return <CoinCharacter paint={handlePaint(handle)} mood={handle ? 'happy' : 'sleepy'} size={72} feet look={[2, 1]} />;
    case 'follow_x':
      return <Follow />;
    case 'post_x':
      return <Post />;
    case 'engage_x':
      return <Engage />;
    case 'join_link':
      return <Join />;
    case 'text':
      return <Note />;
    case 'sign':
    case 'wallet':
      return <Wallet />;
    default:
      return <Note />;
  }
}

/** A magnifying glass (collab: in review). */
export function Magnifier({ size = 64 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M50 50 L72 72" stroke={INK} strokeWidth={13} strokeLinecap="round" />
      <path d="M50 50 L72 72" stroke={ELYSIUM.coral} strokeWidth={7} strokeLinecap="round" />
      <circle cx={33} cy={33} r={22} fill={INK} transform="translate(3 3)" />
      <circle cx={33} cy={33} r={22} fill={ELYSIUM.mist} {...S} />
      <path d="M21 27 a13 13 0 0 1 10 -9" stroke="#FFFFFF" strokeWidth={4} fill="none" strokeLinecap="round" />
    </Svg>
  );
}

/** A rain cloud (collab: not this time). */
export function RainCloud({ size = 80 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M18 46 a12 12 0 0 1 4 -23 a16 16 0 0 1 30 -4 a12 12 0 0 1 12 27Z" fill={INK} transform="translate(3 3)" />
      <path d="M18 46 a12 12 0 0 1 4 -23 a16 16 0 0 1 30 -4 a12 12 0 0 1 12 27Z" fill="#FFFFFF" {...S} />
      <path d="M20 43 H62" stroke={ELYSIUM.mist} strokeWidth={5} strokeLinecap="round" />
      <path d="M26 56 l-3 8 M40 56 l-3 8 M54 56 l-3 8" stroke={ELYSIUM.teal} strokeWidth={3.5} strokeLinecap="round" />
    </Svg>
  );
}

/** A sealed envelope with a sun wax seal (collab: submitted). */
export function Sealed({ size = 80 }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect x={6} y={20} width={66} height={46} rx={6} fill={INK} transform="translate(3 3)" />
      <rect x={6} y={20} width={66} height={46} rx={6} fill={ELYSIUM.cream} {...S} />
      <path d="M6 24 L39 48 L72 24" fill="none" {...S} />
      <path d="M6 64 L30 42 M72 64 L48 42" stroke={INK} strokeWidth={2.5} strokeLinecap="round" opacity={0.6} />
      <circle cx={39} cy={48} r={10} fill={ELYSIUM.sun} {...S} />
      <path d="M35 48 l3 3 6 -6" fill="none" stroke={INK} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** A crescent moon with two stars (closed, after hours). */
export function Moon({ size = 70 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M50 12 a28 28 0 1 0 18 44 a22 22 0 1 1 -18 -44Z" fill={INK} transform="translate(3 3)" />
      <path d="M50 12 a28 28 0 1 0 18 44 a22 22 0 1 1 -18 -44Z" fill={ELYSIUM.sun} {...S} />
      <path d="M66 14 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2Z" fill={ELYSIUM.cream} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <circle cx={70} cy={40} r={2.5} fill={ELYSIUM.cream} stroke={INK} strokeWidth={1.8} />
    </Svg>
  );
}
