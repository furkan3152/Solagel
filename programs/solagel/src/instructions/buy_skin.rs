use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::SolagelError,
    state::{Config, PlayerProfile},
};

#[derive(Accounts)]
pub struct BuySkin<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [PROFILE_SEED, owner.key().as_ref()],
        bump = profile.bump,
        has_one = owner @ SolagelError::Unauthorized
    )]
    pub profile: Account<'info, PlayerProfile>,
    /// CHECK: must equal `config.treasury`; only receives lamports. `dup`: may be the owner.
    #[account(mut, dup, address = config.treasury @ SolagelError::Unauthorized)]
    pub treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Retained for instruction compatibility only. NFT skins will use verified ownership
/// after the collection launches; this legacy SOL sale must not issue substitute rights.
pub fn handle_buy_skin(_ctx: Context<BuySkin>, _skin: u8) -> Result<()> {
    err!(SolagelError::FeatureUnavailable)
}
