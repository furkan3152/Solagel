//! `register_player` and `update_profile` (basic skins only).

mod common;

use {
    anchor_lang::error::ErrorCode as AnchorErrorCode,
    common::*,
    slana::{constants::*, error::SlanaError},
    solana_signer::Signer,
};

#[test]
fn register_player_validates_name_and_skin() {
    let mut env = TestEnv::initialized();
    let alice = env.funded_keypair(10 * SOL);

    assert_error(env.register(&alice, "", 0), SlanaError::InvalidName);
    assert_error(
        env.register(&alice, "abcdefghijklmnopq", 0), // 17 bytes
        SlanaError::InvalidName,
    );
    assert_error(
        env.register(&alice, "ééééééééé", 0), // 9 chars but 18 bytes
        SlanaError::InvalidName,
    );
    assert_error(
        env.register(&alice, "bad\u{7}name", 0),
        SlanaError::InvalidName,
    );
    assert_error(
        env.register(&alice, "line\nbreak", 0),
        SlanaError::InvalidName,
    );
    assert_error(env.register(&alice, "bogus", 255), SlanaError::InvalidSkin);
    assert_eq!(env.config().total_players, 0);

    let name = "Çağrı🚀";
    assert_ok(env.register(&alice, name, 7));
    let profile = env.profile(&alice.pubkey());
    assert_eq!(profile.owner, alice.pubkey());
    assert_eq!(name_of(&profile.name, profile.name_len), name);
    assert_eq!(usize::from(profile.name_len), name.len());
    assert_eq!(profile.skin, 7);
    assert_eq!(profile.xp, 0);
    assert_eq!(profile.season, 1);
    assert_eq!(profile.created_at, START_TS);
    assert_eq!(profile.last_played, 0);
    assert_eq!(env.config().total_players, 1);

    // One profile per wallet.
    assert_already_in_use(env.register(&alice, "again", 0));

    // A 16-byte name is fine.
    let bob = env.funded_keypair(10 * SOL);
    assert_ok(env.register(&bob, "abcdefghijklmnop", 0));
    assert_eq!(env.config().total_players, 2);
}

#[test]
fn profiles_accept_basic_skins_only() {
    let mut env = TestEnv::initialized();

    // Registration: skins 0..BASIC_SKINS only.
    let carol = env.funded_keypair(10 * SOL);
    assert_error(
        env.register(&carol, "carol", BASIC_SKINS),
        SlanaError::InvalidSkin,
    );
    assert_ok(env.register(&carol, "carol", BASIC_SKINS - 1));
    assert_eq!(env.profile(&carol.pubkey()).skin, 7);

    // Update: every basic skin works, anything above is rejected.
    let alice = env.new_player("alice");
    for skin in 0..BASIC_SKINS {
        assert_ok(env.update_profile(&alice, None, Some(skin)));
        assert_eq!(env.profile(&alice.pubkey()).skin, skin);
    }
    for skin in [8, 16, 23, 24, 255] {
        assert_error(
            env.update_profile(&alice, None, Some(skin)),
            SlanaError::InvalidSkin,
        );
    }
    assert_eq!(env.profile(&alice.pubkey()).skin, 7);
}

#[test]
fn update_profile_renames_and_is_owner_only() {
    let mut env = TestEnv::initialized();
    let alice = env.new_player("alice");

    // Rename (skin unchanged) and name validation.
    assert_ok(env.update_profile(&alice, None, Some(3)));
    assert_ok(env.update_profile(&alice, Some("Alice 2"), None));
    let profile = env.profile(&alice.pubkey());
    assert_eq!(name_of(&profile.name, profile.name_len), "Alice 2");
    assert_eq!(profile.skin, 3);
    assert_error(
        env.update_profile(&alice, Some(""), None),
        SlanaError::InvalidName,
    );
    assert_error(
        env.update_profile(&alice, Some("x\u{1b}[31m"), None),
        SlanaError::InvalidName,
    );

    // Nobody can edit somebody else's profile.
    let mallory = env.new_player("mallory");
    let foreign = ix::update_profile_of(
        &mallory.pubkey(),
        &profile_pda(&alice.pubkey()),
        Some("pwned"),
        None,
    );
    assert_anchor_error(
        env.send(&[foreign], &[&mallory]),
        AnchorErrorCode::ConstraintSeeds,
    );
    let profile = env.profile(&alice.pubkey());
    assert_eq!(name_of(&profile.name, profile.name_len), "Alice 2");
}
