use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::SlanaError,
    instructions::shared,
    state::{Arena, Config},
};

#[derive(Accounts)]
pub struct UpdateArena<'info> {
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
    pub arena: Box<Account<'info, Arena>>,
}

/// `enabled` and `max_sessions` can change at any time. `entry_fee` and `requires_pass`
/// only while no session is open (`ArenaBusy`), because open sessions were priced and
/// gated with the old values.
pub fn handle_update_arena(
    ctx: Context<UpdateArena>,
    enabled: Option<bool>,
    max_sessions: Option<u16>,
    entry_fee: Option<u64>,
    requires_pass: Option<bool>,
) -> Result<()> {
    let arena = &mut ctx.accounts.arena;
    if entry_fee.is_some() || requires_pass.is_some() {
        require!(arena.open_sessions == 0, SlanaError::ArenaBusy);
    }
    if let Some(enabled) = enabled {
        arena.enabled = enabled;
    }
    if let Some(max_sessions) = max_sessions {
        shared::check_max_sessions(max_sessions)?;
        arena.max_sessions = max_sessions;
    }
    if let Some(entry_fee) = entry_fee {
        shared::check_entry_fee(entry_fee)?;
        arena.entry_fee = entry_fee;
    }
    if let Some(requires_pass) = requires_pass {
        arena.requires_pass = requires_pass;
    }
    Ok(())
}
