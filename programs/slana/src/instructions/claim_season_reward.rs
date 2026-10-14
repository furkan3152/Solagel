use anchor_lang::prelude::*;

use crate::{
    constants::*, error::SlanaError, events::RewardClaimed, instructions::shared, logic,
    state::Season,
};

/// The top `PRIZE_RANKS` players of a finalized season claim their share of the prize pool.
#[derive(Accounts)]
#[instruction(season_id: u32)]
pub struct ClaimSeasonReward<'info> {
    #[account(mut)]
    pub claimer: Signer<'info>,
    #[account(
        mut,
        seeds = [SEASON_SEED, season_id.to_le_bytes().as_ref()],
        bump = season.bump
    )]
    pub season: Box<Account<'info, Season>>,
}

pub fn handle_claim_season_reward(ctx: Context<ClaimSeasonReward>, season_id: u32) -> Result<()> {
    let season = &ctx.accounts.season;
    require!(season.finalized, SlanaError::SeasonNotFinalized);
    let now = Clock::get()?.unix_timestamp;
    let closes_at = season
        .ended_at
        .checked_add(CLAIM_WINDOW_SECS)
        .ok_or(SlanaError::MathOverflow)?;
    require_gte!(closes_at, now, SlanaError::ClaimWindowClosed);

    let claimer = ctx.accounts.claimer.key();
    let rank = logic::prize_rank(&season.entries, season.count, &claimer)
        .ok_or(SlanaError::NotEligible)?;
    let bit = 1u16 << rank;
    require!(season.claimed_mask & bit == 0, SlanaError::AlreadyClaimed);
    let amount = logic::prize_amount(season.prize_pool, rank)?;

    shared::transfer_from_program_account(
        &ctx.accounts.season.to_account_info(),
        &ctx.accounts.claimer.to_account_info(),
        amount,
    )?;
    ctx.accounts.season.claimed_mask |= bit;

    emit!(RewardClaimed {
        season_id,
        player: claimer,
        // rank < PRIZE_RANKS (10).
        rank: rank as u8,
        amount,
    });
    Ok(())
}
