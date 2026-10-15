//! Program entrypoint and discriminator dispatch.

use {
    crate::{discriminator as d, error},
    pinocchio::{error::ProgramError, AccountView, Address, ProgramResult},
};

pinocchio::program_entrypoint!(process_instruction);
pinocchio::no_allocator!();
pinocchio::nostd_panic_handler!();

#[inline(never)]
pub fn process_instruction(
    _program_id: &Address,
    _accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    if data.len() < 8 {
        return Err(not_found());
    }
    let (disc, _args) = data.split_at(8);
    let disc: [u8; 8] = match disc.try_into() {
        Ok(disc) => disc,
        Err(_) => return Err(not_found()),
    };
    // Every arm is ported in Tasks 2–6; until then each one answers like an unknown
    // instruction (Anchor 101).
    match disc {
        d::INITIALIZE
        | d::UPDATE_CONFIG
        | d::CREATE_ARENA
        | d::UPDATE_ARENA
        | d::WITHDRAW_TREASURY
        | d::REGISTER_PLAYER
        | d::UPDATE_PROFILE
        | d::JOIN_ARENA
        | d::JOIN_ARENA_WITH_PASS
        | d::SETTLE_SESSION
        | d::REFUND_SESSION
        | d::SWEEP_ARENA
        | d::SET_PASS_COLLECTION
        | d::SET_PASS_SEED_HASH
        | d::MINT_PASS
        | d::CLOSE_PASS_MINT
        | d::CAPTURE_PASS_ENTROPY
        | d::REVEAL_PASS
        | d::END_SEASON
        | d::CLAIM_SEASON_REWARD
        | d::ROLLOVER_SEASON => Err(not_found()),
        _ => Err(not_found()),
    }
}

#[cold]
#[inline(never)]
fn not_found() -> ProgramError {
    error::anchor(error::INSTRUCTION_FALLBACK_NOT_FOUND)
}
