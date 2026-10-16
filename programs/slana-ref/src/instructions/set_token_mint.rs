use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::{constants::*, error::SlanaError, events::TokenMintSet, state::Config, token};

/// Admin, once: stores the game token. Allowed only while `config.token_mint` is unset
/// (`TokenAlreadySet`), so the mint can never change after it was set.
#[derive(Accounts)]
pub struct SetTokenMint<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ SlanaError::Unauthorized,
        constraint = config.token_mint == Pubkey::default() @ SlanaError::TokenAlreadySet
    )]
    pub config: Box<Account<'info, Config>>,
    /// The game token. Validated by `token::validate_mint` (no freeze authority, no
    /// forbidden Token-2022 extension) and stored in the config for good.
    #[account(mint::token_program = token_program)]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_set_token_mint(ctx: Context<SetTokenMint>) -> Result<()> {
    let token_program = ctx.accounts.token_program.key();
    let decimals =
        token::validate_mint(&ctx.accounts.token_mint.to_account_info(), &token_program)?;
    let mint = ctx.accounts.token_mint.key();

    let config = &mut ctx.accounts.config;
    config.token_mint = mint;
    config.token_program = token_program;
    config.token_decimals = decimals;

    emit!(TokenMintSet {
        mint,
        token_program,
        decimals,
    });
    Ok(())
}
