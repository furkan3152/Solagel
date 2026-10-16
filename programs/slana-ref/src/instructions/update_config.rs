use anchor_lang::prelude::*;

use crate::{constants::*, error::SlanaError, instructions::shared, state::Config};

/// Every `Some` field replaces the stored value; `None` keeps it. The token mint is set
/// with `set_token_mint` and cannot be changed here.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct UpdateConfigArgs {
    pub admin: Option<Pubkey>,
    pub server_authority: Option<Pubkey>,
    pub fee_wallet: Option<Pubkey>,
    /// ≤ `MAX_FEE_BPS`. Open sessions keep the rate fixed at their join.
    pub fee_bps: Option<u16>,
    pub settle_fee_lamports: Option<u64>,
    pub paused: Option<bool>,
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

    if let Some(fee_bps) = args.fee_bps {
        shared::check_fee(fee_bps)?;
        config.fee_bps = fee_bps;
    }
    if let Some(settle_fee_lamports) = args.settle_fee_lamports {
        shared::check_settle_fee(settle_fee_lamports)?;
        config.settle_fee_lamports = settle_fee_lamports;
    }
    if let Some(admin) = args.admin {
        shared::check_authority(&admin)?;
        config.admin = admin;
    }
    if let Some(server_authority) = args.server_authority {
        shared::check_authority(&server_authority)?;
        config.server_authority = server_authority;
    }
    if let Some(fee_wallet) = args.fee_wallet {
        shared::check_authority(&fee_wallet)?;
        config.fee_wallet = fee_wallet;
    }
    if let Some(paused) = args.paused {
        config.paused = paused;
    }
    Ok(())
}
