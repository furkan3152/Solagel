use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::SlanaError,
    events::ArenaJoined,
    instructions::shared,
    state::{Arena, Config, PlayerProfile, Session},
};

#[derive(Accounts)]
pub struct JoinArena<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [PROFILE_SEED, player.key().as_ref()],
        bump = profile.bump
    )]
    pub profile: Account<'info, PlayerProfile>,
    #[account(
        mut,
        seeds = [ARENA_SEED, arena.id.to_le_bytes().as_ref()],
        bump = arena.bump
    )]
    pub arena: Account<'info, Arena>,
    /// One open session per player per arena: a second join fails because the PDA exists.
    #[account(
        init,
        payer = player,
        space = 8 + Session::INIT_SPACE,
        seeds = [SESSION_SEED, arena.key().as_ref(), player.key().as_ref()],
        bump
    )]
    pub session: Account<'info, Session>,
    pub system_program: Program<'info, System>,
}

pub fn handle_join_arena(ctx: Context<JoinArena>) -> Result<()> {
    require!(!ctx.accounts.config.paused, SlanaError::Paused);
    require!(ctx.accounts.arena.enabled, SlanaError::ArenaDisabled);
    require!(
        ctx.accounts.arena.open_sessions < ctx.accounts.arena.max_players,
        SlanaError::ArenaFull
    );

    let buy_in = ctx.accounts.arena.buy_in;
    shared::transfer_from_wallet(
        &ctx.accounts.player.to_account_info(),
        &ctx.accounts.arena.to_account_info(),
        buy_in,
    )?;

    let now = Clock::get()?.unix_timestamp;
    let player = ctx.accounts.player.key();
    let arena_key = ctx.accounts.arena.key();

    let config = &mut ctx.accounts.config;
    let session_id = config.total_sessions;
    config.total_sessions = session_id.checked_add(1).ok_or(SlanaError::MathOverflow)?;
    config.total_staked = config
        .total_staked
        .checked_add(buy_in)
        .ok_or(SlanaError::MathOverflow)?;

    let profile = &mut ctx.accounts.profile;
    profile.stake_games = profile.stake_games.saturating_add(1);
    profile.total_staked = profile
        .total_staked
        .checked_add(buy_in)
        .ok_or(SlanaError::MathOverflow)?;

    let arena = &mut ctx.accounts.arena;
    arena.open_sessions = arena
        .open_sessions
        .checked_add(1)
        .ok_or(SlanaError::MathOverflow)?;
    arena.total_deposited = arena
        .total_deposited
        .checked_add(buy_in)
        .ok_or(SlanaError::MathOverflow)?;
    let arena_id = arena.id;

    let session = &mut ctx.accounts.session;
    session.player = player;
    session.arena = arena_key;
    session.arena_id = arena_id;
    session.buy_in = buy_in;
    session.opened_at = now;
    session.id = session_id;
    session.bump = ctx.bumps.session;

    emit!(ArenaJoined {
        player,
        arena_id,
        session_id,
        buy_in,
    });
    Ok(())
}
