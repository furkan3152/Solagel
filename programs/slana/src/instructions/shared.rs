//! Account-level helpers shared by several instruction handlers.

use anchor_lang::{
    prelude::*,
    system_program::{self, Transfer},
};

use crate::{
    constants::*,
    error::SlanaError,
    logic::{self, GameResult},
    state::{PassLock, PlayerProfile, Season, Session},
};

// ---------------------------------------------------------------------------------------
// Parameter validation
// ---------------------------------------------------------------------------------------

/// `fee_bps ≤ MAX_FEE_BPS` and `pass_fee_bps ≤ fee_bps`, else `InvalidFee`.
pub(crate) fn check_fees(fee_bps: u16, pass_fee_bps: u16) -> Result<()> {
    require!(fee_bps <= MAX_FEE_BPS, SlanaError::InvalidFee);
    require!(pass_fee_bps <= fee_bps, SlanaError::InvalidFee);
    Ok(())
}

/// The three fee shares must sum to exactly `BPS`, else `BadSplit`.
pub(crate) fn check_split(treasury_bps: u16, season_bps: u16, burn_bps: u16) -> Result<()> {
    let sum = u32::from(treasury_bps) + u32::from(season_bps) + u32::from(burn_bps);
    require!(sum == u32::from(BPS), SlanaError::BadSplit);
    Ok(())
}

/// `settle_fee_lamports ≤ MAX_SETTLE_FEE_LAMPORTS`, else `InvalidFee`.
pub(crate) fn check_settle_fee(settle_fee_lamports: u64) -> Result<()> {
    require!(
        settle_fee_lamports <= MAX_SETTLE_FEE_LAMPORTS,
        SlanaError::InvalidFee
    );
    Ok(())
}

/// `entry_fee > 0`, else `EntryFeeZero`.
pub(crate) fn check_entry_fee(entry_fee: u64) -> Result<()> {
    require!(entry_fee > 0, SlanaError::EntryFeeZero);
    Ok(())
}

/// `MIN_ARENA_SESSIONS ≤ max_sessions ≤ MAX_ARENA_SESSIONS`, else `InvalidMaxSessions`.
pub(crate) fn check_max_sessions(max_sessions: u16) -> Result<()> {
    require!(
        (MIN_ARENA_SESSIONS..=MAX_ARENA_SESSIONS).contains(&max_sessions),
        SlanaError::InvalidMaxSessions
    );
    Ok(())
}

// ---------------------------------------------------------------------------------------
// Pass locks
// ---------------------------------------------------------------------------------------

/// A Pass session must come with exactly its own lock (`["pass_lock", session.pass_asset]`,
/// recorded for this session); a session without a Pass must come with none. Else `PassInUse`.
pub(crate) fn check_pass_lock(
    session: &Account<Session>,
    lock: Option<&Account<PassLock>>,
) -> Result<()> {
    match (session.has_pass, lock) {
        (false, None) => Ok(()),
        (true, Some(lock)) => {
            let expected = Pubkey::create_program_address(
                &[PASS_LOCK_SEED, session.pass_asset.as_ref(), &[lock.bump]],
                &crate::ID,
            )
            .map_err(|_| error!(SlanaError::PassInUse))?;
            require_keys_eq!(lock.key(), expected, SlanaError::PassInUse);
            require_keys_eq!(lock.session, session.key(), SlanaError::PassInUse);
            require_keys_eq!(lock.player, session.player, SlanaError::PassInUse);
            Ok(())
        }
        _ => err!(SlanaError::PassInUse),
    }
}

// ---------------------------------------------------------------------------------------
// Lamports: the join settle deposit
// ---------------------------------------------------------------------------------------

/// Moves lamports out of a user wallet with a System Program CPI.
pub(crate) fn transfer_from_wallet<'info>(
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    system_program::transfer(
        CpiContext::new(
            system_program::ID,
            Transfer {
                from: from.clone(),
                to: to.clone(),
            },
        ),
        amount,
    )
}

// ---------------------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------------------

/// Applies a finished game to `profile`. With `season_points` the score also counts for the
/// current `season` and the player is upserted into its leaderboard.
#[allow(clippy::too_many_arguments)]
pub(crate) fn record_result(
    profile: &mut PlayerProfile,
    season: &mut Season,
    current_season: u32,
    score: u32,
    kills: u16,
    xp: u32,
    now: i64,
    season_points: bool,
) -> GameResult {
    let result = logic::apply_game(
        profile,
        current_season,
        score,
        kills,
        xp,
        now,
        season_points,
    );
    if season_points {
        let candidate = logic::leader_entry(profile, result.score);
        logic::upsert_leaderboard(&mut season.entries, &mut season.count, candidate);
    }
    result
}
