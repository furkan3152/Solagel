//! `update_profile(name: Option<String>, skin: Option<u8>)` (reference:
//! `instructions/update_profile.rs`).
//!
//! Accounts: 0 owner, 1 profile.
//!
//! | reference constraint                                          | lean check                 | error |
//! |---------------------------------------------------------------|----------------------------|-------|
//! | args Borsh (`Option<String>`, `Option<u8>`)                   | `Args`                     | 102 |
//! | `owner: Signer`                                               | `check_signer`             | 3010 |
//! | `profile: Account<PlayerProfile>`                             | `check_account`            | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | `profile: seeds = [PROFILE_SEED, owner], bump = profile.bump` | `stake::check_profile`     | 2006 |
//! | `profile: mut`                                                | `stake::check_profile`     | 2000 |
//! | `profile: has_one = owner @ Unauthorized`                     | key compare                | Unauthorized |
//! | `logic::validate_name` (if `name`), then `logic::check_skin` (if `skin`) | same            | InvalidName / InvalidSkin |
//!
//! Emits `ProfileUpdated { owner: profile.owner, skin }`.

use {
    super::stake,
    crate::error::Result,
    crate::{
        accounts::{data, keq, kind, parse},
        borsh::{rd_key, rd_u8, wr_u8, Args},
        error::{require, UNAUTHORIZED},
        events,
        logic::{check_skin, validate_name, write_name},
        state::profile,
    },
    pinocchio::AccountView,
};

#[inline(never)]
pub fn process(accounts: &[AccountView], args: &[u8]) -> Result {
    let mut a = Args::new(args);
    let name = if a.some() { Some(a.string()) } else { None };
    let skin = if a.some() { Some(a.u8()) } else { None };
    a.finish()?;

    let [owner, profile_acc] = parse(accounts, &[kind::SIGNER, kind::PROFILE])?;
    // SAFETY: `parse` checked the profile.
    let p = unsafe { data::<{ profile::SPACE }>(profile_acc) };
    stake::check_profile(profile_acc, p, owner)?;
    require(
        keq(&rd_key(p, profile::OWNER), owner.address().as_array()),
        UNAUTHORIZED,
    )?;

    if let Some(name) = name {
        let len = validate_name(name)?;
        write_name(p, profile::NAME, name, len);
    }
    if let Some(skin) = skin {
        check_skin(skin)?;
        wr_u8(p, profile::SKIN, skin);
    }

    events::emit(&events::profile_updated(
        &rd_key(p, profile::OWNER),
        rd_u8(p, profile::SKIN),
    ));
    Ok(())
}
