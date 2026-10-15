//! `rollover_season(season_id: u32)` — reference `instructions/rollover_season.rs`: after the
//! claim window of a finalized season, moves its unclaimed prizes (whatever is left of its
//! `pool`, rounding dust and unfilled ranks included) into the current season's `pool` and
//! closes all of its ranks. The tokens stay in the global season vault; only the per-season
//! accounting changes.
//!
//! Accounts: 0 admin, 1 config, 2 old_season, 3 current_season.
//!
//! | reference constraint                                                      | lean check                     | error |
//! |---------------------------------------------------------------------------|--------------------------------|-------|
//! | `season_id: u32` Borsh                                                    | `Args`                         | 102 |
//! | `admin: Signer`                                                           | `check_signer`                 | 3010 |
//! | `config` / `old_season` / `current_season: Box<Account<..>>`              | `check_account`                | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | duplicate `mut` accounts (`current_season` is `dup`; only `old_season` is a candidate) | —                   | — |
//! | `config: seeds = [CONFIG_SEED], bump = config.bump`, `has_one = admin @ Unauthorized` | `check_admin_config` | 2006 / Unauthorized |
//! | `old_season: seeds = [SEASON_SEED, season_id LE], bump = old_season.bump`, `mut` | `check_pda_seeds`      | 2006 / 2000 |
//! | `old_season: constraint = season_id != config.current_season @ InvalidSeason` | same                       | InvalidSeason |
//! | `current_season: seeds = [SEASON_SEED, config.current_season LE], bump = current_season.bump`, `mut` | `stake::check_current_season` | 2006 / 2000 |
//! | `require!(old_season.finalized)`                                          | same                           | SeasonNotFinalized |
//! | `ended_at.checked_add(CLAIM_WINDOW_SECS)`                                 | `checked_add`                  | MathOverflow |
//! | `require_gt!(now, closes_at)`                                             | same                           | ClaimWindowOpen |
//! | `current_season.pool.checked_add(old_season.pool)`                        | `stake::add`                   | MathOverflow |
//!
//! Then `old_season.{pool = 0, claimed_mask = all ranks}`, `current_season.pool`, and
//! `SeasonRolledOver { from: season_id, to: current_season.id, amount }`.
//!
//! Aliasing: with `season_id == current_season` both accounts may be the same; that case
//! fails with `InvalidSeason` before anything is written. Otherwise the two seed checks put
//! them at PDAs of different seeds, so they are distinct accounts when the handler writes.

use {
    super::{check_admin_config, stake, unix_timestamp},
    crate::error::Result,
    crate::{
        accounts::{check_pda_seeds, data, kind, parse},
        borsh::{rd_bool, rd_i64, rd_u32, rd_u64, rd_u8, wr_u16, wr_u64, Args},
        constants::{CLAIM_WINDOW_SECS, PRIZE_RANKS, SEASON_SEED},
        error::{
            err, require, CLAIM_WINDOW_OPEN, INVALID_SEASON, MATH_OVERFLOW, SEASON_NOT_FINALIZED,
        },
        events,
        state::{config, season},
    },
    pinocchio::AccountView,
};

/// `claimed_mask` with every prize rank set.
const ALL_RANKS_CLAIMED: u16 = ((1u32 << PRIZE_RANKS) - 1) as u16;

#[inline(never)]
pub fn process(accounts: &[AccountView], args: &[u8]) -> Result {
    let mut a = Args::new(args);
    let season_id = a.u32();
    a.finish()?;

    // ----- account types, in declaration order -------------------------------------------
    let [admin, config_acc, old_acc, current_acc] = parse(
        accounts,
        &[kind::SIGNER, kind::CONFIG, kind::SEASON, kind::SEASON],
    )?;

    // ----- constraints (no duplicate-mutable candidates) -------------------------------------
    // SAFETY: `parse` checked the types (and so the lengths). The config is a distinct
    // account; the two seasons may alias until the checks below, and are only read until then.
    let c = unsafe { data::<{ config::SPACE }>(config_acc) };
    let old = unsafe { data::<{ season::SPACE }>(old_acc) };
    check_admin_config(config_acc, c, admin, false)?;
    let id = season_id.to_le_bytes();
    check_pda_seeds(old_acc, &[SEASON_SEED, &id], rd_u8(old, season::BUMP), true)?;
    let current_id = rd_u32(c, config::CURRENT_SEASON);
    require(season_id != current_id, INVALID_SEASON)?;
    // SAFETY: as above; distinct from `old` once both seed checks passed (different seeds).
    let cur = unsafe { data::<{ season::SPACE }>(current_acc) };
    stake::check_current_season(current_acc, cur, c)?;

    // ----- handler ---------------------------------------------------------------------------
    require(rd_bool(old, season::FINALIZED), SEASON_NOT_FINALIZED)?;
    let now = unix_timestamp()?;
    let closes_at = rd_i64(old, season::ENDED_AT)
        .checked_add(CLAIM_WINDOW_SECS)
        .ok_or_else(|| err(MATH_OVERFLOW))?;
    require(now > closes_at, CLAIM_WINDOW_OPEN)?;

    let amount = rd_u64(old, season::POOL);
    wr_u64(old, season::POOL, 0);
    wr_u16(old, season::CLAIMED_MASK, ALL_RANKS_CLAIMED);
    let pool = stake::add(rd_u64(cur, season::POOL), amount)?;
    wr_u64(cur, season::POOL, pool);

    events::emit(&events::season_rolled_over(
        season_id,
        rd_u32(cur, season::ID),
        amount,
    ));
    Ok(())
}
