use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::SolagelError,
    state::{Arena, Config},
};

#[derive(Accounts)]
pub struct UpdateArena<'info> {
    pub admin: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ SolagelError::Unauthorized
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [ARENA_SEED, arena.id.to_le_bytes().as_ref()],
        bump = arena.bump
    )]
    pub arena: Account<'info, Arena>,
}

pub fn handle_update_arena(
    ctx: Context<UpdateArena>,
    enabled: Option<bool>,
    max_players: Option<u16>,
) -> Result<()> {
    let arena = &mut ctx.accounts.arena;
    if let Some(enabled) = enabled {
        arena.enabled = enabled;
    }
    if let Some(max_players) = max_players {
        require!(
            (MIN_ARENA_PLAYERS..=MAX_ARENA_PLAYERS).contains(&max_players),
            SolagelError::InvalidMaxPlayers
        );
        arena.max_players = max_players;
    }
    Ok(())
}
