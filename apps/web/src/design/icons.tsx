import type { CSSProperties, ReactElement } from 'react';

/**
 * Kâğıt Bilet icon set. Hand-drawn on a 24×24 grid, 2.2 px stroke, round caps
 * and joins, `currentColor` only. Optical rules: the main silhouette sits inside
 * a 3..21 live area, interior details stay >= 2 px from outlines, and "dots"
 * are zero-length segments so they print as round ink drops.
 */
export const ICON_NAMES = [
  'play',
  'trophy',
  'ticket',
  'passport',
  'user',
  'wallet',
  'lock',
  'key',
  'users',
  'bot',
  'coin',
  'crown',
  'flame',
  'chevron',
  'close',
  'check',
  'arrow',
  'menu',
  'settings',
  'sound',
  'mute',
  'globe',
  'sun',
  'moon',
  'chat',
  'emote',
  'split',
  'eject',
  'cashout',
  'map',
  'info',
  'docs',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

const P: Record<IconName, ReactElement> = {
  play: <path d="M8 5.2v13.6a.6.6 0 0 0 .9.5l10.6-6.8a.6.6 0 0 0 0-1L8.9 4.7a.6.6 0 0 0-.9.5z" />,
  trophy: (
    <>
      <path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z" />
      <path d="M7.5 6H4.5a3 3 0 0 0 3 4M16.5 6h3a3 3 0 0 1-3 4" />
      <path d="M12 13.5V17M8.5 20.5h7M9.5 17h5v3.5h-5z" />
    </>
  ),
  ticket: (
    <>
      <path d="M3.5 7a1 1 0 0 1 1-1h15a1 1 0 0 1 1 1v3a2 2 0 0 0 0 4v3a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-3a2 2 0 0 0 0-4z" />
      <path d="M15 9v0M15 12v0M15 15v0" />
    </>
  ),
  passport: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <circle cx="12" cy="10" r="3.2" />
      <path d="M8.5 17h7" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c1.4-3.8 4.2-5.7 7.5-5.7s6.1 1.9 7.5 5.7" />
    </>
  ),
  wallet: (
    <>
      <path d="M4 8.5a2 2 0 0 1 2-2h12.5a1.5 1.5 0 0 1 1.5 1.5v10.5a1.5 1.5 0 0 1-1.5 1.5H6a2 2 0 0 1-2-2z" />
      <path d="M20 11h-3.5a2 2 0 0 0 0 4H20" />
      <path d="M6.5 6.5l8.2-2.8a1 1 0 0 1 1.3.7l.5 2.1" />
      <path d="M16.6 13v0" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
      <path d="M12 14.5v2" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15.5" r="4" />
      <path d="M10.9 12.6l8.6-8.6M15.5 8l2.5 2.5M13.3 10.2l2 2" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M2.8 20c1-3.4 3.3-5.2 6.2-5.2s5.2 1.8 6.2 5.2" />
      <path d="M15.2 5.3a3.5 3.5 0 0 1 0 6.4M17.4 14.9c1.9.6 3.2 2.3 3.8 5.1" />
    </>
  ),
  bot: (
    <>
      <rect x="4.5" y="8" width="15" height="11.5" rx="3" />
      <path d="M12 8V5.2" />
      <circle cx="12" cy="3.9" r="1.3" />
      <path d="M9.5 12.8v1.4M14.5 12.8v1.4M2.5 12.5v2.5M21.5 12.5v2.5" />
    </>
  ),
  coin: (
    <>
      <ellipse cx="12" cy="6.8" rx="7.5" ry="3" />
      <path d="M4.5 6.8v5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-5" />
      <path d="M4.5 11.8v5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-5" />
    </>
  ),
  crown: (
    <>
      <path d="M4.8 17L3.2 7.6a.4.4 0 0 1 .65-.37L8 10.6l3.6-5.7a.5.5 0 0 1 .8 0l3.6 5.7 4.15-3.37a.4.4 0 0 1 .65.37L19.2 17z" />
      <path d="M5 20.5h14" />
    </>
  ),
  flame: (
    <>
      <path d="M12 21c-3.8 0-6.5-2.6-6.5-6.2 0-3.6 2.6-5.6 3.8-8.1.6 1.8 1.6 2.9 2.7 3.3.2-3 1.6-5.6 3.9-7.5-.2 3.6 3.6 5.6 3.6 10.9C19.5 18 16.2 21 12 21z" />
      <path d="M12 18c-1.4 0-2.4-.9-2.4-2.2 0-1.5 1.1-2.3 2.2-3.6.9 1.3 2.6 2 2.6 3.6 0 1.3-1 2.2-2.4 2.2z" />
    </>
  ),
  chevron: <path d="M9.5 5.5L16 12l-6.5 6.5" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  check: <path d="M4.8 12.6l4.6 4.6L19.2 7.4" />,
  arrow: <path d="M4 12h15M13.5 6.5L19 12l-5.5 5.5" />,
  menu: <path d="M4 7h16M4 12h16M4 17h10" />,
  settings: (
    <>
      <path d="M4 7h8.5M17.5 7H20M4 17h2.5M11.5 17H20" />
      <circle cx="15" cy="7" r="2.5" />
      <circle cx="9" cy="17" r="2.5" />
    </>
  ),
  sound: (
    <>
      <path d="M4 9.5h3.3L11.6 6a.5.5 0 0 1 .9.4v11.2a.5.5 0 0 1-.9.4L7.3 14.5H4z" />
      <path d="M15.6 9.2a4 4 0 0 1 0 5.6M18.3 6.5a7.8 7.8 0 0 1 0 11" />
    </>
  ),
  mute: (
    <>
      <path d="M4 9.5h3.3L11.6 6a.5.5 0 0 1 .9.4v11.2a.5.5 0 0 1-.9.4L7.3 14.5H4z" />
      <path d="M16 9.5l5 5M21 9.5l-5 5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.8" />
      <path d="M3.5 12h17" />
      <path d="M12 3.2c2.3 2.4 3.5 5.3 3.5 8.8s-1.2 6.4-3.5 8.8c-2.3-2.4-3.5-5.3-3.5-8.8s1.2-6.4 3.5-8.8z" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="3.8" />
      <path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4" />
    </>
  ),
  moon: <path d="M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1z" />,
  chat: (
    <>
      <path d="M5 4.8h14a1.8 1.8 0 0 1 1.8 1.8v8.2a1.8 1.8 0 0 1-1.8 1.8h-6.6l-4.6 3.6v-3.6H5a1.8 1.8 0 0 1-1.8-1.8V6.6A1.8 1.8 0 0 1 5 4.8z" />
      <path d="M7.8 9.4h8.4M7.8 12.4h5" />
    </>
  ),
  emote: (
    <>
      <path d="M12.5 20.7a8.8 8.8 0 1 1 8.2-8.2" />
      <path d="M20.7 12.5h-4.2a4 4 0 0 0-4 4v4.2z" />
      <path d="M8.8 9.6v.8M13.6 9.6v.8M8.2 14c.8 1 1.8 1.5 2.9 1.6" />
    </>
  ),
  split: (
    <>
      <circle cx="8.5" cy="12" r="5" />
      <circle cx="18.2" cy="12" r="2.8" />
      <path d="M14.6 7.4l.9-.9M14.6 16.6l.9.9" />
    </>
  ),
  eject: (
    <>
      <path d="M11.6 5.3a.5.5 0 0 1 .8 0l6.3 7.9a.5.5 0 0 1-.4.8H5.7a.5.5 0 0 1-.4-.8z" />
      <path d="M5.5 18.5h13" />
    </>
  ),
  cashout: (
    <>
      <path d="M12 14V3.5M7.8 7.7L12 3.5l4.2 4.2" />
      <path d="M4 12.5v5.5A2.5 2.5 0 0 0 6.5 20.5h11A2.5 2.5 0 0 0 20 18v-5.5" />
    </>
  ),
  map: (
    <>
      <path d="M3.5 6.2l5.5-2.4 6 2.4 5-2.2a.4.4 0 0 1 .5.4v13.4l-5.5 2.4-6-2.4-5 2.2a.4.4 0 0 1-.5-.4z" />
      <path d="M9 3.8v14.4M15 6.2v14.4" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.8" />
      <path d="M12 11v5.5M12 7.6v0" />
    </>
  ),
  docs: (
    <>
      <path d="M6.5 3.5h7.3l4.7 4.7v11.3a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z" />
      <path d="M13.5 3.5v5h5M9 12.5h6M9 16h4" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  /** Rendered size in px (default 24). */
  size?: number;
  /** Accessible name. Omit for decorative icons (the usual case: label the control instead). */
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 24, title, className, style }: IconProps): ReactElement {
  return (
    <svg
      className={className ? `kb-icon ${className}` : 'kb-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {P[name]}
    </svg>
  );
}
