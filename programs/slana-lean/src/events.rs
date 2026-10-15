//! Anchor events: `emit!` logs one `sol_log_data` slice, `discriminator ‖ borsh(fields)`
//! ("Program data: <base64>"). The discriminators are `sha256("event:<Name>")[..8]`; the unit
//! tests compare them, and the encodings, with the reference.

use crate::borsh::{wr_bool, wr_bytes, wr_u16, wr_u32, wr_u64};

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

/// `PlayerRegistered { owner: Pubkey, name: String }` for a name of at most 16 bytes; the
/// event is the first `8 + 32 + 4 + name.len()` bytes.
pub fn player_registered(owner: &[u8; 32], name: &[u8]) -> [u8; 60] {
    let mut e = [0u8; 60];
    wr_bytes(&mut e, 0, &PLAYER_REGISTERED);
    wr_bytes(&mut e, 8, owner);
    wr_u32(&mut e, 40, name.len() as u32);
    wr_bytes(&mut e, 44, name);
    e
}

/// `ProfileUpdated { owner: Pubkey, skin: u8 }`.
pub fn profile_updated(owner: &[u8; 32], skin: u8) -> [u8; 41] {
    let mut e = [0u8; 41];
    wr_bytes(&mut e, 0, &PROFILE_UPDATED);
    wr_bytes(&mut e, 8, owner);
    e[40] = skin;
    e
}

/// `ArenaJoined { player, arena_id: u16, session_id: u64, entry_fee: u64, has_pass: bool }`.
pub fn arena_joined(
    player: &[u8; 32],
    arena_id: u16,
    session_id: u64,
    entry_fee: u64,
    has_pass: bool,
) -> [u8; 59] {
    let mut e = [0u8; 59];
    wr_bytes(&mut e, 0, &ARENA_JOINED);
    wr_bytes(&mut e, 8, player);
    wr_u16(&mut e, 40, arena_id);
    wr_u64(&mut e, 42, session_id);
    wr_u64(&mut e, 50, entry_fee);
    wr_bool(&mut e, 58, has_pass);
    e
}

/// `SessionSettled { player, arena_id: u16, session_id: u64, payout: u64, fee: u64,
/// burned: u64, has_pass: bool, score: u32, kills: u16, owed: u64 }`: the fixed head
/// (player .. session_id) comes from the session, the rest from the settlement.
pub struct SessionSettled {
    pub payout: u64,
    pub fee: u64,
    pub burned: u64,
    pub has_pass: bool,
    pub score: u32,
    pub kills: u16,
    pub owed: u64,
}

pub fn session_settled(
    player: &[u8; 32],
    arena_id: u16,
    session_id: u64,
    s: &SessionSettled,
) -> [u8; 89] {
    let mut e = [0u8; 89];
    wr_bytes(&mut e, 0, &SESSION_SETTLED);
    wr_bytes(&mut e, 8, player);
    wr_u16(&mut e, 40, arena_id);
    wr_u64(&mut e, 42, session_id);
    wr_u64(&mut e, 50, s.payout);
    wr_u64(&mut e, 58, s.fee);
    wr_u64(&mut e, 66, s.burned);
    wr_bool(&mut e, 74, s.has_pass);
    wr_u32(&mut e, 75, s.score);
    wr_u16(&mut e, 79, s.kills);
    wr_u64(&mut e, 81, s.owed);
    e
}

/// `SessionRefunded { player, arena_id: u16, amount: u64, finalized: bool }`.
pub fn session_refunded(
    player: &[u8; 32],
    arena_id: u16,
    amount: u64,
    finalized: bool,
) -> [u8; 51] {
    let mut e = [0u8; 51];
    wr_bytes(&mut e, 0, &SESSION_REFUNDED);
    wr_bytes(&mut e, 8, player);
    wr_u16(&mut e, 40, arena_id);
    wr_u64(&mut e, 42, amount);
    wr_bool(&mut e, 50, finalized);
    e
}

/// `SeasonEnded { season_id: u32, prize_pool: u64 }`.
pub fn season_ended(season_id: u32, prize_pool: u64) -> [u8; 20] {
    let mut e = [0u8; 20];
    wr_bytes(&mut e, 0, &SEASON_ENDED);
    wr_u32(&mut e, 8, season_id);
    wr_u64(&mut e, 12, prize_pool);
    e
}

/// `RewardClaimed { season_id: u32, player: Pubkey, rank: u8, amount: u64 }`.
pub fn reward_claimed(season_id: u32, player: &[u8; 32], rank: u8, amount: u64) -> [u8; 53] {
    let mut e = [0u8; 53];
    wr_bytes(&mut e, 0, &REWARD_CLAIMED);
    wr_u32(&mut e, 8, season_id);
    wr_bytes(&mut e, 12, player);
    e[44] = rank;
    wr_u64(&mut e, 45, amount);
    e
}

/// `SeasonRolledOver { from: u32, to: u32, amount: u64 }`.
pub fn season_rolled_over(from: u32, to: u32, amount: u64) -> [u8; 24] {
    let mut e = [0u8; 24];
    wr_bytes(&mut e, 0, &SEASON_ROLLED_OVER);
    wr_u32(&mut e, 8, from);
    wr_u32(&mut e, 12, to);
    wr_u64(&mut e, 16, amount);
    e
}

/// `ArenaSwept { arena_id: u16, season_id: u32, amount: u64 }`.
pub fn arena_swept(arena_id: u16, season_id: u32, amount: u64) -> [u8; 22] {
    let mut e = [0u8; 22];
    wr_bytes(&mut e, 0, &ARENA_SWEPT);
    wr_u16(&mut e, 8, arena_id);
    wr_u32(&mut e, 10, season_id);
    wr_u64(&mut e, 14, amount);
    e
}

/// `PassMinted { minter: Pubkey, asset: Pubkey, number: u32 }`.
pub fn pass_minted(minter: &[u8; 32], asset: &[u8; 32], number: u32) -> [u8; 76] {
    let mut e = [0u8; 76];
    wr_bytes(&mut e, 0, &PASS_MINTED);
    wr_bytes(&mut e, 8, minter);
    wr_bytes(&mut e, 40, asset);
    wr_u32(&mut e, 72, number);
    e
}

/// `PassMintEnded { minted: u32 }`.
pub fn pass_mint_ended(minted: u32) -> [u8; 12] {
    let mut e = [0u8; 12];
    wr_bytes(&mut e, 0, &PASS_MINT_ENDED);
    wr_u32(&mut e, 8, minted);
    e
}

/// `PassSeedRevealed { seed: [u8; 32], entropy_target_slot: u64 }`.
pub fn pass_seed_revealed(seed: &[u8; 32], entropy_target_slot: u64) -> [u8; 48] {
    let mut e = [0u8; 48];
    wr_bytes(&mut e, 0, &PASS_SEED_REVEALED);
    wr_bytes(&mut e, 8, seed);
    wr_u64(&mut e, 40, entropy_target_slot);
    e
}

/// `PassEntropyCaptured { slot: u64, entropy: [u8; 32] }`.
pub fn pass_entropy_captured(slot: u64, entropy: &[u8; 32]) -> [u8; 48] {
    let mut e = [0u8; 48];
    wr_bytes(&mut e, 0, &PASS_ENTROPY_CAPTURED);
    wr_u64(&mut e, 8, slot);
    wr_bytes(&mut e, 16, entropy);
    e
}

/// `PassEntropyRetargeted { missed_target_slot: u64, entropy_target_slot: u64 }`.
pub fn pass_entropy_retargeted(missed_target_slot: u64, entropy_target_slot: u64) -> [u8; 24] {
    let mut e = [0u8; 24];
    wr_bytes(&mut e, 0, &PASS_ENTROPY_RETARGETED);
    wr_u64(&mut e, 8, missed_target_slot);
    wr_u64(&mut e, 16, entropy_target_slot);
    e
}

/// `PassRevealed { seed: [u8; 32], entropy: [u8; 32], final_seed: [u8; 32] }`.
pub fn pass_revealed(seed: &[u8; 32], entropy: &[u8; 32], final_seed: &[u8; 32]) -> [u8; 104] {
    let mut e = [0u8; 104];
    wr_bytes(&mut e, 0, &PASS_REVEALED);
    wr_bytes(&mut e, 8, seed);
    wr_bytes(&mut e, 40, entropy);
    wr_bytes(&mut e, 72, final_seed);
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
        let k = Pubkey::new_from_array([5; 32]);
        for name in ["", "a", "abcdefghijklmnop", "Renée🚀"] {
            let e = r::PlayerRegistered {
                owner: k,
                name: name.to_string(),
            };
            let len = 44 + name.len();
            assert_eq!(
                player_registered(&k.to_bytes(), name.as_bytes())[..len].to_vec(),
                e.data()
            );
        }
        let e = r::ProfileUpdated { owner: k, skin: 7 };
        assert_eq!(profile_updated(&k.to_bytes(), 7).to_vec(), e.data());
        let e = r::ArenaJoined {
            player: k,
            arena_id: 0x0102,
            session_id: 0x0304_0506_0708_090a,
            entry_fee: 0x0b0c_0d0e_0f10_1112,
            has_pass: true,
        };
        assert_eq!(
            arena_joined(&k.to_bytes(), e.arena_id, e.session_id, e.entry_fee, true).to_vec(),
            e.data()
        );
        let e = r::SessionSettled {
            player: k,
            arena_id: 0x0102,
            session_id: 0x0304_0506_0708_090a,
            payout: 0x1112_1314_1516_1718,
            fee: 0x2122_2324_2526_2728,
            burned: 0x3132_3334_3536_3738,
            has_pass: true,
            score: 0x4142_4344,
            kills: 0x5152,
            owed: 0x6162_6364_6566_6768,
        };
        let s = SessionSettled {
            payout: e.payout,
            fee: e.fee,
            burned: e.burned,
            has_pass: e.has_pass,
            score: e.score,
            kills: e.kills,
            owed: e.owed,
        };
        assert_eq!(
            session_settled(&k.to_bytes(), e.arena_id, e.session_id, &s).to_vec(),
            e.data()
        );
        let e = r::SessionRefunded {
            player: k,
            arena_id: 0x0102,
            amount: 0x0304_0506_0708_090a,
            finalized: true,
        };
        assert_eq!(
            session_refunded(&k.to_bytes(), e.arena_id, e.amount, true).to_vec(),
            e.data()
        );
        let e = r::ArenaSwept {
            arena_id: 0x0102,
            season_id: 0x0304_0506,
            amount: 0x0708_090a_0b0c_0d0e,
        };
        assert_eq!(
            arena_swept(e.arena_id, e.season_id, e.amount).to_vec(),
            e.data()
        );
        let e = r::SeasonEnded {
            season_id: 0x0102_0304,
            prize_pool: 0x0506_0708_090a_0b0c,
        };
        assert_eq!(season_ended(e.season_id, e.prize_pool).to_vec(), e.data());
        let e = r::RewardClaimed {
            season_id: 0x0102_0304,
            player: k,
            rank: 9,
            amount: 0x0506_0708_090a_0b0c,
        };
        assert_eq!(
            reward_claimed(e.season_id, &k.to_bytes(), e.rank, e.amount).to_vec(),
            e.data()
        );
        let e = r::SeasonRolledOver {
            from: 0x0102_0304,
            to: 0x0506_0708,
            amount: 0x090a_0b0c_0d0e_0f10,
        };
        assert_eq!(
            season_rolled_over(e.from, e.to, e.amount).to_vec(),
            e.data()
        );
        let e = r::PassCollectionSet {
            collection: Pubkey::new_from_array([9; 32]),
        };
        assert_eq!(
            pass_collection_set(&e.collection.to_bytes()).to_vec(),
            e.data()
        );
        let (h1, h2, h3) = ([0x11u8; 32], [0x22u8; 32], [0x33u8; 32]);
        let e = r::PassMinted {
            minter: k,
            asset: Pubkey::new_from_array([6; 32]),
            number: 0x0102_0304,
        };
        assert_eq!(
            pass_minted(&k.to_bytes(), &[6; 32], e.number).to_vec(),
            e.data()
        );
        let e = r::PassMintEnded {
            minted: 0x0a0b_0c0d,
        };
        assert_eq!(pass_mint_ended(e.minted).to_vec(), e.data());
        let e = r::PassSeedRevealed {
            seed: h1,
            entropy_target_slot: 0x0102_0304_0506_0708,
        };
        assert_eq!(
            pass_seed_revealed(&h1, e.entropy_target_slot).to_vec(),
            e.data()
        );
        let e = r::PassEntropyCaptured {
            slot: 0x1112_1314_1516_1718,
            entropy: h2,
        };
        assert_eq!(pass_entropy_captured(e.slot, &h2).to_vec(), e.data());
        let e = r::PassEntropyRetargeted {
            missed_target_slot: 0x0102_0304_0506_0708,
            entropy_target_slot: 0x1112_1314_1516_1718,
        };
        assert_eq!(
            pass_entropy_retargeted(e.missed_target_slot, e.entropy_target_slot).to_vec(),
            e.data()
        );
        let e = r::PassRevealed {
            seed: h1,
            entropy: h2,
            final_seed: h3,
        };
        assert_eq!(pass_revealed(&h1, &h2, &h3).to_vec(), e.data());
    }
}
