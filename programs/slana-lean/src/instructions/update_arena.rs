//! `update_arena(enabled, max_sessions, entry_fee, requires_pass)` — reference
//! `instructions/update_arena.rs`.
//!
//! Accounts: 0 admin, 1 config, 2 arena.
//!
//! | reference constraint                                          | lean check                   | error |
//! |---------------------------------------------------------------|------------------------------|-------|
//! | args Borsh (`Option<bool>, Option<u16>, Option<u64>, Option<bool>`) | `Args`                 | 102 |
//! | `admin: Signer`                                               | `check_signer`               | 3010 |
//! | `config: Account<Config>`                                     | `load`                       | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | `arena: Account<Arena>`                                       | `load`                       | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | `config: seeds = [CONFIG_SEED], bump = config.bump`           | `check_admin_config`         | 2006 |
//! | `config: has_one = admin @ Unauthorized`                      | `check_admin_config`         | Unauthorized |
//! | `arena: seeds = [ARENA_SEED, arena.id LE], bump = arena.bump` | `check_pda`                  | 2006 |
//! | `arena: mut`                                                  | `check_writable`             | 2000 |

use {
    super::{check_admin_config, check_entry_fee, check_max_sessions},
    crate::error::Result,
    crate::{
        accounts::{check_pda, check_writable, data, kind, parse},
        borsh::{rd_u16, rd_u8, wr_bool, wr_u16, wr_u64, Args},
        constants::ARENA_SEED,
        error::{require, ARENA_BUSY},
        state::{arena, config},
    },
    pinocchio::{cpi::Seed, AccountView},
};

#[inline(never)]
pub fn process(accounts: &[AccountView], args: &[u8]) -> Result {
    let mut a = Args::new(args);
    let enabled = if a.some() { Some(a.bool()) } else { None };
    let max_sessions = if a.some() { Some(a.u16()) } else { None };
    let entry_fee = if a.some() { Some(a.u64()) } else { None };
    let requires_pass = if a.some() { Some(a.bool()) } else { None };
    a.finish()?;

    let [admin, config_acc, arena_acc] =
        parse(accounts, &[kind::SIGNER, kind::CONFIG, kind::ARENA])?;
    // SAFETY: `parse` checked both accounts' types; they are distinct PDAs (checked below)
    // before anything is written.
    let c = unsafe { data::<{ config::SPACE }>(config_acc) };
    let r = unsafe { data::<{ arena::SPACE }>(arena_acc) };

    check_admin_config(config_acc, c, admin, false)?;
    let id = rd_u16(r, arena::ID).to_le_bytes();
    let bump = [rd_u8(r, arena::BUMP)];
    check_pda(
        arena_acc,
        &[Seed::from(ARENA_SEED), Seed::from(&id), Seed::from(&bump)],
    )?;
    check_writable(arena_acc)?;

    if entry_fee.is_some() || requires_pass.is_some() {
        require(rd_u16(r, arena::OPEN_SESSIONS) == 0, ARENA_BUSY)?;
    }
    if let Some(enabled) = enabled {
        wr_bool(r, arena::ENABLED, enabled);
    }
    if let Some(max_sessions) = max_sessions {
        check_max_sessions(max_sessions)?;
        wr_u16(r, arena::MAX_SESSIONS, max_sessions);
    }
    if let Some(entry_fee) = entry_fee {
        check_entry_fee(entry_fee)?;
        wr_u64(r, arena::ENTRY_FEE, entry_fee);
    }
    if let Some(requires_pass) = requires_pass {
        wr_bool(r, arena::REQUIRES_PASS, requires_pass);
    }
    Ok(())
}
