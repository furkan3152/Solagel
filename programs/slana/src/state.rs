use anchor_lang::prelude::*;

use crate::constants::{BASE_URI_BYTES, LEADERBOARD_LEN, NAME_BYTES};

/// Global configuration. PDA `["config"]`.
#[account]
#[derive(InitSpace, Debug)]
pub struct Config {
    /// May change the configuration, create arenas, manage seasons and withdraw the treasury.
    pub admin: Pubkey,
    /// Game server key that signs `settle_session`.
    pub server_authority: Pubkey,

    // ----- token (fixed at `initialize`) -----------------------------------------------
    /// The game token ($SLANA). Written once and never changed.
    pub token_mint: Pubkey,
    /// Token program owning `token_mint` (SPL Token or Token-2022).
    pub token_program: Pubkey,
    pub token_decimals: u8,

    // ----- fees ------------------------------------------------------------------------
    /// Fee charged on stake profit, in basis points (≤ `MAX_FEE_BPS`).
    pub fee_bps: u16,
    /// Fee charged on stake profit of a Pass session (≤ `fee_bps`).
    pub pass_fee_bps: u16,
    /// Shares of each fee: treasury vault, season vault, burned. They sum to `BPS`.
    pub treasury_bps: u16,
    pub season_bps: u16,
    pub burn_bps: u16,
    /// Lamports a player deposits per session to pay the server's settle transaction
    /// (≤ `MAX_SETTLE_FEE_LAMPORTS`).
    pub settle_fee_lamports: u64,

    // ----- general -----------------------------------------------------------------------
    /// Id of the season that is currently running.
    pub current_season: u32,
    /// Blocks new arena joins (settlements and refunds keep working).
    pub paused: bool,

    // ----- Slana Pass collection and mint --------------------------------------------------
    /// Metaplex Core collection of the Pass (`Pubkey::default()` = not set yet).
    pub pass_collection: Pubkey,
    /// Base URI of Pass metadata (`pass_base_uri[..pass_base_uri_len]`, zero padded).
    pub pass_base_uri: [u8; BASE_URI_BYTES],
    pub pass_base_uri_len: u8,
    /// Maximum number of Passes (≤ `MAX_PASS_SUPPLY`, ≥ `pass_minted`).
    pub pass_supply: u32,
    /// Passes minted so far.
    pub pass_minted: u32,
    /// Free mints per wallet (≤ `MAX_PASS_PER_WALLET`).
    pub pass_per_wallet: u8,
    /// Minimum game-token balance needed to mint (0 = no requirement).
    pub pass_min_tokens: u64,
    pub pass_mint_open: bool,
    pub pass_mint_start_ts: i64,
    /// The mint has been opened at least once: `pass_supply` is frozen from then on.
    pub pass_mint_opened: bool,
    /// The mint ended for good (`close_pass_mint`, or the last Pass of the supply was minted)
    /// and `pass_entropy` is captured. It never reopens.
    pub pass_mint_ended: bool,

    // ----- Pass trait reveal (commit / reveal) ---------------------------------------------
    /// `sha256(pass_seed)` committed before the first mint.
    pub pass_seed_hash: [u8; 32],
    /// The admin's revealed seed (zero until `pass_revealed`).
    pub pass_seed: [u8; 32],
    pub pass_revealed: bool,
    /// Most recent SlotHashes entry when the mint ended (zero before): a chain value nobody,
    /// the admin included, knows while Passes can still be minted.
    pub pass_entropy: [u8; 32],
    /// Slot of `pass_entropy`.
    pub pass_entropy_slot: u64,
    /// `sha256(pass_seed || pass_entropy)`, set by the reveal (zero before). The single seed
    /// every Pass trait is derived from (`passTraits(final_seed, n, supply)`).
    pub pass_final_seed: [u8; 32],

    // ----- bumps -------------------------------------------------------------------------
    pub bump: u8,
    pub treasury_vault_bump: u8,
    pub season_vault_bump: u8,

    // ----- totals ------------------------------------------------------------------------
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
    /// Equipped skin id (`< BASIC_SKINS`).
    pub skin: u8,
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
/// Entry fees are held in the arena's token vault `["vault", arena]` (authority = this PDA).
#[account]
#[derive(InitSpace, Debug)]
pub struct Arena {
    pub id: u16,
    /// Entry fee in base units of the game token.
    pub entry_fee: u64,
    /// Only Slana Pass holders may join.
    pub requires_pass: bool,
    /// Maximum number of simultaneously open sessions.
    pub max_sessions: u16,
    pub open_sessions: u16,
    pub enabled: bool,
    /// The arena's token vault.
    pub vault: Pubkey,
    pub vault_bump: u8,
    pub total_deposited: u64,
    pub total_paid_out: u64,
    pub bump: u8,
}

/// An open stake session (one per player per arena). PDA `["session", arena, player]`.
///
/// Its lamport balance is its rent plus `settle_fee`, both paid by the player at join: the
/// deposit goes to the server at settlement (it pays the settle transaction), the rent back to
/// the player. A refund returns both to the player.
#[account]
#[derive(InitSpace, Debug)]
pub struct Session {
    /// `Config::total_sessions` at join (PDAs are reused, ids are not).
    pub id: u64,
    pub player: Pubkey,
    pub arena: Pubkey,
    pub arena_id: u16,
    /// Entry fee paid into the arena vault, in base units of the game token.
    pub entry_fee: u64,
    pub opened_at: i64,
    /// Joined with a Slana Pass: lower fee, season points, and `pass_asset` is locked.
    pub has_pass: bool,
    /// The Pass asset backing the session (`Pubkey::default()` without a Pass).
    pub pass_asset: Pubkey,
    /// Settle deposit in lamports (`Config::settle_fee_lamports` at join).
    pub settle_fee: u64,
    /// Fee on profit in basis points, fixed at join (`Config::pass_fee_bps` with a Pass,
    /// else `Config::fee_bps`): later fee changes never touch an open session.
    pub fee_bps: u16,
    pub bump: u8,
}

/// Lock of a Pass asset while it backs an open session, so one Pass backs at most one
/// session at a time (even across transfers). PDA `["pass_lock", asset]`.
/// Paid by the player at join and closed back to them at settlement or refund.
#[account]
#[derive(InitSpace, Debug)]
pub struct PassLock {
    pub session: Pubkey,
    pub player: Pubkey,
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
/// Prize tokens live in the global season vault (`["season_vault"]`); `pool` is this
/// season's share of it. While the season runs, settle fee shares, sweeps and rollovers add
/// to `pool`; `end_season` freezes it into `prize_pool`; each claim takes its prize out of
/// `pool`, and `rollover_season` moves what is left into the then-current season.
#[account]
#[derive(InitSpace, Debug)]
pub struct Season {
    pub id: u32,
    pub started_at: i64,
    pub ended_at: i64,
    pub finalized: bool,
    /// Prize pool frozen by `end_season`.
    pub prize_pool: u64,
    /// Game tokens of the season vault that belong to this season and are not paid out yet.
    pub pool: u64,
    /// Bit `rank` set ⇔ the prize of that rank was claimed.
    pub claimed_mask: u16,
    /// Number of used leaderboard entries.
    pub count: u8,
    pub bump: u8,
    /// Sorted by `points`, descending; only `entries[..count]` are meaningful.
    pub entries: [LeaderEntry; LEADERBOARD_LEN],
}

/// Number of Passes a wallet minted. PDA `["pass_minted", minter]`.
#[account]
#[derive(InitSpace, Debug)]
pub struct MintCounter {
    pub count: u8,
    pub bump: u8,
}
