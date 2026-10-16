use anchor_lang::prelude::*;

// ---------------------------------------------------------------------------
// PDA seeds
// ---------------------------------------------------------------------------

/// `Config` PDA: `["config"]`.
#[constant]
pub const CONFIG_SEED: &[u8] = b"config";

/// `PlayerProfile` PDA: `["profile", owner]`.
#[constant]
pub const PROFILE_SEED: &[u8] = b"profile";

/// `Arena` PDA: `["arena", id.to_le_bytes() (u16)]`.
#[constant]
pub const ARENA_SEED: &[u8] = b"arena";

/// Token vault of an arena (authority = the arena PDA): `["vault", arena]`.
#[constant]
pub const VAULT_SEED: &[u8] = b"vault";

/// `Session` PDA: `["session", arena, player]`.
#[constant]
pub const SESSION_SEED: &[u8] = b"session";

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

/// Maximum player name length in bytes (UTF-8).
#[constant]
pub const MAX_NAME_LEN: u8 = 16;

/// `MAX_NAME_LEN` as an array length.
pub const NAME_BYTES: usize = MAX_NAME_LEN as usize;

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/// Basis-point denominator (100 %).
#[constant]
pub const BPS: u16 = 10_000;

/// Upper bound for `Config::fee_bps` (10 %).
#[constant]
pub const MAX_FEE_BPS: u16 = 1_000;

/// Upper bound for `Config::settle_fee_lamports` (the per-session settle deposit).
#[constant]
pub const MAX_SETTLE_FEE_LAMPORTS: u64 = 1_000_000;

/// Minimum value of `Arena::max_sessions`.
#[constant]
pub const MIN_ARENA_SESSIONS: u16 = 2;

/// Maximum value of `Arena::max_sessions`.
#[constant]
pub const MAX_ARENA_SESSIONS: u16 = 2_000;

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/// A session that was never settled can be refunded by its player after this many seconds (24 h).
#[constant]
pub const SESSION_REFUND_TIMEOUT_SECS: i64 = 86_400;

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

/// XP granted by a single game is clamped to this value.
#[constant]
pub const MAX_XP_PER_GAME: u32 = 2_000;

/// Score of a single game is clamped to this value.
#[constant]
pub const MAX_SCORE_PER_GAME: u32 = 1_000_000;

// ---------------------------------------------------------------------------
// Skins & levels
// ---------------------------------------------------------------------------

/// Number of basic skins (ids `0..BASIC_SKINS`); every player may use all of them.
#[constant]
pub const BASIC_SKINS: u8 = 8;

/// `level = 1 + isqrt(xp / XP_LEVEL_DIVISOR)`.
#[constant]
pub const XP_LEVEL_DIVISOR: u64 = 50;

// Compile-time consistency checks.
const _: () = assert!(MAX_FEE_BPS <= BPS);
const _: () = assert!(MIN_ARENA_SESSIONS <= MAX_ARENA_SESSIONS);
