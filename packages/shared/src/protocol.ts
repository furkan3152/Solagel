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
  /** Instance (shard) number within the arena. */
  instance?: number;
  /** Total value of loot on the floor, raw token units. */
  loot?: number;
  /** Private rooms only. */
  code?: string;
  /** Arena rooms: the round in play (shared by every arena and instance). */
  round?: RoundInfo;
}

/** An arena round as clients see it (Unix ms on the server clock; see `serverNow`). */
export interface RoundInfo {
  /** Round number: floor(serverNow / roundMs). */
  n: number;
  /** The round ends (and the next one opens) at this time. */
  endsAt: number;
  /** New joins are refused (`round_closed`) from this time until `endsAt`. */
  joinsCloseAt: number;
}

/** A row of the round-end standings (`roundOver`): stakers by value at the bell. */
export interface RoundStanding {
  name: string;
  /** Value at the bell, raw token units. */
  value: number;
  /** This row is the receiving player. */
  you?: boolean;
}

/**
 * An arena the server keeps closed although it is enabled on chain (R20: its vault
 * cannot cover the loot, pending payouts and tickets the server journaled). No ticket may be sold.
 */
export interface BlockedArena {
  arenaId: number;
  /** `vault_short`: the vault holds less than the journal owes. */
  reason: 'vault_short';
}

export interface ChainStatus {
  enabled: boolean;
  cluster: string;
  programId: string | null;
  rpcUrl: string | null;
  /** Paid arenas are open for tickets (false when the chain is off, the token is not set yet or is unusable). */
  arenasEnabled: boolean;
  /**
   * The game token is set on chain (`set_token_mint`). Until then the server runs practice only
   * and arena joins answer `token_not_set` ("Opening soon"). The server picks the token up
   * without a restart (it re-reads the config every 30 s) and then pushes a `chain` message.
   */
  tokenReady: boolean;
  /** The game token, null until it is set; `symbol` is display only (server `TOKEN_SYMBOL`). */
  token: { mint: string; symbol: string; decimals: number } | null;
  /** Fee on profit for new tickets (`Config.fee_bps`, basis points); null while the config is unknown. */
  feeBps: number | null;
  /** Public key the server signs settlements with: set it as the program's server authority (`init` / `update-config`). */
  serverKey?: string | null;
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
  | { t: 'hello'; v: number }
  | { t: 'auth'; token: string }
  | { t: 'auth'; pubkey: string; message: string; signature: string }
  | { t: 'logout' }
  | {
      t: 'join';
      room: JoinTarget | string;
      name: string;
      skin: number;
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
  | {
      t: 'welcome';
      v: number;
      serverTime: number;
      /** Server clock (Unix ms) that round times are on; clients correct their clock skew with it. */
      serverNow: number;
      rooms: RoomInfo[];
      chain: ChainStatus;
      online: number;
      blocked?: BlockedArena[];
    }
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
      /** Arena rooms: the ticket's on-chain session address (matches `settled.session`). */
      session?: string;
      /** Arena rooms: the round in play (same as `room.round`). */
      round?: RoundInfo;
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
  // Arena rooms: the round ended with this player alive; `payout` (= value at the bell, raw token units,
  // before the fee) is being settled (a `settled` message follows). `standings`: top 10 stakers by value.
  | { t: 'roundOver'; round: number; payout: number; stats: DeathStats; standings: RoundStanding[] }
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
      kind: 'payout' | 'death' | 'refund';
      session?: string;
      arenaId?: number;
      signature: string;
      payout: number;
      fee?: number;
      net?: number;
      /**
       * R24: settled without a usable token account. The result is final but `net`
       * waits in the arena vault: the player collects it ("Collect payout").
       */
      collect?: boolean;
    }
  | { t: 'event'; kind: 'coinrain'; state: 'start' | 'end'; ms?: number }
  | { t: 'event'; kind: 'airdrop'; state: 'start'; x: number; y: number; powerUp: PowerUpType }
  | { t: 'powerup'; type: PowerUpType; ms: number }
  | { t: 'xp'; xp: number; level: number }
  | { t: 'history'; chat: { pid: number; from: string; skin: number; text: string; system?: boolean }[] }
  | { t: 'rooms'; rooms: RoomInfo[]; online: number; blocked?: BlockedArena[] }
  // The chain status changed (e.g. the game token was set: `tokenReady` turned true); same shape as `welcome.chain`.
  | { t: 'chain'; chain: ChainStatus }
  // `opensAt` (Unix ms, server clock): with `round_closed`, when the next round opens for joins.
  | { t: 'error'; code: ErrorCode; message: string; opensAt?: number }
  | { t: 'pong'; ts: number; serverTime: number; serverNow: number };

export type ErrorCode =
  | 'bad_request'
  | 'rate_limited'
  | 'room_full'
  | 'room_not_found'
  | 'auth_required'
  | 'auth_failed'
  | 'no_session'
  | 'session_busy'
  | 'payout_waiting'
  | 'skin_locked'
  | 'arenas_disabled'
  /** The game token is not set on chain yet: arenas open soon (`ChainStatus.tokenReady` false); practice works. */
  | 'token_not_set'
  | 'server_full'
  | 'version_mismatch'
  /** Arena joins are closed for the rest of the round; `opensAt` says when the next one opens. */
  | 'round_closed'
  /** Paid arenas have no cash-out: everyone alive is paid at the round end. */
  | 'no_cashout'
  /** The ticket of a returning (AFK) player was settled at the bell while they were away: the till was paid. */
  | 'round_ended';

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
