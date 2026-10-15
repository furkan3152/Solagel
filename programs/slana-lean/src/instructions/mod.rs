//! Instruction handlers, ported one-for-one from `programs/slana-ref/src/instructions/`.
//!
//! Each handler runs the checks in Anchor's order, so a request that breaks several rules
//! fails with the error the reference reports first:
//! 1. instruction arguments (Borsh, `InstructionDidNotDeserialize`);
//! 2. every account in declaration order: its type (`Signer`, `Account<T>`, `Program<T>`,
//!    `Interface<T>`, `InterfaceAccount<T>`; `init` accounts are only taken);
//! 3. `init` accounts in declaration order (PDA check, creation, token account setup);
//! 4. Anchor's duplicate-mutable-account check;
//! 5. the remaining constraints, per account in declaration order, each account's in Anchor's
//!    order (`seeds`, `mut`, `has_one`, `constraint`, `address`, `token::*`, `mint::*`);
//! 6. the handler body.
//!
//! Every file starts with a table mapping each reference constraint to its lean check.

pub mod capture_pass_entropy;
pub mod claim_season_reward;
pub mod close_pass_mint;
pub mod create_arena;
pub mod end_season;
pub mod initialize;
pub mod join_arena;
pub mod mint_pass;
pub mod refund_session;
pub mod register_player;
pub mod reveal_pass;
pub mod rollover_season;
pub mod set_pass_collection;
pub mod set_pass_seed_hash;
pub mod settle_session;
pub mod stake;
pub mod sweep_arena;
pub mod update_arena;
pub mod update_config;
pub mod update_profile;
pub mod withdraw_treasury;

use {
    crate::error::Result,
    crate::{
        accounts::keq,
        borsh::rd_key,
        constants::*,
        error::{
            require, BAD_SPLIT, ENTRY_FEE_ZERO, INVALID_FEE, INVALID_MAX_SESSIONS, UNAUTHORIZED,
        },
        state::config,
    },
    pinocchio::{
        sysvars::{clock::CLOCK_ID, get_sysvar},
        AccountView,
    },
};

/// The constraints every admin instruction puts on `config`:
/// `seeds = [CONFIG_SEED], bump = config.bump` (`ConstraintSeeds`), optionally `mut`
/// (`ConstraintMut`), and `has_one = admin @ Unauthorized`.
#[inline(never)]
pub(crate) fn check_admin_config(
    config: &AccountView,
    cfg: &[u8; config::SPACE],
    admin: &AccountView,
    mutable: bool,
) -> Result {
    stake::check_config(config, cfg, mutable)?;
    require(
        keq(&rd_key(cfg, config::ADMIN), admin.address().as_array()),
        UNAUTHORIZED,
    )
}

/// `Clock::get()?.slot`.
pub(crate) fn clock_slot() -> Result<u64> {
    let mut slot = [0u8; 8];
    get_sysvar(&mut slot, &CLOCK_ID, 0).map_err(|_| crate::error::Error::UNSUPPORTED_SYSVAR)?;
    Ok(u64::from_le_bytes(slot))
}

/// `Clock::get()?.unix_timestamp`.
pub(crate) fn unix_timestamp() -> Result<i64> {
    let mut ts = [0u8; 8];
    // `Clock`: slot, epoch_start_timestamp, epoch, leader_schedule_epoch, unix_timestamp.
    get_sysvar(&mut ts, &CLOCK_ID, 32).map_err(|_| crate::error::Error::UNSUPPORTED_SYSVAR)?;
    Ok(i64::from_le_bytes(ts))
}

// ----- reference `instructions/shared.rs`: parameter validation ----------------------------

/// `fee_bps ≤ MAX_FEE_BPS` and `pass_fee_bps ≤ fee_bps`, else `InvalidFee`.
pub(crate) fn check_fees(fee_bps: u16, pass_fee_bps: u16) -> Result {
    require(fee_bps <= MAX_FEE_BPS, INVALID_FEE)?;
    require(pass_fee_bps <= fee_bps, INVALID_FEE)
}

/// The three fee shares must sum to exactly `BPS` (summed in u32), else `BadSplit`.
// Bound: three u16 summed in u32 (< 2^18).
#[allow(clippy::arithmetic_side_effects)]
pub(crate) fn check_split(treasury_bps: u16, season_bps: u16, burn_bps: u16) -> Result {
    let sum = u32::from(treasury_bps) + u32::from(season_bps) + u32::from(burn_bps);
    require(sum == u32::from(BPS), BAD_SPLIT)
}

/// `settle_fee_lamports ≤ MAX_SETTLE_FEE_LAMPORTS`, else `InvalidFee`.
pub(crate) fn check_settle_fee(settle_fee_lamports: u64) -> Result {
    require(settle_fee_lamports <= MAX_SETTLE_FEE_LAMPORTS, INVALID_FEE)
}

/// `entry_fee > 0`, else `EntryFeeZero`.
pub(crate) fn check_entry_fee(entry_fee: u64) -> Result {
    require(entry_fee > 0, ENTRY_FEE_ZERO)
}

/// `MIN_ARENA_SESSIONS ≤ max_sessions ≤ MAX_ARENA_SESSIONS`, else `InvalidMaxSessions`.
pub(crate) fn check_max_sessions(max_sessions: u16) -> Result {
    require(
        max_sessions >= MIN_ARENA_SESSIONS && max_sessions <= MAX_ARENA_SESSIONS,
        INVALID_MAX_SESSIONS,
    )
}
