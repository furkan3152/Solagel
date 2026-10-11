use crate::account::AccountState;
use crate::prelude::*;

use crate::constants::{LEADERBOARD_LEN, NAME_BYTES};

/// Global configuration. PDA `["config"]`.
#[derive(BorshSerialize, BorshDeserialize, Default, Debug)]
pub struct Config {
    /// May change the configuration, create arenas and manage seasons.
    #[borsh(deserialize_with = "crate::codec::pubkey")]
    pub admin: Pubkey,
    /// Game server key that signs activation, settlement and practice results.
    #[borsh(deserialize_with = "crate::codec::pubkey")]
    pub server_authority: Pubkey,
    /// Receives the treasury part of fees and swept arena leftovers.
    #[borsh(deserialize_with = "crate::codec::pubkey")]
    pub treasury: Pubkey,
    /// Fee charged on stake profit, in basis points (≤ `MAX_FEE_BPS`).
    pub fee_bps: u16,
    /// Part of the fee that goes to the current season prize pool, in basis points.
    pub season_share_bps: u16,
    /// Reserved legacy skin price. Skin purchases are unavailable during the beta.
    pub skin_price: u64,
    /// Id of the season that is currently running.
    pub current_season: u32,
    /// Blocks new arena joins and activation (settlements and refunds keep working).
    #[borsh(deserialize_with = "crate::codec::boolean")]
    pub paused: bool,
    pub bump: u8,
    pub total_players: u64,
    pub total_games: u64,
    pub total_sessions: u64,
    pub total_staked: u64,
    pub total_paid_out: u64,
}

/// On-chain player identity and statistics. PDA `["profile", owner]`.
#[derive(BorshSerialize, BorshDeserialize, Default, Debug)]
pub struct PlayerProfile {
    #[borsh(deserialize_with = "crate::codec::pubkey")]
    pub owner: Pubkey,
    /// UTF-8 name bytes, zero padded; only `name[..name_len]` is meaningful.
    pub name: [u8; NAME_BYTES],
    pub name_len: u8,
    /// Equipped skin id.
    pub skin: u8,
    /// Owned premium skins: bit `i` set ⇔ skin `PREMIUM_SKIN_START + i` owned.
    pub premium_skins: u32,
    pub xp: u64,
    pub games_played: u32,
    pub kills: u32,
    pub best_score: u32,
    pub total_score: u64,
    /// Season that `season_points` belongs to.
    pub season: u32,
    /// Captured SOL profit in whole 1,000-lamport units; gameplay mass grants no points.
    pub season_points: u64,
    pub stake_games: u32,
    pub total_staked: u64,
    pub total_won: u64,
    pub created_at: i64,
    pub last_played: i64,
    pub bump: u8,
}

/// A stake arena tier. PDA `["arena", id.to_le_bytes()]`.
///
/// The arena account itself is the vault: every lamport above its rent-exempt
/// minimum belongs to the pot.
#[derive(BorshSerialize, BorshDeserialize, Default, Debug)]
pub struct Arena {
    pub id: u16,
    pub buy_in: u64,
    pub max_players: u16,
    #[borsh(deserialize_with = "crate::codec::boolean")]
    pub enabled: bool,
    pub open_sessions: u16,
    pub total_deposited: u64,
    pub total_paid_out: u64,
    pub bump: u8,
}

/// An open stake session (one per player per arena). PDA `["session", arena, player]`.
#[derive(BorshSerialize, BorshDeserialize, Default, Debug)]
pub struct Session {
    #[borsh(deserialize_with = "crate::codec::pubkey")]
    pub player: Pubkey,
    #[borsh(deserialize_with = "crate::codec::pubkey")]
    pub arena: Pubkey,
    pub arena_id: u16,
    pub buy_in: u64,
    pub opened_at: i64,
    pub id: u64,
    /// Set by the server before admission. An activated buy-in is at risk in live play,
    /// so it can only be returned through authoritative settlement, never a timeout refund.
    #[borsh(deserialize_with = "crate::codec::boolean")]
    pub activated: bool,
    pub bump: u8,
}

/// One row of a season leaderboard.
#[derive(BorshSerialize, BorshDeserialize, Clone, Copy, Default, PartialEq, Eq, Debug)]
pub struct LeaderEntry {
    #[borsh(deserialize_with = "crate::codec::pubkey")]
    pub player: Pubkey,
    /// Captured SOL profit points, independent of score and cosmetic XP.
    pub points: u64,
    /// Best single-game score of this player during the season.
    pub best_score: u32,
    pub name: [u8; NAME_BYTES],
    pub name_len: u8,
    pub skin: u8,
}

/// A season with its top-20 leaderboard. PDA `["season", id.to_le_bytes()]`.
///
/// Every lamport above the rent-exempt minimum is prize money.
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct Season {
    pub id: u32,
    pub started_at: i64,
    pub ended_at: i64,
    #[borsh(deserialize_with = "crate::codec::boolean")]
    pub finalized: bool,
    /// Prize pool frozen by `end_season`.
    pub prize_pool: u64,
    /// Bit `rank` set ⇔ the prize of that rank was claimed.
    pub claimed_mask: u16,
    /// Number of used leaderboard entries.
    pub count: u8,
    pub bump: u8,
    /// Sorted by `points`, descending; only `entries[..count]` are meaningful.
    pub entries: [LeaderEntry; LEADERBOARD_LEN],
}

impl Default for Season {
    fn default() -> Self {
        Self {
            id: 0,
            started_at: 0,
            ended_at: 0,
            finalized: false,
            prize_pool: 0,
            claimed_mask: 0,
            count: 0,
            bump: 0,
            // Construct the zero row once, then repeat its Copy value. The
            // derived array default emits a separate constructor for each row.
            entries: [LeaderEntry::default(); LEADERBOARD_LEN],
        }
    }
}

impl Arena {
    pub const INIT_SPACE: usize = 32;
    pub const SPACE: usize = 8 + Self::INIT_SPACE;
}
impl AccountState for Arena {
    const DISCRIMINATOR: [u8; 8] = [243, 215, 44, 44, 231, 211, 232, 168];
    const SPACE: usize = Arena::SPACE;
}

impl Config {
    pub const INIT_SPACE: usize = 154;
    pub const SPACE: usize = 8 + Self::INIT_SPACE;
}
impl AccountState for Config {
    const DISCRIMINATOR: [u8; 8] = [155, 12, 170, 224, 30, 250, 204, 130];
    const SPACE: usize = Config::SPACE;
}

impl PlayerProfile {
    pub const INIT_SPACE: usize = 131;
    pub const SPACE: usize = 8 + Self::INIT_SPACE;
}
impl AccountState for PlayerProfile {
    const DISCRIMINATOR: [u8; 8] = [82, 226, 99, 87, 164, 130, 181, 80];
    const SPACE: usize = PlayerProfile::SPACE;
}

impl Season {
    pub const INIT_SPACE: usize = 1273;
    pub const SPACE: usize = 8 + Self::INIT_SPACE;
}
impl AccountState for Season {
    const DISCRIMINATOR: [u8; 8] = [76, 67, 93, 156, 180, 157, 248, 47];
    const SPACE: usize = Season::SPACE;
}

impl Session {
    pub const INIT_SPACE: usize = 92;
    pub const SPACE: usize = 8 + Self::INIT_SPACE;
}
impl AccountState for Session {
    const DISCRIMINATOR: [u8; 8] = [243, 81, 72, 115, 214, 188, 72, 144];
    const SPACE: usize = Session::SPACE;
}
