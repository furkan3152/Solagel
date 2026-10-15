use anchor_lang::prelude::*;

use crate::{constants::*, error::SlanaError, state::Config};

/// Commits `sha256(seed)` of the Pass trait seed. May be changed until the first Pass is
/// minted (`SeedLocked`) and never after the reveal (`AlreadyRevealed`).
#[derive(Accounts)]
pub struct SetPassSeedHash<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ SlanaError::Unauthorized
    )]
    pub config: Box<Account<'info, Config>>,
}

pub fn handle_set_pass_seed_hash(ctx: Context<SetPassSeedHash>, hash: [u8; 32]) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(
        !config.pass_revealed && !config.pass_seed_revealed,
        SlanaError::AlreadyRevealed
    );
    require!(config.pass_minted == 0, SlanaError::SeedLocked);
    config.pass_seed_hash = hash;
    Ok(())
}
