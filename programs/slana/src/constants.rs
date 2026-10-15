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

/// Treasury token vault (authority = the config PDA): `["treasury_vault"]`.
#[constant]
pub const TREASURY_VAULT_SEED: &[u8] = b"treasury_vault";

/// Global season prize token vault (authority = the config PDA): `["season_vault"]`.
#[constant]
pub const SEASON_VAULT_SEED: &[u8] = b"season_vault";

/// Data-less signer PDA that is the update authority of the Pass collection: `["pass_authority"]`.
#[constant]
pub const PASS_AUTHORITY_SEED: &[u8] = b"pass_authority";

/// Lock of a Pass asset while it backs an open session: `["pass_lock", asset]`.
#[constant]
pub const PASS_LOCK_SEED: &[u8] = b"pass_lock";

/// Per-wallet Pass mint counter: `["pass_minted", wallet]`.
#[constant]
pub const PASS_MINTED_SEED: &[u8] = b"pass_minted";

/// `Session` PDA: `["session", arena, player]`.
#[constant]
pub const SESSION_SEED: &[u8] = b"session";

/// `Season` PDA: `["season", id.to_le_bytes() (u32)]`.
#[constant]
pub const SEASON_SEED: &[u8] = b"season";

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

/// Maximum player name length in bytes (UTF-8).
#[constant]
pub const MAX_NAME_LEN: u8 = 16;

/// Number of entries kept on each season leaderboard.
#[constant]
pub const LEADERBOARD_SIZE: u8 = 20;

/// Number of leaderboard ranks that receive a season prize.
#[constant]
pub const PRIZE_RANKS: u8 = 10;

/// `MAX_NAME_LEN` as an array length.
pub const NAME_BYTES: usize = MAX_NAME_LEN as usize;

/// `LEADERBOARD_SIZE` as an array length.
pub const LEADERBOARD_LEN: usize = LEADERBOARD_SIZE as usize;

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/// Basis-point denominator (100 %).
#[constant]
pub const BPS: u16 = 10_000;

/// Upper bound for `Config::fee_bps` (10 %); `pass_fee_bps` must not exceed `fee_bps`.
#[constant]
pub const MAX_FEE_BPS: u16 = 1_000;

/// Upper bound for `Config::settle_fee_lamports` (the per-session settle deposit).
#[constant]
pub const MAX_SETTLE_FEE_LAMPORTS: u64 = 1_000_000;

/// Prize share of each season rank in basis points (sums to 10 000).
#[constant]
pub const PRIZE_SHARES_BPS: [u16; 10] = [3000, 2000, 1400, 1000, 800, 600, 450, 300, 250, 200];

/// Minimum value of `Arena::max_sessions`.
#[constant]
pub const MIN_ARENA_SESSIONS: u16 = 2;

/// Maximum value of `Arena::max_sessions`.
#[constant]
pub const MAX_ARENA_SESSIONS: u16 = 2_000;

// ---------------------------------------------------------------------------
// Slana Pass
// ---------------------------------------------------------------------------

/// Metaplex Core program (owner of Pass assets and of the Pass collection).
pub const MPL_CORE_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

/// The SlotHashes sysvar. Its most recent entry is the Pass trait entropy captured when the
/// mint ends (see `logic::parse_latest_slot_hash`).
pub const SLOT_HASHES_ID: Pubkey = pubkey!("SysvarS1otHashes111111111111111111111111111");

/// Maximum length of `Config::pass_base_uri` in bytes.
#[constant]
pub const MAX_BASE_URI_LEN: u8 = 96;

/// Upper bound for `Config::pass_supply`.
#[constant]
pub const MAX_PASS_SUPPLY: u32 = 10_000;

/// Upper bound for `Config::pass_per_wallet`.
#[constant]
pub const MAX_PASS_PER_WALLET: u8 = 10;

/// `Config::pass_supply` set by `initialize`.
#[constant]
pub const DEFAULT_PASS_SUPPLY: u32 = 3_333;

/// `Config::pass_per_wallet` set by `initialize`.
#[constant]
pub const DEFAULT_PASS_PER_WALLET: u8 = 1;

/// `MAX_BASE_URI_LEN` as an array length.
pub const BASE_URI_BYTES: usize = MAX_BASE_URI_LEN as usize;

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/// A session that was never settled can be refunded by its player after this many seconds (24 h).
#[constant]
pub const SESSION_REFUND_TIMEOUT_SECS: i64 = 86_400;

/// Season prizes can be claimed for this many seconds after the season ended (30 days).
#[constant]
pub const CLAIM_WINDOW_SECS: i64 = 2_592_000;

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

/// XP granted by a single game is clamped to this value.
#[constant]
pub const MAX_XP_PER_GAME: u32 = 2_000;

/// Score of a single game is clamped to this value.
#[constant]
pub const MAX_SCORE_PER_GAME: u32 = 1_000_000;

/// Id of the first season (created by `initialize`).
#[constant]
pub const FIRST_SEASON: u32 = 1;

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
const _: () = assert!(PRIZE_SHARES_BPS.len() == PRIZE_RANKS as usize);
const _: () = assert!(PRIZE_RANKS <= LEADERBOARD_SIZE);
const _: () = assert!(PRIZE_RANKS as u32 <= u16::BITS); // claimed_mask is a u16
const _: () = assert!(MAX_FEE_BPS <= BPS);
const _: () = assert!(MIN_ARENA_SESSIONS <= MAX_ARENA_SESSIONS);
const _: () = assert!(DEFAULT_PASS_SUPPLY <= MAX_PASS_SUPPLY);
const _: () = assert!(DEFAULT_PASS_PER_WALLET <= MAX_PASS_PER_WALLET);
const _: () = {
    let mut sum = 0u32;
    let mut i = 0;
    while i < PRIZE_SHARES_BPS.len() {
        sum += PRIZE_SHARES_BPS[i] as u32;
        i += 1;
    }
    assert!(sum == BPS as u32);
};
