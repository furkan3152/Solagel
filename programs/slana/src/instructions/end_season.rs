use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::SlanaError,
    events::SeasonEnded,
    state::{Config, Season},
};

/// Freezes the current season (its token pool becomes the claimable prize pool) and opens
/// the next one.
#[derive(Accounts)]
pub struct EndSeason<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ SlanaError::Unauthorized
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [SEASON_SEED, config.current_season.to_le_bytes().as_ref()],
        bump = season.bump
    )]
    pub season: Box<Account<'info, Season>>,
    /// Season `config.current_season + 1`.
    #[account(
        init,
        payer = admin,
        space = 8 + Season::INIT_SPACE,
        seeds = [SEASON_SEED, (config.current_season + 1).to_le_bytes().as_ref()],
        bump
    )]
    pub next_season: Box<Account<'info, Season>>,
    pub system_program: Program<'info, System>,
}

pub fn handle_end_season(ctx: Context<EndSeason>) -> Result<()> {
    let accounts = &mut *ctx.accounts;
    require!(!accounts.season.finalized, SlanaError::SeasonFinalized);
    let now = Clock::get()?.unix_timestamp;

    let season = &mut accounts.season;
    season.finalized = true;
    season.ended_at = now;
    season.prize_pool = season.pool;
    let (ended_id, prize_pool) = (season.id, season.prize_pool);

    let config = &mut accounts.config;
    let next_id = config
        .current_season
        .checked_add(1)
        .ok_or(SlanaError::MathOverflow)?;
    config.current_season = next_id;

    let next = &mut accounts.next_season;
    next.id = next_id;
    next.started_at = now;
    next.bump = ctx.bumps.next_season;

    emit!(SeasonEnded {
        season_id: ended_id,
        prize_pool,
    });
    Ok(())
}
