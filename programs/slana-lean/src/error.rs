//! Error codes. Anchor built-ins keep Anchor's numbers; `SlanaError` codes (6000+) arrive with
//! the instruction ports.

use pinocchio::error::ProgramError;

/// Anchor `ErrorCode::InstructionFallbackNotFound`: no instruction matched the discriminator.
pub const INSTRUCTION_FALLBACK_NOT_FOUND: u32 = 101;

#[inline(always)]
pub const fn anchor(code: u32) -> ProgramError {
    ProgramError::Custom(code)
}
