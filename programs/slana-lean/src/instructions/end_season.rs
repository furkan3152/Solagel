//! `end_season()` — reference `instructions/end_season.rs`: freezes the current season (its
//! token pool becomes the claimable prize pool) and opens the next one.
//!
//! Accounts: 0 admin, 1 config, 2 season, 3 next_season, 4 system_program.
//!
//! | reference constraint                                                      | lean check                     | error |
//! |---------------------------------------------------------------------------|--------------------------------|-------|
//! | `admin: Signer`                                                           | `check_signer`                 | 3010 |
//! | `config` / `season: Box<Account<..>>`                                     | `check_account`                | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | `next_season: init` (only taken here)                                     | `at`                           | 3005 |
//! | `system_program: Program<System>`                                         | `check_program`                | 3008 / 3009 |
//! | `next_season: init, payer = admin, space = 8 + INIT_SPACE, seeds = [SEASON_SEED, (config.current_season + 1) LE], bump` | `checked_add` + `init_program_pda` | (overflow) / 2006 / system program |
//! | duplicate `mut` accounts (config, season)                                 | — (distinct account types)     | (2040) |
//! | `admin: mut`                                                              | `check_writable`               | 2000 |
//! | `config: seeds = [CONFIG_SEED], bump = config.bump`, `mut`, `has_one = admin @ Unauthorized` | `check_admin_config` | 2006 / 2000 / Unauthorized |
//! | `season: seeds = [SEASON_SEED, config.current_season LE], bump = season.bump`, `mut` | `stake::check_current_season` | 2006 / 2000 |
//! | `require!(!season.finalized)`                                             | same                           | SeasonFinalized |
//! | `config.current_season.checked_add(1)`                                    | the seed's `checked_add`       | MathOverflow |
//!
//! `current_season + 1` in the seeds: the reference (`overflow-checks = true`) panics at
//! `u32::MAX`; lean returns `MathOverflow` there (unreachable: one season per call).
//!
//! Then `season.{finalized, ended_at, prize_pool = pool}`, `config.current_season`, the new
//! season's `{id, started_at, bump}`, and `SeasonEnded`.

use {
    super::{check_admin_config, initialize::init_program_pda, stake, unix_timestamp},
    crate::error::Result,
    crate::{
        accounts::{check_writable, data, kind, parse},
        borsh::{rd_bool, rd_u32, rd_u64, wr_bool, wr_bytes, wr_i64, wr_u32, wr_u64, wr_u8},
        constants::SEASON_SEED,
        error::{err, require, MATH_OVERFLOW, SEASON_FINALIZED},
        events,
        state::{config, season},
    },
    pinocchio::AccountView,
};

#[inline(never)]
pub fn process(accounts: &[AccountView], _args: &[u8]) -> Result {
    // ----- account types, in declaration order -------------------------------------------
    let [admin, config_acc, season_acc, next_acc, _system_program] = parse(
        accounts,
        &[
            kind::SIGNER,
            kind::CONFIG,
            kind::SEASON,
            kind::ANY,
            kind::SYSTEM_PROGRAM,
        ],
    )?;
    // SAFETY: `parse` checked both types (and so the lengths); a config and a season are
    // distinct accounts (distinct discriminators).
    let c = unsafe { data::<{ config::SPACE }>(config_acc) };
    let s = unsafe { data::<{ season::SPACE }>(season_acc) };

    // ----- init: next_season ---------------------------------------------------------------
    let next_id = rd_u32(c, config::CURRENT_SEASON)
        .checked_add(1)
        .ok_or_else(|| err(MATH_OVERFLOW))?;
    let next_seed = next_id.to_le_bytes();
    let next_bump = init_program_pda(admin, next_acc, season::SPACE, &[SEASON_SEED, &next_seed])?;

    // ----- the remaining constraints -------------------------------------------------------
    check_writable(admin)?;
    check_admin_config(config_acc, c, admin, true)?;
    stake::check_current_season(season_acc, s, c)?;

    // ----- handler ---------------------------------------------------------------------------
    require(!rd_bool(s, season::FINALIZED), SEASON_FINALIZED)?;
    let now = unix_timestamp()?;
    let prize_pool = rd_u64(s, season::POOL);
    wr_bool(s, season::FINALIZED, true);
    wr_i64(s, season::ENDED_AT, now);
    wr_u64(s, season::PRIZE_POOL, prize_pool);

    wr_u32(c, config::CURRENT_SEASON, next_id);

    // SAFETY: `init_program_pda` allocated `season::SPACE` zeroed bytes at a PDA other than
    // the current season's (different seeds); nothing else references them.
    let n = unsafe { data::<{ season::SPACE }>(next_acc) };
    wr_bytes(n, 0, &season::DISCRIMINATOR);
    wr_u32(n, season::ID, next_id);
    wr_i64(n, season::STARTED_AT, now);
    wr_u8(n, season::BUMP, next_bump);

    events::emit(&events::season_ended(rd_u32(s, season::ID), prize_pool));
    Ok(())
}
