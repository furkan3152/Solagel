use anchor_lang::{prelude::*, solana_program::bpf_loader_upgradeable};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    constants::*,
    error::SlanaError,
    instructions::shared,
    program::Slana,
    state::{Config, Season},
    token,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializeArgs {
    pub server_authority: Pubkey,
    pub fee_bps: u16,
    pub pass_fee_bps: u16,
    pub treasury_bps: u16,
    pub season_bps: u16,
    pub burn_bps: u16,
    pub settle_fee_lamports: u64,
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
    pub config: Box<Account<'info, Config>>,
    #[account(
        init,
        payer = admin,
        space = 8 + Season::INIT_SPACE,
        seeds = [SEASON_SEED, FIRST_SEASON.to_le_bytes().as_ref()],
        bump
    )]
    pub season: Box<Account<'info, Season>>,
    /// The game token. Validated by `token::validate_mint` (no freeze authority, no
    /// forbidden Token-2022 extension) and stored in the config for good.
    #[account(mint::token_program = token_program)]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
    #[account(
        init,
        payer = admin,
        seeds = [TREASURY_VAULT_SEED],
        bump,
        token::mint = token_mint,
        token::authority = config,
        token::token_program = token_program
    )]
    pub treasury_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = admin,
        seeds = [SEASON_VAULT_SEED],
        bump,
        token::mint = token_mint,
        token::authority = config,
        token::token_program = token_program
    )]
    pub season_vault: Box<InterfaceAccount<'info, TokenAccount>>,
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
    shared::check_fees(args.fee_bps, args.pass_fee_bps)?;
    shared::check_split(args.treasury_bps, args.season_bps, args.burn_bps)?;
    shared::check_settle_fee(args.settle_fee_lamports)?;
    let token_program = ctx.accounts.token_program.key();
    let decimals =
        token::validate_mint(&ctx.accounts.token_mint.to_account_info(), &token_program)?;
    let now = Clock::get()?.unix_timestamp;

    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.server_authority = args.server_authority;
    config.token_mint = ctx.accounts.token_mint.key();
    config.token_program = token_program;
    config.token_decimals = decimals;
    config.fee_bps = args.fee_bps;
    config.pass_fee_bps = args.pass_fee_bps;
    config.treasury_bps = args.treasury_bps;
    config.season_bps = args.season_bps;
    config.burn_bps = args.burn_bps;
    config.settle_fee_lamports = args.settle_fee_lamports;
    config.current_season = FIRST_SEASON;
    config.paused = false;
    config.pass_collection = Pubkey::default();
    config.pass_supply = DEFAULT_PASS_SUPPLY;
    config.pass_per_wallet = DEFAULT_PASS_PER_WALLET;
    config.bump = ctx.bumps.config;
    config.treasury_vault_bump = ctx.bumps.treasury_vault;
    config.season_vault_bump = ctx.bumps.season_vault;

    let season = &mut ctx.accounts.season;
    season.id = FIRST_SEASON;
    season.started_at = now;
    season.bump = ctx.bumps.season;

    msg!("Slana initialized");
    Ok(())
}
