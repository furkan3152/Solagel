//! `reveal_pass(seed: [u8; 32])` — reference `instructions/reveal_pass.rs` (ruling R23):
//! after the mint ended, publishes the committed trait seed (`sha256(seed) ==
//! pass_seed_hash`, `sol_sha256`) and only then sets `pass_entropy_target_slot = slot +
//! ENTROPY_DELAY_SLOTS`. Once only.
//!
//! Accounts: 0 admin, 1 config.
//!
//! | reference constraint                                    | lean check                     | error |
//! |---------------------------------------------------------|--------------------------------|-------|
//! | `seed: [u8; 32]` Borsh                                  | `Args`                         | 102 |
//! | `admin: Signer`                                         | `check_signer`                 | 3010 |
//! | `config: Box<Account<Config>>`                          | `check_account`                | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | `config: seeds = [CONFIG_SEED], bump = config.bump`     | `check_admin_config`           | 2006 |
//! | `config: mut`                                           | `check_admin_config`           | 2000 |
//! | `config: has_one = admin @ Unauthorized`                | `check_admin_config`           | Unauthorized |
//! | `require!(!pass_seed_revealed && !pass_revealed)`       | same                           | AlreadyRevealed |
//! | `require!(pass_seed_hash != [0; 32])`                   | same                           | SeedNotSet |
//! | `require!(pass_mint_ended)`                             | same                           | MintStillOpen |
//! | `require!(sha256(seed) == pass_seed_hash)`              | `logic::sha256`                | SeedMismatch |
//! | `Clock.slot.checked_add(ENTROPY_DELAY_SLOTS)`           | `checked_add`                  | MathOverflow |
//!
//! Stores the seed, `pass_seed_revealed` and the target; emits `PassSeedRevealed`.

use {
    super::{check_admin_config, clock_slot},
    crate::error::Result,
    crate::{
        accounts::{data, keq, kind, parse},
        borsh::{rd_bool, rd_key, wr_bool, wr_bytes, wr_u64, Args},
        constants::ENTROPY_DELAY_SLOTS,
        error::{
            err, require, ALREADY_REVEALED, MATH_OVERFLOW, MINT_STILL_OPEN, SEED_MISMATCH,
            SEED_NOT_SET,
        },
        events,
        logic::sha256,
        state::config,
    },
    pinocchio::AccountView,
};

#[inline(never)]
pub fn process(accounts: &[AccountView], args: &[u8]) -> Result {
    let mut a = Args::new(args);
    let seed = a.key();
    a.finish()?;

    let [admin, config_acc] = parse(accounts, &[kind::SIGNER, kind::CONFIG])?;
    // SAFETY: `parse` checked the account holds a `Config`.
    let c = unsafe { data::<{ config::SPACE }>(config_acc) };
    check_admin_config(config_acc, c, admin, true)?;

    require(
        !rd_bool(c, config::PASS_SEED_REVEALED) && !rd_bool(c, config::PASS_REVEALED),
        ALREADY_REVEALED,
    )?;
    let committed = rd_key(c, config::PASS_SEED_HASH);
    require(!keq(&committed, &[0; 32]), SEED_NOT_SET)?;
    require(rd_bool(c, config::PASS_MINT_ENDED), MINT_STILL_OPEN)?;
    require(keq(&sha256(&[&seed]), &committed), SEED_MISMATCH)?;
    let target = clock_slot()?
        .checked_add(ENTROPY_DELAY_SLOTS)
        .ok_or_else(|| err(MATH_OVERFLOW))?;

    wr_bytes(c, config::PASS_SEED, &seed);
    wr_bool(c, config::PASS_SEED_REVEALED, true);
    wr_u64(c, config::PASS_ENTROPY_TARGET_SLOT, target);
    events::emit(&events::pass_seed_revealed(&seed, target));
    Ok(())
}
