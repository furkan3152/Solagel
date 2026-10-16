//! Account-level helpers shared by several instruction handlers.

use anchor_lang::{
    prelude::*,
    system_program::{self, Transfer},
};

use crate::{constants::*, error::SlanaError};

// ---------------------------------------------------------------------------------------
// Parameter validation
// ---------------------------------------------------------------------------------------

/// `fee_bps ≤ MAX_FEE_BPS`, else `InvalidFee`.
pub(crate) fn check_fee(fee_bps: u16) -> Result<()> {
    require!(fee_bps <= MAX_FEE_BPS, SlanaError::InvalidFee);
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

/// A role key (admin, server authority, fee wallet) must not be `Pubkey::default()`, else
/// `InvalidAuthority`.
pub(crate) fn check_authority(key: &Pubkey) -> Result<()> {
    require_keys_neq!(*key, Pubkey::default(), SlanaError::InvalidAuthority);
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
