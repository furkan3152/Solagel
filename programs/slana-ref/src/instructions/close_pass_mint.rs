use anchor_lang::prelude::*;

use crate::{constants::*, error::SlanaError, instructions::shared, state::Config};

/// Ends the Pass mint for good (see `shared::end_pass_mint`). The mint never reopens
/// afterwards; the admin then publishes the seed with `reveal_pass`.
/// Requires at least one minted Pass (before the first mint, `update_config` may still open
/// and close the mint freely: nothing is at stake yet).
#[derive(Accounts)]
pub struct ClosePassMint<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ SlanaError::Unauthorized
    )]
    pub config: Box<Account<'info, Config>>,
}

pub fn handle_close_pass_mint(ctx: Context<ClosePassMint>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(!config.pass_mint_ended, SlanaError::MintEnded);
    require!(config.pass_minted > 0, SlanaError::NothingMinted);
    shared::end_pass_mint(config)
}
