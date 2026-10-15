use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    constants::*,
    error::SlanaError,
    events::RewardClaimed,
    logic,
    state::{Config, Season},
    token,
};

/// The top `PRIZE_RANKS` players of a finalized season claim their share of the prize pool,
/// paid in game tokens from the season vault into their own token account.
#[derive(Accounts)]
#[instruction(season_id: u32)]
pub struct ClaimSeasonReward<'info> {
    pub claimer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [SEASON_SEED, season_id.to_le_bytes().as_ref()],
        bump = season.bump
    )]
    pub season: Box<Account<'info, Season>>,
    #[account(
        mut,
        seeds = [SEASON_VAULT_SEED],
        bump = config.season_vault_bump
    )]
    pub season_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Receives the prize: a game-token account of the claimer.
    #[account(
        mut,
        token::mint = token_mint,
        token::authority = claimer,
        token::token_program = token_program
    )]
    pub claimer_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.token_mint)]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = config.token_program)]
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_claim_season_reward(ctx: Context<ClaimSeasonReward>, season_id: u32) -> Result<()> {
    let a = &mut *ctx.accounts;
    require!(a.season.finalized, SlanaError::SeasonNotFinalized);
    let now = Clock::get()?.unix_timestamp;
    let closes_at = a
        .season
        .ended_at
        .checked_add(CLAIM_WINDOW_SECS)
        .ok_or(SlanaError::MathOverflow)?;
    require_gte!(closes_at, now, SlanaError::ClaimWindowClosed);

    let claimer = a.claimer.key();
    let rank = logic::prize_rank(&a.season.entries, a.season.count, &claimer)
        .ok_or(SlanaError::NotEligible)?;
    let bit = 1u16 << rank;
    require!(a.season.claimed_mask & bit == 0, SlanaError::AlreadyClaimed);
    let amount = logic::prize_amount(a.season.prize_pool, rank)?;

    // Prizes sum to at most `prize_pool` (= `pool` at `end_season`), so this cannot fail
    // unless the accounting is broken.
    a.season.pool = a
        .season
        .pool
        .checked_sub(amount)
        .ok_or(SlanaError::InsufficientPot)?;
    a.season.claimed_mask |= bit;

    let seeds: &[&[u8]] = &[CONFIG_SEED, &[a.config.bump]];
    token::transfer_from_pda(
        &a.token_program.to_account_info(),
        &a.season_vault.to_account_info(),
        &a.token_mint.to_account_info(),
        &a.claimer_token.to_account_info(),
        &a.config.to_account_info(),
        &[seeds],
        amount,
        a.config.token_decimals,
    )?;

    emit!(RewardClaimed {
        season_id,
        player: claimer,
        // rank < PRIZE_RANKS (10).
        rank: rank as u8,
        amount,
    });
    Ok(())
}
