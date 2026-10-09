use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::SolagelError,
    events::SeasonRolledOver,
    instructions::shared,
    state::{Config, Season},
};

/// After the claim window of a finalized season, moves its unclaimed prizes into the
/// current season's pool.
#[derive(Accounts)]
#[instruction(season_id: u32)]
pub struct RolloverSeason<'info> {
    pub admin: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ SolagelError::Unauthorized
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [SEASON_SEED, season_id.to_le_bytes().as_ref()],
        bump = old_season.bump,
        constraint = season_id != config.current_season @ SolagelError::InvalidSeason
    )]
    pub old_season: Box<Account<'info, Season>>,
    /// `dup` so that `season_id == current_season` is reported as `InvalidSeason` by the
    /// constraint above instead of a generic duplicate-account error.
    #[account(
        mut,
        dup,
        seeds = [SEASON_SEED, config.current_season.to_le_bytes().as_ref()],
        bump = current_season.bump
    )]
    pub current_season: Box<Account<'info, Season>>,
}

pub fn handle_rollover_season(ctx: Context<RolloverSeason>, season_id: u32) -> Result<()> {
    let old = &ctx.accounts.old_season;
    require!(old.finalized, SolagelError::SeasonNotFinalized);
    let now = Clock::get()?.unix_timestamp;
    let closes_at = old
        .ended_at
        .checked_add(CLAIM_WINDOW_SECS)
        .ok_or(SolagelError::MathOverflow)?;
    require_gt!(now, closes_at, SolagelError::ClaimWindowOpen);

    let old_info = ctx.accounts.old_season.to_account_info();
    let amount = shared::available_lamports(&old_info)?;
    shared::transfer_from_program_account(
        &old_info,
        &ctx.accounts.current_season.to_account_info(),
        amount,
    )?;

    emit!(SeasonRolledOver {
        from: season_id,
        to: ctx.accounts.current_season.id,
        amount,
    });
    Ok(())
}
