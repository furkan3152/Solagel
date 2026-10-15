//! `capture_pass_entropy()` — reference `instructions/capture_pass_entropy.rs`.
//! Permissionless and idempotent: once the seed is public and the target slot has passed,
//! stores the hash of the first slot with a block at or after the target (read from the
//! address-checked SlotHashes sysvar), `pass_final_seed = sha256(seed ‖ entropy)`, and marks
//! the Pass as revealed. A target that already left the SlotHashes window moves to
//! `slot + ENTROPY_DELAY_SLOTS` instead.
//!
//! Accounts: 0 signer, 1 config, 2 slot_hashes.
//!
//! | reference constraint                                          | lean check                 | error |
//! |---------------------------------------------------------------|----------------------------|-------|
//! | `signer: Signer`                                              | `check_signer`             | 3010 |
//! | `config: Box<Account<Config>>`                                | `check_account`            | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | `slot_hashes: UncheckedAccount`                               | `at`                       | 3005 |
//! | `config: seeds = [CONFIG_SEED], bump = config.bump`, `mut`    | `stake::check_config`      | 2006 / 2000 |
//! | `slot_hashes: address = SLOT_HASHES_ID @ BadSlotHashes`       | key compare                | BadSlotHashes |
//! | `if pass_revealed { return Ok(()) }`                          | same                       | — |
//! | `require!(pass_seed_revealed)`                                | same                       | SeedNotRevealed |
//! | `require!(Clock.slot > pass_entropy_target_slot)`             | same                       | EntropyNotReady |
//! | `logic::find_slot_hash(data, target).ok_or(BadSlotHashes)`    | `logic::find_slot_hash`    | BadSlotHashes |
//! | `NotYet`                                                      | same                       | EntropyNotReady |
//! | `Missed`: `slot.checked_add(ENTROPY_DELAY_SLOTS)`             | `checked_add`              | MathOverflow |
//!
//! `Found`: stores entropy, slot, `captured`, the final seed and `revealed`, logs `Pass
//! entropy: slot {slot} hash {hex}` and emits `PassEntropyCaptured` then `PassRevealed`.
//! `Missed`: stores the new target and emits `PassEntropyRetargeted` (the reference's
//! human-readable "missed" `msg!` is not part of the contract and is not logged).

use {
    super::{clock_slot, stake},
    crate::error::Result,
    crate::{
        accounts::{data, keq, kind, parse},
        borsh::{rd_bool, rd_key, rd_u64, wr_bool, wr_bytes, wr_u64},
        constants::{ENTROPY_DELAY_SLOTS, SLOT_HASHES_ID},
        error::{
            err, require, BAD_SLOT_HASHES, ENTROPY_NOT_READY, MATH_OVERFLOW, SEED_NOT_REVEALED,
        },
        events,
        logic::{entropy_log_line, find_slot_hash, pass_final_seed, SlotHashLookup},
        state::config,
    },
    pinocchio::AccountView,
};

#[inline(never)]
pub fn process(accounts: &[AccountView], _args: &[u8]) -> Result {
    let [_signer, config_acc, slot_hashes] =
        parse(accounts, &[kind::SIGNER, kind::CONFIG, kind::ANY])?;
    // SAFETY: `parse` checked the account holds a `Config`.
    let c = unsafe { data::<{ config::SPACE }>(config_acc) };
    stake::check_config(config_acc, c, true)?;
    require(
        keq(slot_hashes.address().as_array(), SLOT_HASHES_ID.as_array()),
        BAD_SLOT_HASHES,
    )?;

    if rd_bool(c, config::PASS_REVEALED) {
        return Ok(());
    }
    require(rd_bool(c, config::PASS_SEED_REVEALED), SEED_NOT_REVEALED)?;
    let slot = clock_slot()?;
    let target = rd_u64(c, config::PASS_ENTROPY_TARGET_SLOT);
    require(slot > target, ENTROPY_NOT_READY)?;

    // SAFETY: read only; the sysvar is not one of this instruction's writable accounts.
    let lookup = find_slot_hash(unsafe { slot_hashes.borrow_unchecked() }, target)
        .ok_or_else(|| err(BAD_SLOT_HASHES))?;
    match lookup {
        SlotHashLookup::Found(found_slot, hash) => {
            let seed = rd_key(c, config::PASS_SEED);
            let final_seed = pass_final_seed(&seed, &hash);
            wr_bytes(c, config::PASS_ENTROPY, &hash);
            wr_u64(c, config::PASS_ENTROPY_SLOT, found_slot);
            wr_bool(c, config::PASS_ENTROPY_CAPTURED, true);
            wr_bytes(c, config::PASS_FINAL_SEED, &final_seed);
            wr_bool(c, config::PASS_REVEALED, true);
            pinocchio_log::logger::log_message(entropy_log_line(found_slot, &hash).bytes());
            events::emit(&events::pass_entropy_captured(found_slot, &hash));
            events::emit(&events::pass_revealed(&seed, &hash, &final_seed));
            Ok(())
        }
        SlotHashLookup::NotYet => Err(err(ENTROPY_NOT_READY)),
        SlotHashLookup::Missed => {
            let next = slot
                .checked_add(ENTROPY_DELAY_SLOTS)
                .ok_or_else(|| err(MATH_OVERFLOW))?;
            wr_u64(c, config::PASS_ENTROPY_TARGET_SLOT, next);
            events::emit(&events::pass_entropy_retargeted(target, next));
            Ok(())
        }
    }
}
