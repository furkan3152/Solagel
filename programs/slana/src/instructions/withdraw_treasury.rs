use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{constants::*, error::SlanaError, events::TreasuryWithdrawn, state::Config, token};

/// Moves tokens out of the treasury vault into any token account of the game mint.
#[derive(Accounts)]
pub struct WithdrawTreasury<'info> {
    pub admin: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ SlanaError::Unauthorized
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [TREASURY_VAULT_SEED],
        bump = config.treasury_vault_bump,
        token::mint = token_mint,
        token::authority = config,
        token::token_program = token_program
    )]
    pub treasury_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = token_mint,
        token::token_program = token_program
    )]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.token_mint)]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = config.token_program)]
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_withdraw_treasury(ctx: Context<WithdrawTreasury>, amount: u64) -> Result<()> {
    require_gt!(amount, 0, SlanaError::InvalidAmount);
    require_gte!(
        ctx.accounts.treasury_vault.amount,
        amount,
        SlanaError::InsufficientPot
    );

    let seeds: &[&[u8]] = &[CONFIG_SEED, &[ctx.accounts.config.bump]];
    token::transfer_from_pda(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.treasury_vault.to_account_info(),
        &ctx.accounts.token_mint.to_account_info(),
        &ctx.accounts.destination.to_account_info(),
        &ctx.accounts.config.to_account_info(),
        &[seeds],
        amount,
        ctx.accounts.config.token_decimals,
    )?;

    emit!(TreasuryWithdrawn {
        destination: ctx.accounts.destination.key(),
        amount,
    });
    Ok(())
}
