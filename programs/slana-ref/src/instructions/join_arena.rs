use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{
    constants::*,
    error::SlanaError,
    events::ArenaJoined,
    instructions::shared,
    state::{Arena, Config, PlayerProfile, Session},
};

/// Joins a stake arena: the entry fee moves into the arena vault, the settle deposit into the
/// new session.
#[derive(Accounts)]
pub struct JoinArena<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    /// `TokenNotSet` until `set_token_mint` ran.
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.token_mint != Pubkey::default() @ SlanaError::TokenNotSet
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [PROFILE_SEED, player.key().as_ref()],
        bump = profile.bump
    )]
    pub profile: Box<Account<'info, PlayerProfile>>,
    #[account(
        mut,
        seeds = [ARENA_SEED, arena.id.to_le_bytes().as_ref()],
        bump = arena.bump
    )]
    pub arena: Box<Account<'info, Arena>>,
    #[account(
        mut,
        seeds = [VAULT_SEED, arena.key().as_ref()],
        bump = arena.vault_bump
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// One open session per player per arena: a second join fails because the PDA exists
    /// (also while a finalized session waits for its payout to be collected).
    #[account(
        init,
        payer = player,
        space = 8 + Session::INIT_SPACE,
        seeds = [SESSION_SEED, arena.key().as_ref(), player.key().as_ref()],
        bump
    )]
    pub session: Box<Account<'info, Session>>,
    #[account(
        mut,
        token::mint = token_mint,
        token::authority = player,
        token::token_program = token_program
    )]
    pub player_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.token_mint)]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = config.token_program)]
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// What the player was shown and signed: the join fails rather than charge more.
#[derive(Clone, Copy)]
pub struct JoinLimits {
    /// Fee on profit, basis points (`FeeAboveLimit`).
    pub max_fee_bps: u16,
    /// Entry fee in game-token base units (`EntryFeeAboveLimit`).
    pub max_entry_fee: u64,
    /// Settle deposit in lamports (`SettleFeeAboveLimit`).
    pub max_settle_fee: u64,
}

/// Checks the arena, takes the entry fee (tokens → vault) and the settle deposit
/// (lamports → session), and fills in the session.
pub fn handle_join_arena(ctx: Context<JoinArena>, limits: JoinLimits) -> Result<()> {
    let a = ctx.accounts;
    require!(!a.config.paused, SlanaError::Paused);
    // The fee on profit fixed into the session: never above what the player was shown.
    let fee_bps = a.config.fee_bps;
    require!(fee_bps <= limits.max_fee_bps, SlanaError::FeeAboveLimit);
    require!(
        a.arena.entry_fee <= limits.max_entry_fee,
        SlanaError::EntryFeeAboveLimit
    );
    require!(
        a.config.settle_fee_lamports <= limits.max_settle_fee,
        SlanaError::SettleFeeAboveLimit
    );
    require!(a.arena.enabled, SlanaError::ArenaDisabled);
    require!(
        a.arena.open_sessions < a.arena.max_sessions,
        SlanaError::ArenaFull
    );

    let entry_fee = a.arena.entry_fee;
    token_interface::transfer_checked(
        CpiContext::new(
            a.token_program.key(),
            TransferChecked {
                from: a.player_token.to_account_info(),
                mint: a.token_mint.to_account_info(),
                to: a.vault.to_account_info(),
                authority: a.player.to_account_info(),
            },
        ),
        entry_fee,
        a.token_mint.decimals,
    )?;

    let settle_fee = a.config.settle_fee_lamports;
    shared::transfer_from_wallet(
        &a.player.to_account_info(),
        &a.session.to_account_info(),
        settle_fee,
    )?;

    let now = Clock::get()?.unix_timestamp;
    let player = a.player.key();
    let arena_key = a.arena.key();

    let config = &mut a.config;
    let session_id = config.total_sessions;
    config.total_sessions = session_id.checked_add(1).ok_or(SlanaError::MathOverflow)?;
    config.total_staked = config
        .total_staked
        .checked_add(entry_fee)
        .ok_or(SlanaError::MathOverflow)?;

    let profile = &mut a.profile;
    profile.stake_games = profile.stake_games.saturating_add(1);
    profile.total_staked = profile
        .total_staked
        .checked_add(entry_fee)
        .ok_or(SlanaError::MathOverflow)?;

    let arena = &mut a.arena;
    arena.open_sessions = arena
        .open_sessions
        .checked_add(1)
        .ok_or(SlanaError::MathOverflow)?;
    arena.total_deposited = arena
        .total_deposited
        .checked_add(entry_fee)
        .ok_or(SlanaError::MathOverflow)?;
    let arena_id = arena.id;

    let session = &mut a.session;
    session.id = session_id;
    session.player = player;
    session.arena = arena_key;
    session.arena_id = arena_id;
    session.entry_fee = entry_fee;
    session.opened_at = now;
    session.settle_fee = settle_fee;
    // The fee on profit is fixed now; `settle_session` uses this snapshot, not the config.
    session.fee_bps = fee_bps;
    session.bump = ctx.bumps.session;
    session.finalized = false;
    session.owed = 0;

    emit!(ArenaJoined {
        player,
        arena_id,
        session_id,
        entry_fee,
    });
    Ok(())
}
