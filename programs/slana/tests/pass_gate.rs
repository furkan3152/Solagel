//! Slana Pass gating: `join_arena_with_pass`, Pass locks and Pass-only season points.

mod common;

use {
    anchor_lang::prelude::Pubkey,
    common::*,
    slana::{constants::*, error::SlanaError},
    solana_signer::Signer,
};

#[test]
fn join_requires_pass_in_pass_arena() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(7, ENTRY_FEE, 300, true));
    let a = env.token_player("a", ENTRY_FEE);
    let a_ata = env.player_ata(&a.pubkey());

    assert_error(env.join(&a, 7), SlanaError::PassRequired);
    assert!(env.session(7, &a.pubkey()).is_none());
    assert_eq!(env.tokens(&a_ata), ENTRY_FEE);

    let (_, asset) = env.give_pass(&a.pubkey());
    assert_ok(env.join_with_pass(&a, 7, &asset));
    let session = env.session(7, &a.pubkey()).expect("session");
    assert!(session.has_pass);
    assert_eq!(session.pass_asset, asset);
    assert_eq!(env.tokens(&a_ata), 0);
    assert_eq!(env.tokens(&vault_pda(&arena_pda(7))), ENTRY_FEE);
}

#[test]
fn join_with_pass_checks_owner_and_collection() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, ENTRY_FEE, 300, false));
    let a = env.token_player("a", ENTRY_FEE);
    let b = env.token_player("b", 0);
    let (collection, own_asset) = env.give_pass(&a.pubkey());

    // A Pass owned by somebody else.
    let foreign = fake_core_asset(&mut env.svm, &b.pubkey(), &collection);
    assert_error(
        env.join_with_pass(&a, 1, &foreign),
        SlanaError::PassNotOwned,
    );

    // An asset of another collection.
    let other = fake_core_asset(&mut env.svm, &a.pubkey(), &Pubkey::new_unique());
    assert_error(
        env.join_with_pass(&a, 1, &other),
        SlanaError::PassWrongCollection,
    );

    // Same bytes, but not owned by the Core program.
    let forged = Pubkey::new_unique();
    write_raw_account(
        &mut env.svm,
        &forged,
        slana::ID,
        core_asset_data(&a.pubkey(), &collection),
    );
    assert_error(
        env.join_with_pass(&a, 1, &forged),
        SlanaError::PassWrongCollection,
    );

    // A Core asset without a collection (update authority = Address).
    let mut data = core_asset_data(&a.pubkey(), &collection);
    data[33] = 1;
    let loose = Pubkey::new_unique();
    write_core_account(&mut env.svm, &loose, data);
    assert_error(
        env.join_with_pass(&a, 1, &loose),
        SlanaError::PassWrongCollection,
    );

    // A Core collection account is not an asset.
    let mut collection_data = vec![5u8];
    collection_data.extend_from_slice(Pubkey::new_unique().as_ref());
    collection_data.extend_from_slice(&[0; 16]);
    let collection_account = Pubkey::new_unique();
    write_core_account(&mut env.svm, &collection_account, collection_data);
    assert_error(
        env.join_with_pass(&a, 1, &collection_account),
        SlanaError::PassWrongCollection,
    );

    // Nothing was locked or charged by the failed joins.
    for asset in [foreign, other, forged, loose, collection_account] {
        assert!(env.pass_lock(&asset).is_none());
    }
    assert!(env.session(1, &a.pubkey()).is_none());
    assert_eq!(env.tokens(&env.player_ata(&a.pubkey())), ENTRY_FEE);

    let before = env.balance(&a.pubkey());
    assert_ok(env.join_with_pass(&a, 1, &own_asset));
    let lock = env.pass_lock(&own_asset).expect("pass lock");
    assert_eq!(lock.player, a.pubkey());
    assert_eq!(lock.session, session_pda(&arena_pda(1), &a.pubkey()));
    assert_eq!(
        env.balance(&a.pubkey()),
        before - env.session_rent() - SETTLE_FEE_LAMPORTS - env.pass_lock_rent()
    );
}

#[test]
fn pass_join_needs_a_collection_in_the_config() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, ENTRY_FEE, 300, false));
    let a = env.token_player("a", ENTRY_FEE);
    assert_eq!(env.config().pass_collection, Pubkey::default());
    // An asset that claims the default collection must not pass while none is set.
    let asset = fake_core_asset(&mut env.svm, &a.pubkey(), &Pubkey::default());
    assert_error(
        env.join_with_pass(&a, 1, &asset),
        SlanaError::PassWrongCollection,
    );
}

#[test]
fn pass_lock_blocks_second_session() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, ENTRY_FEE, 300, false));
    assert_ok(env.create_arena(2, ENTRY_FEE, 300, false));
    let a = env.token_player("a", ENTRY_FEE);
    let b = env.token_player("b", ENTRY_FEE);
    let (_, asset) = env.give_pass(&a.pubkey());

    assert_ok(env.join_with_pass(&a, 1, &asset));
    // The same Pass cannot back a second session of its owner in another arena …
    let a_ata = env.player_ata(&a.pubkey());
    env.mint_to(&a_ata, ENTRY_FEE);
    assert_already_in_use(env.join_with_pass(&a, 2, &asset));

    // … nor, after a transfer, a session of the new owner.
    set_core_asset_owner(&mut env.svm, &asset, &b.pubkey());
    assert_already_in_use(env.join_with_pass(&b, 1, &asset));
    assert!(env.session(1, &b.pubkey()).is_none());

    // Settling A's session releases the lock (its rent goes back to A).
    let a_before = env.balance(&a.pubkey());
    assert_ok(env.settle(&a.pubkey(), 1, ENTRY_FEE, 0, 0, 0));
    assert!(env.pass_lock(&asset).is_none());
    assert_eq!(
        env.balance(&a.pubkey()),
        a_before + env.session_rent() + env.pass_lock_rent()
    );

    assert_ok(env.join_with_pass(&b, 1, &asset));
    assert_eq!(env.pass_lock(&asset).expect("lock").player, b.pubkey());
}

#[test]
fn settle_of_a_pass_session_needs_its_lock() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, ENTRY_FEE, 300, false));
    let a = env.token_player("a", ENTRY_FEE);
    let b = env.token_player("b", ENTRY_FEE);
    let c = env.token_player("c", ENTRY_FEE);
    let (collection, asset_a) = env.give_pass(&a.pubkey());
    let asset_b = fake_core_asset(&mut env.svm, &b.pubkey(), &collection);
    assert_ok(env.join_with_pass(&a, 1, &asset_a));
    assert_ok(env.join_with_pass(&b, 1, &asset_b));
    assert_ok(env.join(&c, 1));

    let server = env.server.insecure_clone();
    let args = |id| slana::SettleArgs {
        session_id: id,
        payout: ENTRY_FEE,
        score: 0,
        kills: 0,
        xp: 0,
    };
    let id_a = env.session(1, &a.pubkey()).unwrap().id;
    let id_c = env.session(1, &c.pubkey()).unwrap().id;
    // Missing lock.
    assert_error(
        env.settle_as(&server, &a.pubkey(), 1, args(id_a), None),
        SlanaError::PassInUse,
    );
    // Somebody else's lock.
    assert_error(
        env.settle_as(
            &server,
            &a.pubkey(),
            1,
            args(id_a),
            Some(pass_lock_pda(&asset_b)),
        ),
        SlanaError::PassInUse,
    );
    // A session without a Pass cannot close a lock.
    assert_error(
        env.settle_as(
            &server,
            &c.pubkey(),
            1,
            args(id_c),
            Some(pass_lock_pda(&asset_b)),
        ),
        SlanaError::PassInUse,
    );
    assert!(env.pass_lock(&asset_b).is_some());

    assert_ok(env.settle(&a.pubkey(), 1, ENTRY_FEE, 0, 0, 0));
    assert_ok(env.settle(&c.pubkey(), 1, ENTRY_FEE, 0, 0, 0));
    assert!(env.pass_lock(&asset_a).is_none());
    assert!(env.pass_lock(&asset_b).is_some());
}

#[test]
fn refund_of_a_pass_session_releases_the_lock() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, ENTRY_FEE, 300, true));
    let a = env.token_player("a", ENTRY_FEE);
    let (_, asset) = env.give_pass(&a.pubkey());
    let before = env.balance(&a.pubkey());
    assert_ok(env.join_with_pass(&a, 1, &asset));

    env.warp(SESSION_REFUND_TIMEOUT_SECS);
    assert_error(env.refund_with(&a, 1, None), SlanaError::PassInUse);
    assert_ok(env.refund(&a, 1));
    assert!(env.pass_lock(&asset).is_none());
    assert!(env.session(1, &a.pubkey()).is_none());
    assert_eq!(env.balance(&a.pubkey()), before);
    assert_eq!(env.tokens(&env.player_ata(&a.pubkey())), ENTRY_FEE);
}

#[test]
fn season_points_only_with_pass() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, ENTRY_FEE, 300, false));
    let holder = env.token_player("holder", ENTRY_FEE);
    let plain = env.token_player("plain", ENTRY_FEE);
    let (_, asset) = env.give_pass(&holder.pubkey());
    assert_ok(env.join_with_pass(&holder, 1, &asset));
    assert_ok(env.join(&plain, 1));

    assert_ok(env.settle(&holder.pubkey(), 1, ENTRY_FEE, 5_000, 2, 50));
    assert_ok(env.settle(&plain.pubkey(), 1, ENTRY_FEE, 5_000, 2, 50));

    let season = env.season(FIRST_SEASON);
    assert_eq!(season.count, 1);
    assert_eq!(season.entries[0].player, holder.pubkey());
    assert_eq!(season.entries[0].points, 5_000);
    assert_eq!(env.profile(&holder.pubkey()).season_points, 5_000);
    let plain_profile = env.profile(&plain.pubkey());
    assert_eq!(plain_profile.season_points, 0);
    // Everything else still counts for the player without a Pass.
    assert_eq!(plain_profile.best_score, 5_000);
    assert_eq!(plain_profile.xp, 50);
}
