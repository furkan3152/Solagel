use anchor_lang::prelude::*;

use crate::constants::NAME_BYTES;

/// Global configuration. PDA `["config"]`.
#[account]
#[derive(InitSpace, Debug)]
pub struct Config {
    /// May change the configuration, set the token mint, and create and sweep arenas.
    pub admin: Pubkey,
    /// Game server key that signs `settle_session` and `sweep_loot`.
    pub server_authority: Pubkey,
    /// Owner of the token account that receives every fee and every swept arena vault.
    pub fee_wallet: Pubkey,

    // ----- token (set once by `set_token_mint`) ----------------------------------------
    /// The game token ($SLANA); `Pubkey::default()` until `set_token_mint`, then fixed.
    pub token_mint: Pubkey,
    /// Token program owning `token_mint` (SPL Token or Token-2022); default while unset.
    pub token_program: Pubkey,
    /// Decimals of `token_mint` (0 while unset).
    pub token_decimals: u8,

    // ----- fees ------------------------------------------------------------------------
    /// Fee charged on stake profit, in basis points (≤ `MAX_FEE_BPS`).
    pub fee_bps: u16,
    /// Lamports a player deposits per session to pay the server's settle transaction
    /// (≤ `MAX_SETTLE_FEE_LAMPORTS`).
    pub settle_fee_lamports: u64,

    // ----- general -----------------------------------------------------------------------
    /// Blocks new arena joins (settlements and refunds keep working).
    pub paused: bool,
    pub bump: u8,

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
    /// Settle deposit in lamports (`Config::settle_fee_lamports` at join).
    pub settle_fee: u64,
    /// Fee on profit in basis points, fixed at join (`Config::fee_bps`): later fee changes
    /// never touch an open session.
    pub fee_bps: u16,
    pub bump: u8,
    /// Settled without a player token account (R24): the game result is final and the
    /// fee is paid, but `owed` still sits in the arena vault until the player collects it with
    /// `refund_session` (no waiting time). The session stays open (it counts in
    /// `Arena::open_sessions`, so the vault cannot be swept meanwhile).
    pub finalized: bool,
    /// Game tokens the player is owed by a finalized session (0 otherwise).
    pub owed: u64,
}
