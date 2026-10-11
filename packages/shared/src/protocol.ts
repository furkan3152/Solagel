import type { RoomMode } from './constants';

/* ------------------------------------------------------------------ */
/* Entity / flag enums (plain objects so they work across packages)    */
/* ------------------------------------------------------------------ */

export const EntityKind = {
  Cell: 1,
  Food: 2,
  Eject: 3,
  Virus: 4,
  PowerUp: 5,
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
  Staker: 4,
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
  /** Food: variant 0..7. Eject: skin id (for color). PowerUp: PowerUpType. */
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
  width: number;
  height: number;
  players: number;
  bots: number;
  maxPlayers: number;
  /** Stake rooms only. */
  arenaId?: number;
  buyIn?: number;
  /** Stake arena admission state; existing sessions can still reconnect when false. */
  enabled?: boolean;
  /** Private rooms only. */
  code?: string;
}

export interface ChainStatus {
  /** Runtime gate for new games; existing games and settlements remain active. */
  admissionsPaused?: boolean;
  enabled: boolean;
  cluster: string;
  programId: string | null;
  rpcUrl: string | null;
  stakeEnabled: boolean;
  currentSeason: number | null;
}

export interface ProfileSummary {
  name: string;
  skin: number;
  xp: number;
  level: number;
  premiumSkins: number;
}

export type JoinTarget =
  | 'free'
  | `private:${string}`
  | `stake:${number}`;

export type ClientMessage =
  | { t: 'hello'; v: number; lang?: string }
  | { t: 'auth'; token: string }
  | { t: 'auth'; pubkey: string; message: string; signature: string }
  | { t: 'logout' }
  | { t: 'join'; room: JoinTarget | string; name: string; skin: number }
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
  /** Stake rooms: in-game value in lamports. */
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
  /** Stake rooms: lamports paid out (0 on death). */
  payout?: number;
}

export type ServerMessage =
  | { t: 'welcome'; v: number; serverTime: number; rooms: RoomInfo[]; chain: ChainStatus; online: number }
  | { t: 'authed'; pubkey: string; token: string; profile: ProfileSummary | null }
  | { t: 'joined'; room: RoomInfo; playerId: number; name: string; skin: number; value?: number; sessionId?: number; arenaId?: number }
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
  | { t: 'settled'; kind: 'cashout' | 'death' | 'record' | 'refund'; signature: string; payout?: number; sessionId?: number; arenaId?: number }
  | { t: 'event'; kind: 'coinrain'; state: 'start' | 'end'; ms?: number }
  | { t: 'event'; kind: 'airdrop'; state: 'start'; x: number; y: number; powerUp: PowerUpType }
  | { t: 'powerup'; type: PowerUpType; ms: number }
  | { t: 'xp'; xp: number; level: number }
  | { t: 'history'; chat: { pid: number; from: string; skin: number; text: string; system?: boolean }[] }
  | { t: 'rooms'; rooms: RoomInfo[]; online: number; chain?: ChainStatus }
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
  | 'stake_disabled'
  | 'admissions_paused'
  | 'server_full'
  | 'version_mismatch';

/** Parse a join target into its parts. Returns null for malformed input. */
export function parseJoinTarget(
  target: string,
): { mode: 'free' } | { mode: 'private'; code: string | null } | { mode: 'stake'; arenaId: number } | null {
  if (target === 'free') return { mode: 'free' };
  if (target.startsWith('private:')) {
    const code = target.slice(8).toUpperCase();
    if (code === 'NEW') return { mode: 'private', code: null };
    return /^[A-Z0-9]{5}$/.test(code) ? { mode: 'private', code } : null;
  }
  if (target.startsWith('stake:')) {
    const id = Number(target.slice(6));
    return Number.isInteger(id) && id >= 0 && id <= 65535 ? { mode: 'stake', arenaId: id } : null;
  }
  return null;
}
