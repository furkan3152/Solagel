use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{
    constants::*,
    core_asset,
    error::SlanaError,
    events::ArenaJoined,
    instructions::shared,
    state::{Arena, Config, PassLock, PlayerProfile, Session},
};

/// Joins a stake arena without a Slana Pass (not allowed in Pass arenas).
#[derive(Accounts)]
pub struct JoinArena<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
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
    /// One open session per player per arena: a second join fails because the PDA exists.
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

/// Joins a stake arena backed by a Slana Pass (lower fee, season points). The Pass is locked
/// by `pass_lock` until the session is settled or refunded.
#[derive(Accounts)]
pub struct JoinArenaWithPass<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
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
    /// CHECK: a Metaplex Core asset, verified by `core_asset::read_core_asset` in the handler
    /// (owned by the Core program, owned by `player`, in `config.pass_collection`).
    pub pass_asset: UncheckedAccount<'info>,
    /// Exists while the Pass backs an open session: a second join with the same Pass fails
    /// with the System Program's "already in use" error (`PassInUse` in the SDK).
    #[account(
        init,
        payer = player,
        space = 8 + PassLock::INIT_SPACE,
        seeds = [PASS_LOCK_SEED, pass_asset.key().as_ref()],
        bump
    )]
    pub pass_lock: Box<Account<'info, PassLock>>,
    pub system_program: Program<'info, System>,
}

pub fn handle_join_arena(ctx: Context<JoinArena>, max_fee_bps: u16) -> Result<()> {
    require!(!ctx.accounts.arena.requires_pass, SlanaError::PassRequired);
    let a = ctx.accounts;
    open_session(
        JoinAccounts {
            player: &a.player,
            config: &mut a.config,
            profile: &mut a.profile,
            arena: &mut a.arena,
            vault: &a.vault,
            session: &mut a.session,
            player_token: &a.player_token,
            token_mint: &a.token_mint,
            token_program: &a.token_program,
        },
        ctx.bumps.session,
        None,
        max_fee_bps,
    )
}

pub fn handle_join_arena_with_pass(
    ctx: Context<JoinArenaWithPass>,
    max_fee_bps: u16,
) -> Result<()> {
    let a = ctx.accounts;
    let asset = core_asset::read_core_asset(&a.pass_asset.to_account_info())?;
    require_keys_eq!(asset.owner, a.player.key(), SlanaError::PassNotOwned);
    let collection = a.config.pass_collection;
    require!(
        collection != Pubkey::default() && asset.collection == Some(collection),
        SlanaError::PassWrongCollection
    );

    let pass_asset = a.pass_asset.key();
    let lock = &mut a.pass_lock;
    lock.session = a.session.key();
    lock.player = a.player.key();
    lock.bump = ctx.bumps.pass_lock;

    open_session(
        JoinAccounts {
            player: &a.player,
            config: &mut a.config,
            profile: &mut a.profile,
            arena: &mut a.arena,
            vault: &a.vault,
            session: &mut a.session,
            player_token: &a.player_token,
            token_mint: &a.token_mint,
            token_program: &a.token_program,
        },
        ctx.bumps.session,
        Some(pass_asset),
        max_fee_bps,
    )
}

/// The accounts both joins share.
struct JoinAccounts<'a, 'info> {
    player: &'a Signer<'info>,
    config: &'a mut Account<'info, Config>,
    profile: &'a mut Account<'info, PlayerProfile>,
    arena: &'a mut Account<'info, Arena>,
    vault: &'a InterfaceAccount<'info, TokenAccount>,
    session: &'a mut Account<'info, Session>,
    player_token: &'a InterfaceAccount<'info, TokenAccount>,
    token_mint: &'a InterfaceAccount<'info, Mint>,
    token_program: &'a Interface<'info, TokenInterface>,
}

/// Checks the arena, takes the entry fee (tokens → vault) and the settle deposit
/// (lamports → session), and fills in the session.
fn open_session(
    a: JoinAccounts,
    session_bump: u8,
    pass_asset: Option<Pubkey>,
    max_fee_bps: u16,
) -> Result<()> {
    require!(!a.config.paused, SlanaError::Paused);
    // The fee on profit fixed into the session: never above what the player was shown.
    let fee_bps = if pass_asset.is_some() {
        a.config.pass_fee_bps
    } else {
        a.config.fee_bps
    };
    require!(fee_bps <= max_fee_bps, SlanaError::FeeAboveLimit);
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

    let config = a.config;
    let session_id = config.total_sessions;
    config.total_sessions = session_id.checked_add(1).ok_or(SlanaError::MathOverflow)?;
    config.total_staked = config
        .total_staked
        .checked_add(entry_fee)
        .ok_or(SlanaError::MathOverflow)?;

    let profile = a.profile;
    profile.stake_games = profile.stake_games.saturating_add(1);
    profile.total_staked = profile
        .total_staked
        .checked_add(entry_fee)
        .ok_or(SlanaError::MathOverflow)?;

    let arena = a.arena;
    arena.open_sessions = arena
        .open_sessions
        .checked_add(1)
        .ok_or(SlanaError::MathOverflow)?;
    arena.total_deposited = arena
        .total_deposited
        .checked_add(entry_fee)
        .ok_or(SlanaError::MathOverflow)?;
    let arena_id = arena.id;

    let session = a.session;
    session.id = session_id;
    session.player = player;
    session.arena = arena_key;
    session.arena_id = arena_id;
    session.entry_fee = entry_fee;
    session.opened_at = now;
    session.has_pass = pass_asset.is_some();
    session.pass_asset = pass_asset.unwrap_or_default();
    session.settle_fee = settle_fee;
    // The fee on profit is fixed now; `settle_session` uses this snapshot, not the config.
    session.fee_bps = fee_bps;
    session.bump = session_bump;

    emit!(ArenaJoined {
        player,
        arena_id,
        session_id,
        entry_fee,
        has_pass: pass_asset.is_some(),
    });
    Ok(())
}
