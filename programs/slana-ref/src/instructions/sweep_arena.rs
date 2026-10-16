use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    constants::*,
    error::SlanaError,
    events::ArenaSwept,
    state::{Arena, Config},
    token,
};

/// Moves whatever is left in a disabled arena's vault to the fee wallet's token account once
/// no session is open.
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
    /// Any token account of the game mint owned by `config.fee_wallet`.
    #[account(
        mut,
        token::mint = token_mint,
        token::authority = config.fee_wallet,
        token::token_program = token_program
    )]
    pub fee_wallet_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.token_mint)]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = config.token_program)]
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_sweep_arena(ctx: Context<SweepArena>) -> Result<()> {
    let a = &mut *ctx.accounts;
    require!(!a.arena.enabled, SlanaError::ArenaBusy);
    require!(a.arena.open_sessions == 0, SlanaError::ArenaHasOpenSessions);

    let amount = a.vault.amount;
    let arena_id_bytes = a.arena.id.to_le_bytes();
    let arena_seeds: &[&[u8]] = &[ARENA_SEED, &arena_id_bytes, &[a.arena.bump]];
    token::transfer_from_pda(
        &a.token_program.to_account_info(),
        &a.vault.to_account_info(),
        &a.token_mint.to_account_info(),
        &a.fee_wallet_token.to_account_info(),
        &a.arena.to_account_info(),
        &[arena_seeds],
        amount,
        a.config.token_decimals,
    )?;

    emit!(ArenaSwept {
        arena_id: a.arena.id,
        amount,
    });
    Ok(())
}
