//! Anchor instruction discriminators: `sha256("global:<name>")[..8]`.
//!
//! These must equal the reference's `slana::instruction::<Name>::DISCRIMINATOR`; the
//! unit tests in this file check them against the hash, the reference and the IDL.

pub const INITIALIZE: [u8; 8] = [175, 175, 109, 31, 13, 152, 155, 237];
pub const SET_TOKEN_MINT: [u8; 8] = [204, 233, 179, 83, 12, 31, 139, 120];
pub const UPDATE_CONFIG: [u8; 8] = [29, 158, 252, 191, 10, 83, 219, 99];
pub const CREATE_ARENA: [u8; 8] = [174, 236, 45, 61, 197, 215, 149, 169];
pub const UPDATE_ARENA: [u8; 8] = [179, 14, 84, 80, 59, 23, 182, 226];
pub const REGISTER_PLAYER: [u8; 8] = [242, 146, 194, 234, 234, 145, 228, 42];
pub const UPDATE_PROFILE: [u8; 8] = [98, 67, 99, 206, 86, 115, 175, 1];
pub const JOIN_ARENA: [u8; 8] = [135, 217, 203, 200, 93, 181, 131, 47];
pub const SETTLE_SESSION: [u8; 8] = [156, 20, 180, 117, 117, 85, 225, 128];
pub const REFUND_SESSION: [u8; 8] = [168, 87, 185, 45, 250, 170, 10, 85];
pub const SWEEP_ARENA: [u8; 8] = [124, 38, 247, 190, 34, 58, 64, 7];
pub const SWEEP_LOOT: [u8; 8] = [221, 67, 119, 145, 176, 100, 54, 6];

/// `anchor_lang::event::EVENT_IX_TAG_LE`: Anchor's event-CPI instruction tag.
pub const EVENT_IX_TAG_LE: [u8; 8] = [0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d];

/// Every instruction of the program, by its Anchor (snake_case) name.
pub const ALL: [(&str, [u8; 8]); 12] = [
    ("initialize", INITIALIZE),
    ("set_token_mint", SET_TOKEN_MINT),
    ("update_config", UPDATE_CONFIG),
    ("create_arena", CREATE_ARENA),
    ("update_arena", UPDATE_ARENA),
    ("register_player", REGISTER_PLAYER),
    ("update_profile", UPDATE_PROFILE),
    ("join_arena", JOIN_ARENA),
    ("settle_session", SETTLE_SESSION),
    ("refund_session", REFUND_SESSION),
    ("sweep_arena", SWEEP_ARENA),
    ("sweep_loot", SWEEP_LOOT),
];

#[cfg(test)]
mod tests {
    use {super::*, anchor_lang::Discriminator, slana::instruction as i};

    fn d<T: Discriminator>() -> &'static [u8] {
        T::DISCRIMINATOR
    }

    /// The reference's discriminators, from the Anchor-generated `slana::instruction` structs.
    fn reference() -> [(&'static str, &'static [u8]); 12] {
        [
            ("initialize", d::<i::Initialize>()),
            ("set_token_mint", d::<i::SetTokenMint>()),
            ("update_config", d::<i::UpdateConfig>()),
            ("create_arena", d::<i::CreateArena>()),
            ("update_arena", d::<i::UpdateArena>()),
            ("register_player", d::<i::RegisterPlayer>()),
            ("update_profile", d::<i::UpdateProfile>()),
            ("join_arena", d::<i::JoinArena>()),
            ("settle_session", d::<i::SettleSession>()),
            ("refund_session", d::<i::RefundSession>()),
            ("sweep_arena", d::<i::SweepArena>()),
            ("sweep_loot", d::<i::SweepLoot>()),
        ]
    }

    #[test]
    fn event_tag_matches_anchor() {
        assert_eq!(&EVENT_IX_TAG_LE[..], anchor_lang::event::EVENT_IX_TAG_LE);
        assert!(ALL.iter().all(|(_, d)| *d != EVENT_IX_TAG_LE));
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
