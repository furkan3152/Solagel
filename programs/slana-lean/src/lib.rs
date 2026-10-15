//! Slana — the deployed program, written with Pinocchio.
//!
//! Wire-compatible with the Anchor reference (`programs/slana-ref`, lib `slana`): the same
//! instruction discriminators and Borsh args, account order and flags, account layouts, PDA
//! seeds, error codes and events. The reference is never deployed; it is the IDL source and
//! the conformance oracle the LiteSVM suite runs against (`SLANA_IMPL=ref|lean`).
//!
//! `no_std`, no allocator, no `core::fmt`, no floats.

#![cfg_attr(not(test), no_std)]
// `RangeInclusive::contains` is not inlined at `opt-level = "z"` (an out-of-line call per
// type); the explicit comparisons are smaller.
#![allow(clippy::manual_range_contains)]
// `overflow-checks = false` in release (root Cargo.toml): every arithmetic site is either
// `checked_*` (returning the reference's error) or carries a local allow with its bound.
#![cfg_attr(not(test), deny(clippy::arithmetic_side_effects))]

pub mod accounts;
pub mod borsh;
pub mod constants;
pub mod core_asset;
pub mod cpi;
pub mod discriminator;
pub mod error;
pub mod events;
pub mod instructions;
pub mod logic;
pub mod state;
pub mod token;

#[cfg(not(test))]
mod entrypoint;

use pinocchio::Address;

/// Program id, identical to the reference's `declare_id!`
/// (`5skf5Twyqr8M84dJ8RLGfz1NU6fR3zPDRLUvGd5y7472`).
pub const ID: Address = Address::new_from_array([
    72, 111, 38, 149, 160, 93, 0, 23, 177, 15, 48, 252, 98, 121, 13, 150, 85, 64, 195, 168, 89,
    155, 185, 173, 103, 216, 69, 152, 128, 182, 245, 57,
]);

#[cfg(test)]
mod tests {
    #[test]
    fn program_id_matches_reference() {
        assert_eq!(super::ID.to_bytes(), slana::ID.to_bytes());
    }
}
