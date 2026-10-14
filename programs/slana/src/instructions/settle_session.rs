use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::SlanaError,
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
        close = player,
        seeds = [SESSION_SEED, arena.key().as_ref(), player.key().as_ref()],
        bump = session.bump,
        has_one = player @ SlanaError::Unauthorized,
        has_one = arena @ SlanaError::Unauthorized
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
}

// TODO(Task 4): interim lamport version; Task 4 pays out of the arena token vault, splits
// the fee into treasury / season / burn, and passes `season_points = session.has_pass`.
pub fn handle_settle_session(ctx: Context<SettleSession>, args: SettleArgs) -> Result<()> {
    let accounts = &mut *ctx.accounts;
    require_eq!(
        accounts.session.id,
        args.session_id,
        SlanaError::SessionMismatch
    );
    let now = Clock::get()?.unix_timestamp;

    let arena_info = accounts.arena.to_account_info();
    let pot = shared::available_lamports(&arena_info)?;
    require_gte!(pot, args.payout, SlanaError::InsufficientPot);

    let split = logic::split_payout(
        args.payout,
        accounts.session.entry_fee,
        accounts.config.fee_bps,
        accounts.config.treasury_bps,
        accounts.config.burn_bps,
    )?;

    // Interim: lamports cannot be burned and the treasury is a token vault now, so the
    // whole fee goes to the season account until Task 4 moves settlement to tokens.
    shared::debit_program_account(&arena_info, args.payout)?;
    shared::credit_account(&accounts.player.to_account_info(), split.player)?;
    shared::credit_account(&accounts.season.to_account_info(), split.fee)?;

    let arena = &mut accounts.arena;
    arena.open_sessions = arena.open_sessions.saturating_sub(1);
    arena.total_paid_out = arena
        .total_paid_out
        .checked_add(args.payout)
        .ok_or(SlanaError::MathOverflow)?;

    let config = &mut accounts.config;
    config.total_games = config
        .total_games
        .checked_add(1)
        .ok_or(SlanaError::MathOverflow)?;
    config.total_paid_out = config
        .total_paid_out
        .checked_add(args.payout)
        .ok_or(SlanaError::MathOverflow)?;
    let current_season = config.current_season;

    let profile = &mut accounts.profile;
    profile.total_won = profile
        .total_won
        .checked_add(split.player)
        .ok_or(SlanaError::MathOverflow)?;
    let result = shared::record_result(
        profile,
        &mut accounts.season,
        current_season,
        args.score,
        args.kills,
        args.xp,
        now,
        true,
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
