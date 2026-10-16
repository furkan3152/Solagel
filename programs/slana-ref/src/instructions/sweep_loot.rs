use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    constants::*,
    error::SlanaError,
    events::LootBurned,
    state::{Arena, Config},
    token,
};

/// Server-signed: burns `amount` of an arena vault's loot (the tokens the round's losers left
/// on the floor). Unlike `sweep_arena` the arena may be enabled and have open sessions; the
/// trust model is `settle_session`'s, where the server already chooses each payout up to the
/// vault balance.
#[derive(Accounts)]
pub struct SweepLoot<'info> {
    #[account(
        constraint = server.key() == config.server_authority @ SlanaError::Unauthorized
    )]
    pub server: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
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
    /// Writable: the burn lowers its supply.
    #[account(mut, address = config.token_mint)]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = config.token_program)]
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_sweep_loot(ctx: Context<SweepLoot>, amount: u64) -> Result<()> {
    let a = &mut *ctx.accounts;
    require_gte!(a.vault.amount, amount, SlanaError::InsufficientPot);
    if amount == 0 {
        return Ok(());
    }

    let arena_id_bytes = a.arena.id.to_le_bytes();
    let arena_seeds: &[&[u8]] = &[ARENA_SEED, &arena_id_bytes, &[a.arena.bump]];
    token::burn_from_pda(
        &a.token_program.to_account_info(),
        &a.vault.to_account_info(),
        &a.token_mint.to_account_info(),
        &a.arena.to_account_info(),
        &[arena_seeds],
        amount,
    )?;

    emit!(LootBurned {
        arena_id: a.arena.id,
        amount,
    });
    Ok(())
}
