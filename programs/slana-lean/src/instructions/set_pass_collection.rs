//! `set_pass_collection()` — reference `instructions/set_pass_collection.rs`.
//!
//! Accounts: 0 admin, 1 config, 2 collection, 3 pass_authority.
//!
//! | reference constraint                                    | lean check                     | error |
//! |---------------------------------------------------------|--------------------------------|-------|
//! | `admin: Signer`                                         | `check_signer`                 | 3010 |
//! | `config: Account<Config>`                               | `load`                         | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | `collection: UncheckedAccount`                          | `at`                           | 3005 |
//! | `pass_authority: UncheckedAccount`                      | `at`                           | 3005 |
//! | `config: seeds = [CONFIG_SEED], bump = config.bump`     | `check_admin_config`           | 2006 |
//! | `config: mut`                                           | `check_admin_config`           | 2000 |
//! | `config: has_one = admin @ Unauthorized`                | `check_admin_config`           | Unauthorized |
//! | `pass_authority: seeds = [PASS_AUTHORITY_SEED], bump`   | `check_canonical_pda`          | 2006 |
//! | `require_keys_eq!(config.pass_collection, default)`     | same                           | CollectionAlreadySet |
//! | `core_asset::read_core_collection(collection)`          | `core_asset::read_core_collection` | BadCollection |
//! | `require_keys_eq!(update_authority, pass_authority)`    | same                           | BadCollection |
//!
//! Emits `PassCollectionSet`.

use {
    super::check_admin_config,
    crate::error::Result,
    crate::{
        accounts::{check_canonical_pda, data, keq, kind, parse},
        borsh::{rd_key, wr_bytes},
        constants::PASS_AUTHORITY_SEED,
        core_asset::read_core_collection,
        error::{require, BAD_COLLECTION, COLLECTION_ALREADY_SET},
        events,
        state::config,
        ID,
    },
    pinocchio::{cpi::Seed, AccountView},
};

#[inline(never)]
pub fn process(accounts: &[AccountView], _args: &[u8]) -> Result {
    let [admin, config_acc, collection, pass_authority] = parse(
        accounts,
        &[kind::SIGNER, kind::CONFIG, kind::ANY, kind::ANY],
    )?;
    // SAFETY: `parse` checked the account holds a `Config`.
    let c = unsafe { data::<{ config::SPACE }>(config_acc) };

    check_admin_config(config_acc, c, admin, true)?;
    check_canonical_pda(pass_authority, &[Seed::from(PASS_AUTHORITY_SEED)], &ID)?;

    require(
        keq(&rd_key(c, config::PASS_COLLECTION), &[0; 32]),
        COLLECTION_ALREADY_SET,
    )?;
    let update_authority = read_core_collection(collection)?;
    require(
        keq(&update_authority, pass_authority.address().as_array()),
        BAD_COLLECTION,
    )?;
    let key = collection.address().as_array();
    wr_bytes(c, config::PASS_COLLECTION, key);

    events::emit(&events::pass_collection_set(key));
    Ok(())
}
