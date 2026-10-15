//! `close_pass_mint()` — reference `instructions/close_pass_mint.rs`: ends the Pass mint for
//! good (no entropy target: `reveal_pass` sets it later).
//!
//! Accounts: 0 admin, 1 config.
//!
//! | reference constraint                                    | lean check                     | error |
//! |---------------------------------------------------------|--------------------------------|-------|
//! | `admin: Signer`                                         | `check_signer`                 | 3010 |
//! | `config: Box<Account<Config>>`                          | `check_account`                | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | `config: seeds = [CONFIG_SEED], bump = config.bump`     | `check_admin_config`           | 2006 |
//! | `config: mut`                                           | `check_admin_config`           | 2000 |
//! | `config: has_one = admin @ Unauthorized`                | `check_admin_config`           | Unauthorized |
//! | `require!(!config.pass_mint_ended)`                     | same                           | MintEnded |
//! | `require!(config.pass_minted > 0)`                      | same                           | NothingMinted |
//! | `shared::end_pass_mint`                                 | [`end_pass_mint`]              | MintEnded |

use {
    super::check_admin_config,
    crate::error::Result,
    crate::{
        accounts::{data, kind, parse},
        borsh::{rd_bool, rd_u32, wr_bool},
        error::{require, MINT_ENDED, NOTHING_MINTED},
        events,
        state::config,
    },
    pinocchio::AccountView,
};

#[inline(never)]
pub fn process(accounts: &[AccountView], _args: &[u8]) -> Result {
    let [admin, config_acc] = parse(accounts, &[kind::SIGNER, kind::CONFIG])?;
    // SAFETY: `parse` checked the account holds a `Config`.
    let c = unsafe { data::<{ config::SPACE }>(config_acc) };
    check_admin_config(config_acc, c, admin, true)?;

    require(!rd_bool(c, config::PASS_MINT_ENDED), MINT_ENDED)?;
    require(rd_u32(c, config::PASS_MINTED) > 0, NOTHING_MINTED)?;
    end_pass_mint(c)
}

/// Reference `shared::end_pass_mint`: `MintEnded` if already ended, else ended for good, the
/// mint closed, and `PassMintEnded { minted }`.
#[inline(never)]
pub(crate) fn end_pass_mint(c: &mut [u8; config::SPACE]) -> Result {
    require(!rd_bool(c, config::PASS_MINT_ENDED), MINT_ENDED)?;
    wr_bool(c, config::PASS_MINT_ENDED, true);
    wr_bool(c, config::PASS_MINT_OPEN, false);
    events::emit(&events::pass_mint_ended(rd_u32(c, config::PASS_MINTED)));
    Ok(())
}
