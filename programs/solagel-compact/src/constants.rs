//! ABI-compatible constants; values mirror the Anchor reference program.

// ---------------------------------------------------------------------------
// PDA seeds
// ---------------------------------------------------------------------------

/// `Config` PDA: `["config"]`.
pub const CONFIG_SEED: &[u8] = b"config";

/// `PlayerProfile` PDA: `["profile", owner]`.
pub const PROFILE_SEED: &[u8] = b"profile";

/// `Arena` PDA: `["arena", id.to_le_bytes() (u16)]`.
pub const ARENA_SEED: &[u8] = b"arena";

/// `Session` PDA: `["session", arena, player]`.
pub const SESSION_SEED: &[u8] = b"session";

/// `Season` PDA: `["season", id.to_le_bytes() (u32)]`.
pub const SEASON_SEED: &[u8] = b"season";

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

/// Maximum player name length in bytes (UTF-8).
pub const MAX_NAME_LEN: u8 = 16;

/// Number of entries kept on each season leaderboard.
pub const LEADERBOARD_SIZE: u8 = 20;

/// Number of leaderboard ranks that receive a season prize.
pub const PRIZE_RANKS: u8 = 10;

/// `MAX_NAME_LEN` as an array length.
pub const NAME_BYTES: usize = MAX_NAME_LEN as usize;

/// `LEADERBOARD_SIZE` as an array length.
pub const LEADERBOARD_LEN: usize = LEADERBOARD_SIZE as usize;

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/// Basis-point denominator (100 %).
pub const BPS: u16 = 10_000;

/// Upper bound for `Config::fee_bps` (10 %).
pub const MAX_FEE_BPS: u16 = 1_000;

/// Prize share of each season rank in basis points (sums to 10 000).
pub const PRIZE_SHARES_BPS: [u16; 10] = [3000, 2000, 1400, 1000, 800, 600, 450, 300, 250, 200];

/// Minimum arena buy-in (0.001 SOL).
pub const MIN_BUY_IN: u64 = 1_000_000;

/// One season point per 1,000 lamports captured above the original buy-in.
/// Food, practice and zero-value bots cannot generate prize-bearing points.
pub const LAMPORTS_PER_SEASON_POINT: u64 = 1_000;

/// Minimum value of `Arena::max_players`.
pub const MIN_ARENA_PLAYERS: u16 = 2;

/// Maximum value of `Arena::max_players`.
pub const MAX_ARENA_PLAYERS: u16 = 100;

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/// An unactivated ticket can be refunded by its player after this many seconds (24 h).
pub const SESSION_REFUND_TIMEOUT_SECS: i64 = 86_400;

/// Season prizes can be claimed for this many seconds after the season ended (30 days).
pub const CLAIM_WINDOW_SECS: i64 = 2_592_000;

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

/// XP granted by a single game is clamped to this value.
pub const MAX_XP_PER_GAME: u32 = 2_000;

/// Score of a single game is clamped to this value.
pub const MAX_SCORE_PER_GAME: u32 = 1_000_000;

/// Id of the first season (created by `initialize`).
pub const FIRST_SEASON: u32 = 1;

// ---------------------------------------------------------------------------
// Skins & levels
// ---------------------------------------------------------------------------

/// Total number of skins (ids `0..SKIN_COUNT`).
pub const SKIN_COUNT: u8 = 24;

/// Skins `0..FREE_SKINS` are free.
pub const FREE_SKINS: u8 = 8;

/// Skins `LEVEL_SKIN_START..PREMIUM_SKIN_START` are unlocked by level.
pub const LEVEL_SKIN_START: u8 = 8;

/// Reserved NFT skin ids. The legacy SOL purchase entry point is disabled during beta.
pub const PREMIUM_SKIN_START: u8 = 16;

/// Level required by level-gated skins (skin 8 needs level 2 … skin 15 needs level 20).
pub const LEVEL_SKIN_REQUIREMENTS: [u32; 8] = [2, 3, 5, 7, 10, 13, 16, 20];

/// `level = 1 + isqrt(xp / XP_LEVEL_DIVISOR)`.
pub const XP_LEVEL_DIVISOR: u64 = 50;

// Compile-time consistency checks.
const _: () = assert!(PRIZE_SHARES_BPS.len() == PRIZE_RANKS as usize);
const _: () = assert!(PRIZE_RANKS <= LEADERBOARD_SIZE);
const _: () = assert!(PRIZE_RANKS as u32 <= u16::BITS); // claimed_mask is a u16
const _: () =
    assert!(LEVEL_SKIN_REQUIREMENTS.len() == (PREMIUM_SKIN_START - LEVEL_SKIN_START) as usize);
const _: () = assert!(FREE_SKINS == LEVEL_SKIN_START);
const _: () = assert!((SKIN_COUNT - PREMIUM_SKIN_START) as u32 <= u32::BITS); // premium_skins is a u32
const _: () = {
    let mut sum = 0u32;
    let mut i = 0;
    while i < PRIZE_SHARES_BPS.len() {
        sum += PRIZE_SHARES_BPS[i] as u32;
        i += 1;
    }
    assert!(sum == BPS as u32);
};
