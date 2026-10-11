use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::SolagelError,
    state::{Arena, Config, Session},
};

/// The server must confirm this instruction before admitting a paid ticket to live play.
/// Marking admission on-chain prevents the original buy-in being claimed again after
/// its value has been transferred to another player by the authoritative game server.
#[derive(Accounts)]
pub struct ActivateSession<'info> {
    #[account(
        constraint = server.key() == config.server_authority @ SolagelError::Unauthorized
    )]
    pub server: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        seeds = [ARENA_SEED, arena.id.to_le_bytes().as_ref()],
        bump = arena.bump
    )]
    pub arena: Account<'info, Arena>,
    #[account(
        mut,
        seeds = [SESSION_SEED, arena.key().as_ref(), session.player.as_ref()],
        bump = session.bump,
        has_one = arena @ SolagelError::Unauthorized
    )]
    pub session: Account<'info, Session>,
}

pub fn handle_activate_session(ctx: Context<ActivateSession>, session_id: u64) -> Result<()> {
    require!(!ctx.accounts.config.paused, SolagelError::Paused);
    require!(ctx.accounts.arena.enabled, SolagelError::ArenaDisabled);

    let session = &mut ctx.accounts.session;
    require_eq!(session.id, session_id, SolagelError::SessionMismatch);
    require!(!session.activated, SolagelError::SessionAlreadyActivated);
    let refundable_at = session
        .opened_at
        .checked_add(SESSION_REFUND_TIMEOUT_SECS)
        .ok_or(SolagelError::MathOverflow)?;
    require!(
        Clock::get()?.unix_timestamp < refundable_at,
        SolagelError::SessionActivationExpired
    );
    session.activated = true;
    Ok(())
}
