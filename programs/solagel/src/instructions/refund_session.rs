use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::SolagelError,
    events::SessionRefunded,
    instructions::shared,
    state::{Arena, Session},
};

/// Return an unused ticket after `SESSION_REFUND_TIMEOUT_SECS` when the server never
/// admitted it to live play. Activated sessions must be settled by the server because
/// their original buy-in may already belong to another player.
#[derive(Accounts)]
pub struct RefundSession<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(
        mut,
        seeds = [ARENA_SEED, arena.id.to_le_bytes().as_ref()],
        bump = arena.bump
    )]
    pub arena: Account<'info, Arena>,
    #[account(
        mut,
        close = player,
        seeds = [SESSION_SEED, arena.key().as_ref(), player.key().as_ref()],
        bump = session.bump,
        has_one = player @ SolagelError::Unauthorized,
        has_one = arena @ SolagelError::Unauthorized
    )]
    pub session: Account<'info, Session>,
}

pub fn handle_refund_session(ctx: Context<RefundSession>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let session = &ctx.accounts.session;
    require!(!session.activated, SolagelError::SessionNotRefundable);
    let refundable_at = session
        .opened_at
        .checked_add(SESSION_REFUND_TIMEOUT_SECS)
        .ok_or(SolagelError::MathOverflow)?;
    require_gte!(now, refundable_at, SolagelError::RefundTooEarly);

    let arena_info = ctx.accounts.arena.to_account_info();
    let refund = session.buy_in.min(shared::available_lamports(&arena_info)?);
    shared::transfer_from_program_account(
        &arena_info,
        &ctx.accounts.player.to_account_info(),
        refund,
    )?;

    let arena = &mut ctx.accounts.arena;
    arena.open_sessions = arena.open_sessions.saturating_sub(1);
    arena.total_paid_out = arena
        .total_paid_out
        .checked_add(refund)
        .ok_or(SolagelError::MathOverflow)?;

    emit!(SessionRefunded {
        player: ctx.accounts.player.key(),
        arena_id: arena.id,
        amount: refund,
    });
    Ok(())
}
