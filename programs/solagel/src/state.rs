use anchor_lang::prelude::*;

use crate::constants::{LEADERBOARD_LEN, NAME_BYTES};

/// Global configuration. PDA `["config"]`.
#[account]
#[derive(InitSpace, Debug)]
pub struct Config {
    /// May change the configuration, create arenas and manage seasons.
    pub admin: Pubkey,
    /// Game server key that signs `settle_session` and `record_game`.
    pub server_authority: Pubkey,
    /// Receives skin purchases, the treasury part of fees and swept arena leftovers.
    pub treasury: Pubkey,
    /// Fee charged on stake profit, in basis points (≤ `MAX_FEE_BPS`).
    pub fee_bps: u16,
    /// Part of the fee that goes to the current season prize pool, in basis points.
    pub season_share_bps: u16,
    /// Price of a premium skin in lamports.
    pub skin_price: u64,
    /// Id of the season that is currently running.
    pub current_season: u32,
    /// Blocks new arena joins (settlements and refunds keep working).
    pub paused: bool,
    pub bump: u8,
    pub total_players: u64,
    pub total_games: u64,
    pub total_sessions: u64,
    pub total_staked: u64,
    pub total_paid_out: u64,
}

/// On-chain player identity and statistics. PDA `["profile", owner]`.
#[account]
#[derive(InitSpace, Default, Debug)]
pub struct PlayerProfile {
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
#[account]
#[derive(InitSpace, Debug)]
pub struct Arena {
    pub id: u16,
    pub buy_in: u64,
    pub max_players: u16,
    pub enabled: bool,
    pub open_sessions: u16,
    pub total_deposited: u64,
    pub total_paid_out: u64,
    pub bump: u8,
}

/// An open stake session (one per player per arena). PDA `["session", arena, player]`.
#[account]
#[derive(InitSpace, Debug)]
pub struct Session {
    pub player: Pubkey,
    pub arena: Pubkey,
    pub arena_id: u16,
    pub buy_in: u64,
    pub opened_at: i64,
    pub id: u64,
    pub bump: u8,
}

/// One row of a season leaderboard.
#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, PartialEq, Eq, Debug,
)]
pub struct LeaderEntry {
    pub player: Pubkey,
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
#[account]
#[derive(InitSpace, Debug)]
pub struct Season {
    pub id: u32,
    pub started_at: i64,
    pub ended_at: i64,
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
