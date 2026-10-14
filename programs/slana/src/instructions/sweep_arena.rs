use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::SlanaError,
    events::ArenaSwept,
    instructions::shared,
    state::{Arena, Config},
};

/// Sends whatever is left in an arena pot to the treasury once no session is open.
#[derive(Accounts)]
pub struct SweepArena<'info> {
    pub admin: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ SlanaError::Unauthorized
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [ARENA_SEED, arena.id.to_le_bytes().as_ref()],
        bump = arena.bump
    )]
    pub arena: Account<'info, Arena>,
    /// CHECK: must equal `config.treasury`; only receives lamports.
    #[account(mut, address = config.treasury @ SlanaError::Unauthorized)]
    pub treasury: UncheckedAccount<'info>,
}

pub fn handle_sweep_arena(ctx: Context<SweepArena>) -> Result<()> {
    require!(
        ctx.accounts.arena.open_sessions == 0,
        SlanaError::ArenaHasOpenSessions
    );

    let arena_info = ctx.accounts.arena.to_account_info();
    let amount = shared::available_lamports(&arena_info)?;
    shared::transfer_from_program_account(
        &arena_info,
        &ctx.accounts.treasury.to_account_info(),
        amount,
    )?;

    emit!(ArenaSwept {
        arena_id: ctx.accounts.arena.id,
        amount,
    });
    Ok(())
}
