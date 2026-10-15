import type { League, RoomMode } from './constants';

/* ------------------------------------------------------------------ */
/* Entity / flag enums (plain objects so they work across packages)    */
/* ------------------------------------------------------------------ */

export const EntityKind = {
  Cell: 1,
  Food: 2,
  Eject: 3,
  Virus: 4,
  PowerUp: 5,
  /** Tokens spilled by a bot kill; `variant` is the size tier 0..3 (see `lootTier`). */
  Loot: 6,
} as const;
export type EntityKind = (typeof EntityKind)[keyof typeof EntityKind];

export const PowerUpType = {
  Magnet: 1,
  Pump: 2,
  Shield: 3,
  Bag: 4,
} as const;
export type PowerUpType = (typeof PowerUpType)[keyof typeof PowerUpType];

/** Per-cell visual flags carried in snapshots. */
export const CellFlag = {
  Shield: 1,
  CashingOut: 2,
  Magnet: 4,
  Pump: 8,
  Afk: 16,
} as const;

/** Per-player flags carried in snapshots. */
export const PlayerFlag = {
  Bot: 1,
  /** Name comes from a wallet-verified on-chain profile. */
  Verified: 2,
  /** Plays an arena ticket (tokens at stake). */
  Staker: 4,
  /** Plays with a Slana Pass; `PlayerInfo.pass` carries its number. */
  Pass: 8,
} as const;

/** Binary client → server opcodes (first byte). */
export const ClientOp = {
  Target: 1,
  Split: 2,
  Eject: 3,
} as const;

/** Binary server → client opcodes (first byte). */
export const ServerOp = {
  Snapshot: 1,
} as const;

/* ------------------------------------------------------------------ */
/* Snapshot payload                                                    */
/* ------------------------------------------------------------------ */

export interface PlayerInfo {
  id: number;
  skin: number;
  flags: number;
  /** Slana Pass number whose look this player wears (0 = none). */
  pass: number;
  name: string;
}

export interface EntityRecord {
  id: number;
  kind: EntityKind;
  x: number;
  y: number;
  r: number;
  /** Cell: owning player id. */
  playerId?: number;
  /** Cell: CellFlag bits. */
  flags?: number;
  /** Food: variant 0..7. Eject: skin id (for color). PowerUp: PowerUpType. Loot: size tier 0..3. */
  variant?: number;
}

export interface Removal {
  id: number;
  /** Entity id of the eater (0 if it just left the view / despawned). */
  eaterId: number;
}

export interface SnapshotData {
  tick: number;
  /** Server-side view centre and visible height (used for spectating). */
  view: { x: number; y: number; h: number };
  players: PlayerInfo[];
  upserts: EntityRecord[];
  removals: Removal[];
}

/* ------------------------------------------------------------------ */
/* JSON messages                                                       */
/* ------------------------------------------------------------------ */

export interface RoomInfo {
  id: string;
  mode: RoomMode;
  name: string;
  /** Practice rooms only. */
  league?: League;
  width: number;
  height: number;
  players: number;
  bots: number;
  maxPlayers: number;
  /** Arena rooms only. */
  arenaId?: number;
  /** Entry fee in raw token units (base units of the mint). */
  entryFee?: number;
  /** A Slana Pass is needed to buy a ticket. */
  requiresPass?: boolean;
  /** Instance (shard) number within the arena. */
  instance?: number;
  /** Total value of loot on the floor, raw token units. */
  loot?: number;
  /** Private rooms only. */
  code?: string;
}

/** The Slana Pass collection as the server sees it on chain. */
export interface PassStatus {
  /** Collection address. */
  collection: string;
  supply: number;
  minted: number;
  perWallet: number;
  mintOpen: boolean;
  /** Unix seconds; the mint opens at this time. */
  mintStartTs: number;
  revealed: boolean;
  /** Final trait seed `Config.pass_final_seed` = sha256(admin seed || entropy), hex, published at reveal (null before). `passTraits(seed, n, supply)`. */
  seed: string | null;
}

/** Marketplace pages of the Slana Pass collection (server `MARKET_URLS`); a missing key hides that link. */
export interface MarketUrls {
  magicEden?: string;
  tensor?: string;
  opensea?: string;
}

export interface ChainStatus {
  enabled: boolean;
  cluster: string;
  programId: string | null;
  rpcUrl: string | null;
  /** Paid arenas are open for tickets (false when the chain is off or the token is unusable). */
  arenasEnabled: boolean;
  currentSeason: number | null;
  /** The game token; `symbol` is display only. */
  token: { mint: string; symbol: string; decimals: number } | null;
  pass: PassStatus | null;
  /** Collection pages on the marketplaces (added by the server from its config; absent = none). */
  markets?: MarketUrls;
}

export interface ProfileSummary {
  name: string;
  skin: number;
  xp: number;
  level: number;
  premiumSkins: number;
}

export type JoinTarget = 'practice' | `private:${string}` | `arena:${number}`;

export type ClientMessage =
  | { t: 'hello'; v: number; lang?: string }
  | { t: 'auth'; token: string }
  | { t: 'auth'; pubkey: string; message: string; signature: string }
  | { t: 'logout' }
  | {
      t: 'join';
      room: JoinTarget | string;
      name: string;
      skin: number;
      /** Address of the Slana Pass asset to play with; the server verifies ownership. */
      pass?: string;
    }
  | { t: 'spectate'; room?: string; next?: boolean }
  | { t: 'leave' }
  | { t: 'viewport'; w: number; h: number }
  | { t: 'chat'; text: string }
  | { t: 'emote'; id: number }
  | { t: 'cashout' }
  | { t: 'ping'; ts: number };

export interface LbEntry {
  pid: number;
  name: string;
  skin: number;
  score: number;
  /** Arena rooms: in-game value, raw token units. */
  value?: number;
  bot?: boolean;
  verified?: boolean;
}

export interface DeathStats {
  aliveMs: number;
  finalMass: number;
  maxMass: number;
  foodEaten: number;
  cellsEaten: number;
  playersEaten: number;
  bestRank: number;
  xp?: number;
  /** Arena rooms: raw token units paid out (0 on death). */
  payout?: number;
  /** Arena rooms: value lost on death, raw token units. */
  valueLost?: number;
  /** Arena rooms: the killer was a bot. */
  byBot?: boolean;
  /** Arena rooms: part of `valueLost` that spilled as loot (all of it on a bot kill). */
  lootSpilled?: number;
}

export type ServerMessage =
  | { t: 'welcome'; v: number; serverTime: number; rooms: RoomInfo[]; chain: ChainStatus; online: number }
  | { t: 'authed'; pubkey: string; token: string; profile: ProfileSummary | null }
  | {
      t: 'joined';
      room: RoomInfo;
      playerId: number;
      name: string;
      skin: number;
      /** Arena rooms: the player's in-game value, raw token units. */
      value?: number;
      /** Arena rooms: the ticket price, raw token units. */
      entryFee?: number;
      /** The ticket carries a Slana Pass (Pass power applies). */
      hasPass?: boolean;
      /** Arena rooms: the ticket's on-chain session address (matches `settled.session`). */
      session?: string;
    }
  | { t: 'spectating'; room: RoomInfo; targetPid: number | null }
  | { t: 'left' }
  | {
      t: 'lb';
      top: LbEntry[];
      me: { rank: number; score: number; value?: number } | null;
      /** Up to three leader centres for the minimap. */
      leaders: { x: number; y: number }[];
      players: number;
    }
  | { t: 'kf'; killer: string; killerSkin: number; victim: string; victimSkin: number; cause: 'eat' | 'virus' }
  | { t: 'chat'; pid: number; from: string; skin: number; text: string; system?: boolean }
  | { t: 'emote'; pid: number; id: number }
  | { t: 'death'; stats: DeathStats; killer: string | null; killerSkin: number | null }
  | { t: 'cashout'; state: 'started' | 'canceled' | 'done'; ms?: number; value?: number; stats?: DeathStats }
  // Arena rooms: the player's in-game value changed.
  | {
      t: 'value';
      /** New value, raw token units. */
      value: number;
      /** Signed change that was just applied. */
      delta: number;
      /** eat: took a share from a player; loot: picked up loot; eaten: a player took a share from us; spill: a bot ate a cell and the share spilled as loot. */
      reason: 'eat' | 'loot' | 'eaten' | 'spill';
    }
  // Amounts are raw token units: `fee` is taken from the profit and `net` (= payout - fee) reaches the wallet.
  // `session` is the settled ticket's on-chain session address (= `joined.session`) and `arenaId` its arena;
  // clients match a receipt by `session`. Both are optional so older servers stay readable (R16).
  | {
      t: 'settled';
      kind: 'cashout' | 'death' | 'refund';
      session?: string;
      arenaId?: number;
      signature: string;
      payout: number;
      fee?: number;
      net?: number;
    }
  | { t: 'event'; kind: 'coinrain'; state: 'start' | 'end'; ms?: number }
  | { t: 'event'; kind: 'airdrop'; state: 'start'; x: number; y: number; powerUp: PowerUpType }
  | { t: 'powerup'; type: PowerUpType; ms: number }
  | { t: 'xp'; xp: number; level: number }
  | { t: 'history'; chat: { pid: number; from: string; skin: number; text: string; system?: boolean }[] }
  | { t: 'rooms'; rooms: RoomInfo[]; online: number }
  | { t: 'error'; code: ErrorCode; message: string }
  | { t: 'pong'; ts: number; serverTime: number };

export type ErrorCode =
  | 'bad_request'
  | 'rate_limited'
  | 'room_full'
  | 'room_not_found'
  | 'auth_required'
  | 'auth_failed'
  | 'no_session'
  | 'session_busy'
  | 'skin_locked'
  | 'pass_required'
  | 'pass_invalid'
  | 'pass_in_use'
  | 'arenas_disabled'
  | 'server_full'
  | 'version_mismatch';

/** Parse a join target into its parts. Returns null for malformed input. */
export function parseJoinTarget(
  target: string,
): { mode: 'practice' } | { mode: 'private'; code: string | null } | { mode: 'arena'; arenaId: number } | null {
  if (target === 'practice') return { mode: 'practice' };
  if (target.startsWith('private:')) {
    const code = target.slice(8).toUpperCase();
    if (code === 'NEW') return { mode: 'private', code: null };
    return /^[A-Z0-9]{5}$/.test(code) ? { mode: 'private', code } : null;
  }
  if (target.startsWith('arena:')) {
    const digits = target.slice(6);
    if (!/^\d{1,5}$/.test(digits)) return null;
    const id = Number(digits);
    return id <= 65535 ? { mode: 'arena', arenaId: id } : null;
  }
  return null;
}
