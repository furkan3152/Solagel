//! Slana: on-chain part of a cute coin-themed Agar.io.
//!
//! The game loop runs on an authoritative server; this program holds everything that
//! involves value or identity: player profiles and skins, stake arenas (the arena account
//! is the vault), session settlement with a fee on profit, free-play stats, and seasons with
//! a top-20 leaderboard and a prize pool for the top 10.

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod logic;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("5skf5Twyqr8M84dJ8RLGfz1NU6fR3zPDRLUvGd5y7472");

#[program]
pub mod slana {
    use super::*;

    // ----- admin -----------------------------------------------------------------------

    /// Creates the config and season 1. Only the program's upgrade authority may call it.
    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        instructions::initialize::handle_initialize(ctx, args)
    }

    pub fn update_config(ctx: Context<UpdateConfig>, args: UpdateConfigArgs) -> Result<()> {
        instructions::update_config::handle_update_config(ctx, args)
    }

    pub fn create_arena(
        ctx: Context<CreateArena>,
        id: u16,
        buy_in: u64,
        max_players: u16,
    ) -> Result<()> {
        instructions::create_arena::handle_create_arena(ctx, id, buy_in, max_players)
    }

    pub fn update_arena(
        ctx: Context<UpdateArena>,
        enabled: Option<bool>,
        max_players: Option<u16>,
    ) -> Result<()> {
        instructions::update_arena::handle_update_arena(ctx, enabled, max_players)
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

    pub fn buy_skin(ctx: Context<BuySkin>, skin: u8) -> Result<()> {
        instructions::buy_skin::handle_buy_skin(ctx, skin)
    }

    // ----- stake arenas -------------------------------------------------------------------

    pub fn join_arena(ctx: Context<JoinArena>) -> Result<()> {
        instructions::join_arena::handle_join_arena(ctx)
    }

    /// Server-signed cash-out of a stake session.
    pub fn settle_session(ctx: Context<SettleSession>, args: SettleArgs) -> Result<()> {
        instructions::settle_session::handle_settle_session(ctx, args)
    }

    /// Server-signed free-play result.
    pub fn record_game(ctx: Context<RecordGame>, args: RecordArgs) -> Result<()> {
        instructions::record_game::handle_record_game(ctx, args)
    }

    pub fn refund_session(ctx: Context<RefundSession>) -> Result<()> {
        instructions::refund_session::handle_refund_session(ctx)
    }

    pub fn sweep_arena(ctx: Context<SweepArena>) -> Result<()> {
        instructions::sweep_arena::handle_sweep_arena(ctx)
    }

    // ----- seasons ----------------------------------------------------------------------

    pub fn fund_season(ctx: Context<FundSeason>, amount: u64) -> Result<()> {
        instructions::fund_season::handle_fund_season(ctx, amount)
    }

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
