//! `update_config(args: UpdateConfigArgs)` (reference: `instructions/update_config.rs`).
//!
//! Accounts: 0 admin, 1 config.
//!
//! | reference constraint                                    | lean check                     | error |
//! |---------------------------------------------------------|--------------------------------|-------|
//! | `UpdateConfigArgs` Borsh (6 `Option`s)                  | `Args`                         | 102 |
//! | `admin: Signer`                                         | `check_signer`                 | 3010 |
//! | `config: Account<Config>`                               | `load`                         | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | `config: seeds = [CONFIG_SEED], bump = config.bump`     | `check_admin_config` (`check_pda_seeds`) | 2006 |
//! | `config: mut`                                           | `check_admin_config` (`check_writable`) | 2000 |
//! | `config: has_one = admin @ Unauthorized`                | `check_admin_config`           | Unauthorized |
//!
//! The handler applies the fields in the reference's order with the same checks.

use {
    super::{check_admin_config, check_authority, check_fee, check_settle_fee},
    crate::error::Result,
    crate::{
        accounts::{data, kind, parse},
        borsh::{wr_bool, wr_bytes, wr_u16, wr_u64, Args},
        state::config::{self, *},
    },
    pinocchio::AccountView,
};

#[inline(never)]
pub fn process(accounts: &[AccountView], args: &[u8]) -> Result {
    // ----- UpdateConfigArgs (decoded completely before any account is touched) ------------
    let mut a = Args::new(args);
    let admin_arg = if a.some() { Some(a.key()) } else { None };
    let server_authority = if a.some() { Some(a.key()) } else { None };
    let fee_wallet = if a.some() { Some(a.key()) } else { None };
    let fee_bps = if a.some() { Some(a.u16()) } else { None };
    let settle_fee_lamports = if a.some() { Some(a.u64()) } else { None };
    let paused = if a.some() { Some(a.bool()) } else { None };
    a.finish()?;

    // ----- accounts --------------------------------------------------------------------------
    let [admin, config_acc] = parse(accounts, &[kind::SIGNER, kind::CONFIG])?;
    // SAFETY: `parse` checked the account holds a `Config` (`config::SPACE` bytes).
    let c = unsafe { data::<{ config::SPACE }>(config_acc) };
    check_admin_config(config_acc, c, admin, true)?;

    // ----- handler ---------------------------------------------------------------------------
    if let Some(fee) = fee_bps {
        check_fee(fee)?;
        wr_u16(c, FEE_BPS, fee);
    }
    if let Some(lamports) = settle_fee_lamports {
        check_settle_fee(lamports)?;
        wr_u64(c, SETTLE_FEE_LAMPORTS, lamports);
    }
    if let Some(key) = admin_arg {
        check_authority(&key)?;
        wr_bytes(c, ADMIN, &key);
    }
    if let Some(key) = server_authority {
        check_authority(&key)?;
        wr_bytes(c, SERVER_AUTHORITY, &key);
    }
    if let Some(key) = fee_wallet {
        check_authority(&key)?;
        wr_bytes(c, FEE_WALLET, &key);
    }
    if let Some(paused) = paused {
        wr_bool(c, PAUSED, paused);
    }
    Ok(())
}
