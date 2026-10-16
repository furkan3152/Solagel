//! `sweep_arena()` — reference `instructions/sweep_arena.rs`.
//!
//! Accounts: 0 admin, 1 config, 2 arena, 3 vault, 4 fee_wallet_token, 5 token_mint,
//! 6 token_program.
//!
//! | reference constraint                                                          | lean check                     | error |
//! |-------------------------------------------------------------------------------|--------------------------------|-------|
//! | `admin: Signer`                                                               | `check_signer`                 | 3010 |
//! | `config` / `arena: Box<Account<..>>`                                          | `check_account`                | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | `vault`, `fee_wallet_token: InterfaceAccount<TokenAccount>`                   | `token::load_token_account`    | 3012 / 3007 / ProgramError |
//! | `token_mint: InterfaceAccount<Mint>`                                          | `token::load_mint`             | 3012 / 3007 / ProgramError |
//! | `token_program: Interface<TokenInterface>`                                    | `token::check_token_program`   | 3008 / 3009 |
//! | duplicate `mut` accounts (vault, fee_wallet_token)                            | `stake::check_distinct2`       | 2040 |
//! | `config: seeds = [CONFIG_SEED], bump = config.bump`, `has_one = admin @ Unauthorized` | `check_admin_config`   | 2006 / Unauthorized |
//! | `arena: seeds = [ARENA_SEED, arena.id LE], bump = arena.bump` (not `mut`)     | `stake::check_arena`           | 2006 |
//! | `vault: seeds = [VAULT_SEED, arena], bump = arena.vault_bump`, `mut`          | `stake::check_arena_vault`     | 2006 / 2000 |
//! | `fee_wallet_token: mut, token::mint, token::authority = config.fee_wallet, token::token_program` | `stake::check_fee_wallet_token` | 2000 / 2015 / 2014 / 2021 |
//! | `token_mint` / `token_program: address = config.*`                            | `stake::check_token_addresses` | 2012 |
//! | `require!(!arena.enabled)`                                                    | same                           | ArenaBusy |
//! | `require!(arena.open_sessions == 0)` (finalized sessions count as open)       | same                           | ArenaHasOpenSessions |
//! | `token::transfer_from_pda(vault → fee_wallet_token, vault.amount)` (0 = no-op) | `stake::pay_from_vault`       | token program |
//!
//! Emits `ArenaSwept`.

use {
    super::{check_admin_config, stake},
    crate::error::Result,
    crate::{
        accounts::{data, data_ref, kind, parse},
        borsh::{rd_bool, rd_u16, rd_u64},
        error::{require, ARENA_BUSY, ARENA_HAS_OPEN_SESSIONS},
        events,
        state::{arena, config},
        token::{ACCOUNT_AMOUNT, ACCOUNT_LEN},
    },
    pinocchio::AccountView,
};

#[inline(never)]
pub fn process(accounts: &[AccountView], _args: &[u8]) -> Result {
    let [admin, config_acc, arena_acc, vault, fee_wallet_token, token_mint, token_program] = parse(
        accounts,
        &[
            kind::SIGNER,
            kind::CONFIG,
            kind::ARENA,
            kind::TOKEN_ACCOUNT,
            kind::TOKEN_ACCOUNT,
            kind::MINT,
            kind::TOKEN_PROGRAM,
        ],
    )?;
    stake::check_distinct2(vault, fee_wallet_token)?;
    // SAFETY: `parse` checked each type (and so each length); distinct program-account types,
    // and the vault (read only) differs from the fee wallet's token account (above).
    let c = unsafe { data::<{ config::SPACE }>(config_acc) };
    let r = unsafe { data::<{ arena::SPACE }>(arena_acc) };
    let vault_amount = rd_u64(unsafe { data_ref::<ACCOUNT_LEN>(vault) }, ACCOUNT_AMOUNT);

    check_admin_config(config_acc, c, admin, false)?;
    stake::check_arena(arena_acc, r, false)?;
    stake::check_arena_vault(vault, arena_acc, r)?;
    stake::check_fee_wallet_token(fee_wallet_token, c, token_mint, token_program)?;
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
        fee_wallet_token,
        token_program,
        vault_amount,
    )?;

    events::emit(&events::arena_amount(
        &events::ARENA_SWEPT,
        rd_u16(r, arena::ID),
        vault_amount,
    ));
    Ok(())
}
