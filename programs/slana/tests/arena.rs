//! Arenas: `create_arena`, `update_arena`, `join_arena`, `settle_session`, `refund_session`,
//! `sweep_arena`.

mod common;

use {
    anchor_lang::{error::ErrorCode as AnchorErrorCode, Space},
    common::*,
    slana::{
        constants::*,
        error::SlanaError,
        state::{Arena, Session},
        SettleArgs, UpdateConfigArgs,
    },
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const BUY_IN: u64 = 100_000_000; // 0.1 SOL

#[test]
fn create_and_update_arena_admin_only() {
    let mut env = TestEnv::initialized();
    let mallory = env.funded_keypair(10 * SOL);

    assert_error(
        env.create_arena_as(&mallory, 1, BUY_IN, 10),
        SlanaError::Unauthorized,
    );
    assert_error(
        env.create_arena(1, MIN_BUY_IN - 1, 10),
        SlanaError::BuyInTooLow,
    );
    assert_error(
        env.create_arena(1, MIN_BUY_IN, 1),
        SlanaError::InvalidMaxPlayers,
    );
    assert_error(
        env.create_arena(1, MIN_BUY_IN, 101),
        SlanaError::InvalidMaxPlayers,
    );
    assert!(env.try_fetch::<Arena>(&arena_pda(1)).is_none());

    assert_ok(env.create_arena(1, MIN_BUY_IN, 40));
    let arena = env.arena(1);
    assert_eq!(arena.id, 1);
    assert_eq!(arena.buy_in, MIN_BUY_IN);
    assert_eq!(arena.max_players, 40);
    assert!(arena.enabled);
    assert_eq!(
        (
            arena.open_sessions,
            arena.total_deposited,
            arena.total_paid_out
        ),
        (0, 0, 0)
    );
    assert_eq!(env.pot(1), 0);
    assert_already_in_use(env.create_arena(1, BUY_IN, 10));

    // update_arena
    assert_error(
        env.update_arena_as(&mallory, 1, Some(false), None),
        SlanaError::Unauthorized,
    );
    assert_error(
        env.update_arena(1, None, Some(101)),
        SlanaError::InvalidMaxPlayers,
    );
    assert_ok(env.update_arena(1, Some(false), Some(2)));
    let arena = env.arena(1);
    assert!(!arena.enabled);
    assert_eq!(arena.max_players, 2);
    assert_ok(env.update_arena(1, Some(true), None));
    assert!(env.arena(1).enabled);
    assert_eq!(env.arena(1).max_players, 2);
}

#[test]
fn join_arena_deposits_buy_in() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, BUY_IN, 2));
    let alice = env.new_player("alice");
    let session_rent = env.session_rent();

    let before = env.balance(&alice.pubkey());
    assert_ok(env.join(&alice, 1));
    assert_eq!(before - env.balance(&alice.pubkey()), BUY_IN + session_rent);
    assert_eq!(env.pot(1), BUY_IN);

    let arena = env.arena(1);
    assert_eq!(arena.open_sessions, 1);
    assert_eq!(arena.total_deposited, BUY_IN);
    let session = env.session(1, &alice.pubkey()).expect("session");
    assert_eq!(session.player, alice.pubkey());
    assert_eq!(session.arena, arena_pda(1));
    assert_eq!(session.arena_id, 1);
    assert_eq!(session.buy_in, BUY_IN);
    assert_eq!(session.opened_at, START_TS);
    assert_eq!(session.id, 0);
    let config = env.config();
    assert_eq!((config.total_sessions, config.total_staked), (1, BUY_IN));
    let profile = env.profile(&alice.pubkey());
    assert_eq!((profile.stake_games, profile.total_staked), (1, BUY_IN));

    // One open session per player per arena.
    assert_already_in_use(env.join(&alice, 1));

    // max_players = 2: the third player is turned away.
    let bob = env.new_player("bob");
    assert_ok(env.join(&bob, 1));
    assert_eq!(env.session(1, &bob.pubkey()).unwrap().id, 1);
    assert_eq!(env.pot(1), 2 * BUY_IN);
    let carol = env.new_player("carol");
    assert_error(env.join(&carol, 1), SlanaError::ArenaFull);

    // Paused config blocks joins.
    assert_ok(env.create_arena(2, MIN_BUY_IN, 10));
    assert_ok(env.update_config(UpdateConfigArgs {
        paused: Some(true),
        ..Default::default()
    }));
    assert_error(env.join(&carol, 2), SlanaError::Paused);
    assert_ok(env.update_config(UpdateConfigArgs {
        paused: Some(false),
        ..Default::default()
    }));

    // Disabled arenas block joins.
    assert_ok(env.update_arena(2, Some(false), None));
    assert_error(env.join(&carol, 2), SlanaError::ArenaDisabled);
    assert_ok(env.update_arena(2, Some(true), None));
    assert_ok(env.join(&carol, 2));
    assert_eq!(env.pot(2), MIN_BUY_IN);

    // A wallet without a profile cannot join.
    let ghost = env.funded_keypair(10 * SOL);
    assert_anchor_error(env.join(&ghost, 2), AnchorErrorCode::AccountNotInitialized);
}

/// Two players join a 0.1 SOL arena; payouts, fee split and stats.
#[test]
fn settle_session_pays_player_and_splits_fee() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, BUY_IN, 10));
    let alice = env.new_player("alice");
    let bob = env.new_player("bob");
    assert_ok(env.join(&alice, 1));
    assert_ok(env.join(&bob, 1));
    assert_eq!(env.pot(1), 2 * BUY_IN);
    let session_rent = env.session_rent();
    let treasury = env.treasury.pubkey();

    // Only the server authority can settle.
    let mallory = env.funded_keypair(SOL);
    let args = SettleArgs {
        session_id: env.session(1, &alice.pubkey()).unwrap().id,
        payout: 150_000_000,
        score: 1_234,
        kills: 3,
        xp: 120,
    };
    assert_error(
        env.settle_as(&mallory, &alice.pubkey(), 1, args.clone()),
        SlanaError::Unauthorized,
    );
    // A session must be settled together with its own player.
    let config = env.config();
    let wrong_player = ix::settle_session_with(
        &env.server.pubkey(),
        &bob.pubkey(),
        1,
        &session_pda(&arena_pda(1), &alice.pubkey()),
        config.current_season,
        &config.treasury,
        args.clone(),
    );
    let server = env.server.insecure_clone();
    assert_anchor_error(
        env.send(&[wrong_player], &[&server]),
        AnchorErrorCode::ConstraintSeeds,
    );

    // Alice cashes out 0.15 SOL: fee = 5 % of the 0.05 profit, half to the season.
    let alice_before = env.balance(&alice.pubkey());
    let treasury_before = env.balance(&treasury);
    let season_before = env.prize_balance(1);
    assert_ok(env.settle(&alice.pubkey(), 1, 150_000_000, 1_234, 3, 120));
    assert_eq!(
        env.balance(&alice.pubkey()) - alice_before,
        147_500_000 + session_rent
    );
    assert_eq!(env.balance(&treasury) - treasury_before, 1_250_000);
    assert_eq!(env.prize_balance(1) - season_before, 1_250_000);
    assert!(env.session(1, &alice.pubkey()).is_none(), "session closed");
    assert_eq!(env.balance(&session_pda(&arena_pda(1), &alice.pubkey())), 0);
    assert_eq!(env.pot(1), 50_000_000);

    let arena = env.arena(1);
    assert_eq!(arena.open_sessions, 1);
    assert_eq!(arena.total_paid_out, 150_000_000);
    let config = env.config();
    assert_eq!(config.total_games, 1);
    assert_eq!(config.total_paid_out, 150_000_000);
    let profile = env.profile(&alice.pubkey());
    assert_eq!(profile.total_won, 147_500_000);
    assert_eq!(profile.games_played, 1);
    assert_eq!(profile.kills, 3);
    assert_eq!(profile.best_score, 1_234);
    assert_eq!(profile.total_score, 1_234);
    assert_eq!(profile.xp, 120);
    assert_eq!(profile.season_points, 1_234);
    assert_eq!(profile.last_played, START_TS);

    // Settling an already closed session fails.
    assert_anchor_error(
        env.settle(&alice.pubkey(), 1, 0, 0, 0, 0),
        AnchorErrorCode::AccountNotInitialized,
    );

    // Bob cannot get more than the pot.
    assert_error(
        env.settle(&bob.pubkey(), 1, 50_000_001, 10, 0, 1),
        SlanaError::InsufficientPot,
    );

    // Bob lost everything: payout 0. Settlement keeps working while paused.
    assert_ok(env.update_config(UpdateConfigArgs {
        paused: Some(true),
        ..Default::default()
    }));
    let bob_before = env.balance(&bob.pubkey());
    let treasury_before = env.balance(&treasury);
    assert_ok(env.settle(&bob.pubkey(), 1, 0, 50, 1, 10));
    assert_eq!(env.balance(&bob.pubkey()) - bob_before, session_rent);
    assert_eq!(env.balance(&treasury), treasury_before);
    assert!(env.session(1, &bob.pubkey()).is_none());
    assert_eq!(env.pot(1), 50_000_000);
    assert_eq!(env.arena(1).open_sessions, 0);
    let profile = env.profile(&bob.pubkey());
    assert_eq!(profile.total_won, 0);
    assert_eq!(
        (profile.games_played, profile.kills, profile.xp),
        (1, 1, 10)
    );
    assert_eq!(profile.season_points, 50);
    assert_eq!(env.config().total_games, 2);

    // Both players are on the season leaderboard, best first.
    let season = env.season(1);
    assert_eq!(season.count, 2);
    let (first, second) = (season.entries[0], season.entries[1]);
    assert_eq!(first.player, alice.pubkey());
    assert_eq!((first.points, first.best_score), (1_234, 1_234));
    assert_eq!(name_of(&first.name, first.name_len), "alice");
    assert_eq!(second.player, bob.pubkey());
    assert_eq!((second.points, second.best_score), (50, 50));
    assert_eq!(name_of(&second.name, second.name_len), "bob");

    // A closed session can be opened again (new session id). Joining is blocked while
    // paused, settling is not.
    assert_error(env.join(&alice, 1), SlanaError::Paused);
    assert_ok(env.update_config(UpdateConfigArgs {
        paused: Some(false),
        ..Default::default()
    }));
    assert_ok(env.join(&alice, 1));
    let session = env.session(1, &alice.pubkey()).expect("new session");
    assert_eq!(session.id, 2);
    assert_eq!(env.pot(1), 50_000_000 + BUY_IN);
    assert_eq!(env.arena(1).open_sessions, 1);
    assert_eq!(env.profile(&alice.pubkey()).stake_games, 2);
}

/// Edge cases of the payout path: treasury == player, and a treasury account that does not
/// exist yet (its cut would be below the rent-exempt minimum, so it goes to the season).
#[test]
fn settle_session_treasury_edge_cases() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, BUY_IN, 10));
    let alice = env.new_player("alice");
    let bob = env.new_player("bob");
    let session_rent = env.session_rent();

    // treasury == player
    assert_ok(env.update_config(UpdateConfigArgs {
        treasury: Some(alice.pubkey()),
        ..Default::default()
    }));
    assert_ok(env.join(&alice, 1));
    assert_ok(env.join(&bob, 1));
    let alice_before = env.balance(&alice.pubkey());
    let season_before = env.prize_balance(1);
    assert_ok(env.settle(&alice.pubkey(), 1, 150_000_000, 10, 0, 0));
    // 147.5M payout + 1.25M treasury cut + session rent, all to the same wallet.
    assert_eq!(
        env.balance(&alice.pubkey()) - alice_before,
        147_500_000 + 1_250_000 + session_rent
    );
    assert_eq!(env.prize_balance(1) - season_before, 1_250_000);

    // Treasury account that does not exist: 0.25M treasury cut < rent-exempt minimum.
    let empty_treasury = Keypair::new().pubkey();
    assert_eq!(env.balance(&empty_treasury), 0);
    assert_ok(env.update_config(UpdateConfigArgs {
        treasury: Some(empty_treasury),
        ..Default::default()
    }));
    let bob_before = env.balance(&bob.pubkey());
    let season_before = env.prize_balance(1);
    assert_ok(env.settle(&bob.pubkey(), 1, 50_000_000, 10, 0, 0)); // pot is exactly 50M
    assert_eq!(
        env.balance(&bob.pubkey()) - bob_before,
        50_000_000 + session_rent
    );
    assert_eq!(env.prize_balance(1) - season_before, 0); // no profit, no fee
    assert_eq!(env.pot(1), 0);

    let carol = env.new_player("carol");
    let dave = env.new_player("dave");
    assert_ok(env.join(&carol, 1));
    assert_ok(env.join(&dave, 1));
    let season_before = env.prize_balance(1);
    // Profit 10M → fee 500k (250k season + 250k treasury): treasury part rerouted.
    assert_ok(env.settle(&carol.pubkey(), 1, 110_000_000, 10, 0, 0));
    assert_eq!(env.prize_balance(1) - season_before, 500_000);
    assert_eq!(env.balance(&empty_treasury), 0);
}

#[test]
fn refund_session_after_timeout() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, BUY_IN, 10));
    let alice = env.new_player("alice");
    let bob = env.new_player("bob");
    let carol = env.new_player("carol");
    let session_rent = env.session_rent();
    assert_ok(env.join(&alice, 1));

    // Too early.
    assert_error(env.refund(&alice, 1), SlanaError::RefundTooEarly);
    env.warp(SESSION_REFUND_TIMEOUT_SECS - 1);
    assert_error(env.refund(&alice, 1), SlanaError::RefundTooEarly);
    env.warp(1);

    // Only the player's own session can be refunded.
    assert_anchor_error(env.refund(&bob, 1), AnchorErrorCode::AccountNotInitialized);

    let before = env.balance(&alice.pubkey());
    assert_ok(env.refund(&alice, 1));
    assert_eq!(env.balance(&alice.pubkey()) - before, BUY_IN + session_rent);
    assert!(env.session(1, &alice.pubkey()).is_none());
    assert_eq!(env.pot(1), 0);
    let arena = env.arena(1);
    assert_eq!(arena.open_sessions, 0);
    assert_eq!(arena.total_paid_out, BUY_IN);
    assert_eq!(
        env.balance(&arena_pda(1)),
        env.rent(8 + Arena::INIT_SPACE),
        "arena stays rent exempt"
    );

    // The refund is capped by the pot: bob joins with carol, carol wins 0.15 SOL.
    assert_ok(env.join(&bob, 1));
    assert_ok(env.join(&carol, 1));
    assert_ok(env.settle(&carol.pubkey(), 1, 150_000_000, 0, 0, 0));
    assert_eq!(env.pot(1), 50_000_000);
    env.warp(SESSION_REFUND_TIMEOUT_SECS);
    let before = env.balance(&bob.pubkey());
    assert_ok(env.refund(&bob, 1));
    assert_eq!(
        env.balance(&bob.pubkey()) - before,
        50_000_000 + session_rent
    );
    assert_eq!(env.pot(1), 0);
    assert_eq!(env.arena(1).open_sessions, 0);
    assert_eq!(
        env.arena(1).total_paid_out,
        BUY_IN + 150_000_000 + 50_000_000
    );
    assert!(env
        .try_fetch::<Session>(&session_pda(&arena_pda(1), &bob.pubkey()))
        .is_none());
}

#[test]
fn sweep_arena_after_all_sessions_settled() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, BUY_IN, 10));
    let alice = env.new_player("alice");
    let bob = env.new_player("bob");
    assert_ok(env.join(&alice, 1));
    assert_ok(env.join(&bob, 1));

    assert_error(env.sweep(1), SlanaError::ArenaHasOpenSessions);

    assert_ok(env.settle(&alice.pubkey(), 1, 120_000_000, 0, 0, 0));
    assert_error(env.sweep(1), SlanaError::ArenaHasOpenSessions);
    assert_ok(env.settle(&bob.pubkey(), 1, 30_000_000, 0, 0, 0));
    assert_eq!(env.pot(1), 50_000_000);

    // Admin only, and only to the configured treasury.
    let mallory = env.funded_keypair(SOL);
    assert_error(env.sweep_as(&mallory, 1), SlanaError::Unauthorized);
    let admin = env.admin.insecure_clone();
    let wrong_treasury = ix::sweep_arena(&admin.pubkey(), 1, &mallory.pubkey());
    assert_error(
        env.send(&[wrong_treasury], &[&admin]),
        SlanaError::Unauthorized,
    );

    let treasury = env.treasury.pubkey();
    let before = env.balance(&treasury);
    assert_ok(env.sweep(1));
    assert_eq!(env.balance(&treasury) - before, 50_000_000);
    assert_eq!(env.pot(1), 0);
    assert_eq!(env.balance(&arena_pda(1)), env.rent(8 + Arena::INIT_SPACE));

    // Sweeping an empty arena is a no-op.
    assert_ok(env.sweep(1));
    assert_eq!(env.balance(&treasury) - before, 50_000_000);
}

/// A delayed or retried settlement of an old session must not hit a newer session that
/// reuses the same PDA address (player joined the same arena again).
#[test]
fn stale_settlement_cannot_hit_a_rejoined_session() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, BUY_IN, 10));
    let alice = env.new_player("alice");
    let bob = env.new_player("bob");
    assert_ok(env.join(&bob, 1));
    assert_ok(env.join(&alice, 1));
    let first_id = env.session(1, &alice.pubkey()).unwrap().id;
    assert_ok(env.settle(&alice.pubkey(), 1, 0, 10, 0, 1));

    // Alice joins again: same PDA, new session id.
    assert_ok(env.join(&alice, 1));
    let second_id = env.session(1, &alice.pubkey()).unwrap().id;
    assert_ne!(first_id, second_id);

    let server = env.server.insecure_clone();
    let stale = SettleArgs {
        session_id: first_id,
        payout: 2 * BUY_IN,
        score: 1,
        kills: 0,
        xp: 1,
    };
    assert_error(
        env.settle_as(&server, &alice.pubkey(), 1, stale),
        SlanaError::SessionMismatch,
    );
    assert!(
        env.session(1, &alice.pubkey()).is_some(),
        "new session untouched"
    );
    assert_ok(env.settle(&alice.pubkey(), 1, BUY_IN, 10, 0, 1));
}
