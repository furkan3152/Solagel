use anchor_lang::{prelude::*, solana_program::bpf_loader_upgradeable};

use crate::{
    constants::*,
    error::SlanaError,
    program::Slana,
    state::{Config, Season},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializeArgs {
    pub server_authority: Pubkey,
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub season_share_bps: u16,
    pub skin_price: u64,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Must be the program's upgrade authority (prevents front-running `initialize`).
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = admin,
        space = 8 + Season::INIT_SPACE,
        seeds = [SEASON_SEED, FIRST_SEASON.to_le_bytes().as_ref()],
        bump
    )]
    pub season: Box<Account<'info, Season>>,
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
            @ SlanaError::Unauthorized
    )]
    pub program: Program<'info, Slana>,
    /// The program's ProgramData account (PDA of the upgradeable loader, seeds `[program_id]`).
    #[account(
        seeds = [crate::ID.as_ref()],
        bump,
        seeds::program = bpf_loader_upgradeable::ID,
        constraint = program_data.upgrade_authority_address == Some(admin.key())
            @ SlanaError::Unauthorized
    )]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
    require!(args.fee_bps <= MAX_FEE_BPS, SlanaError::InvalidFee);
    require!(args.season_share_bps <= BPS, SlanaError::InvalidFee);
    let now = Clock::get()?.unix_timestamp;

    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.server_authority = args.server_authority;
    config.treasury = args.treasury;
    config.fee_bps = args.fee_bps;
    config.season_share_bps = args.season_share_bps;
    config.skin_price = args.skin_price;
    config.current_season = FIRST_SEASON;
    config.paused = false;
    config.bump = ctx.bumps.config;

    let season = &mut ctx.accounts.season;
    season.id = FIRST_SEASON;
    season.started_at = now;
    season.bump = ctx.bumps.season;

    msg!("Slana initialized");
    Ok(())
}
