use anchor_lang::prelude::*;

use crate::{constants::*, error::SlanaError, events::PassRevealed, logic, state::Config};

/// Publishes the Pass trait seed: `sha256(seed)` must equal the committed `pass_seed_hash`.
/// Once only, and only after the mint ended (`close_pass_mint` or sold out), which captured
/// `pass_entropy`. Stores `pass_final_seed = sha256(seed || pass_entropy)`, the seed every
/// trait is derived from: the admin knows `seed` during the mint but not the entropy, so
/// nobody can pick a Pass number knowing its traits.
#[derive(Accounts)]
pub struct RevealPass<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ SlanaError::Unauthorized
    )]
    pub config: Box<Account<'info, Config>>,
}

pub fn handle_reveal_pass(ctx: Context<RevealPass>, seed: [u8; 32]) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(!config.pass_revealed, SlanaError::AlreadyRevealed);
    require!(config.pass_seed_hash != [0u8; 32], SlanaError::SeedNotSet);
    require!(config.pass_mint_ended, SlanaError::MintStillOpen);
    require!(
        solana_sha256_hasher::hash(&seed).to_bytes() == config.pass_seed_hash,
        SlanaError::SeedMismatch
    );
    let final_seed = logic::pass_final_seed(&seed, &config.pass_entropy);
    config.pass_seed = seed;
    config.pass_final_seed = final_seed;
    config.pass_revealed = true;

    emit!(PassRevealed {
        seed,
        entropy: config.pass_entropy,
        final_seed,
    });
    Ok(())
}
