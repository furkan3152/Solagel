/**
 * Program constants mirrored from `programs/slana/src/constants.rs`
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
/** Upper bound for `Config.feeBps` (10 %); `passFeeBps` must not exceed `feeBps`. */
export const MAX_FEE_BPS = 1_000;
/** Upper bound for `Config.settleFeeLamports` (the per-session settle deposit). */
export const MAX_SETTLE_FEE_LAMPORTS = 1_000_000;
/** Bounds of `Arena.maxSessions`. */
export const MIN_ARENA_SESSIONS = 2;
export const MAX_ARENA_SESSIONS = 2_000;
/** Maximum length of `Config.passBaseUri` in bytes (it must end with `/`). */
export const MAX_BASE_URI_LEN = 96;
/** Upper bound for `Config.passSupply`. */
export const MAX_PASS_SUPPLY = 10_000;
/** Upper bound for `Config.passPerWallet`. */
export const MAX_PASS_PER_WALLET = 10;
/** `Config.passSupply` / `passPerWallet` set by `initialize`. */
export const DEFAULT_PASS_SUPPLY = 3_333;
export const DEFAULT_PASS_PER_WALLET = 1;
/** A session can be refunded by its player this many seconds after `openedAt` (24 h). */
export const SESSION_REFUND_TIMEOUT_SECS = 86_400;
/** Season prizes can be claimed for this many seconds after `endedAt` (30 days). */
export const CLAIM_WINDOW_SECS = 2_592_000;
export const MAX_XP_PER_GAME = 2_000;
export const MAX_SCORE_PER_GAME = 1_000_000;
/** Slots between the end of the Pass mint and its entropy target slot (~1 minute). */
export const ENTROPY_DELAY_SLOTS = 150;
/** Entries kept by the SlotHashes sysvar: a target older than this many slots can no longer be captured. */
export const SLOT_HASHES_WINDOW = 512;
/** Season created by `initialize`. */
export const FIRST_SEASON = 1;
/** Basic skins (ids `0..BASIC_SKINS`); every player may use all of them. */
export const BASIC_SKINS = 8;
/** `level = 1 + isqrt(xp / XP_LEVEL_DIVISOR)`. */
export const XP_LEVEL_DIVISOR = 50;
/**
 * Defaults of `pnpm admin init` (not program constants: the admin sets them in `Config`
 * and may change them with `update-config`). Fee on stake profit 5 % (Pass 2 %), fee split
 * treasury / season / burn 50 / 30 / 20 %, settle deposit 20 000 lamports per session.
 */
export const DEFAULT_FEE_BPS = 500;
export const DEFAULT_PASS_FEE_BPS = 200;
export const DEFAULT_FEE_SPLIT_BPS: readonly [number, number, number] = [5_000, 3_000, 2_000];
export const DEFAULT_SETTLE_FEE_LAMPORTS = 20_000;
/** Name of Pass number `n` (`mint_pass` names assets `Slana Pass #<n>`). */
export const PASS_NAME_PREFIX = 'Slana Pass #';

/**
 * Account sizes in bytes (8-byte Anchor discriminator + `INIT_SPACE`), for rent estimates.
 * A unit test recomputes them from the IDL types, so a layout change cannot leave them stale.
 */
export const ACCOUNT_BYTES = {
  /** owner 32 + name 16 + len 1 + skin 1 + xp 8 + games 4 + kills 4 + best 4 + total 8 + season 4 + points 8 + stakeGames 4 + staked 8 + won 8 + created 8 + last 8 + bump 1 */
  playerProfile: 8 + 127,
  /** id 8 + player 32 + arena 32 + arenaId 2 + entry 8 + opened 8 + hasPass 1 + passAsset 32 + settleFee 8 + feeBps 2 + bump 1 + finalized 1 + owed 8 */
  session: 8 + 143,
  /** session 32 + player 32 + bump 1 */
  passLock: 8 + 65,
  /** count 1 + bump 1 */
  mintCounter: 8 + 2,
} as const;
