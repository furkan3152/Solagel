use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::SlanaError,
    events::SeasonFunded,
    instructions::shared,
    state::{Config, Season},
};

/// Anyone can donate to the prize pool of the current season.
#[derive(Accounts)]
pub struct FundSeason<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [SEASON_SEED, config.current_season.to_le_bytes().as_ref()],
        bump = season.bump
    )]
    pub season: Box<Account<'info, Season>>,
    pub system_program: Program<'info, System>,
}

pub fn handle_fund_season(ctx: Context<FundSeason>, amount: u64) -> Result<()> {
    require_gt!(amount, 0, SlanaError::InvalidAmount);
    require!(!ctx.accounts.season.finalized, SlanaError::SeasonFinalized);

    shared::transfer_from_wallet(
        &ctx.accounts.funder.to_account_info(),
        &ctx.accounts.season.to_account_info(),
        amount,
    )?;

    emit!(SeasonFunded {
        season_id: ctx.accounts.season.id,
        funder: ctx.accounts.funder.key(),
        amount,
    });
    Ok(())
}
