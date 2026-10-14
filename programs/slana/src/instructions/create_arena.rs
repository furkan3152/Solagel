use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::SlanaError,
    state::{Arena, Config},
};

#[derive(Accounts)]
#[instruction(id: u16)]
pub struct CreateArena<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ SlanaError::Unauthorized
    )]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = admin,
        space = 8 + Arena::INIT_SPACE,
        seeds = [ARENA_SEED, id.to_le_bytes().as_ref()],
        bump
    )]
    pub arena: Account<'info, Arena>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_arena(
    ctx: Context<CreateArena>,
    id: u16,
    buy_in: u64,
    max_players: u16,
) -> Result<()> {
    require_gte!(buy_in, MIN_BUY_IN, SlanaError::BuyInTooLow);
    require!(
        (MIN_ARENA_PLAYERS..=MAX_ARENA_PLAYERS).contains(&max_players),
        SlanaError::InvalidMaxPlayers
    );

    let arena = &mut ctx.accounts.arena;
    arena.id = id;
    arena.buy_in = buy_in;
    arena.max_players = max_players;
    arena.enabled = true;
    arena.open_sessions = 0;
    arena.total_deposited = 0;
    arena.total_paid_out = 0;
    arena.bump = ctx.bumps.arena;
    Ok(())
}
