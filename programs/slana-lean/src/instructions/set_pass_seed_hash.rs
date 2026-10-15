//! `set_pass_seed_hash(hash: [u8; 32])` — reference `instructions/set_pass_seed_hash.rs`.
//!
//! Accounts: 0 admin, 1 config.
//!
//! | reference constraint                                    | lean check                     | error |
//! |---------------------------------------------------------|--------------------------------|-------|
//! | `hash: [u8; 32]` Borsh                                  | `Args`                         | 102 |
//! | `admin: Signer`                                         | `check_signer`                 | 3010 |
//! | `config: Account<Config>`                               | `load`                         | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | `config: seeds = [CONFIG_SEED], bump = config.bump`     | `check_admin_config`           | 2006 |
//! | `config: mut`                                           | `check_admin_config`           | 2000 |
//! | `config: has_one = admin @ Unauthorized`                | `check_admin_config`           | Unauthorized |
//! | `!pass_revealed && !pass_seed_revealed`                 | same                           | AlreadyRevealed |
//! | `pass_minted == 0`                                      | same                           | SeedLocked |

use {
    super::check_admin_config,
    crate::error::Result,
    crate::{
        accounts::{data, kind, parse},
        borsh::{rd_bool, rd_u32, wr_bytes, Args},
        error::{require, ALREADY_REVEALED, SEED_LOCKED},
        state::config,
    },
    pinocchio::AccountView,
};

#[inline(never)]
pub fn process(accounts: &[AccountView], args: &[u8]) -> Result {
    let mut a = Args::new(args);
    let hash = a.key();
    a.finish()?;

    let [admin, config_acc] = parse(accounts, &[kind::SIGNER, kind::CONFIG])?;
    // SAFETY: `parse` checked the account holds a `Config`.
    let c = unsafe { data::<{ config::SPACE }>(config_acc) };
    check_admin_config(config_acc, c, admin, true)?;

    require(
        !rd_bool(c, config::PASS_REVEALED) && !rd_bool(c, config::PASS_SEED_REVEALED),
        ALREADY_REVEALED,
    )?;
    require(rd_u32(c, config::PASS_MINTED) == 0, SEED_LOCKED)?;
    wr_bytes(c, config::PASS_SEED_HASH, &hash);
    Ok(())
}
