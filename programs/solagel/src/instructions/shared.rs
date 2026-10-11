//! Account-level helpers shared by several instruction handlers.

use anchor_lang::{
    prelude::*,
    system_program::{self, Transfer},
};

use crate::{
    error::SolagelError,
    logic::{self, GameResult},
    state::{PlayerProfile, Season},
};

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
        .ok_or(SolagelError::InsufficientPot)?;
    require_gte!(remaining, minimum, SolagelError::InsufficientPot);
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
        .ok_or(SolagelError::MathOverflow)?;
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

/// Applies a paid game to `profile` and updates the current prize leaderboard only
/// when the game earns points from captured SOL profit.
pub(crate) fn record_result(
    profile: &mut PlayerProfile,
    season: &mut Season,
    current_season: u32,
    game: GameResult,
    earned_points: u64,
    now: i64,
) -> GameResult {
    let result = logic::apply_game(profile, current_season, game, earned_points, now);
    // Bot/food mass and returned buy-ins are not financial wins. Only captured
    // profit can enroll a wallet in the prize-bearing season leaderboard.
    if earned_points > 0 {
        let candidate = logic::leader_entry(profile, result.score);
        logic::upsert_leaderboard(&mut season.entries, &mut season.count, candidate);
    }
    result
}
