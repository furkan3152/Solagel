//! Slana: on-chain part of a cute coin-themed Agar.io.
//!
//! The game loop runs on an authoritative server; this program holds everything that
//! involves value or identity: player profiles, stake arenas paid in the $SLANA token (each
//! arena has a token vault), and session settlement with a fee on profit paid to the fee
//! wallet. The program deploys and initializes without a token; the admin sets the mint once
//! later with `set_token_mint`, and no arena can be created or joined before that.

pub mod constants;
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

    /// Creates the config (no token yet). Only the program's upgrade authority may call it.
    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        instructions::initialize::handle_initialize(ctx, args)
    }

    /// Sets the game token, once, while it is unset (`TokenAlreadySet` afterwards).
    pub fn set_token_mint(ctx: Context<SetTokenMint>) -> Result<()> {
        instructions::set_token_mint::handle_set_token_mint(ctx)
    }

    pub fn update_config(ctx: Context<UpdateConfig>, args: UpdateConfigArgs) -> Result<()> {
        instructions::update_config::handle_update_config(ctx, args)
    }

    /// Fails with `TokenNotSet` until `set_token_mint` ran.
    pub fn create_arena(
        ctx: Context<CreateArena>,
        id: u16,
        entry_fee: u64,
        max_sessions: u16,
    ) -> Result<()> {
        instructions::create_arena::handle_create_arena(ctx, id, entry_fee, max_sessions)
    }

    pub fn update_arena(
        ctx: Context<UpdateArena>,
        enabled: Option<bool>,
        max_sessions: Option<u16>,
        entry_fee: Option<u64>,
    ) -> Result<()> {
        instructions::update_arena::handle_update_arena(ctx, enabled, max_sessions, entry_fee)
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

    /// Pays the entry fee into the arena vault and opens a session. Fails with `TokenNotSet`
    /// before the mint is set, with `FeeAboveLimit` if the fee rate fixed into the session
    /// exceeds `max_fee_bps` (the rate the player was shown), with `EntryFeeAboveLimit` if the
    /// arena's entry fee exceeds `max_entry_fee`, and with `SettleFeeAboveLimit` if the settle
    /// deposit exceeds `max_settle_fee`.
    pub fn join_arena(
        ctx: Context<JoinArena>,
        max_fee_bps: u16,
        max_entry_fee: u64,
        max_settle_fee: u64,
    ) -> Result<()> {
        instructions::join_arena::handle_join_arena(
            ctx,
            JoinLimits {
                max_fee_bps,
                max_entry_fee,
                max_settle_fee,
            },
        )
    }

    /// Server-signed settlement of a stake session (a death, the round bell, or an operator
    /// exit). The fee on profit goes to the fee wallet's token account. With the player's
    /// token account the payout is paid and the session closed; without it
    /// (`player_token = None`) the session is finalized with `owed` for the player to collect
    /// via `refund_session` (ruling R24).
    pub fn settle_session(ctx: Context<SettleSession>, args: SettleArgs) -> Result<()> {
        instructions::settle_session::handle_settle_session(ctx, args)
    }

    /// Player-signed. A finalized session pays its `owed` payout at once; an unsettled one
    /// returns the entry fee after `SESSION_REFUND_TIMEOUT_SECS`.
    pub fn refund_session(ctx: Context<RefundSession>) -> Result<()> {
        instructions::refund_session::handle_refund_session(ctx)
    }

    /// Admin: moves the whole vault of a disabled arena with no open session to the fee
    /// wallet's token account.
    pub fn sweep_arena(ctx: Context<SweepArena>) -> Result<()> {
        instructions::sweep_arena::handle_sweep_arena(ctx)
    }

    /// Server-signed: burns `amount` (at most the vault balance) of an arena vault's floor
    /// loot, while the arena runs. `amount == 0` succeeds and does nothing.
    pub fn sweep_loot(ctx: Context<SweepLoot>, amount: u64) -> Result<()> {
        instructions::sweep_loot::handle_sweep_loot(ctx, amount)
    }
}
