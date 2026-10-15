use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    constants::*,
    error::SlanaError,
    events::ArenaCreated,
    instructions::shared,
    state::{Arena, Config},
};

#[derive(Accounts)]
#[instruction(id: u16)]
pub struct CreateArena<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ SlanaError::Unauthorized
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(
        init,
        payer = admin,
        space = 8 + Arena::INIT_SPACE,
        seeds = [ARENA_SEED, id.to_le_bytes().as_ref()],
        bump
    )]
    pub arena: Box<Account<'info, Arena>>,
    /// The arena's token vault: holds every entry fee, signed for by the arena PDA.
    #[account(
        init,
        payer = admin,
        seeds = [VAULT_SEED, arena.key().as_ref()],
        bump,
        token::mint = token_mint,
        token::authority = arena,
        token::token_program = token_program
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.token_mint)]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = config.token_program)]
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_arena(
    ctx: Context<CreateArena>,
    id: u16,
    entry_fee: u64,
    max_sessions: u16,
    requires_pass: bool,
) -> Result<()> {
    shared::check_entry_fee(entry_fee)?;
    shared::check_max_sessions(max_sessions)?;

    let vault = ctx.accounts.vault.key();
    let arena = &mut ctx.accounts.arena;
    arena.id = id;
    arena.entry_fee = entry_fee;
    arena.requires_pass = requires_pass;
    arena.max_sessions = max_sessions;
    arena.open_sessions = 0;
    arena.enabled = true;
    arena.vault = vault;
    arena.vault_bump = ctx.bumps.vault;
    arena.total_deposited = 0;
    arena.total_paid_out = 0;
    arena.bump = ctx.bumps.arena;

    emit!(ArenaCreated {
        arena_id: id,
        entry_fee,
        max_sessions,
        requires_pass,
    });
    Ok(())
}
