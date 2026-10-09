//! `register_player`, `update_profile`, `buy_skin` (+ skin locks via `record_game` XP).

mod common;

use {
    anchor_lang::error::ErrorCode as AnchorErrorCode,
    common::*,
    solagel::{constants::*, error::SolagelError, UpdateConfigArgs},
    solana_signer::Signer,
};

#[test]
fn register_player_validates_name_and_skin() {
    let mut env = TestEnv::initialized();
    let alice = env.funded_keypair(10 * SOL);

    assert_error(env.register(&alice, "", 0), SolagelError::InvalidName);
    assert_error(
        env.register(&alice, "abcdefghijklmnopq", 0), // 17 bytes
        SolagelError::InvalidName,
    );
    assert_error(
        env.register(&alice, "ééééééééé", 0), // 9 chars but 18 bytes
        SolagelError::InvalidName,
    );
    assert_error(
        env.register(&alice, "bad\u{7}name", 0),
        SolagelError::InvalidName,
    );
    assert_error(
        env.register(&alice, "line\nbreak", 0),
        SolagelError::InvalidName,
    );
    // Only free skins at registration.
    assert_error(env.register(&alice, "rich", 16), SolagelError::SkinLocked);
    assert_error(env.register(&alice, "rich", 23), SolagelError::SkinLocked);
    assert_error(env.register(&alice, "grinder", 8), SolagelError::SkinLocked);
    assert_error(env.register(&alice, "bogus", 24), SolagelError::InvalidSkin);
    assert_eq!(env.config().total_players, 0);

    let name = "Çağrı🚀";
    assert_ok(env.register(&alice, name, 7));
    let profile = env.profile(&alice.pubkey());
    assert_eq!(profile.owner, alice.pubkey());
    assert_eq!(name_of(&profile.name, profile.name_len), name);
    assert_eq!(usize::from(profile.name_len), name.len());
    assert_eq!(profile.skin, 7);
    assert_eq!(profile.premium_skins, 0);
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
fn level_skins_unlock_with_xp() {
    let mut env = TestEnv::initialized();
    let alice = env.new_player("alice");

    // Skin 10 needs level 5, i.e. 800 XP.
    assert_error(
        env.update_profile(&alice, None, Some(10)),
        SolagelError::SkinLocked,
    );
    assert_ok(env.record(&alice.pubkey(), 100, 1, 500));
    assert_eq!(env.profile(&alice.pubkey()).xp, 500); // level 4
    assert_error(
        env.update_profile(&alice, None, Some(10)),
        SolagelError::SkinLocked,
    );
    assert_ok(env.record(&alice.pubkey(), 100, 1, 500));
    assert_eq!(env.profile(&alice.pubkey()).xp, 1_000); // level 5
    assert_ok(env.update_profile(&alice, None, Some(10)));
    assert_eq!(env.profile(&alice.pubkey()).skin, 10);

    // Skin 11 needs level 7 (1 800 XP).
    assert_error(
        env.update_profile(&alice, None, Some(11)),
        SolagelError::SkinLocked,
    );
    // XP per game is clamped to MAX_XP_PER_GAME.
    assert_ok(env.record(&alice.pubkey(), 0, 0, 50_000));
    assert_eq!(
        env.profile(&alice.pubkey()).xp,
        1_000 + u64::from(MAX_XP_PER_GAME)
    );
    assert_ok(env.update_profile(&alice, None, Some(11)));

    // Premium skins are not unlocked by XP; invalid ids are rejected.
    assert_error(
        env.update_profile(&alice, None, Some(16)),
        SolagelError::SkinLocked,
    );
    assert_error(
        env.update_profile(&alice, None, Some(24)),
        SolagelError::InvalidSkin,
    );

    // Rename (skin unchanged) and name validation.
    assert_ok(env.update_profile(&alice, Some("Alice 2"), None));
    let profile = env.profile(&alice.pubkey());
    assert_eq!(name_of(&profile.name, profile.name_len), "Alice 2");
    assert_eq!(profile.skin, 11);
    assert_error(
        env.update_profile(&alice, Some(""), None),
        SolagelError::InvalidName,
    );
    assert_error(
        env.update_profile(&alice, Some("x\u{1b}[31m"), None),
        SolagelError::InvalidName,
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

#[test]
fn buy_skin_pays_treasury() {
    let mut env = TestEnv::initialized();
    let alice = env.new_player("alice");
    let treasury = env.treasury.pubkey();

    let treasury_before = env.balance(&treasury);
    let alice_before = env.balance(&alice.pubkey());
    assert_ok(env.buy_skin(&alice, 17));
    assert_eq!(env.balance(&treasury) - treasury_before, SKIN_PRICE);
    assert_eq!(alice_before - env.balance(&alice.pubkey()), SKIN_PRICE);
    let profile = env.profile(&alice.pubkey());
    assert_eq!(profile.premium_skins, 1 << 1);
    assert_eq!(profile.skin, 17);

    // Same skin again, non-premium and invalid ids fail.
    assert_error(env.buy_skin(&alice, 17), SolagelError::SkinAlreadyOwned);
    assert_error(env.buy_skin(&alice, 5), SolagelError::InvalidSkin);
    assert_error(env.buy_skin(&alice, 10), SolagelError::InvalidSkin);
    assert_error(env.buy_skin(&alice, 24), SolagelError::InvalidSkin);
    assert_eq!(env.balance(&treasury) - treasury_before, SKIN_PRICE);

    // An owned premium skin can be re-equipped.
    assert_ok(env.update_profile(&alice, None, Some(0)));
    assert_ok(env.update_profile(&alice, None, Some(17)));
    assert_eq!(env.profile(&alice.pubkey()).skin, 17);

    // The treasury account must be the configured one.
    let fake_treasury = env.funded_keypair(SOL).pubkey();
    let bad = ix::buy_skin(&alice.pubkey(), &fake_treasury, 18);
    assert_error(env.send(&[bad], &[&alice]), SolagelError::Unauthorized);

    // The treasury may be the buyer itself (`dup`).
    assert_ok(env.update_config(UpdateConfigArgs {
        treasury: Some(alice.pubkey()),
        ..Default::default()
    }));
    let alice_before = env.balance(&alice.pubkey());
    assert_ok(env.buy_skin(&alice, PREMIUM_SKIN_START + 7));
    assert_eq!(env.balance(&alice.pubkey()), alice_before);
    let profile = env.profile(&alice.pubkey());
    assert_eq!(profile.premium_skins, (1 << 1) | (1 << 7));
    assert_eq!(profile.skin, 23);
}
