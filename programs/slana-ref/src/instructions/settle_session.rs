use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    constants::*,
    error::SlanaError,
    events::SessionSettled,
    logic,
    state::{Arena, Config, PlayerProfile, Session},
    token,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SettleArgs {
    /// `Session::id` the server is settling. Session PDAs are reused when a player joins
    /// the same arena again, so this stops a delayed/retried settlement of an old session
    /// from being applied to a newer one at the same address.
    pub session_id: u64,
    /// Game-token base units the player cashed out with (taken from the arena vault, before
    /// the fee on profit).
    pub payout: u64,
    pub score: u32,
    pub kills: u16,
    pub xp: u32,
}

/// Server-signed settlement. Works while the program is paused: players must always be able to
/// get paid.
#[derive(Accounts)]
pub struct SettleSession<'info> {
    /// Receives the session's settle deposit.
    #[account(
        mut,
        constraint = server.key() == config.server_authority @ SlanaError::Unauthorized
    )]
    pub server: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
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
    /// Closed back to the player when the payout is paid in this transaction; kept open
    /// (finalized, with `owed`) when `player_token` is absent.
    #[account(
        mut,
        seeds = [SESSION_SEED, arena.key().as_ref(), player.key().as_ref()],
        bump = session.bump,
        has_one = player @ SlanaError::Unauthorized,
        has_one = arena @ SlanaError::Unauthorized
    )]
    pub session: Box<Account<'info, Session>>,
    /// CHECK: the session's player (enforced by `has_one`); receives the session rent.
    #[account(mut)]
    pub player: UncheckedAccount<'info>,
    /// Any token account of the game mint owned by the player (the player creates and pays
    /// for it; the server never does). Optional (R24): without it, or when the player
    /// made it unable to receive, the server settles anyway and the session is finalized with
    /// `owed`, which the player collects with `refund_session`. So a player can delay their
    /// own payout but never block the game result.
    #[account(
        mut,
        token::mint = token_mint,
        token::authority = player,
        token::token_program = token_program
    )]
    pub player_token: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    #[account(
        mut,
        seeds = [PROFILE_SEED, player.key().as_ref()],
        bump = profile.bump
    )]
    pub profile: Box<Account<'info, PlayerProfile>>,
    /// Receives the fee: any token account of the game mint owned by `config.fee_wallet`
    /// (not necessarily its associated token account). Required even when the fee is 0.
    #[account(
        mut,
        token::mint = token_mint,
        token::authority = config.fee_wallet,
        token::token_program = token_program
    )]
    pub fee_wallet_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.token_mint)]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = config.token_program)]
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_settle_session(ctx: Context<SettleSession>, args: SettleArgs) -> Result<()> {
    let a = &mut *ctx.accounts;
    require_eq!(a.session.id, args.session_id, SlanaError::SessionMismatch);
    require!(!a.session.finalized, SlanaError::SessionFinalized);
    require_gte!(a.vault.amount, args.payout, SlanaError::InsufficientPot);
    let now = Clock::get()?.unix_timestamp;

    // The fee fixed at join (a later `update_config` never changes an open session's fee).
    let split = logic::split_payout(args.payout, a.session.entry_fee, a.session.fee_bps)?;

    // The player share is paid now when there is a token account to pay into, or nothing to
    // pay. Otherwise it stays in the vault as `owed` (R24).
    let pay_now = a.player_token.is_some() || split.player == 0;
    let owed = if pay_now { 0 } else { split.player };

    // Tokens out of the arena vault, signed by the arena PDA. Neither receiving account can
    // alias the vault: Anchor's duplicate-mutable check refuses the same key twice.
    let arena_id_bytes = a.arena.id.to_le_bytes();
    let arena_seeds: &[&[u8]] = &[ARENA_SEED, &arena_id_bytes, &[a.arena.bump]];
    let program = a.token_program.to_account_info();
    let vault = a.vault.to_account_info();
    let mint = a.token_mint.to_account_info();
    let arena_info = a.arena.to_account_info();
    let decimals = a.config.token_decimals;
    let mut transfers = vec![(a.fee_wallet_token.to_account_info(), split.fee)];
    if let Some(player_token) = a.player_token.as_ref() {
        transfers.push((player_token.to_account_info(), split.player));
    }
    for (to, amount) in transfers {
        token::transfer_from_pda(
            &program,
            &vault,
            &mint,
            &to,
            &arena_info,
            &[arena_seeds],
            amount,
            decimals,
        )?;
    }

    // The settle deposit pays the server either way.
    let settle_fee = a.session.settle_fee;
    a.session.sub_lamports(settle_fee)?;
    a.server.add_lamports(settle_fee)?;

    // `total_paid_out` counts what actually left the vault; the owed share is counted when
    // the player collects it.
    let left_vault = args
        .payout
        .checked_sub(owed)
        .ok_or(SlanaError::MathOverflow)?;
    let arena = &mut a.arena;
    if pay_now {
        arena.open_sessions = arena.open_sessions.saturating_sub(1);
    }
    arena.total_paid_out = arena
        .total_paid_out
        .checked_add(left_vault)
        .ok_or(SlanaError::MathOverflow)?;

    let config = &mut a.config;
    config.total_games = config
        .total_games
        .checked_add(1)
        .ok_or(SlanaError::MathOverflow)?;
    config.total_paid_out = config
        .total_paid_out
        .checked_add(left_vault)
        .ok_or(SlanaError::MathOverflow)?;

    let profile = &mut a.profile;
    profile.total_won = profile
        .total_won
        .checked_add(split.player)
        .ok_or(SlanaError::MathOverflow)?;
    let result = logic::apply_game(profile, args.score, args.kills, args.xp, now);

    emit!(SessionSettled {
        player: a.session.player,
        arena_id: a.session.arena_id,
        session_id: a.session.id,
        payout: args.payout,
        fee: split.fee,
        score: result.score,
        kills: result.kills,
        owed,
    });

    if pay_now {
        // Paid: the session's rent goes back to the player.
        a.session.close(a.player.to_account_info())?;
    } else {
        // Finalized: the session stays open until the player collects `owed`.
        a.session.finalized = true;
        a.session.owed = owed;
    }
    Ok(())
}
