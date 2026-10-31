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

export function tokenFormat(decimals: number, symbol: string): TokenFormat {
  const fmt = (raw: number, opts?: { maxFrac?: number; compact?: boolean }) => formatToken(raw, decimals, opts);
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
