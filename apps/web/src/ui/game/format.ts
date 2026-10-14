import { TOKEN_SYMBOL_DEFAULT, arenaMeta, formatToken, type RoomInfo } from '@slana/shared';
import { useUi, type Lang } from '../../store';

export interface TokenFormat {
  symbol: string;
  decimals: number;
  lang: Lang;
  /** Raw base units → display text (`1.234,5` in tr). */
  fmt: (raw: number, opts?: { maxFrac?: number; compact?: boolean }) => string;
  /** Signed, with a real minus sign: `+1.250` / `−1.250`. */
  signed: (raw: number, opts?: { maxFrac?: number; compact?: boolean }) => string;
}

/** Token formatting bound to the current language and the chain's mint. */
export function useTokenFormat(): TokenFormat {
  const lang = useUi((s) => s.settings.lang);
  const token = useUi((s) => s.chain?.token ?? null);
  return tokenFormat(lang, token?.decimals ?? 6, token?.symbol ?? TOKEN_SYMBOL_DEFAULT);
}

export function tokenFormat(lang: Lang, decimals: number, symbol: string): TokenFormat {
  const fmt = (raw: number, opts?: { maxFrac?: number; compact?: boolean }) => formatToken(raw, decimals, lang, opts);
  return {
    symbol,
    decimals,
    lang,
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

const LEAGUES = {
  rookie: { tr: 'Çaylak Gölü', en: 'Rookie Pond' },
  pro: { tr: 'Usta Gölü', en: 'Pro Pond' },
} as const;

/** A room's display name in the current language. */
export function roomName(room: RoomInfo | null, lang: Lang): string {
  if (!room) return '';
  if (room.mode === 'practice' && room.league && LEAGUES[room.league]) {
    const n = /-(\d+)$/.exec(room.id)?.[1];
    return `${LEAGUES[room.league][lang]}${n ? ` #${n}` : ''}`;
  }
  if (room.mode === 'arena' && room.arenaId !== undefined) {
    const name = arenaMeta(room.arenaId).name[lang];
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
