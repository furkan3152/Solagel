//! Anchor events: `emit!` logs one `sol_log_data` slice, `discriminator ‖ borsh(fields)`
//! ("Program data: <base64>"). The discriminators are `sha256("event:<Name>")[..8]`; the unit
//! tests compare them, and the encodings, with the reference.

use crate::borsh::{wr_bool, wr_bytes, wr_u16, wr_u32, wr_u64};

pub const PLAYER_REGISTERED: [u8; 8] = [175, 78, 252, 170, 75, 230, 36, 251];
pub const PROFILE_UPDATED: [u8; 8] = [186, 248, 62, 98, 112, 98, 161, 252];
pub const ARENA_JOINED: [u8; 8] = [195, 38, 154, 241, 247, 142, 31, 5];
pub const SESSION_SETTLED: [u8; 8] = [127, 161, 59, 136, 23, 168, 191, 149];
pub const SESSION_REFUNDED: [u8; 8] = [176, 138, 119, 46, 99, 172, 75, 152];
pub const ARENA_SWEPT: [u8; 8] = [132, 32, 57, 60, 149, 87, 201, 80];
pub const LOOT_BURNED: [u8; 8] = [157, 111, 219, 163, 179, 39, 235, 95];
pub const ARENA_CREATED: [u8; 8] = [93, 57, 84, 96, 112, 3, 148, 17];
pub const TOKEN_MINT_SET: [u8; 8] = [236, 245, 220, 223, 246, 139, 23, 69];

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

/// `ArenaCreated { arena_id: u16, entry_fee: u64, max_sessions: u16 }`.
pub fn arena_created(arena_id: u16, entry_fee: u64, max_sessions: u16) -> [u8; 20] {
    let mut e = [0u8; 20];
    wr_bytes(&mut e, 0, &ARENA_CREATED);
    wr_u16(&mut e, 8, arena_id);
    wr_u64(&mut e, 10, entry_fee);
    wr_u16(&mut e, 18, max_sessions);
    e
}

/// `TokenMintSet { mint: Pubkey, token_program: Pubkey, decimals: u8 }`.
pub fn token_mint_set(mint: &[u8; 32], token_program: &[u8; 32], decimals: u8) -> [u8; 73] {
    let mut e = [0u8; 73];
    wr_bytes(&mut e, 0, &TOKEN_MINT_SET);
    wr_bytes(&mut e, 8, mint);
    wr_bytes(&mut e, 40, token_program);
    e[72] = decimals;
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

/// `ArenaJoined { player, arena_id: u16, session_id: u64, entry_fee: u64 }`.
pub fn arena_joined(player: &[u8; 32], arena_id: u16, session_id: u64, entry_fee: u64) -> [u8; 58] {
    let mut e = [0u8; 58];
    wr_bytes(&mut e, 0, &ARENA_JOINED);
    wr_bytes(&mut e, 8, player);
    wr_u16(&mut e, 40, arena_id);
    wr_u64(&mut e, 42, session_id);
    wr_u64(&mut e, 50, entry_fee);
    e
}

/// `SessionSettled { player, arena_id: u16, session_id: u64, payout: u64, fee: u64,
/// score: u32, kills: u16, owed: u64 }`: the fixed head (player .. session_id) comes from the
/// session, the rest from the settlement.
pub struct SessionSettled {
    pub payout: u64,
    pub fee: u64,
    pub score: u32,
    pub kills: u16,
    pub owed: u64,
}

pub fn session_settled(
    player: &[u8; 32],
    arena_id: u16,
    session_id: u64,
    s: &SessionSettled,
) -> [u8; 80] {
    let mut e = [0u8; 80];
    wr_bytes(&mut e, 0, &SESSION_SETTLED);
    wr_bytes(&mut e, 8, player);
    wr_u16(&mut e, 40, arena_id);
    wr_u64(&mut e, 42, session_id);
    wr_u64(&mut e, 50, s.payout);
    wr_u64(&mut e, 58, s.fee);
    wr_u32(&mut e, 66, s.score);
    wr_u16(&mut e, 70, s.kills);
    wr_u64(&mut e, 72, s.owed);
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

/// `ArenaSwept` / `LootBurned` (`discriminator` = [`ARENA_SWEPT`] / [`LOOT_BURNED`]): the same
/// fields `{ arena_id: u16, amount: u64 }`.
pub fn arena_amount(discriminator: &[u8; 8], arena_id: u16, amount: u64) -> [u8; 18] {
    let mut e = [0u8; 18];
    wr_bytes(&mut e, 0, discriminator);
    wr_u16(&mut e, 8, arena_id);
    wr_u64(&mut e, 10, amount);
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
        let table: [([u8; 8], &[u8]); 9] = [
            (PLAYER_REGISTERED, r::PlayerRegistered::DISCRIMINATOR),
            (PROFILE_UPDATED, r::ProfileUpdated::DISCRIMINATOR),
            (ARENA_JOINED, r::ArenaJoined::DISCRIMINATOR),
            (SESSION_SETTLED, r::SessionSettled::DISCRIMINATOR),
            (SESSION_REFUNDED, r::SessionRefunded::DISCRIMINATOR),
            (ARENA_SWEPT, r::ArenaSwept::DISCRIMINATOR),
            (LOOT_BURNED, r::LootBurned::DISCRIMINATOR),
            (ARENA_CREATED, r::ArenaCreated::DISCRIMINATOR),
            (TOKEN_MINT_SET, r::TokenMintSet::DISCRIMINATOR),
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
        };
        assert_eq!(
            arena_created(e.arena_id, e.entry_fee, e.max_sessions).to_vec(),
            e.data()
        );
        let e = r::TokenMintSet {
            mint: Pubkey::new_from_array([7; 32]),
            token_program: Pubkey::new_from_array([8; 32]),
            decimals: 9,
        };
        assert_eq!(
            token_mint_set(&e.mint.to_bytes(), &e.token_program.to_bytes(), e.decimals).to_vec(),
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
        };
        assert_eq!(
            arena_joined(&k.to_bytes(), e.arena_id, e.session_id, e.entry_fee).to_vec(),
            e.data()
        );
        let e = r::SessionSettled {
            player: k,
            arena_id: 0x0102,
            session_id: 0x0304_0506_0708_090a,
            payout: 0x1112_1314_1516_1718,
            fee: 0x2122_2324_2526_2728,
            score: 0x4142_4344,
            kills: 0x5152,
            owed: 0x6162_6364_6566_6768,
        };
        let s = SessionSettled {
            payout: e.payout,
            fee: e.fee,
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
            amount: 0x0708_090a_0b0c_0d0e,
        };
        assert_eq!(
            arena_amount(&ARENA_SWEPT, e.arena_id, e.amount).to_vec(),
            e.data()
        );
        let e = r::LootBurned {
            arena_id: 0x0102,
            amount: 0x0708_090a_0b0c_0d0e,
        };
        assert_eq!(
            arena_amount(&LOOT_BURNED, e.arena_id, e.amount).to_vec(),
            e.data()
        );
    }
}
