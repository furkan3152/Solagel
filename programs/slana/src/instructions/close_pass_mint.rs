use anchor_lang::prelude::*;

use crate::{constants::*, error::SlanaError, instructions::shared, state::Config};

/// Ends the Pass mint for good and captures the trait entropy from the SlotHashes sysvar
/// (see `shared::end_pass_mint`). The mint never reopens afterwards; `reveal_pass` needs it.
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
    /// CHECK: the SlotHashes sysvar (address checked), parsed by `logic::parse_latest_slot_hash`.
    #[account(address = SLOT_HASHES_ID @ SlanaError::BadSlotHashes)]
    pub slot_hashes: UncheckedAccount<'info>,
}

pub fn handle_close_pass_mint(ctx: Context<ClosePassMint>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(!config.pass_mint_ended, SlanaError::MintEnded);
    require!(config.pass_minted > 0, SlanaError::NothingMinted);
    shared::end_pass_mint(config, &ctx.accounts.slot_hashes.to_account_info())
}
