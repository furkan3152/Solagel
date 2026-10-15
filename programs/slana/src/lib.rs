//! Slana: on-chain part of a cute coin-themed Agar.io.
//!
//! The game loop runs on an authoritative server; this program holds everything that
//! involves value or identity: player profiles, stake arenas paid in the $SLANA token (each
//! arena has a token vault), session settlement with a fee on profit split between the
//! treasury vault, the season vault and a burn, seasons with a top-20 leaderboard and a token
//! prize pool for the top 10, and the Slana Pass (a free-mint Metaplex Core collection with a
//! commit–reveal trait seed mixed with the hash of a future slot fixed when the mint ends).

pub mod constants;
pub mod core_asset;
pub mod core_cpi;
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

    /// Pays the entry fee into the arena vault and opens a session (no Pass). Fails with
    /// `FeeAboveLimit` if the fee rate fixed into the session exceeds `max_fee_bps` (the rate
    /// the player was shown).
    pub fn join_arena(ctx: Context<JoinArena>, max_fee_bps: u16) -> Result<()> {
        instructions::join_arena::handle_join_arena(ctx, max_fee_bps)
    }

    /// Like `join_arena`, backed by a Slana Pass that is locked until the session closes.
    pub fn join_arena_with_pass(ctx: Context<JoinArenaWithPass>, max_fee_bps: u16) -> Result<()> {
        instructions::join_arena::handle_join_arena_with_pass(ctx, max_fee_bps)
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

    // ----- Slana Pass ----------------------------------------------------------------------

    /// Sets the Pass collection once (a Core collection whose update authority is the
    /// `pass_authority` PDA).
    pub fn set_pass_collection(ctx: Context<SetPassCollection>) -> Result<()> {
        instructions::set_pass_collection::handle_set_pass_collection(ctx)
    }

    /// Commits `sha256(seed)` of the Pass trait seed (before the first mint).
    pub fn set_pass_seed_hash(ctx: Context<SetPassSeedHash>, hash: [u8; 32]) -> Result<()> {
        instructions::set_pass_seed_hash::handle_set_pass_seed_hash(ctx, hash)
    }

    /// Free mint of one Slana Pass (Core asset in the Pass collection) to the signer.
    pub fn mint_pass(ctx: Context<MintPass>) -> Result<()> {
        instructions::mint_pass::handle_mint_pass(ctx)
    }

    /// Ends the Pass mint for good (no entropy target yet: `reveal_pass` sets it).
    pub fn close_pass_mint(ctx: Context<ClosePassMint>) -> Result<()> {
        instructions::close_pass_mint::handle_close_pass_mint(ctx)
    }

    /// Permissionless: once the seed is public and the target slot has passed, stores the
    /// entropy (hash of the first slot at or after the target) and the final seed, which
    /// reveals the traits; re-targets if the target left the SlotHashes window.
    pub fn capture_pass_entropy(ctx: Context<CapturePassEntropy>) -> Result<()> {
        instructions::capture_pass_entropy::handle_capture_pass_entropy(ctx)
    }

    /// Publishes the Pass trait seed (checked against the committed hash), once, after the
    /// mint ended, then sets the entropy target slot.
    pub fn reveal_pass(ctx: Context<RevealPass>, seed: [u8; 32]) -> Result<()> {
        instructions::reveal_pass::handle_reveal_pass(ctx, seed)
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
