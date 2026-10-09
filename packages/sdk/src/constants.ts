/**
 * Program constants mirrored from `programs/solagel/src/constants.rs`
 * (a unit test checks them against the IDL so they cannot drift silently).
 */

/** Maximum player name length in bytes (UTF-8). */
export const MAX_NAME_BYTES = 16;
/** Entries kept on each season leaderboard. */
export const LEADERBOARD_SIZE = 20;
/** Leaderboard ranks that receive a season prize. */
export const PRIZE_RANKS = 10;
/** Prize share of each rank in basis points (sums to 10 000). */
export const PRIZE_SHARES_BPS: readonly number[] = [3000, 2000, 1400, 1000, 800, 600, 450, 300, 250, 200];
/** Basis-point denominator. */
export const BPS = 10_000;
/** Upper bound for `Config.feeBps` (10 %). */
export const MAX_FEE_BPS = 1_000;
/** Minimum arena buy-in (0.001 SOL). */
export const MIN_BUY_IN_LAMPORTS = 1_000_000;
export const MIN_ARENA_PLAYERS = 2;
export const MAX_ARENA_PLAYERS = 100;
/** A session can be refunded by its player this many seconds after `openedAt` (24 h). */
export const SESSION_REFUND_TIMEOUT_SECS = 86_400;
/** Season prizes can be claimed for this many seconds after `endedAt` (30 days). */
export const CLAIM_WINDOW_SECS = 2_592_000;
export const MAX_XP_PER_GAME = 2_000;
export const MAX_SCORE_PER_GAME = 1_000_000;
/** Season created by `initialize`. */
export const FIRST_SEASON = 1;
/** Number of skins and tiers (ids 0..7 free, 8..15 level-gated, 16..23 premium). */
export const SKIN_COUNT = 24;
export const FREE_SKINS = 8;
export const PREMIUM_SKIN_START = 16;
/** `level = 1 + isqrt(xp / XP_LEVEL_DIVISOR)`. */
export const XP_LEVEL_DIVISOR = 50;
