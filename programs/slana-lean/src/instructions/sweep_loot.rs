//! `sweep_loot(amount: u64)` — reference `instructions/sweep_loot.rs`.
//!
//! Accounts: 0 server, 1 config, 2 arena, 3 vault, 4 token_mint, 5 token_program. Signed by
//! the server authority; the arena may be enabled and have open sessions.
//!
//! | reference constraint                                                          | lean check                     | error |
//! |-------------------------------------------------------------------------------|--------------------------------|-------|
//! | `amount: u64` Borsh                                                           | `Args`                         | 102 |
//! | `server: Signer`                                                              | `check_signer`                 | 3010 |
//! | `config` / `arena: Box<Account<..>>`                                          | `check_account`                | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | `vault: InterfaceAccount<TokenAccount>`                                       | `token::load_token_account`    | 3012 / 3007 / ProgramError |
//! | `token_mint: InterfaceAccount<Mint>`                                          | `token::load_mint`             | 3012 / 3007 / ProgramError |
//! | `token_program: Interface<TokenInterface>`                                    | `token::check_token_program`   | 3008 / 3009 |
//! | `server: constraint = server == config.server_authority @ Unauthorized`       | key compare                    | Unauthorized |
//! | `config: seeds = [CONFIG_SEED], bump = config.bump` (not `mut`)               | `stake::check_config`          | 2006 |
//! | `arena: seeds = [ARENA_SEED, arena.id LE], bump = arena.bump` (not `mut`)     | `stake::check_arena`           | 2006 |
//! | `vault: seeds = [VAULT_SEED, arena], bump = arena.vault_bump`, `mut`          | `stake::check_arena_vault`     | 2006 / 2000 |
//! | `token_mint: mut, address = config.token_mint`                                | `check_writable` + `stake::check_token_addresses` | 2000 / 2012 |
//! | `token_program: address = config.token_program`                               | `stake::check_token_addresses` | 2012 |
//! | `require_gte!(vault.amount, amount)`                                          | same                           | InsufficientPot |
//! | `amount == 0` → `Ok(())` (no burn, no event)                                  | same                           | — |
//! | `token::burn_from_pda(vault, amount)` signed by the arena PDA                 | `cpi::token::burn`             | token program |
//!
//! Emits `LootBurned`. The vault and the mint have distinct account types, so Anchor's
//! duplicate-mutable check cannot fire.

use {
    super::stake,
    crate::{
        accounts::{check_writable, data, data_ref, keq, kind, parse},
        borsh::{rd_key, rd_u16, rd_u64, Args},
        cpi::token::burn,
        error::{require, Result, INSUFFICIENT_POT, UNAUTHORIZED},
        events,
        state::{arena, config},
        token::{ACCOUNT_AMOUNT, ACCOUNT_LEN},
    },
    pinocchio::AccountView,
};

#[inline(never)]
pub fn process(accounts: &[AccountView], args: &[u8]) -> Result {
    let mut a = Args::new(args);
    let amount = a.u64();
    a.finish()?;

    let [server, config_acc, arena_acc, vault, token_mint, token_program] = parse(
        accounts,
        &[
            kind::SIGNER,
            kind::CONFIG,
            kind::ARENA,
            kind::TOKEN_ACCOUNT,
            kind::MINT,
            kind::TOKEN_PROGRAM,
        ],
    )?;
    // SAFETY: `parse` checked each type (and so each length); distinct program-account types,
    // the vault is only read.
    let c = unsafe { data::<{ config::SPACE }>(config_acc) };
    let r = unsafe { data::<{ arena::SPACE }>(arena_acc) };
    let vault_amount = rd_u64(unsafe { data_ref::<ACCOUNT_LEN>(vault) }, ACCOUNT_AMOUNT);

    require(
        keq(
            server.address().as_array(),
            &rd_key(c, config::SERVER_AUTHORITY),
        ),
        UNAUTHORIZED,
    )?;
    stake::check_config(config_acc, c, false)?;
    stake::check_arena(arena_acc, r, false)?;
    stake::check_arena_vault(vault, arena_acc, r)?;
    check_writable(token_mint)?;
    stake::check_token_addresses(c, token_mint, token_program)?;

    require(vault_amount >= amount, INSUFFICIENT_POT)?;
    if amount == 0 {
        return Ok(());
    }
    stake::with_arena_signer(r, |signer| {
        burn(
            token_program.address(),
            vault,
            token_mint,
            arena_acc,
            amount,
            signer,
        )
    })?;

    events::emit(&events::arena_amount(
        &events::LOOT_BURNED,
        rd_u16(r, arena::ID),
        amount,
    ));
    Ok(())
}
