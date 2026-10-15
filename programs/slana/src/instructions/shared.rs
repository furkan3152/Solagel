//! Account-level helpers shared by several instruction handlers.

use anchor_lang::{
    prelude::*,
    system_program::{self, Transfer},
};

use crate::{
    constants::*,
    error::SlanaError,
    events::PassMintEnded,
    logic::{self, GameResult},
    state::{Config, PassLock, PlayerProfile, Season, Session},
};

// ---------------------------------------------------------------------------------------
// Pass mint end
// ---------------------------------------------------------------------------------------

/// Ends the Pass mint for good and captures the trait entropy: the most recent entry of the
/// SlotHashes sysvar (`slot_hashes` must be that account; its address is checked by the
/// caller's account constraint). Called by `close_pass_mint` and by `mint_pass` when the last
/// Pass of the supply is minted. The entropy is a chain value fixed only now, so nobody (the
/// admin with the committed seed included) can know a Pass number's traits while Passes can
/// still be minted.
pub(crate) fn end_pass_mint(config: &mut Config, slot_hashes: &AccountInfo) -> Result<()> {
    require!(!config.pass_mint_ended, SlanaError::MintEnded);
    let data = slot_hashes.try_borrow_data()?;
    let (slot, hash) = logic::parse_latest_slot_hash(&data).ok_or(SlanaError::BadSlotHashes)?;
    config.pass_entropy = hash;
    config.pass_entropy_slot = slot;
    config.pass_mint_ended = true;
    config.pass_mint_open = false;
    emit!(PassMintEnded {
        minted: config.pass_minted,
        entropy_slot: slot,
        entropy: hash,
    });
    Ok(())
}

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
