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
// Lamports: the join settle deposit (System transfer) and the legacy season flows
// (`end_season` / `claim_season_reward` / `rollover_season`, moved to tokens in Task 5)
// ---------------------------------------------------------------------------------------

/// Rent-exempt minimum of an account with the data length of `info`.
pub(crate) fn rent_exempt_minimum(info: &AccountInfo) -> Result<u64> {
    Ok(Rent::get()?.minimum_balance(info.data_len()))
}

/// Lamports held above the rent-exempt minimum (an arena pot or a season prize pool).
pub(crate) fn available_lamports(info: &AccountInfo) -> Result<u64> {
    Ok(info.lamports().saturating_sub(rent_exempt_minimum(info)?))
}

/// Removes `amount` lamports from an account owned by this program, never letting it
/// drop below its rent-exempt minimum.
pub(crate) fn debit_program_account(from: &AccountInfo, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let minimum = rent_exempt_minimum(from)?;
    let remaining = from
        .lamports()
        .checked_sub(amount)
        .ok_or(SlanaError::InsufficientPot)?;
    require_gte!(remaining, minimum, SlanaError::InsufficientPot);
    **from.try_borrow_mut_lamports()? = remaining;
    Ok(())
}

/// Adds `amount` lamports to any writable account. The lamports borrow is released before
/// returning, so aliased accounts (e.g. treasury == player) can be credited one after another.
pub(crate) fn credit_account(to: &AccountInfo, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let total = to
        .lamports()
        .checked_add(amount)
        .ok_or(SlanaError::MathOverflow)?;
    **to.try_borrow_mut_lamports()? = total;
    Ok(())
}

/// Moves lamports out of a program-owned account (direct lamport arithmetic).
pub(crate) fn transfer_from_program_account(
    from: &AccountInfo,
    to: &AccountInfo,
    amount: u64,
) -> Result<()> {
    debit_program_account(from, amount)?;
    credit_account(to, amount)
}

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
