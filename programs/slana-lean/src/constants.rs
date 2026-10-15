//! Constants of the reference (`programs/slana-ref/src/constants.rs`) and the program
//! addresses the lean program needs. The unit tests compare them with the reference.

use pinocchio::Address;

// ----- PDA seeds ----------------------------------------------------------------------------

pub const CONFIG_SEED: &[u8] = b"config";
pub const PROFILE_SEED: &[u8] = b"profile";
pub const ARENA_SEED: &[u8] = b"arena";
pub const VAULT_SEED: &[u8] = b"vault";
pub const TREASURY_VAULT_SEED: &[u8] = b"treasury_vault";
pub const SEASON_VAULT_SEED: &[u8] = b"season_vault";
pub const PASS_AUTHORITY_SEED: &[u8] = b"pass_authority";
pub const PASS_LOCK_SEED: &[u8] = b"pass_lock";
pub const PASS_MINTED_SEED: &[u8] = b"pass_minted";
pub const SESSION_SEED: &[u8] = b"session";
pub const SEASON_SEED: &[u8] = b"season";

// ----- sizes ----------------------------------------------------------------------------------

pub const NAME_BYTES: usize = 16;
pub const LEADERBOARD_LEN: usize = 20;
pub const BASE_URI_BYTES: usize = 96;

// ----- money ----------------------------------------------------------------------------------

pub const BPS: u16 = 10_000;
pub const MAX_FEE_BPS: u16 = 1_000;
pub const MAX_SETTLE_FEE_LAMPORTS: u64 = 1_000_000;
pub const MIN_ARENA_SESSIONS: u16 = 2;
pub const MAX_ARENA_SESSIONS: u16 = 2_000;

// ----- Slana Pass -----------------------------------------------------------------------------

pub const MAX_PASS_SUPPLY: u32 = 10_000;
pub const MAX_PASS_PER_WALLET: u8 = 10;
pub const DEFAULT_PASS_SUPPLY: u32 = 3_333;
pub const DEFAULT_PASS_PER_WALLET: u8 = 1;
/// `reveal_pass` sets the entropy target this many slots after the reveal (and a missed
/// target moves this far past the current slot).
pub const ENTROPY_DELAY_SLOTS: u64 = 150;

// ----- game -----------------------------------------------------------------------------------

pub const FIRST_SEASON: u32 = 1;
/// A session the server never settled can be refunded this long after the join.
pub const SESSION_REFUND_TIMEOUT_SECS: i64 = 86_400;
pub const MAX_XP_PER_GAME: u32 = 2_000;
pub const MAX_SCORE_PER_GAME: u32 = 1_000_000;
/// Skins `0..BASIC_SKINS`.
pub const BASIC_SKINS: u8 = 8;

// ----- programs -------------------------------------------------------------------------------

/// System program (`11111111111111111111111111111111`).
pub const SYSTEM_PROGRAM_ID: Address = Address::new_from_array([0; 32]);

/// SPL Token (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`).
pub const TOKEN_PROGRAM_ID: Address = Address::new_from_array([
    6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237,
    95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169,
]);

/// SPL Token-2022 (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`).
pub const TOKEN_2022_PROGRAM_ID: Address = Address::new_from_array([
    6, 221, 246, 225, 238, 117, 143, 222, 24, 66, 93, 188, 228, 108, 205, 218, 182, 26, 252, 77,
    131, 185, 13, 39, 254, 189, 249, 40, 216, 161, 139, 252,
]);

/// BPF loader v3 (`BPFLoaderUpgradeab1e11111111111111111111111`).
pub const BPF_LOADER_UPGRADEABLE_ID: Address = Address::new_from_array([
    2, 168, 246, 145, 78, 136, 161, 176, 226, 16, 21, 62, 247, 99, 174, 43, 0, 194, 185, 61, 22,
    193, 36, 210, 192, 83, 122, 16, 4, 128, 0, 0,
]);

/// Metaplex Core (`CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`).
pub const MPL_CORE_ID: Address = Address::new_from_array([
    175, 84, 171, 16, 189, 151, 165, 66, 160, 158, 247, 179, 152, 137, 221, 12, 211, 148, 164, 204,
    233, 223, 166, 205, 201, 126, 190, 45, 35, 91, 167, 72,
]);

/// SlotHashes sysvar (`SysvarS1otHashes111111111111111111111111111`).
pub const SLOT_HASHES_ID: Address = Address::new_from_array([
    6, 167, 213, 23, 25, 47, 10, 175, 198, 242, 101, 227, 251, 119, 204, 122, 218, 130, 197, 41,
    208, 190, 59, 19, 110, 45, 0, 85, 32, 0, 0, 0,
]);

#[cfg(test)]
mod tests {
    use {super::*, anchor_lang::prelude::Pubkey, slana::constants as r};

    fn key(a: &Address) -> Pubkey {
        Pubkey::new_from_array(a.to_bytes())
    }

    #[test]
    fn constants_match_the_reference() {
        let seeds: [(&[u8], &[u8]); 11] = [
            (CONFIG_SEED, r::CONFIG_SEED),
            (PROFILE_SEED, r::PROFILE_SEED),
            (ARENA_SEED, r::ARENA_SEED),
            (VAULT_SEED, r::VAULT_SEED),
            (TREASURY_VAULT_SEED, r::TREASURY_VAULT_SEED),
            (SEASON_VAULT_SEED, r::SEASON_VAULT_SEED),
            (PASS_AUTHORITY_SEED, r::PASS_AUTHORITY_SEED),
            (PASS_LOCK_SEED, r::PASS_LOCK_SEED),
            (PASS_MINTED_SEED, r::PASS_MINTED_SEED),
            (SESSION_SEED, r::SESSION_SEED),
            (SEASON_SEED, r::SEASON_SEED),
        ];
        for (lean, reference) in seeds {
            assert_eq!(lean, reference);
        }
        assert_eq!(NAME_BYTES, r::NAME_BYTES);
        assert_eq!(LEADERBOARD_LEN, r::LEADERBOARD_LEN);
        assert_eq!(BASE_URI_BYTES, r::BASE_URI_BYTES);
        assert_eq!(BPS, r::BPS);
        assert_eq!(MAX_FEE_BPS, r::MAX_FEE_BPS);
        assert_eq!(MAX_SETTLE_FEE_LAMPORTS, r::MAX_SETTLE_FEE_LAMPORTS);
        assert_eq!(MIN_ARENA_SESSIONS, r::MIN_ARENA_SESSIONS);
        assert_eq!(MAX_ARENA_SESSIONS, r::MAX_ARENA_SESSIONS);
        assert_eq!(MAX_PASS_SUPPLY, r::MAX_PASS_SUPPLY);
        assert_eq!(MAX_PASS_PER_WALLET, r::MAX_PASS_PER_WALLET);
        assert_eq!(DEFAULT_PASS_SUPPLY, r::DEFAULT_PASS_SUPPLY);
        assert_eq!(DEFAULT_PASS_PER_WALLET, r::DEFAULT_PASS_PER_WALLET);
        assert_eq!(FIRST_SEASON, r::FIRST_SEASON);
        assert_eq!(SESSION_REFUND_TIMEOUT_SECS, r::SESSION_REFUND_TIMEOUT_SECS);
        assert_eq!(MAX_XP_PER_GAME, r::MAX_XP_PER_GAME);
        assert_eq!(MAX_SCORE_PER_GAME, r::MAX_SCORE_PER_GAME);
        assert_eq!(BASIC_SKINS, r::BASIC_SKINS);
        assert_eq!(ENTROPY_DELAY_SLOTS, r::ENTROPY_DELAY_SLOTS);
    }

    #[test]
    fn program_ids_match() {
        use anchor_lang::solana_program::{bpf_loader_upgradeable, system_program};
        assert_eq!(key(&SYSTEM_PROGRAM_ID), system_program::ID);
        assert_eq!(key(&TOKEN_PROGRAM_ID), anchor_spl::token::ID);
        assert_eq!(key(&TOKEN_2022_PROGRAM_ID), anchor_spl::token_2022::ID);
        assert_eq!(key(&BPF_LOADER_UPGRADEABLE_ID), bpf_loader_upgradeable::ID);
        assert_eq!(key(&MPL_CORE_ID), r::MPL_CORE_ID);
        assert_eq!(key(&SLOT_HASHES_ID), r::SLOT_HASHES_ID);
    }
}
