use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::SlanaError,
    events::ArenaSwept,
    instructions::shared,
    state::{Arena, Config, Season},
};

/// Sends whatever is left in an arena pot to the current season once no session is open.
#[derive(Accounts)]
pub struct SweepArena<'info> {
    pub admin: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ SlanaError::Unauthorized
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [ARENA_SEED, arena.id.to_le_bytes().as_ref()],
        bump = arena.bump
    )]
    pub arena: Account<'info, Arena>,
    #[account(
        mut,
        seeds = [SEASON_SEED, config.current_season.to_le_bytes().as_ref()],
        bump = season.bump
    )]
    pub season: Box<Account<'info, Season>>,
}

// TODO(Task 4): interim lamport version; Task 4 sweeps the token vault into the season vault.
pub fn handle_sweep_arena(ctx: Context<SweepArena>) -> Result<()> {
    require!(
        ctx.accounts.arena.open_sessions == 0,
        SlanaError::ArenaHasOpenSessions
    );

    let arena_info = ctx.accounts.arena.to_account_info();
    let amount = shared::available_lamports(&arena_info)?;
    shared::transfer_from_program_account(
        &arena_info,
        &ctx.accounts.season.to_account_info(),
        amount,
    )?;

    emit!(ArenaSwept {
        arena_id: ctx.accounts.arena.id,
        amount,
    });
    Ok(())
}
