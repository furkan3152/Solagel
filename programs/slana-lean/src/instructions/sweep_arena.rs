//! `sweep_arena()` (reference: `instructions/sweep_arena.rs`).
//!
//! Accounts: 0 admin, 1 config, 2 arena, 3 vault, 4 season, 5 season_vault, 6 token_mint,
//! 7 token_program.
//!
//! | reference constraint                                                          | lean check                     | error |
//! |-------------------------------------------------------------------------------|--------------------------------|-------|
//! | `admin: Signer`                                                               | `check_signer`                 | 3010 |
//! | `config` / `arena` / `season: Box<Account<..>>`                               | `check_account`                | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | `vault`, `season_vault: InterfaceAccount<TokenAccount>`                       | `token::load_token_account`    | 3012 / 3007 / ProgramError |
//! | `token_mint: InterfaceAccount<Mint>`                                          | `token::load_mint`             | 3012 / 3007 / ProgramError |
//! | `token_program: Interface<TokenInterface>`                                    | `token::check_token_program`   | 3008 / 3009 |
//! | duplicate `mut` accounts (vault, season_vault)                                | `stake::check_distinct`        | 2040 |
//! | `config: seeds = [CONFIG_SEED], bump = config.bump`, `has_one = admin @ Unauthorized` | `check_admin_config`   | 2006 / Unauthorized |
//! | `arena: seeds = [ARENA_SEED, arena.id LE], bump = arena.bump` (not `mut`)     | `stake::check_arena`           | 2006 |
//! | `vault: seeds = [VAULT_SEED, arena], bump = arena.vault_bump`, `mut`          | `stake::check_arena_vault`     | 2006 / 2000 |
//! | `season: seeds = [SEASON_SEED, config.current_season LE], bump = season.bump`, `mut` | `stake::check_current_season` | 2006 / 2000 |
//! | `season_vault: seeds = [SEASON_VAULT_SEED], bump = config.season_vault_bump`, `mut` | `stake::check_global_vault` | 2006 / 2000 |
//! | `token_mint` / `token_program: address = config.*`                            | `stake::check_token_addresses` | 2012 |
//! | `require!(!arena.enabled)`                                                    | same                           | ArenaBusy |
//! | `require!(arena.open_sessions == 0)` (finalized sessions count as open)       | same                           | ArenaHasOpenSessions |
//! | `token::transfer_from_pda(vault → season_vault, vault.amount)` (0 = no-op)    | `stake::pay_from_vault`        | token program |
//! | `season.pool.checked_add(amount)`                                             | `stake::add`                   | MathOverflow |
//!
//! Emits `ArenaSwept`.

use {
    super::{check_admin_config, stake},
    crate::error::Result,
    crate::{
        accounts::{data, kind, parse},
        borsh::{rd_bool, rd_u16, rd_u32, rd_u64, rd_u8, wr_u64},
        constants::SEASON_VAULT_SEED,
        error::{require, ARENA_BUSY, ARENA_HAS_OPEN_SESSIONS},
        events,
        state::{arena, config, season},
        token::{ACCOUNT_AMOUNT, ACCOUNT_LEN},
    },
    pinocchio::AccountView,
};

#[inline(never)]
pub fn process(accounts: &[AccountView], _args: &[u8]) -> Result {
    let [admin, config_acc, arena_acc, vault, season_acc, season_vault, token_mint, token_program] =
        parse(
            accounts,
            &[
                kind::SIGNER,
                kind::CONFIG,
                kind::ARENA,
                kind::TOKEN_ACCOUNT,
                kind::SEASON,
                kind::TOKEN_ACCOUNT,
                kind::MINT,
                kind::TOKEN_PROGRAM,
            ],
        )?;
    stake::check_distinct(&[vault, season_vault])?;
    // SAFETY: `parse` checked each type (and so each length); distinct program-account types,
    // and the vault (read only) differs from the season vault (above).
    let c = unsafe { data::<{ config::SPACE }>(config_acc) };
    let r = unsafe { data::<{ arena::SPACE }>(arena_acc) };
    let sn = unsafe { data::<{ season::SPACE }>(season_acc) };
    let amount = rd_u64(unsafe { data::<ACCOUNT_LEN>(vault) }, ACCOUNT_AMOUNT);

    check_admin_config(config_acc, c, admin, false)?;
    stake::check_arena(arena_acc, r, false)?;
    stake::check_arena_vault(vault, arena_acc, r)?;
    stake::check_current_season(season_acc, sn, c)?;
    stake::check_global_vault(
        season_vault,
        SEASON_VAULT_SEED,
        rd_u8(c, config::SEASON_VAULT_BUMP),
    )?;
    stake::check_token_addresses(c, token_mint, token_program)?;

    require(!rd_bool(r, arena::ENABLED), ARENA_BUSY)?;
    require(
        rd_u16(r, arena::OPEN_SESSIONS) == 0,
        ARENA_HAS_OPEN_SESSIONS,
    )?;

    stake::pay_from_vault(
        c,
        r,
        arena_acc,
        vault,
        token_mint,
        season_vault,
        token_program,
        amount,
    );
    let pool = stake::add(rd_u64(sn, season::POOL), amount)?;
    wr_u64(sn, season::POOL, pool);

    events::emit(&events::arena_swept(
        rd_u16(r, arena::ID),
        rd_u32(sn, season::ID),
        amount,
    ));
    Ok(())
}
