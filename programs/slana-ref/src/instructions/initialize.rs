use anchor_lang::{prelude::*, solana_program::bpf_loader_upgradeable};

use crate::{constants::*, error::SlanaError, instructions::shared, program::Slana, state::Config};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializeArgs {
    /// Fee on stake profit in basis points (≤ `MAX_FEE_BPS`).
    pub fee_bps: u16,
    /// Settle deposit per session in lamports (≤ `MAX_SETTLE_FEE_LAMPORTS`).
    pub settle_fee_lamports: u64,
    /// Game server key (not the default key).
    pub server_authority: Pubkey,
    /// Owner of the token account that receives the fees (not the default key).
    pub fee_wallet: Pubkey,
}

/// Creates the config without a token: `token_mint` / `token_program` stay the default key
/// and `token_decimals` 0 until `set_token_mint`.
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
    shared::check_fee(args.fee_bps)?;
    shared::check_settle_fee(args.settle_fee_lamports)?;
    shared::check_authority(&args.server_authority)?;
    shared::check_authority(&args.fee_wallet)?;

    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.server_authority = args.server_authority;
    config.fee_wallet = args.fee_wallet;
    config.token_mint = Pubkey::default();
    config.token_program = Pubkey::default();
    config.token_decimals = 0;
    config.fee_bps = args.fee_bps;
    config.settle_fee_lamports = args.settle_fee_lamports;
    config.paused = false;
    config.bump = ctx.bumps.config;

    msg!("Slana initialized");
    Ok(())
}
