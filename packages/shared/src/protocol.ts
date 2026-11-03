import type { BoostKind, BoostRefusal, BoostState } from './boosts';
import type { League, RoomMode } from './constants';
import type { CustomRoomSummary } from './custom-rooms';

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
  /**
   * The player just fired a bought Shockwave (`BOOST_RULES.shock.fxMs`): viewers draw a ring out to
   * `shockRange(r)` from the flag's rising edge. Old clients ignore the bit.
   */
  Shock: 32,
} as const;

/** Per-player flags carried in snapshots. */
export const PlayerFlag = {
  Bot: 1,
  /** Name comes from the server profile of a signed-in (SIWE) wallet. */
  Verified: 2,
  /** Plays an arena ticket (tokens at stake). */
  Staker: 4,
  /** The wallet holds an Elymum emblem (the name tag wears a laurel). Old clients ignore the bit. */
  Holder: 8,
  /**
   * The player wears an uploaded profile picture (`avatar`): the wire record carries the 8-byte avatar
   * id after the name (protocol v7). Never set for bots.
   */
  Avatar: 16,
  /**
   * The player plays for a country (`country`): the wire record carries its 2-letter ISO 3166-1 code
   * (two ASCII capitals) after the name and the avatar id (protocol v8).
   */
  Country: 32,
  /**
   * The player wears its country's flag as the coin skin (protocol v10): only with `Country` (the
   * encoder clears it otherwise). No extra bytes. A worn profile picture wins over it on screen.
   */
  FlagSkin: 64,
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
  /** `PlayerFlag` bits (the wire carries only these). */
  flags: number;
  name: string;
  /**
   * The player is a server bot (show the BOT tag). On the wire this is `PlayerFlag.Bot` in `flags`:
   * `decodeSnapshot` always sets it, `writeSnapshot` sets the flag bit when it is true.
   */
  isBot?: boolean;
  /**
   * The player's wallet holds an Elymum emblem (show the laurel). On the wire this is
   * `PlayerFlag.Holder` in `flags`; `decodeSnapshot` sets it only when true.
   */
  holder?: boolean;
  /**
   * The player's profile picture (`isAvatarId`: 16 lowercase hex, served at `avatarPath(id)`). On the
   * wire this is `PlayerFlag.Avatar` in `flags` plus 8 bytes after the name; absent for bots and guests.
   */
  avatar?: string;
  /**
   * The country the player plays for (`isCountryCode`), shown as a flag by the name. On the wire this
   * is `PlayerFlag.Country` in `flags` plus 2 bytes after the avatar id; absent for "no country".
   */
  country?: string;
  /**
   * The coin is painted with the flag of `country` (the flag skin). On the wire this is
   * `PlayerFlag.FlagSkin` in `flags` (never without a country); `decodeSnapshot` sets it only when true.
   */
  flagSkin?: boolean;
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
  /**
   * The world's playable rectangle (v8), sent when it changed since this connection last heard it
   * (and with the first snapshot of a fresh view). Absent: unchanged.
   */
  bounds?: WorldBounds;
  players: PlayerInfo[];
  upserts: EntityRecord[];
  removals: Removal[];
}

/** A world's playable rectangle in world units: [x0, x1) x [y0, y1). Adaptive maps grow it in play. */
export interface WorldBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
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
  /** Playable size now (an adaptive map grows in play: snapshots carry the live `bounds`). */
  width: number;
  height: number;
  /** Origin of the playable square (v8; absent: 0). Adaptive maps sit centred in `MAP_SPACE`. */
  x0?: number;
  y0?: number;
  players: number;
  bots: number;
  maxPlayers: number;
  /** Arena rooms only. */
  arenaId?: number;
  /** Entry fee in raw token units (base units of the ERC-20 game token). */
  entryFee?: number;
  /** Instance (shard) number within the arena. */
  instance?: number;
  /** Total value of loot on the floor, raw token units. */
  loot?: number;
  /** Private rooms only. */
  code?: string;
  /**
   * Custom rooms only (a paid private room with its own rules): the rules, the creator and when
   * the room closes. Old clients ignore it and see a plain private room.
   */
  custom?: CustomRoomSummary;
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
  /** The row is a server bot (a testnet staked bot; zero-value bots hold no ticket and never stand). */
  isBot?: boolean;
  /** Value at the bell, raw token units. */
  value: number;
  /** This row is the receiving player. */
  you?: boolean;
}

/**
 * An arena the server keeps closed although it is enabled on chain (its vault
 * cannot cover the loot, pending payouts and tickets the server journaled). No ticket may be sold.
 */
export interface BlockedArena {
  arenaId: number;
  /** `vault_short`: the vault holds less than the journal owes. */
  reason: 'vault_short';
}

/** What the arena fee is taken from (see `ChainStatus.feeModel`). */
export type FeeModel = 'entry' | 'profit';

export interface ChainStatus {
  /** The server has an EVM RPC (`EVM_RPC_URL`) and talks to the chain. */
  enabled: boolean;
  /** `eth_chainId` of the server's RPC (the source of truth); null while the chain is off or unknown. */
  chainId: number | null;
  /** Display name (`chainInfo(chainId).name`, `CHAIN_NAME` for ids not in the table). */
  chainName: string;
  /** Public RPC handed to browsers (no secrets); null: the wallet uses its own RPC. */
  rpcUrl: string | null;
  /** Blockscout-style explorer base URL (`/tx/<hash>`, `/address/<addr>`); null when there is none. */
  explorerUrl: string | null;
  /** The registered `ElymumArena` contract (0x address), null until one is deployed and registered. */
  arenaAddress: string | null;
  /** The registered `ElymumNFT` contract (0x address), null until one is deployed and registered. */
  nftAddress: string | null;
  /** Paid arenas are open for tickets (false when the chain is off, the token is not set yet or is unusable). */
  arenasEnabled: boolean;
  /**
   * The game token is set on the arena contract (`setToken`). Until then the server runs practice only
   * and arena joins answer `token_not_set` ("Opening soon"). The server picks the token up
   * without a restart (it re-reads `config()` every 30 s) and then pushes a `chain` message.
   */
  tokenReady: boolean;
  /** The game token (ERC-20 address), null until it is set; `symbol` is display only (server `TOKEN_SYMBOL`). */
  token: { address: string; symbol: string; decimals: number } | null;
  /**
   * The platform fee of new tickets (`config().feeBps`, basis points); null while the config is unknown.
   * Its base depends on `feeModel`: the entry fee of every played ticket (`entry`) or the profit (`profit`).
   */
  feeBps: number | null;
  /**
   * What `feeBps` is taken from. `entry` (arena contract v2): every played ticket pays it from its entry
   * fee, whatever the result; the ticket plays `entry − fee` and a payout is paid in full. `profit` (the
   * legacy v1 contract still live on the testnet until it is redeployed): only on profit, at the payout.
   * Absent or null when unknown (clients then assume `entry`, the model of every new deployment).
   */
  feeModel?: FeeModel | null;
  /** Address of the server key that sends settlements (pays gas in HYPE): the arena's server authority. */
  serverKey: string | null;
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
  /** SIWE sign-in: `message` is `siweMessage(...)`, `signature` the wallet's `personal_sign` (0x hex). */
  | { t: 'auth'; address: string; message: string; signature: string }
  | { t: 'logout' }
  | {
      t: 'join';
      room: JoinTarget | string;
      name: string;
      skin: number;
      /** Optional browser fingerprint (`isFingerprint`): integrity evidence only, untrusted. */
      fp?: string;
      /**
       * Wear the profile picture of the signed-in wallet (`ProfileView.avatar`) on the coin. Ignored for
       * guests and wallets without a picture; the coin keeps `skin` as its rim colour.
       */
      pic?: boolean;
      /**
       * The country the player plays for (ISO 3166-1 alpha-2, `isCountryCode`); absent or anything
       * off the allowlist: none. Shown as a flag by the name (bots wear one too).
       */
      country?: string;
      /**
       * Wear the country's flag as the coin skin (needs a country; a worn picture wins). Absent: the
       * signed-in wallet's saved choice (`ProfileView.flagSkin`), else off.
       */
      flag?: boolean;
    }
  | { t: 'spectate'; room?: string; next?: boolean }
  | { t: 'leave' }
  | { t: 'viewport'; w: number; h: number }
  | { t: 'chat'; text: string }
  | { t: 'emote'; id: number }
  | { t: 'cashout' }
  /** Use one charge of a bought power-up (signed-in players; the server checks charges, cooldown and the arena's round cap). */
  | { t: 'boost'; kind: BoostKind }
  /**
   * Full room standings on (`on: true`) or off: while on, the server sends `standings` with the
   * leaderboard (once a second) and once right away. Additive: older servers ignore it.
   */
  | { t: 'standings'; on: boolean }
  | { t: 'ping'; ts: number };

/** Most rows a `standings` message carries (rooms are far smaller; a guard, not a page size). */
export const STANDINGS_MAX_ROWS = 200;

/** A row of the full room standings (`standings`): every coin in play, best first. */
export interface StandingRow {
  pid: number;
  name: string;
  skin: number;
  /** Total mass (floored). */
  score: number;
  /** Arena rooms: in-game value, raw token units. */
  value?: number;
  isBot?: boolean;
  verified?: boolean;
  /** Holds an Elymum emblem (laurel). */
  holder?: boolean;
  /** Profile picture id (`avatarPath(id)`); humans only. */
  avatar?: string;
  /** The country the player plays for (ISO 3166-1 alpha-2), absent for none. */
  country?: string;
  /** Arena rooms: the player's connection dropped; the coin stays in play until the bell. */
  away?: boolean;
}

export interface LbEntry {
  pid: number;
  name: string;
  skin: number;
  score: number;
  /** Arena rooms: in-game value, raw token units. */
  value?: number;
  /** @deprecated same as `isBot` (kept for older clients). */
  bot?: boolean;
  /** The row is a server bot: show the BOT tag. */
  isBot?: boolean;
  verified?: boolean;
  /** The country the player plays for (ISO 3166-1 alpha-2), absent for none. */
  country?: string;
}

/**
 * Why a player left the room without dying (`feed` kind `left`). Bots: `make_room` (a human took
 * the seat), `retired` (it played a while and went home), `settings` (the admin lowered the cap or
 * turned bots off).
 */
export type LeftReason = 'make_room' | 'retired' | 'settings';

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
  /** `address` is the signed-in wallet, EIP-55 checksummed. */
  | { t: 'authed'; address: string; token: string; profile: ProfileSummary | null }
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
      /** Arena rooms: the ticket's session key `<arenaId>:<player lowercase>:<sessionId>` (matches `settled.session`). */
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
  /**
   * Every coin in play, ranked (the full standings sheet), while the client asked for them with
   * `standings` `on: true`. `watching`: connections in the room that have no coin in play
   * (spectators, players between games). Additive: older clients never ask for it.
   */
  | { t: 'standings'; rows: StandingRow[]; players: number; watching: number }
  | {
      t: 'kf';
      killer: string;
      killerSkin: number;
      victim: string;
      victimSkin: number;
      cause: 'eat' | 'virus';
      /** The killer is a server bot (BOT tag). */
      killerIsBot?: boolean;
      /** The victim is a server bot (BOT tag). */
      victimIsBot?: boolean;
    }
  // A player left the room without dying: render "<name> went home" in the kill feed and let the
  // cell (`pid`) fade out with a short "going home" animation (its removal follows in the snapshot).
  | { t: 'feed'; kind: 'left'; pid: number; name: string; skin: number; isBot: boolean; reason: LeftReason }
  | { t: 'chat'; pid: number; from: string; skin: number; text: string; system?: boolean }
  | { t: 'emote'; pid: number; id: number }
  | { t: 'death'; stats: DeathStats; killer: string | null; killerSkin: number | null; killerIsBot?: boolean }
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
  // Amounts are raw token units. `feeOnEntry` (arena v2): `fee` was the ticket's cut of its entry fee, taken at
  // the entry, and the whole payout reaches the wallet (`net` = payout). Otherwise (legacy v1) `fee` is taken
  // from the profit and `net` (= payout - fee) reaches the wallet. `kind: 'refund'`: an unplayed ticket's full
  // entry fee came back (no fee).
  // `session` is the settled ticket's session key `<arenaId>:<player lowercase>:<sessionId>` (= `joined.session`)
  // and `arenaId` its arena; clients match a receipt by `session`. `txHash` is the settlement transaction (0x hex).
  | {
      t: 'settled';
      kind: 'payout' | 'death' | 'refund';
      session?: string;
      arenaId?: number;
      txHash: string;
      payout: number;
      fee?: number;
      net?: number;
      /** The fee was taken from the entry fee (arena v2), not from this payout: `net` = `payout`. */
      feeOnEntry?: boolean;
      /**
       * The token transfer to the player failed, so the session was finalized with `owed`.
       * The result is final but `net` waits in the arena vault: the player collects it with `refund`
       * ("Collect payout").
       */
      collect?: boolean;
    }
  | { t: 'event'; kind: 'coinrain'; state: 'start' | 'end'; ms?: number }
  | { t: 'event'; kind: 'airdrop'; state: 'start'; x: number; y: number; powerUp: PowerUpType }
  | { t: 'powerup'; type: PowerUpType; ms: number }
  // Bought power-ups: the player's charges, cooldowns and arena allowance (on join, after a use or a purchase).
  | { t: 'boosts'; state: BoostState }
  // The answer to `boost`: used (`ms`: how long the effect lasts, 0 for the instant shockwave) or refused.
  | { t: 'boost'; kind: BoostKind; ok: true; ms: number }
  | { t: 'boost'; kind: BoostKind; ok: false; reason: BoostRefusal }
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
  /** The game token is not set on the arena contract yet: arenas open soon (`ChainStatus.tokenReady` false); practice works. */
  | 'token_not_set'
  | 'server_full'
  | 'version_mismatch'
  /** Arena joins are closed for the rest of the round; `opensAt` says when the next one opens. */
  | 'round_closed'
  /** Paid arenas have no cash-out: everyone alive is paid at the round end. */
  | 'no_cashout'
  /** The ticket of a returning (AFK) player was settled at the bell while they were away: the till was paid. */
  | 'round_ended'
  /** The game is not open to this wallet (`SiteSettings.gameAccess`: admins only, or NFT holders and admins). */
  | 'game_closed'
  /** The admin banned this wallet from arenas (integrity review). Practice still works. */
  | 'banned'
  /**
   * The server could not read the chain right now (the RPC is rate-limiting): the ticket is safe and
   * untouched; the server retries a join on its own, then the player tries again. Never "no ticket".
   */
  | 'chain_busy'
  /**
   * The custom room the player was in closed (its time ran out, or its creator or an admin closed it):
   * back to the lobby. Also the answer to joining a custom room that just closed.
   */
  | 'room_closed';

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
