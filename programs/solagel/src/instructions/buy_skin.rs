use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::SolagelError,
    events::SkinPurchased,
    instructions::shared,
    logic,
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

pub fn handle_buy_skin(ctx: Context<BuySkin>, skin: u8) -> Result<()> {
    let bit = logic::premium_skin_bit(skin).ok_or(SolagelError::InvalidSkin)?;
    require!(
        ctx.accounts.profile.premium_skins & bit == 0,
        SolagelError::SkinAlreadyOwned
    );

    let price = ctx.accounts.config.skin_price;
    shared::transfer_from_wallet(
        &ctx.accounts.owner.to_account_info(),
        &ctx.accounts.treasury.to_account_info(),
        price,
    )?;

    let profile = &mut ctx.accounts.profile;
    profile.premium_skins |= bit;
    profile.skin = skin;

    emit!(SkinPurchased {
        owner: profile.owner,
        skin,
        price,
    });
    Ok(())
}
