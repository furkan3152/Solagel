//! `sweep_loot(amount: u64)` — reference `instructions/sweep_loot.rs`.
//!
//! Accounts: 0 server, 1 config, 2 arena, 3 vault, 4 season, 5 season_vault, 6 token_mint,
//! 7 token_program. The same accounts as `sweep_arena`, signed by the server authority; the
//! arena may be enabled and have open sessions.
//!
//! | reference constraint                                                          | lean check                     | error |
//! |-------------------------------------------------------------------------------|--------------------------------|-------|
//! | `amount: u64` Borsh                                                           | `Args`                         | 102 |
//! | `server: Signer`                                                              | `check_signer`                 | 3010 |
//! | `config` / `arena` / `season: Box<Account<..>>`                               | `check_account`                | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | `vault`, `season_vault: InterfaceAccount<TokenAccount>`                       | `token::load_token_account`    | 3012 / 3007 / ProgramError |
//! | `token_mint: InterfaceAccount<Mint>`                                          | `token::load_mint`             | 3012 / 3007 / ProgramError |
//! | `token_program: Interface<TokenInterface>`                                    | `token::check_token_program`   | 3008 / 3009 |
//! | duplicate `mut` accounts (vault, season_vault)                                | `stake::check_distinct2`       | 2040 |
//! | `server: constraint = server == config.server_authority @ Unauthorized`       | key compare                    | Unauthorized |
//! | `config: seeds = [CONFIG_SEED], bump = config.bump` (not `mut`)               | `stake::check_config`          | 2006 |
//! | `arena: seeds = [ARENA_SEED, arena.id LE], bump = arena.bump` (not `mut`)     | `stake::check_arena`           | 2006 |
//! | `vault: seeds = [VAULT_SEED, arena], bump = arena.vault_bump`, `mut`          | `stake::check_arena_vault`     | 2006 / 2000 |
//! | `season: seeds = [SEASON_SEED, config.current_season LE], bump = season.bump`, `mut` | `stake::check_current_season` | 2006 / 2000 |
//! | `season_vault: seeds = [SEASON_VAULT_SEED], bump = config.season_vault_bump`, `mut` | `check_pda_seeds` | 2006 / 2000 |
//! | `token_mint` / `token_program: address = config.*`                            | `stake::check_token_addresses` | 2012 |
//! | `require_gte!(vault.amount, amount)`                                          | same                           | InsufficientPot |
//! | `amount == 0` → `Ok(())` (no transfer, no event)                              | same                           | — |
//! | `token::transfer_from_pda(vault → season_vault, amount)`                      | `stake::pay_from_vault`        | token program |
//! | `season.pool.checked_add(amount)`                                             | `stake::add`                   | MathOverflow |
//!
//! Emits `LootSwept`. The checks and the transfer are `sweep_arena`'s body
//! ([`super::sweep_arena::sweep`]) with `loot = Some(amount)`.

use {
    super::sweep_arena::sweep,
    crate::{borsh::Args, error::Result},
    pinocchio::AccountView,
};

#[inline(never)]
pub fn process(accounts: &[AccountView], args: &[u8]) -> Result {
    let mut a = Args::new(args);
    let amount = a.u64();
    a.finish()?;
    sweep(accounts, Some(amount))
}
