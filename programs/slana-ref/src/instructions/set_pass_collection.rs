use anchor_lang::prelude::*;

use crate::{
    constants::*, core_asset, error::SlanaError, events::PassCollectionSet, state::Config,
};

/// Sets the Slana Pass collection, once. The collection must be a Metaplex Core collection
/// whose update authority is the program's `pass_authority` PDA, so only `mint_pass` can add
/// assets to it.
#[derive(Accounts)]
pub struct SetPassCollection<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ SlanaError::Unauthorized
    )]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: parsed as a Core `CollectionV1` (owner program and key checked) by the handler.
    pub collection: UncheckedAccount<'info>,
    /// CHECK: data-less signer PDA; only its address is used.
    #[account(seeds = [PASS_AUTHORITY_SEED], bump)]
    pub pass_authority: UncheckedAccount<'info>,
}

pub fn handle_set_pass_collection(ctx: Context<SetPassCollection>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require_keys_eq!(
        config.pass_collection,
        Pubkey::default(),
        SlanaError::CollectionAlreadySet
    );
    let update_authority = core_asset::read_core_collection(&ctx.accounts.collection)?;
    require_keys_eq!(
        update_authority,
        ctx.accounts.pass_authority.key(),
        SlanaError::BadCollection
    );
    let collection = ctx.accounts.collection.key();
    config.pass_collection = collection;

    emit!(PassCollectionSet { collection });
    Ok(())
}
