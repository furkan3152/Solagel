use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::SlanaError,
    events::SeasonRolledOver,
    state::{Config, Season},
};

/// After the claim window of a finalized season, moves its unclaimed prizes (whatever is
/// left of its `pool`, rounding dust and unfilled ranks included) into the current season's
/// `pool` and closes all of its ranks. The tokens stay in the global season vault; only the
/// per-season accounting changes.
#[derive(Accounts)]
#[instruction(season_id: u32)]
pub struct RolloverSeason<'info> {
    pub admin: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ SlanaError::Unauthorized
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [SEASON_SEED, season_id.to_le_bytes().as_ref()],
        bump = old_season.bump,
        constraint = season_id != config.current_season @ SlanaError::InvalidSeason
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

/// `claimed_mask` with every prize rank set.
const ALL_RANKS_CLAIMED: u16 = ((1u32 << PRIZE_RANKS) - 1) as u16;

pub fn handle_rollover_season(ctx: Context<RolloverSeason>, season_id: u32) -> Result<()> {
    let a = &mut *ctx.accounts;
    require!(a.old_season.finalized, SlanaError::SeasonNotFinalized);
    let now = Clock::get()?.unix_timestamp;
    let closes_at = a
        .old_season
        .ended_at
        .checked_add(CLAIM_WINDOW_SECS)
        .ok_or(SlanaError::MathOverflow)?;
    require_gt!(now, closes_at, SlanaError::ClaimWindowOpen);

    let amount = a.old_season.pool;
    a.old_season.pool = 0;
    a.old_season.claimed_mask = ALL_RANKS_CLAIMED;
    a.current_season.pool = a
        .current_season
        .pool
        .checked_add(amount)
        .ok_or(SlanaError::MathOverflow)?;

    emit!(SeasonRolledOver {
        from: season_id,
        to: a.current_season.id,
        amount,
    });
    Ok(())
}
