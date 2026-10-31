import { ELYSIUM, SHADE } from '@elymum/shared';
import type { CSSProperties, ReactElement } from 'react';

export type FoodKind = 'pear' | 'grapes' | 'seed';
export type SeedPaint = 'sun' | 'foam' | 'up' | 'blush' | 'cream' | 'spray';

export interface FoodBitProps {
  kind: FoodKind;
  /** Rendered size in px (default 28). */
  size?: number;
  /** Seed colour (seeds only). */
  paint?: SeedPaint;
  /** The faint halo food has on the night floor ("food glows a little"). */
  glow?: boolean;
  /** Gentle wobble loop (stops under reduced motion / offscreen). */
  wiggle?: boolean;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

const INK = ELYSIUM.abyss;

/** A bit of food, drawn like the coins: ink outline, flat paint, one shade, a shine. */
export function FoodBit({ kind, size = 28, paint = 'sun', glow = false, wiggle = false, title, className, style }: FoodBitProps): ReactElement {
  let art: ReactElement;
  if (kind === 'pear') {
    art = (
      <g>
        {glow && <circle r={13} fill={ELYSIUM.sun} opacity={0.2} />}
        <path d="M0 -8 Q5 -8 5 -2 Q8 2 8 5 Q8 10 0 10 Q-8 10 -8 5 Q-8 2 -5 -2 Q-5 -8 0 -8Z" fill={SHADE.sun} />
        <path d="M-1 -8 Q4 -8 4 -2 Q6.5 2 6.5 4.5 Q6 8.5 -1 8.6 Q-8 8.6 -8 5 Q-8 2 -5 -2 Q-5 -8 -1 -8Z" fill={ELYSIUM.sun} />
        <path d="M0 -8 Q5 -8 5 -2 Q8 2 8 5 Q8 10 0 10 Q-8 10 -8 5 Q-8 2 -5 -2 Q-5 -8 0 -8Z" fill="none" stroke={INK} strokeWidth={2.2} strokeLinejoin="round" />
        <path d="M0 -8 q1 -4 4 -5" stroke={INK} strokeWidth={2.2} fill="none" strokeLinecap="round" />
        <path d="M2 -11 q4 -3 6 0 q-3 2 -6 0Z" fill={ELYSIUM.verdant} stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
        <path d="M-5 3 q0 -3 2 -4" stroke="#FFFFFF" strokeWidth={1.8} fill="none" strokeLinecap="round" opacity={0.85} />
      </g>
    );
  } else if (kind === 'grapes') {
    art = (
      <g>
        {glow && <circle r={13} fill={ELYSIUM.spray} opacity={0.2} />}
        <path d="M0 -10 q1 -3 4 -3" stroke={INK} strokeWidth={2} fill="none" strokeLinecap="round" />
        <g stroke={INK} strokeWidth={2} fill={ELYSIUM.spray}>
          <circle cx={-4.2} cy={-4} r={4.6} />
          <circle cx={4.2} cy={-4} r={4.6} />
          <circle cx={0} cy={3.6} r={4.6} />
        </g>
        <g fill="#FFFFFF" opacity={0.9}>
          <circle cx={-5.6} cy={-5.4} r={1.3} />
          <circle cx={2.8} cy={-5.4} r={1.3} />
          <circle cx={-1.4} cy={2.2} r={1.3} />
        </g>
      </g>
    );
  } else {
    const c = ELYSIUM[paint];
    art = (
      <g>
        {glow && <circle r={11} fill={c} opacity={0.2} />}
        <circle r={5.8} fill={SHADE[paint]} />
        <circle cx={-0.8} cy={-0.8} r={5} fill={c} />
        <circle r={5.8} fill="none" stroke={INK} strokeWidth={2.2} />
        <circle cx={-1.9} cy={-1.9} r={1.5} fill="#FFFFFF" />
      </g>
    );
  }
  return (
    <svg
      className={`kb-food${wiggle ? ' kb-food--wiggle' : ''}${className ? ` ${className}` : ''}`}
      viewBox="-14 -14 28 28"
      width={size}
      height={size}
      overflow="visible"
      style={style}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {art}
    </svg>
  );
}

/** A little scatter of food (decoration under copy, empty states). */
export function FoodScatter({ count = 9, seed = 7, size = 22, glow = false, className }: { count?: number; seed?: number; size?: number; glow?: boolean; className?: string }) {
  let h = seed * 9301 + 49297;
  const rnd = () => ((h = (h * 16807) % 2147483647) / 2147483647);
  const kinds: FoodKind[] = ['seed', 'pear', 'seed', 'grapes', 'seed'];
  const paints: SeedPaint[] = ['sun', 'foam', 'up', 'blush', 'cream'];
  return (
    <span className={`kb-food-scatter${className ? ` ${className}` : ''}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <FoodBit
          key={i}
          kind={kinds[i % kinds.length]}
          paint={paints[i % paints.length]}
          size={size * (0.8 + rnd() * 0.4)}
          glow={glow}
          wiggle
          style={{ left: `${4 + rnd() * 90}%`, top: `${6 + rnd() * 80}%`, animationDelay: `${-rnd() * 3}s` }}
        />
      ))}
    </span>
  );
}
