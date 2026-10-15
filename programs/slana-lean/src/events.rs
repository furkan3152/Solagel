//! Anchor events: `emit!` logs one `sol_log_data` slice, `discriminator ‖ borsh(fields)`
//! ("Program data: <base64>"). The discriminators are `sha256("event:<Name>")[..8]`; the unit
//! tests compare them, and the encodings, with the reference.

use crate::borsh::{wr_bytes, wr_u16, wr_u64};

pub const PLAYER_REGISTERED: [u8; 8] = [175, 78, 252, 170, 75, 230, 36, 251];
pub const PROFILE_UPDATED: [u8; 8] = [186, 248, 62, 98, 112, 98, 161, 252];
pub const ARENA_JOINED: [u8; 8] = [195, 38, 154, 241, 247, 142, 31, 5];
pub const SESSION_SETTLED: [u8; 8] = [127, 161, 59, 136, 23, 168, 191, 149];
pub const SESSION_REFUNDED: [u8; 8] = [176, 138, 119, 46, 99, 172, 75, 152];
pub const SEASON_ENDED: [u8; 8] = [231, 210, 35, 6, 231, 92, 111, 69];
pub const REWARD_CLAIMED: [u8; 8] = [49, 28, 87, 84, 158, 48, 229, 175];
pub const SEASON_ROLLED_OVER: [u8; 8] = [70, 173, 38, 206, 53, 30, 122, 83];
pub const ARENA_SWEPT: [u8; 8] = [132, 32, 57, 60, 149, 87, 201, 80];
pub const ARENA_CREATED: [u8; 8] = [93, 57, 84, 96, 112, 3, 148, 17];
pub const TREASURY_WITHDRAWN: [u8; 8] = [143, 181, 157, 169, 87, 155, 170, 46];
pub const PASS_COLLECTION_SET: [u8; 8] = [159, 63, 91, 220, 66, 126, 121, 171];
pub const PASS_MINTED: [u8; 8] = [41, 18, 56, 61, 177, 162, 4, 13];
pub const PASS_MINT_ENDED: [u8; 8] = [62, 149, 116, 122, 113, 242, 93, 181];
pub const PASS_SEED_REVEALED: [u8; 8] = [42, 110, 80, 48, 148, 5, 106, 38];
pub const PASS_ENTROPY_CAPTURED: [u8; 8] = [190, 90, 135, 238, 49, 72, 218, 122];
pub const PASS_ENTROPY_RETARGETED: [u8; 8] = [247, 163, 240, 184, 80, 73, 235, 214];
pub const PASS_REVEALED: [u8; 8] = [31, 81, 11, 22, 7, 225, 19, 53];

/// Logs `event` (discriminator included) as one `sol_log_data` slice.
#[inline(never)]
pub fn emit(event: &[u8]) {
    #[cfg(target_os = "solana")]
    {
        let slices: [&[u8]; 1] = [event];
        // SAFETY: `&[u8]` has the `(ptr, len)` layout the syscall expects.
        unsafe {
            pinocchio::syscalls::sol_log_data(slices.as_ptr() as *const u8, 1);
        }
    }
    #[cfg(not(target_os = "solana"))]
    core::hint::black_box(event);
}

/// `ArenaCreated { arena_id: u16, entry_fee: u64, max_sessions: u16, requires_pass: bool }`.
pub fn arena_created(
    arena_id: u16,
    entry_fee: u64,
    max_sessions: u16,
    requires_pass: bool,
) -> [u8; 21] {
    let mut e = [0u8; 21];
    wr_bytes(&mut e, 0, &ARENA_CREATED);
    wr_u16(&mut e, 8, arena_id);
    wr_u64(&mut e, 10, entry_fee);
    wr_u16(&mut e, 18, max_sessions);
    e[20] = requires_pass as u8;
    e
}

/// `TreasuryWithdrawn { destination: Pubkey, amount: u64 }`.
pub fn treasury_withdrawn(destination: &[u8; 32], amount: u64) -> [u8; 48] {
    let mut e = [0u8; 48];
    wr_bytes(&mut e, 0, &TREASURY_WITHDRAWN);
    wr_bytes(&mut e, 8, destination);
    wr_u64(&mut e, 40, amount);
    e
}

/// `PassCollectionSet { collection: Pubkey }`.
pub fn pass_collection_set(collection: &[u8; 32]) -> [u8; 40] {
    let mut e = [0u8; 40];
    wr_bytes(&mut e, 0, &PASS_COLLECTION_SET);
    wr_bytes(&mut e, 8, collection);
    e
}

#[cfg(test)]
mod tests {
    use {
        super::*,
        anchor_lang::{prelude::Pubkey, Discriminator, Event},
        slana::events as r,
    };

    #[test]
    fn discriminators_match_the_reference() {
        let table: [([u8; 8], &[u8]); 18] = [
            (PLAYER_REGISTERED, r::PlayerRegistered::DISCRIMINATOR),
            (PROFILE_UPDATED, r::ProfileUpdated::DISCRIMINATOR),
            (ARENA_JOINED, r::ArenaJoined::DISCRIMINATOR),
            (SESSION_SETTLED, r::SessionSettled::DISCRIMINATOR),
            (SESSION_REFUNDED, r::SessionRefunded::DISCRIMINATOR),
            (SEASON_ENDED, r::SeasonEnded::DISCRIMINATOR),
            (REWARD_CLAIMED, r::RewardClaimed::DISCRIMINATOR),
            (SEASON_ROLLED_OVER, r::SeasonRolledOver::DISCRIMINATOR),
            (ARENA_SWEPT, r::ArenaSwept::DISCRIMINATOR),
            (ARENA_CREATED, r::ArenaCreated::DISCRIMINATOR),
            (TREASURY_WITHDRAWN, r::TreasuryWithdrawn::DISCRIMINATOR),
            (PASS_COLLECTION_SET, r::PassCollectionSet::DISCRIMINATOR),
            (PASS_MINTED, r::PassMinted::DISCRIMINATOR),
            (PASS_MINT_ENDED, r::PassMintEnded::DISCRIMINATOR),
            (PASS_SEED_REVEALED, r::PassSeedRevealed::DISCRIMINATOR),
            (PASS_ENTROPY_CAPTURED, r::PassEntropyCaptured::DISCRIMINATOR),
            (
                PASS_ENTROPY_RETARGETED,
                r::PassEntropyRetargeted::DISCRIMINATOR,
            ),
            (PASS_REVEALED, r::PassRevealed::DISCRIMINATOR),
        ];
        for (lean, reference) in table {
            assert_eq!(&lean[..], reference);
        }
    }

    #[test]
    fn encodings_match_the_reference() {
        let e = r::ArenaCreated {
            arena_id: 0x0102,
            entry_fee: 0x0304_0506_0708_090a,
            max_sessions: 0x0b0c,
            requires_pass: true,
        };
        assert_eq!(
            arena_created(e.arena_id, e.entry_fee, e.max_sessions, e.requires_pass).to_vec(),
            e.data()
        );
        let e = r::TreasuryWithdrawn {
            destination: Pubkey::new_from_array([7; 32]),
            amount: 0x0102_0304_0506_0708,
        };
        assert_eq!(
            treasury_withdrawn(&e.destination.to_bytes(), e.amount).to_vec(),
            e.data()
        );
        let e = r::PassCollectionSet {
            collection: Pubkey::new_from_array([9; 32]),
        };
        assert_eq!(
            pass_collection_set(&e.collection.to_bytes()).to_vec(),
            e.data()
        );
    }
}
