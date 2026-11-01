import { CAPACITY } from './constants';

/**
 * Custom rooms: a signed-in wallet pays a small native HYPE fee (to the treasury) and gets a
 * private room with its own rules (map size, bots, duration, ...). Anyone with the invite code
 * joins (guests too). No token stakes: pure fun, with the room's own leaderboard.
 *
 * A custom room is a `private` room (`RoomInfo.mode`), joined with `private:<CODE>` like any
 * other; `RoomInfo.custom` carries its rules and its end time.
 */

export const CUSTOM_DURATIONS_MIN = [15, 30, 60] as const;
export type CustomDuration = (typeof CUSTOM_DURATIONS_MIN)[number];

export const CUSTOM_MAP_SIZES = ['S', 'M', 'L'] as const;
export type CustomMapSize = (typeof CUSTOM_MAP_SIZES)[number];

export const CUSTOM_DIFFICULTIES = ['easy', 'mixed', 'hard'] as const;
export type CustomDifficulty = (typeof CUSTOM_DIFFICULTIES)[number];

export const CUSTOM_FOOD = ['low', 'normal', 'high'] as const;
export type CustomFood = (typeof CUSTOM_FOOD)[number];

/** How NFT holders are rewarded: a discount on the price, one free room a day (UTC), or nothing. */
export const CUSTOM_HOLDER_PERKS = ['discount', 'free_daily', 'none'] as const;
export type CustomHolderPerk = (typeof CUSTOM_HOLDER_PERKS)[number];

/** Bounds of the creator's choices. */
export const CUSTOM_LIMITS = {
  nameMin: 2,
  nameMax: 24,
  botsMax: 12,
  playersMin: 2,
  playersMax: CAPACITY.private,
} as const;

/** World sizes (square) per map size: S is smaller than a private room, L about a practice pond. */
export const CUSTOM_MAP_WIDTH: Record<CustomMapSize, number> = { S: 3600, M: 5200, L: 7000 };

/** What the creator picks in the room creator sheet. */
export interface CustomRoomConfig {
  /** Room name (2..24 printable characters). */
  name: string;
  durationMin: CustomDuration;
  mapSize: CustomMapSize;
  /** Bots in the room, 0..12 (they stay at this count whatever the humans do). */
  bots: number;
  difficulty: CustomDifficulty;
  /** Most humans at once, 2..20. */
  maxPlayers: number;
  food: CustomFood;
  powerUps: boolean;
}

export const CUSTOM_DEFAULTS: CustomRoomConfig = {
  name: '',
  durationMin: 30,
  mapSize: 'M',
  bots: 6,
  difficulty: 'mixed',
  maxPlayers: 10,
  food: 'normal',
  powerUps: true,
};

/** The rules of a live custom room as clients see them (`RoomInfo.custom`). */
export interface CustomRoomSummary {
  durationMin: CustomDuration;
  mapSize: CustomMapSize;
  bots: number;
  difficulty: CustomDifficulty;
  food: CustomFood;
  powerUps: boolean;
  /** Creator wallet (EIP-55). */
  creator: string;
  /** Unix ms: the room opened. */
  createdAt: number;
  /** Unix ms: the room closes (everyone goes back to the lobby). */
  endsAt: number;
}

/** A row of a custom room's own leaderboard (best finished games in this room). */
export interface CustomBest {
  name: string;
  /** Best mass of the game. */
  score: number;
  kills: number;
  at: number;
}

/** `GET /api/rooms/custom/<CODE>` and the create / list answers. */
export interface CustomRoomView extends CustomRoomSummary {
  code: string;
  name: string;
  maxPlayers: number;
  /** Humans in the room now. */
  players: number;
  /** The room's own leaderboard, best first (up to 10). */
  best: CustomBest[];
  /** How it was paid: `paid` (a HYPE transfer) or `free` (the holder perk: a free room of the day, or a 100 % discount). */
  paidWith: 'paid' | 'free';
  /** The payment transaction (0x hash), when paid. */
  txHash: string | null;
}

/** The admin settings (`/api/admin/custom-rooms`). */
export interface CustomRoomSettings {
  /** Creating rooms is open. */
  enabled: boolean;
  /** Price in HYPE, decimal string (e.g. "0.05"). */
  priceHype: string;
  /** Where the fee goes (EIP-55); null: the first `ADMIN_WALLETS` wallet (the owner). */
  treasury: string | null;
  holderPerk: CustomHolderPerk;
  /** `discount` perk: percent off for NFT holders (0..100). */
  holderDiscountPct: number;
  /** Most custom rooms live at once on this server (it is small). */
  maxLive: number;
  /** Most live custom rooms per creator wallet. */
  maxPerWallet: number;
}

export const CUSTOM_SETTINGS_DEFAULT: CustomRoomSettings = {
  enabled: true,
  priceHype: '0.05',
  treasury: null,
  holderPerk: 'discount',
  holderDiscountPct: 50,
  maxLive: 6,
  maxPerWallet: 2,
};

/** Bounds of the admin caps. */
export const CUSTOM_SETTINGS_LIMITS = { maxLive: 24, maxPerWallet: 10 } as const;

/** A payment older than this is refused (`payment_stale`). */
export const CUSTOM_PAYMENT_MAX_AGE_MS = 2 * 3600_000;

/** `GET /api/rooms/custom/quote`: what creating a room costs this wallet right now. */
export interface CustomRoomQuote {
  enabled: boolean;
  /** Base price, wei (decimal string). */
  priceWei: string;
  /** What this wallet pays, wei (decimal string; "0" with a free room). */
  youPayWei: string;
  /** Fee receiver (EIP-55); null: none configured (creating is closed). */
  treasury: string | null;
  holderPerk: CustomHolderPerk;
  holderDiscountPct: number;
  /** The signed-in wallet holds an Elymum NFT (false for guests). */
  holder: boolean;
  /** The holder's free room of the day is still available (`free_daily`). */
  freeAvailable: boolean;
  live: number;
  maxLive: number;
  /** Live rooms of the signed-in wallet. */
  mine: number;
  maxPerWallet: number;
  /** The server's chain id (the payment must be sent on it); null while the chain is off. */
  chainId: number | null;
}

/** Error codes of the custom room API (`{ error, message }`). */
export type CustomRoomError =
  | 'bad_request'
  | 'unauthorized'
  | 'rooms_closed'
  | 'slots_busy'
  | 'wallet_limit'
  | 'payment_required'
  | 'payment_pending'
  | 'payment_invalid'
  | 'payment_used'
  | 'payment_stale'
  | 'payment_low'
  | 'chain_busy'
  | 'not_found'
  | 'forbidden';

const NAME_RE = /^[\p{L}\p{N} .,'!?&#@:()_-]+$/u;

/** Checks the creator's choices; returns the clean config or an error message naming the field. */
export function validateCustomConfig(x: unknown): { ok: true; config: CustomRoomConfig } | { ok: false; field: string; message: string } {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return { ok: false, field: 'config', message: 'config must be an object' };
  const o = x as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.replace(/\s+/g, ' ').trim() : '';
  if (name.length < CUSTOM_LIMITS.nameMin || name.length > CUSTOM_LIMITS.nameMax || !NAME_RE.test(name)) {
    return { ok: false, field: 'name', message: `Give the room a name of ${CUSTOM_LIMITS.nameMin} to ${CUSTOM_LIMITS.nameMax} letters or digits.` };
  }
  const pick = <T extends string | number>(v: unknown, list: readonly T[], field: string): T | { field: string } =>
    (list as readonly unknown[]).includes(v) ? (v as T) : { field };
  const durationMin = pick(o.durationMin, CUSTOM_DURATIONS_MIN, 'durationMin');
  const mapSize = pick(o.mapSize, CUSTOM_MAP_SIZES, 'mapSize');
  const difficulty = pick(o.difficulty, CUSTOM_DIFFICULTIES, 'difficulty');
  const food = o.food === undefined ? CUSTOM_DEFAULTS.food : pick(o.food, CUSTOM_FOOD, 'food');
  for (const v of [durationMin, mapSize, difficulty, food]) if (typeof v === 'object') return { ok: false, field: v.field, message: `${v.field} is not one of the choices` };
  const int = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);
  const bots = int(o.bots, 0, CUSTOM_LIMITS.botsMax);
  if (bots === null) return { ok: false, field: 'bots', message: `bots must be a whole number from 0 to ${CUSTOM_LIMITS.botsMax}` };
  const maxPlayers = int(o.maxPlayers, CUSTOM_LIMITS.playersMin, CUSTOM_LIMITS.playersMax);
  if (maxPlayers === null) return { ok: false, field: 'maxPlayers', message: `maxPlayers must be a whole number from ${CUSTOM_LIMITS.playersMin} to ${CUSTOM_LIMITS.playersMax}` };
  const powerUps = o.powerUps === undefined ? true : o.powerUps;
  if (typeof powerUps !== 'boolean') return { ok: false, field: 'powerUps', message: 'powerUps must be true or false' };
  return {
    ok: true,
    config: {
      name,
      durationMin: durationMin as CustomDuration,
      mapSize: mapSize as CustomMapSize,
      bots,
      difficulty: difficulty as CustomDifficulty,
      maxPlayers,
      food: food as CustomFood,
      powerUps,
    },
  };
}

/** Invite codes are the private-room codes: 5 of these characters (no 0/O, 1/I). */
export const INVITE_CODE_RE = /^[A-HJ-NP-Z2-9]{5}$/;

/** The code in an invite (`?room=CODE`, any case); null when it is not one. */
export function parseInviteCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const c = raw.trim().toUpperCase();
  return INVITE_CODE_RE.test(c) ? c : null;
}

/** The share link of a room: `<origin>/play?room=CODE` (e.g. https://elymum.io/play?room=AB2CD). */
export function inviteUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/play?room=${encodeURIComponent(code)}`;
}

/** What a wallet pays for a room (wei) given the settings and its holder status. */
export function customRoomPrice(
  priceWei: bigint,
  s: Pick<CustomRoomSettings, 'holderPerk' | 'holderDiscountPct'>,
  holder: boolean,
  freeAvailable: boolean,
): bigint {
  if (!holder) return priceWei;
  if (s.holderPerk === 'free_daily' && freeAvailable) return 0n;
  if (s.holderPerk === 'discount') {
    const pct = BigInt(Math.max(0, Math.min(100, Math.floor(s.holderDiscountPct))));
    return (priceWei * (100n - pct)) / 100n;
  }
  return priceWei;
}
