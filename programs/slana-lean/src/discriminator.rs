//! Anchor instruction discriminators: `sha256("global:<name>")[..8]`.
//!
//! These must equal the reference's `slana::instruction::<Name>::DISCRIMINATOR`; the
//! `discriminators` test in `programs/slana-ref/tests` checks both the hash and the reference.

pub const INITIALIZE: [u8; 8] = [175, 175, 109, 31, 13, 152, 155, 237];
pub const UPDATE_CONFIG: [u8; 8] = [29, 158, 252, 191, 10, 83, 219, 99];
pub const CREATE_ARENA: [u8; 8] = [174, 236, 45, 61, 197, 215, 149, 169];
pub const UPDATE_ARENA: [u8; 8] = [179, 14, 84, 80, 59, 23, 182, 226];
pub const WITHDRAW_TREASURY: [u8; 8] = [40, 63, 122, 158, 144, 216, 83, 96];
pub const REGISTER_PLAYER: [u8; 8] = [242, 146, 194, 234, 234, 145, 228, 42];
pub const UPDATE_PROFILE: [u8; 8] = [98, 67, 99, 206, 86, 115, 175, 1];
pub const JOIN_ARENA: [u8; 8] = [135, 217, 203, 200, 93, 181, 131, 47];
pub const JOIN_ARENA_WITH_PASS: [u8; 8] = [145, 196, 60, 74, 142, 112, 166, 224];
pub const SETTLE_SESSION: [u8; 8] = [156, 20, 180, 117, 117, 85, 225, 128];
pub const REFUND_SESSION: [u8; 8] = [168, 87, 185, 45, 250, 170, 10, 85];
pub const SWEEP_ARENA: [u8; 8] = [124, 38, 247, 190, 34, 58, 64, 7];
pub const SET_PASS_COLLECTION: [u8; 8] = [60, 188, 194, 201, 72, 107, 78, 208];
pub const SET_PASS_SEED_HASH: [u8; 8] = [192, 248, 24, 81, 247, 241, 216, 11];
pub const MINT_PASS: [u8; 8] = [142, 56, 26, 197, 227, 241, 84, 174];
pub const CLOSE_PASS_MINT: [u8; 8] = [227, 254, 103, 66, 121, 84, 65, 218];
pub const CAPTURE_PASS_ENTROPY: [u8; 8] = [187, 128, 145, 219, 72, 180, 205, 195];
pub const REVEAL_PASS: [u8; 8] = [233, 27, 93, 192, 147, 157, 246, 103];
pub const END_SEASON: [u8; 8] = [167, 166, 166, 109, 166, 71, 15, 68];
pub const CLAIM_SEASON_REWARD: [u8; 8] = [129, 96, 145, 129, 154, 203, 29, 150];
pub const ROLLOVER_SEASON: [u8; 8] = [100, 231, 139, 192, 118, 134, 116, 197];

/// Every instruction of the program, by its Anchor (snake_case) name.
pub const ALL: [(&str, [u8; 8]); 21] = [
    ("initialize", INITIALIZE),
    ("update_config", UPDATE_CONFIG),
    ("create_arena", CREATE_ARENA),
    ("update_arena", UPDATE_ARENA),
    ("withdraw_treasury", WITHDRAW_TREASURY),
    ("register_player", REGISTER_PLAYER),
    ("update_profile", UPDATE_PROFILE),
    ("join_arena", JOIN_ARENA),
    ("join_arena_with_pass", JOIN_ARENA_WITH_PASS),
    ("settle_session", SETTLE_SESSION),
    ("refund_session", REFUND_SESSION),
    ("sweep_arena", SWEEP_ARENA),
    ("set_pass_collection", SET_PASS_COLLECTION),
    ("set_pass_seed_hash", SET_PASS_SEED_HASH),
    ("mint_pass", MINT_PASS),
    ("close_pass_mint", CLOSE_PASS_MINT),
    ("capture_pass_entropy", CAPTURE_PASS_ENTROPY),
    ("reveal_pass", REVEAL_PASS),
    ("end_season", END_SEASON),
    ("claim_season_reward", CLAIM_SEASON_REWARD),
    ("rollover_season", ROLLOVER_SEASON),
];

#[cfg(test)]
mod tests {
    use {super::*, anchor_lang::Discriminator, slana::instruction as i};

    fn d<T: Discriminator>() -> &'static [u8] {
        T::DISCRIMINATOR
    }

    /// The reference's discriminators, from the Anchor-generated `slana::instruction` structs.
    fn reference() -> [(&'static str, &'static [u8]); 21] {
        [
            ("initialize", d::<i::Initialize>()),
            ("update_config", d::<i::UpdateConfig>()),
            ("create_arena", d::<i::CreateArena>()),
            ("update_arena", d::<i::UpdateArena>()),
            ("withdraw_treasury", d::<i::WithdrawTreasury>()),
            ("register_player", d::<i::RegisterPlayer>()),
            ("update_profile", d::<i::UpdateProfile>()),
            ("join_arena", d::<i::JoinArena>()),
            ("join_arena_with_pass", d::<i::JoinArenaWithPass>()),
            ("settle_session", d::<i::SettleSession>()),
            ("refund_session", d::<i::RefundSession>()),
            ("sweep_arena", d::<i::SweepArena>()),
            ("set_pass_collection", d::<i::SetPassCollection>()),
            ("set_pass_seed_hash", d::<i::SetPassSeedHash>()),
            ("mint_pass", d::<i::MintPass>()),
            ("close_pass_mint", d::<i::ClosePassMint>()),
            ("capture_pass_entropy", d::<i::CapturePassEntropy>()),
            ("reveal_pass", d::<i::RevealPass>()),
            ("end_season", d::<i::EndSeason>()),
            ("claim_season_reward", d::<i::ClaimSeasonReward>()),
            ("rollover_season", d::<i::RolloverSeason>()),
        ]
    }

    #[test]
    fn discriminators_are_sha256_global_name() {
        for (name, disc) in ALL {
            let hash = solana_sha256_hasher::hashv(&[b"global:", name.as_bytes()]);
            assert_eq!(disc, hash.to_bytes()[..8], "{name}");
        }
    }

    #[test]
    fn discriminators_match_the_reference() {
        for ((name, disc), (ref_name, ref_disc)) in ALL.iter().zip(reference()) {
            assert_eq!(*name, ref_name);
            assert_eq!(&disc[..], ref_disc, "{name}");
        }
        for (k, (_, a)) in ALL.iter().enumerate() {
            for (_, b) in &ALL[k + 1..] {
                assert_ne!(a, b, "duplicate discriminator");
            }
        }
    }

    /// The table is complete: exactly the instructions of the IDL the SDK ships.
    #[test]
    fn discriminators_match_the_idl() {
        let idl: serde_json::Value =
            serde_json::from_str(include_str!("../../../packages/sdk/src/idl/slana.json")).unwrap();
        let mut from_idl: Vec<(String, Vec<u8>)> = idl["instructions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|ix| {
                let disc = ix["discriminator"].as_array().unwrap();
                (
                    ix["name"].as_str().unwrap().to_owned(),
                    disc.iter().map(|b| b.as_u64().unwrap() as u8).collect(),
                )
            })
            .collect();
        let mut ours: Vec<(String, Vec<u8>)> = ALL
            .iter()
            .map(|(n, d)| ((*n).to_owned(), d.to_vec()))
            .collect();
        from_idl.sort();
        ours.sort();
        assert_eq!(ours, from_idl);
    }
}
