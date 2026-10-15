use anchor_lang::prelude::*;

use crate::{constants::*, error::SlanaError, events::PassSeedRevealed, state::Config};

/// Publishes the Pass trait seed (ruling R23): after the mint ended, `sha256(seed)` must equal
/// the committed `pass_seed_hash`. Stores the seed publicly and only then sets
/// `pass_entropy_target_slot = slot + ENTROPY_DELAY_SLOTS`. Once only.
///
/// Because the seed is public before the target slot exists, everybody can compute the
/// outcome at the same moment the target's hash appears; the permissionless
/// `capture_pass_entropy` then stores it and the final seed.
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
    require!(
        !config.pass_seed_revealed && !config.pass_revealed,
        SlanaError::AlreadyRevealed
    );
    require!(config.pass_seed_hash != [0u8; 32], SlanaError::SeedNotSet);
    require!(config.pass_mint_ended, SlanaError::MintStillOpen);
    require!(
        solana_sha256_hasher::hash(&seed).to_bytes() == config.pass_seed_hash,
        SlanaError::SeedMismatch
    );
    let target = Clock::get()?
        .slot
        .checked_add(ENTROPY_DELAY_SLOTS)
        .ok_or(SlanaError::MathOverflow)?;
    config.pass_seed = seed;
    config.pass_seed_revealed = true;
    config.pass_entropy_target_slot = target;

    emit!(PassSeedRevealed {
        seed,
        entropy_target_slot: target,
    });
    Ok(())
}
