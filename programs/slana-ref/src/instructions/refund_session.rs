use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    constants::*,
    error::SlanaError,
    events::SessionRefunded,
    instructions::shared,
    state::{Arena, Config, PassLock, Session},
    token,
};

/// Player-signed close of their session. Works while paused.
///
/// * Finalized session (settled without a player token account, ruling R24): pays
///   `min(owed, vault balance)` at once, plus the session rent. The game result already
///   happened, so this never returns the entry fee.
/// * Unsettled session (the server never settled it): after `SESSION_REFUND_TIMEOUT_SECS`
///   the player gets `min(entry_fee, vault balance)` back, plus the session rent and its
///   settle deposit (and the Pass lock rent).
#[derive(Accounts)]
pub struct RefundSession<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [ARENA_SEED, arena.id.to_le_bytes().as_ref()],
        bump = arena.bump
    )]
    pub arena: Box<Account<'info, Arena>>,
    #[account(
        mut,
        seeds = [VAULT_SEED, arena.key().as_ref()],
        bump = arena.vault_bump
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        close = player,
        seeds = [SESSION_SEED, arena.key().as_ref(), player.key().as_ref()],
        bump = session.bump,
        has_one = player @ SlanaError::Unauthorized,
        has_one = arena @ SlanaError::Unauthorized
    )]
    pub session: Box<Account<'info, Session>>,
    #[account(
        mut,
        token::mint = token_mint,
        token::authority = player,
        token::token_program = token_program
    )]
    pub player_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.token_mint)]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = config.token_program)]
    pub token_program: Interface<'info, TokenInterface>,
    /// Required iff the session has a Pass and is not finalized (settlement already closed the
    /// lock of a finalized session): its lock, closed back to the player.
    #[account(mut, close = player)]
    pub pass_lock: Option<Box<Account<'info, PassLock>>>,
}

pub fn handle_refund_session(ctx: Context<RefundSession>) -> Result<()> {
    let a = &mut *ctx.accounts;
    let finalized = a.session.finalized;
    let refund = if finalized {
        // The lock was closed at settlement; any lock passed here would be someone else's.
        require!(a.pass_lock.is_none(), SlanaError::PassInUse);
        a.session.owed.min(a.vault.amount)
    } else {
        let now = Clock::get()?.unix_timestamp;
        let refundable_at = a
            .session
            .opened_at
            .checked_add(SESSION_REFUND_TIMEOUT_SECS)
            .ok_or(SlanaError::MathOverflow)?;
        require_gte!(now, refundable_at, SlanaError::RefundTooEarly);
        shared::check_pass_lock(&a.session, a.pass_lock.as_deref())?;
        a.session.entry_fee.min(a.vault.amount)
    };

    let arena_id_bytes = a.arena.id.to_le_bytes();
    let arena_seeds: &[&[u8]] = &[ARENA_SEED, &arena_id_bytes, &[a.arena.bump]];
    token::transfer_from_pda(
        &a.token_program.to_account_info(),
        &a.vault.to_account_info(),
        &a.token_mint.to_account_info(),
        &a.player_token.to_account_info(),
        &a.arena.to_account_info(),
        &[arena_seeds],
        refund,
        a.config.token_decimals,
    )?;

    let arena = &mut a.arena;
    arena.open_sessions = arena.open_sessions.saturating_sub(1);
    arena.total_paid_out = arena
        .total_paid_out
        .checked_add(refund)
        .ok_or(SlanaError::MathOverflow)?;
    if finalized {
        // Settlement left the owed share out of the global total.
        let config = &mut a.config;
        config.total_paid_out = config
            .total_paid_out
            .checked_add(refund)
            .ok_or(SlanaError::MathOverflow)?;
    }

    emit!(SessionRefunded {
        player: a.player.key(),
        arena_id: arena.id,
        amount: refund,
        finalized,
    });
    Ok(())
}
