use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::SolagelError,
    events::SessionSettled,
    instructions::shared,
    logic,
    state::{Arena, Config, PlayerProfile, Season, Session},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SettleArgs {
    /// `Session::id` the server is settling. Session PDAs are reused when a player joins
    /// the same arena again, so this stops a delayed/retried settlement of an old session
    /// from being applied to a newer one at the same address.
    pub session_id: u64,
    /// Lamports the player cashed out with (taken from the arena pot).
    pub payout: u64,
    pub score: u32,
    pub kills: u16,
    pub xp: u32,
}

/// Works while the program is paused: players must always be able to get paid.
#[derive(Accounts)]
pub struct SettleSession<'info> {
    #[account(
        constraint = server.key() == config.server_authority @ SolagelError::Unauthorized
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
        close = player,
        seeds = [SESSION_SEED, arena.key().as_ref(), player.key().as_ref()],
        bump = session.bump,
        has_one = player @ SolagelError::Unauthorized,
        has_one = arena @ SolagelError::Unauthorized
    )]
    pub session: Box<Account<'info, Session>>,
    /// CHECK: the session's player (enforced by `has_one`); receives the payout and the session rent.
    #[account(mut)]
    pub player: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [PROFILE_SEED, player.key().as_ref()],
        bump = profile.bump
    )]
    pub profile: Box<Account<'info, PlayerProfile>>,
    #[account(
        mut,
        seeds = [SEASON_SEED, config.current_season.to_le_bytes().as_ref()],
        bump = season.bump
    )]
    pub season: Box<Account<'info, Season>>,
    /// CHECK: must equal `config.treasury`; only receives lamports. `dup`: may be the player.
    #[account(mut, dup, address = config.treasury @ SolagelError::Unauthorized)]
    pub treasury: UncheckedAccount<'info>,
}

pub fn handle_settle_session(ctx: Context<SettleSession>, args: SettleArgs) -> Result<()> {
    let accounts = &mut *ctx.accounts;
    require_eq!(
        accounts.session.id,
        args.session_id,
        SolagelError::SessionMismatch
    );
    let now = Clock::get()?.unix_timestamp;

    let arena_info = accounts.arena.to_account_info();
    let pot = shared::available_lamports(&arena_info)?;
    require_gte!(pot, args.payout, SolagelError::InsufficientPot);

    let split = logic::compute_settlement(
        args.payout,
        accounts.session.buy_in,
        accounts.config.fee_bps,
        accounts.config.season_share_bps,
    )?;

    // Liveness guard: a treasury account that does not exist yet cannot receive less than
    // the rent-exempt minimum, which would make every settlement fail. In that case the
    // treasury cut goes to the season prize pool instead, so players always get paid.
    let treasury_info = accounts.treasury.to_account_info();
    let (season_cut, treasury_cut) = if split.treasury_cut > 0
        && treasury_info.lamports().saturating_add(split.treasury_cut)
            < shared::rent_exempt_minimum(&treasury_info)?
    {
        (split.fee, 0)
    } else {
        (split.season_cut, split.treasury_cut)
    };

    // Sequential, non-overlapping lamport borrows (safe when treasury == player).
    shared::debit_program_account(&arena_info, args.payout)?;
    shared::credit_account(&accounts.player.to_account_info(), split.player_amount)?;
    shared::credit_account(&treasury_info, treasury_cut)?;
    shared::credit_account(&accounts.season.to_account_info(), season_cut)?;

    let arena = &mut accounts.arena;
    arena.open_sessions = arena.open_sessions.saturating_sub(1);
    arena.total_paid_out = arena
        .total_paid_out
        .checked_add(args.payout)
        .ok_or(SolagelError::MathOverflow)?;

    let config = &mut accounts.config;
    config.total_games = config
        .total_games
        .checked_add(1)
        .ok_or(SolagelError::MathOverflow)?;
    config.total_paid_out = config
        .total_paid_out
        .checked_add(args.payout)
        .ok_or(SolagelError::MathOverflow)?;
    let current_season = config.current_season;

    let profile = &mut accounts.profile;
    profile.total_won = profile
        .total_won
        .checked_add(split.player_amount)
        .ok_or(SolagelError::MathOverflow)?;
    let result = shared::record_result(
        profile,
        &mut accounts.season,
        current_season,
        logic::GameResult {
            score: args.score,
            kills: args.kills,
            xp: args.xp,
        },
        logic::season_points_from_profit(args.payout, accounts.session.buy_in),
        now,
    );

    emit!(SessionSettled {
        player: accounts.session.player,
        arena_id: accounts.session.arena_id,
        session_id: accounts.session.id,
        payout: args.payout,
        fee: split.fee,
        score: result.score,
        kills: result.kills,
    });
    Ok(())
}
