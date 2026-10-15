use anchor_lang::prelude::*;

use crate::{constants::*, error::SlanaError, instructions::shared, state::Config};

/// Every `Some` field replaces the stored value; `None` keeps it. The token mint is fixed
/// at `initialize` and cannot be changed.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct UpdateConfigArgs {
    pub admin: Option<Pubkey>,
    pub server_authority: Option<Pubkey>,
    pub fee_bps: Option<u16>,
    pub pass_fee_bps: Option<u16>,
    /// `[treasury_bps, season_bps, burn_bps]`, must sum to `BPS`. (An array rather than a
    /// tuple because the Anchor IDL has no tuple type; the Borsh encoding is identical.)
    pub split: Option<[u16; 3]>,
    pub settle_fee_lamports: Option<u64>,
    pub paused: Option<bool>,
    /// At most `MAX_BASE_URI_LEN` bytes, ends with `/`; frozen once the first Pass is minted.
    pub pass_base_uri: Option<String>,
    /// `1..=MAX_PASS_SUPPLY`; frozen once the mint has opened (`SupplyLocked`).
    pub pass_supply: Option<u32>,
    /// `1..=MAX_PASS_PER_WALLET`.
    pub pass_per_wallet: Option<u8>,
    pub pass_min_tokens: Option<u64>,
    /// `true` opens the mint (never after it ended). `false` closes it only while no Pass is
    /// minted; a started mint ends with `close_pass_mint` (`UseCloseMint`).
    pub pass_mint_open: Option<bool>,
    pub pass_mint_start_ts: Option<i64>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ SlanaError::Unauthorized
    )]
    pub config: Box<Account<'info, Config>>,
}

pub fn handle_update_config(ctx: Context<UpdateConfig>, args: UpdateConfigArgs) -> Result<()> {
    let config = &mut ctx.accounts.config;

    if args.fee_bps.is_some() || args.pass_fee_bps.is_some() {
        let fee_bps = args.fee_bps.unwrap_or(config.fee_bps);
        let pass_fee_bps = args.pass_fee_bps.unwrap_or(config.pass_fee_bps);
        shared::check_fees(fee_bps, pass_fee_bps)?;
        config.fee_bps = fee_bps;
        config.pass_fee_bps = pass_fee_bps;
    }
    if let Some([treasury_bps, season_bps, burn_bps]) = args.split {
        shared::check_split(treasury_bps, season_bps, burn_bps)?;
        config.treasury_bps = treasury_bps;
        config.season_bps = season_bps;
        config.burn_bps = burn_bps;
    }
    if let Some(settle_fee_lamports) = args.settle_fee_lamports {
        shared::check_settle_fee(settle_fee_lamports)?;
        config.settle_fee_lamports = settle_fee_lamports;
    }
    if let Some(admin) = args.admin {
        config.admin = admin;
    }
    if let Some(server_authority) = args.server_authority {
        config.server_authority = server_authority;
    }
    if let Some(paused) = args.paused {
        config.paused = paused;
    }

    if let Some(uri) = args.pass_base_uri {
        // Metadata URIs of minted Passes are derived from it, so it is frozen after a mint.
        require!(config.pass_minted == 0, SlanaError::BadBaseUri);
        let bytes = uri.as_bytes();
        require!(bytes.len() <= BASE_URI_BYTES, SlanaError::BadBaseUri);
        require!(!uri.chars().any(char::is_control), SlanaError::BadBaseUri);
        // `mint_pass` appends `<n>.json`.
        require!(uri.ends_with('/'), SlanaError::BadBaseUri);
        let mut stored = [0u8; BASE_URI_BYTES];
        stored[..bytes.len()].copy_from_slice(bytes);
        config.pass_base_uri = stored;
        // Cannot truncate: bytes.len() <= 96.
        config.pass_base_uri_len = bytes.len() as u8;
    }
    if let Some(pass_supply) = args.pass_supply {
        // Trait rarity depends on the supply: it is fixed for good once anyone could mint.
        require!(
            !config.pass_mint_opened && config.pass_minted == 0,
            SlanaError::SupplyLocked
        );
        require!(
            (1..=MAX_PASS_SUPPLY).contains(&pass_supply),
            SlanaError::InvalidAmount
        );
        config.pass_supply = pass_supply;
    }
    if let Some(pass_per_wallet) = args.pass_per_wallet {
        require!(
            (1..=MAX_PASS_PER_WALLET).contains(&pass_per_wallet),
            SlanaError::InvalidAmount
        );
        config.pass_per_wallet = pass_per_wallet;
    }
    if let Some(pass_min_tokens) = args.pass_min_tokens {
        config.pass_min_tokens = pass_min_tokens;
    }
    if let Some(pass_mint_open) = args.pass_mint_open {
        if pass_mint_open {
            // The trait seed is public after the reveal, so the mint must stay closed.
            require!(
                !config.pass_revealed && !config.pass_seed_revealed,
                SlanaError::AlreadyRevealed
            );
            // The entropy is known once the mint ended: reopening would let anyone pick traits.
            require!(!config.pass_mint_ended, SlanaError::MintEnded);
            config.pass_mint_opened = true;
        } else if config.pass_mint_open {
            // Closing a started mint must capture the entropy (`close_pass_mint`).
            require!(config.pass_minted == 0, SlanaError::UseCloseMint);
        }
        config.pass_mint_open = pass_mint_open;
    }
    if let Some(pass_mint_start_ts) = args.pass_mint_start_ts {
        config.pass_mint_start_ts = pass_mint_start_ts;
    }
    Ok(())
}
