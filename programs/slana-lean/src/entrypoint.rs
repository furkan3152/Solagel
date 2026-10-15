//! Program entrypoint and discriminator dispatch.
//!
//! A hand-written `entrypoint` around pinocchio's input `deserialize`: the handlers return
//! [`crate::error::Error`], already the `u64` the runtime expects, so no `ProgramError`
//! conversion table is linked in.

use {
    crate::{
        discriminator as d,
        error::{
            err, Result, DECLARED_PROGRAM_ID_MISMATCH, EVENT_INSTRUCTION_STUB,
            INSTRUCTION_FALLBACK_NOT_FOUND,
        },
        instructions as ix, ID,
    },
    core::mem::MaybeUninit,
    pinocchio::{entrypoint::deserialize, AccountView, Address, MAX_TX_ACCOUNTS},
};

pinocchio::no_allocator!();
pinocchio::nostd_panic_handler!();

/// Program entrypoint.
///
/// # Safety
///
/// Called by the runtime with its serialized program input.
#[no_mangle]
pub unsafe extern "C" fn entrypoint(input: *mut u8) -> u64 {
    const UNINIT: MaybeUninit<AccountView> = MaybeUninit::<AccountView>::uninit();
    let mut accounts = [UNINIT; MAX_TX_ACCOUNTS];
    // SAFETY: `input` is the runtime's input buffer.
    let (program_id, count, data) = unsafe { deserialize::<MAX_TX_ACCOUNTS>(input, &mut accounts) };
    // SAFETY: `deserialize` initialized the first `count` views.
    let accounts =
        unsafe { core::slice::from_raw_parts(accounts.as_ptr() as *const AccountView, count) };
    match process_instruction(program_id, accounts, data) {
        Ok(()) => 0,
        Err(e) => e.code(),
    }
}

/// Anchor's `entry` + `dispatch`: the program id (`DeclaredProgramIdMismatch`), then the
/// instruction discriminators, then the event-CPI tag (`EventInstructionStub`; the reference
/// is built without `event-cpi`), else `InstructionFallbackNotFound`.
#[inline(never)]
fn process_instruction(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> Result {
    if program_id != &ID {
        return Err(err(DECLARED_PROGRAM_ID_MISMATCH));
    }
    let Some((disc, args)) = data.split_first_chunk::<8>() else {
        return Err(err(INSTRUCTION_FALLBACK_NOT_FOUND));
    };
    // Compared as one u64 per arm. Instructions not ported yet (Tasks 3–5) answer like an
    // unknown instruction (Anchor 101).
    match u64::from_le_bytes(*disc) {
        INITIALIZE => ix::initialize::process(accounts, args),
        UPDATE_CONFIG => ix::update_config::process(accounts, args),
        CREATE_ARENA => ix::create_arena::process(accounts, args),
        UPDATE_ARENA => ix::update_arena::process(accounts, args),
        WITHDRAW_TREASURY => ix::withdraw_treasury::process(accounts, args),
        SET_PASS_COLLECTION => ix::set_pass_collection::process(accounts, args),
        SET_PASS_SEED_HASH => ix::set_pass_seed_hash::process(accounts, args),
        EVENT_IX_TAG => Err(err(EVENT_INSTRUCTION_STUB)),
        _ => Err(err(INSTRUCTION_FALLBACK_NOT_FOUND)),
    }
}

const INITIALIZE: u64 = u64::from_le_bytes(d::INITIALIZE);
const UPDATE_CONFIG: u64 = u64::from_le_bytes(d::UPDATE_CONFIG);
const CREATE_ARENA: u64 = u64::from_le_bytes(d::CREATE_ARENA);
const UPDATE_ARENA: u64 = u64::from_le_bytes(d::UPDATE_ARENA);
const WITHDRAW_TREASURY: u64 = u64::from_le_bytes(d::WITHDRAW_TREASURY);
const SET_PASS_COLLECTION: u64 = u64::from_le_bytes(d::SET_PASS_COLLECTION);
const SET_PASS_SEED_HASH: u64 = u64::from_le_bytes(d::SET_PASS_SEED_HASH);
const EVENT_IX_TAG: u64 = u64::from_le_bytes(d::EVENT_IX_TAG_LE);
