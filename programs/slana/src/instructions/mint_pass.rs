use anchor_lang::{prelude::*, solana_program::program::invoke_signed};
use anchor_spl::token_interface::TokenAccount;

use crate::{
    constants::*,
    core_cpi,
    error::SlanaError,
    events::PassMinted,
    state::{Config, MintCounter},
};

/// Free mint of a Slana Pass: creates a Metaplex Core asset owned by the minter in the Pass
/// collection (signed by the `pass_authority` PDA). The minter pays rent and fees only.
#[derive(Accounts)]
pub struct MintPass<'info> {
    #[account(mut)]
    pub minter: Signer<'info>,
    /// The new Core asset (a fresh keypair).
    #[account(mut)]
    pub asset: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: must be `config.pass_collection` (checked by the handler, after
    /// `CollectionNotSet`); Core validates its contents during the CPI.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: data-less signer PDA, update authority of the Pass collection.
    #[account(seeds = [PASS_AUTHORITY_SEED], bump)]
    pub pass_authority: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = minter,
        space = 8 + MintCounter::INIT_SPACE,
        seeds = [PASS_MINTED_SEED, minter.key().as_ref()],
        bump
    )]
    pub mint_counter: Box<Account<'info, MintCounter>>,
    /// Game-token account of the minter; only needed when `config.pass_min_tokens > 0`.
    pub minter_token: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    /// CHECK: the Metaplex Core program.
    #[account(address = MPL_CORE_ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_mint_pass(ctx: Context<MintPass>) -> Result<()> {
    let a = &mut *ctx.accounts;
    let config = &a.config;

    // 1. Collection set (and this is it).
    require_keys_neq!(
        config.pass_collection,
        Pubkey::default(),
        SlanaError::CollectionNotSet
    );
    require_keys_eq!(
        a.collection.key(),
        config.pass_collection,
        SlanaError::BadCollection
    );
    // 2. Trait seed committed.
    require!(config.pass_seed_hash != [0u8; 32], SlanaError::SeedNotSet);
    // 3. Mint open (and never again after the trait seed is revealed).
    let now = Clock::get()?.unix_timestamp;
    require!(
        config.pass_mint_open && now >= config.pass_mint_start_ts && !config.pass_revealed,
        SlanaError::MintClosed
    );
    // 4. Supply left.
    require!(
        config.pass_minted < config.pass_supply,
        SlanaError::MintSoldOut
    );
    // 5. Per-wallet limit.
    require!(
        a.mint_counter.count < config.pass_per_wallet,
        SlanaError::MintLimit
    );
    // 6. Minimum game-token balance.
    if config.pass_min_tokens > 0 {
        let minter = a.minter.key();
        let holds_enough = a.minter_token.as_ref().is_some_and(|t| {
            t.owner == minter && t.mint == config.token_mint && t.amount >= config.pass_min_tokens
        });
        require!(holds_enough, SlanaError::MintMinTokens);
    }

    let number = config
        .pass_minted
        .checked_add(1)
        .ok_or(SlanaError::MathOverflow)?;
    require!(config.pass_base_uri_len > 0, SlanaError::BadBaseUri);
    let name = format!("Slana Pass #{number}");
    let base_uri = &config.pass_base_uri[..usize::from(config.pass_base_uri_len)];
    let mut uri = Vec::with_capacity(base_uri.len() + 15);
    uri.extend_from_slice(base_uri);
    uri.extend_from_slice(format!("{number}.json").as_bytes());

    let ix = core_cpi::create_v2_in_collection(
        &a.asset.key(),
        &a.collection.key(),
        &a.pass_authority.key(),
        &a.minter.key(),
        &a.minter.key(),
        name.as_bytes(),
        &uri,
    );
    let seeds: &[&[u8]] = &[PASS_AUTHORITY_SEED, &[ctx.bumps.pass_authority]];
    invoke_signed(
        &ix,
        &[
            a.asset.to_account_info(),
            a.collection.to_account_info(),
            a.pass_authority.to_account_info(),
            a.minter.to_account_info(),
            a.mpl_core_program.to_account_info(),
            a.system_program.to_account_info(),
        ],
        &[seeds],
    )?;

    a.config.pass_minted = number;
    let counter = &mut a.mint_counter;
    counter.count = counter
        .count
        .checked_add(1)
        .ok_or(SlanaError::MathOverflow)?;
    counter.bump = ctx.bumps.mint_counter;

    emit!(PassMinted {
        minter: a.minter.key(),
        asset: a.asset.key(),
        number,
    });
    Ok(())
}
