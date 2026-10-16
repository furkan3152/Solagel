/**
 * Program constants mirrored from `programs/slana-ref/src/constants.rs`
 * (a unit test checks them against the IDL so they cannot drift silently).
 * The program id itself lives in `program.ts` (`PROGRAM_ID`, read from the IDL).
 */

/** Maximum player name length in bytes (UTF-8). */
export const MAX_NAME_BYTES = 16;
/** Basis-point denominator. */
export const BPS = 10_000;
/** Upper bound for `Config.feeBps` (10 %). */
export const MAX_FEE_BPS = 1_000;
/** Upper bound for `Config.settleFeeLamports` (the per-session settle deposit). */
export const MAX_SETTLE_FEE_LAMPORTS = 1_000_000;
/** Bounds of `Arena.maxSessions`. */
export const MIN_ARENA_SESSIONS = 2;
export const MAX_ARENA_SESSIONS = 2_000;
/** A session can be refunded by its player this many seconds after `openedAt` (24 h). */
export const SESSION_REFUND_TIMEOUT_SECS = 86_400;
export const MAX_XP_PER_GAME = 2_000;
export const MAX_SCORE_PER_GAME = 1_000_000;
/** Basic skins (ids `0..BASIC_SKINS`); every player may use all of them. */
export const BASIC_SKINS = 8;
/** `level = 1 + isqrt(xp / XP_LEVEL_DIVISOR)`. */
export const XP_LEVEL_DIVISOR = 50;
/**
 * Defaults of `pnpm admin init` (not program constants: the admin sets them in `Config`
 * and may change them with `update-config`). Fee on stake profit 5 %, paid in full to the
 * fee wallet; settle deposit 20 000 lamports per session.
 */
export const DEFAULT_FEE_BPS = 500;
export const DEFAULT_SETTLE_FEE_LAMPORTS = 20_000;

/**
 * Account sizes in bytes (8-byte Anchor discriminator + `INIT_SPACE`), for rent estimates.
 * A unit test recomputes them from the IDL types, so a layout change cannot leave them stale.
 */
export const ACCOUNT_BYTES = {
  /** admin, server, fee wallet, mint, token program 5 × 32 + decimals 1 + fee 2 + settle fee 8 + paused 1 + bump 1 + 5 totals × 8 */
  config: 8 + 213,
  /** owner 32 + name 16 + len 1 + skin 1 + xp 8 + games 4 + kills 4 + best 4 + total 8 + stakeGames 4 + staked 8 + won 8 + created 8 + last 8 + bump 1 */
  playerProfile: 8 + 115,
  /** id 2 + entry 8 + max 2 + open 2 + enabled 1 + vault 32 + vaultBump 1 + deposited 8 + paidOut 8 + bump 1 */
  arena: 8 + 65,
  /** id 8 + player 32 + arena 32 + arenaId 2 + entry 8 + opened 8 + settleFee 8 + feeBps 2 + bump 1 + finalized 1 + owed 8 */
  session: 8 + 110,
} as const;
