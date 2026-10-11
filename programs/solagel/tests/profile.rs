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
fn premium_purchases_are_unavailable_in_beta_and_never_move_funds() {
    let mut env = TestEnv::initialized();
    let alice = env.new_player("alice");
    let treasury = env.treasury.pubkey();
    let treasury_before = env.balance(&treasury);
    let alice_before = env.balance(&alice.pubkey());
    let profile_before = env
        .svm
        .get_account(&profile_pda(&alice.pubkey()))
        .unwrap()
        .data;

    // The legacy entry point cannot sell or unlock any skin, including invalid ids.
    for skin in 0..=u8::MAX {
        assert_error(env.buy_skin(&alice, skin), SolagelError::FeatureUnavailable);
    }
    assert_eq!(env.balance(&treasury), treasury_before);
    assert_eq!(env.balance(&alice.pubkey()), alice_before);
    assert_eq!(
        env.svm
            .get_account(&profile_pda(&alice.pubkey()))
            .unwrap()
            .data,
        profile_before
    );
    assert_error(
        env.update_profile(&alice, None, Some(PREMIUM_SKIN_START)),
        SolagelError::SkinLocked,
    );

    // A configured zero price and a self-payment treasury cannot bypass the beta gate.
    assert_ok(env.update_config(UpdateConfigArgs {
        skin_price: Some(0),
        treasury: Some(alice.pubkey()),
        ..Default::default()
    }));
    for skin in PREMIUM_SKIN_START..SKIN_COUNT {
        assert_error(env.buy_skin(&alice, skin), SolagelError::FeatureUnavailable);
    }
    assert_eq!(env.balance(&alice.pubkey()), alice_before);
    assert_eq!(env.balance(&treasury), treasury_before);
    assert_eq!(
        env.svm
            .get_account(&profile_pda(&alice.pubkey()))
            .unwrap()
            .data,
        profile_before
    );

    // Account validation is retained for callers of the legacy ABI.
    let fake_treasury = env.funded_keypair(SOL).pubkey();
    let bad = ix::buy_skin(&alice.pubkey(), &fake_treasury, PREMIUM_SKIN_START);
    assert_error(env.send(&[bad], &[&alice]), SolagelError::Unauthorized);
}

#[test]
fn practice_updates_clamped_stats_without_paid_points_or_leaderboard_rewards() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, MIN_BUY_IN, 10));
    let alice = env.new_player("alice");
    let bob = env.new_player("bob");
    let empty_board = env.svm.get_account(&season_pda(1)).unwrap().data;
    let alice_before = env.balance(&alice.pubkey());

    assert_ok(env.record(&alice.pubkey(), u32::MAX, u16::MAX, u32::MAX));
    let profile = env.profile(&alice.pubkey());
    assert_eq!(profile.games_played, 1);
    assert_eq!(profile.kills, u32::from(u16::MAX));
    assert_eq!(profile.best_score, MAX_SCORE_PER_GAME);
    assert_eq!(profile.total_score, u64::from(MAX_SCORE_PER_GAME));
    assert_eq!(profile.xp, u64::from(MAX_XP_PER_GAME));
    assert_eq!(profile.last_played, START_TS);
    assert_eq!(profile.season_points, 0);
    assert_eq!(
        (profile.stake_games, profile.total_staked, profile.total_won),
        (0, 0, 0)
    );
    assert_eq!(env.config().total_games, 1);
    assert_eq!(env.config().total_staked, 0);
    assert_eq!(env.config().total_paid_out, 0);
    assert_eq!(env.balance(&alice.pubkey()), alice_before);
    assert_eq!(
        env.svm.get_account(&season_pda(1)).unwrap().data,
        empty_board
    );

    // Practice also leaves a paid player's existing points and entire leaderboard row alone.
    assert_ok(env.play_paid(&bob, 1, 500, 2, 100));
    let paid_board = env.svm.get_account(&season_pda(1)).unwrap().data;
    env.warp(1);
    assert_ok(env.record(&bob.pubkey(), u32::MAX, 3, u32::MAX));
    let profile = env.profile(&bob.pubkey());
    assert_eq!(profile.games_played, 2);
    assert_eq!(profile.kills, 5);
    assert_eq!(profile.best_score, MAX_SCORE_PER_GAME);
    assert_eq!(profile.total_score, 500 + u64::from(MAX_SCORE_PER_GAME));
    assert_eq!(profile.xp, 100 + u64::from(MAX_XP_PER_GAME));
    assert_eq!(profile.last_played, START_TS + 1);
    assert_eq!((profile.season, profile.season_points), (1, 500));
    assert_eq!(
        env.svm.get_account(&season_pda(1)).unwrap().data,
        paid_board
    );
    assert_eq!(env.prize_balance(1), 12_500);

    // A large practice score does not make a player eligible for a funded season prize.
    let funder = env.funded_keypair(2 * SOL);
    assert_ok(env.fund_season(&funder, SOL));
    assert_ok(env.end_season());
    assert_error(env.claim(&alice, 1), SolagelError::NotEligible);
    let finalized_board = env.svm.get_account(&season_pda(1)).unwrap().data;
    let new_board = env.svm.get_account(&season_pda(2)).unwrap().data;
    assert_ok(env.record(&bob.pubkey(), u32::MAX, 0, 0));
    let profile = env.profile(&bob.pubkey());
    assert_eq!((profile.season, profile.season_points), (1, 500));
    assert_eq!(
        env.svm.get_account(&season_pda(1)).unwrap().data,
        finalized_board
    );
    assert_eq!(env.svm.get_account(&season_pda(2)).unwrap().data, new_board);
    assert_eq!(env.prize_balance(1), SOL + 12_500);
    assert_eq!(env.prize_balance(2), 0);
}
