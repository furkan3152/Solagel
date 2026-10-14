use anchor_lang::prelude::*;

use crate::{constants::*, error::SlanaError, state::Config};

/// Every `Some` field replaces the stored value; `None` keeps it.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct UpdateConfigArgs {
    pub admin: Option<Pubkey>,
    pub server_authority: Option<Pubkey>,
    pub treasury: Option<Pubkey>,
    pub fee_bps: Option<u16>,
    pub season_share_bps: Option<u16>,
    pub skin_price: Option<u64>,
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
    pub config: Account<'info, Config>,
}

pub fn handle_update_config(ctx: Context<UpdateConfig>, args: UpdateConfigArgs) -> Result<()> {
    let config = &mut ctx.accounts.config;

    if let Some(fee_bps) = args.fee_bps {
        require!(fee_bps <= MAX_FEE_BPS, SlanaError::InvalidFee);
        config.fee_bps = fee_bps;
    }
    if let Some(season_share_bps) = args.season_share_bps {
        require!(season_share_bps <= BPS, SlanaError::InvalidFee);
        config.season_share_bps = season_share_bps;
    }
    if let Some(admin) = args.admin {
        config.admin = admin;
    }
    if let Some(server_authority) = args.server_authority {
        config.server_authority = server_authority;
    }
    if let Some(treasury) = args.treasury {
        config.treasury = treasury;
    }
    if let Some(skin_price) = args.skin_price {
        config.skin_price = skin_price;
    }
    if let Some(paused) = args.paused {
        config.paused = paused;
    }
    Ok(())
}
