import { ledgerDecimals } from '@elymum/sdk';
import { TOKEN_SYMBOL_DEFAULT, arenaMeta, formatToken, type RoomInfo } from '@elymum/shared';
import { useUi } from '../../store';

export interface TokenFormat {
  symbol: string;
  decimals: number;
  /** Ledger units (the game server's wire amounts) → display text (`1,234.5`). */
  fmt: (raw: number, opts?: { maxFrac?: number; compact?: boolean }) => string;
  /** Signed, with a real minus sign: `+1.250` / `−1.250`. */
  signed: (raw: number, opts?: { maxFrac?: number; compact?: boolean }) => string;
}

/**
 * Formatting of the game server's amounts (values, payouts, loot, standings): they are ledger
 * units, so the decimals are `ledgerDecimals(token decimals)` (at most 6).
 */
export function useTokenFormat(): TokenFormat {
  const token = useUi((s) => s.chain?.token ?? null);
  return tokenFormat(ledgerDecimals(token?.decimals ?? 18), token?.symbol ?? TOKEN_SYMBOL_DEFAULT);
}

/** Whole tokens from which summaries switch to the compact form (`1.2B`) unless a caller asks otherwise. */
export const COMPACT_FROM_TOKENS = 1e9;

export function tokenFormat(decimals: number, symbol: string): TokenFormat {
  // summaries never print a 13-digit whole part: from a billion tokens up they read `1.2B` / `1T`
  const fmt = (raw: number, opts?: { maxFrac?: number; compact?: boolean }) =>
    formatToken(raw, decimals, { ...opts, compact: opts?.compact ?? Math.abs(raw) >= COMPACT_FROM_TOKENS * 10 ** decimals });
  return {
    symbol,
    decimals,
    fmt,
    signed: (raw, opts) => {
      const text = fmt(Math.abs(raw), opts);
      if (text === '0') return text;
      return `${raw < 0 ? '−' : '+'}${text}`;
    },
  };
}

/**
 * A mass (or any count) for a tight column: grouped up to 9,999, then compact with one decimal
 * (`99.9K`, `1.2M`), so a 99,999 mass never widens a standings row.
 */
export function compactCount(n: number): string {
  const v = Math.floor(Math.max(0, n));
  if (v < 10_000) return v.toLocaleString('en-US');
  for (const [d, s] of [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ] as const) {
    if (v >= d) {
      const x = Math.floor((v / d) * 10) / 10;
      return `${x >= 1000 ? Math.floor(x).toLocaleString('en-US') : x.toFixed(x < 100 ? 1 : 0).replace(/\.0$/, '')}${s}`;
    }
  }
  return v.toLocaleString('en-US');
}

/** Whole tokens for the counters (two decimals while the amount is under 100 tokens). */
export const counterFrac = (raw: number, decimals: number): number => (Math.abs(raw) < 100 * 10 ** decimals ? 2 : 0);

/** Practice rooms by league (Rookie, Pro). */
const LEAGUES = {
  rookie: 'Rookie Pond',
  pro: 'Pro Pond',
} as const;

/** A room's display name. */
export function roomName(room: RoomInfo | null): string {
  if (!room) return '';
  if (room.mode === 'practice' && room.league && LEAGUES[room.league]) {
    const n = /-(\d+)$/.exec(room.id)?.[1];
    return `${LEAGUES[room.league]}${n ? ` #${n}` : ''}`;
  }
  if (room.mode === 'arena' && room.arenaId !== undefined) {
    const name = arenaMeta(room.arenaId).name;
    return room.instance && room.instance > 1 ? `${name} · ${room.instance}` : name;
  }
  return room.name;
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Sector label ("C3") of a world point on the 5 × 5 map sheet. */
export function sectorOf(x: number, y: number, width: number, height: number): string {
  const cx = Math.max(0, Math.min(4, Math.floor((x / Math.max(1, width)) * 5)));
  const cy = Math.max(0, Math.min(4, Math.floor((y / Math.max(1, height)) * 5)));
  return `${'ABCDE'[cy]}${cx + 1}`;
}

/** English ordinal: 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st. */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}
