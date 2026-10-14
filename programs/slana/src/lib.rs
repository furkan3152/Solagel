//! Slana: on-chain part of a cute coin-themed Agar.io.
//!
//! The game loop runs on an authoritative server; this program holds everything that
//! involves value or identity: player profiles, stake arenas paid in the $SLANA token (each
//! arena has a token vault), session settlement with a fee on profit split between the
//! treasury vault, the season vault and a burn, and seasons with a top-20 leaderboard and a
//! prize pool for the top 10.

pub mod constants;
pub mod core_asset;
pub mod error;
pub mod events;
pub mod instructions;
pub mod logic;
pub mod state;
pub mod token;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("5skf5Twyqr8M84dJ8RLGfz1NU6fR3zPDRLUvGd5y7472");

#[program]
pub mod slana {
    use super::*;

    // ----- admin -----------------------------------------------------------------------

    /// Creates the config, the treasury and season vaults and season 1 for the game mint.
    /// Only the program's upgrade authority may call it.
    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        instructions::initialize::handle_initialize(ctx, args)
    }

    pub fn update_config(ctx: Context<UpdateConfig>, args: UpdateConfigArgs) -> Result<()> {
        instructions::update_config::handle_update_config(ctx, args)
    }

    pub fn create_arena(
        ctx: Context<CreateArena>,
        id: u16,
        entry_fee: u64,
        max_sessions: u16,
        requires_pass: bool,
    ) -> Result<()> {
        instructions::create_arena::handle_create_arena(
            ctx,
            id,
            entry_fee,
            max_sessions,
            requires_pass,
        )
    }

    pub fn update_arena(
        ctx: Context<UpdateArena>,
        enabled: Option<bool>,
        max_sessions: Option<u16>,
        entry_fee: Option<u64>,
        requires_pass: Option<bool>,
    ) -> Result<()> {
        instructions::update_arena::handle_update_arena(
            ctx,
            enabled,
            max_sessions,
            entry_fee,
            requires_pass,
        )
    }

    pub fn withdraw_treasury(ctx: Context<WithdrawTreasury>, amount: u64) -> Result<()> {
        instructions::withdraw_treasury::handle_withdraw_treasury(ctx, amount)
    }

    // ----- players -----------------------------------------------------------------------

    pub fn register_player(ctx: Context<RegisterPlayer>, name: String, skin: u8) -> Result<()> {
        instructions::register_player::handle_register_player(ctx, name, skin)
    }

    pub fn update_profile(
        ctx: Context<UpdateProfile>,
        name: Option<String>,
        skin: Option<u8>,
    ) -> Result<()> {
        instructions::update_profile::handle_update_profile(ctx, name, skin)
    }

    // ----- stake arenas -------------------------------------------------------------------

    /// Pays the entry fee into the arena vault and opens a session (no Pass).
    pub fn join_arena(ctx: Context<JoinArena>) -> Result<()> {
        instructions::join_arena::handle_join_arena(ctx)
    }

    /// Like `join_arena`, backed by a Slana Pass that is locked until the session closes.
    pub fn join_arena_with_pass(ctx: Context<JoinArenaWithPass>) -> Result<()> {
        instructions::join_arena::handle_join_arena_with_pass(ctx)
    }

    /// Server-signed cash-out of a stake session.
    pub fn settle_session(ctx: Context<SettleSession>, args: SettleArgs) -> Result<()> {
        instructions::settle_session::handle_settle_session(ctx, args)
    }

    pub fn refund_session(ctx: Context<RefundSession>) -> Result<()> {
        instructions::refund_session::handle_refund_session(ctx)
    }

    pub fn sweep_arena(ctx: Context<SweepArena>) -> Result<()> {
        instructions::sweep_arena::handle_sweep_arena(ctx)
    }

    // ----- seasons ----------------------------------------------------------------------

    pub fn end_season(ctx: Context<EndSeason>) -> Result<()> {
        instructions::end_season::handle_end_season(ctx)
    }

    pub fn claim_season_reward(ctx: Context<ClaimSeasonReward>, season_id: u32) -> Result<()> {
        instructions::claim_season_reward::handle_claim_season_reward(ctx, season_id)
    }

    pub fn rollover_season(ctx: Context<RolloverSeason>, season_id: u32) -> Result<()> {
        instructions::rollover_season::handle_rollover_season(ctx, season_id)
    }
}
