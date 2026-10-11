//! Arenas: `create_arena`, `update_arena`, `join_arena`, `activate_session`, `settle_session`, `refund_session`,
//! `sweep_arena`.

mod common;

use {
    anchor_lang::{error::ErrorCode as AnchorErrorCode, Space},
    common::*,
    solagel::{
        constants::*,
        error::SolagelError,
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
        SolagelError::Unauthorized,
    );
    assert_error(
        env.create_arena(1, MIN_BUY_IN - 1, 10),
        SolagelError::BuyInTooLow,
    );
    assert_error(
        env.create_arena(1, MIN_BUY_IN, 1),
        SolagelError::InvalidMaxPlayers,
    );
    assert_error(
        env.create_arena(1, MIN_BUY_IN, 101),
        SolagelError::InvalidMaxPlayers,
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
        SolagelError::Unauthorized,
    );
    assert_error(
        env.update_arena(1, None, Some(101)),
        SolagelError::InvalidMaxPlayers,
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
    assert!(!session.activated);
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
    assert_error(env.join(&carol, 1), SolagelError::ArenaFull);

    // Paused config blocks joins.
    assert_ok(env.create_arena(2, MIN_BUY_IN, 10));
    assert_ok(env.update_config(UpdateConfigArgs {
        paused: Some(true),
        ..Default::default()
    }));
    assert_error(env.join(&carol, 2), SolagelError::Paused);
    assert_ok(env.update_config(UpdateConfigArgs {
        paused: Some(false),
        ..Default::default()
    }));

    // Disabled arenas block joins.
    assert_ok(env.update_arena(2, Some(false), None));
    assert_error(env.join(&carol, 2), SolagelError::ArenaDisabled);
    assert_ok(env.update_arena(2, Some(true), None));
    assert_ok(env.join(&carol, 2));
    assert_eq!(env.pot(2), MIN_BUY_IN);

    // A wallet without a profile cannot join.
    let ghost = env.funded_keypair(10 * SOL);
    assert_anchor_error(env.join(&ghost, 2), AnchorErrorCode::AccountNotInitialized);
}

#[test]
fn activation_requires_server_and_available_arena_and_is_one_time() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, BUY_IN, 10));
    let alice = env.new_player("alice");
    assert_ok(env.join(&alice, 1));
    let id = env.session(1, &alice.pubkey()).unwrap().id;
    let server = env.server.insecure_clone();
    let before = env.balance(&alice.pubkey());

    // Paying for the session does not authorize the player to admit it to gameplay.
    assert_error(
        env.activate_as(&alice, &alice.pubkey(), 1, id),
        SolagelError::Unauthorized,
    );
    assert_error(
        env.activate_as(&server, &alice.pubkey(), 1, id + 1),
        SolagelError::SessionMismatch,
    );
    assert_ok(env.update_config(UpdateConfigArgs {
        paused: Some(true),
        ..Default::default()
    }));
    assert_error(env.activate(&alice.pubkey(), 1), SolagelError::Paused);
    assert_ok(env.update_config(UpdateConfigArgs {
        paused: Some(false),
        ..Default::default()
    }));
    assert_ok(env.update_arena(1, Some(false), None));
    assert_error(
        env.activate(&alice.pubkey(), 1),
        SolagelError::ArenaDisabled,
    );
    assert!(!env.session(1, &alice.pubkey()).unwrap().activated);
    assert_ok(env.update_arena(1, Some(true), None));

    assert_ok(env.activate(&alice.pubkey(), 1));
    let session = env.session(1, &alice.pubkey()).unwrap();
    assert!(session.activated);
    assert_eq!(
        (session.id, session.opened_at, session.buy_in),
        (id, START_TS, BUY_IN)
    );
    assert_error(
        env.activate(&alice.pubkey(), 1),
        SolagelError::SessionAlreadyActivated,
    );
    assert_error(env.refund(&alice, 1), SolagelError::SessionNotRefundable);
    assert_eq!(env.balance(&alice.pubkey()), before);
    assert_eq!(env.pot(1), BUY_IN);
    assert_eq!(env.arena(1).open_sessions, 1);
    assert_eq!(env.config().total_games, 0);
}

#[test]
fn activation_expires_at_refund_boundary_and_admitted_stakes_cannot_be_refunded() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, BUY_IN, 10));
    let alice = env.new_player("alice");
    let bob = env.new_player("bob");
    assert_ok(env.join(&alice, 1));
    assert_ok(env.join(&bob, 1));

    // The last second before the refund deadline still permits admission.
    env.warp(SESSION_REFUND_TIMEOUT_SECS - 1);
    assert_ok(env.activate(&alice.pubkey(), 1));
    env.warp(1);
    assert_error(
        env.activate(&bob.pubkey(), 1),
        SolagelError::SessionActivationExpired,
    );
    assert!(!env.session(1, &bob.pubkey()).unwrap().activated);
    let bob_before = env.balance(&bob.pubkey());
    assert_ok(env.refund(&bob, 1));
    assert_eq!(
        env.balance(&bob.pubkey()) - bob_before,
        BUY_IN + env.session_rent()
    );

    // Once admitted, a losing player can never race settlement with a wallet refund.
    assert_error(env.refund(&alice, 1), SolagelError::SessionNotRefundable);
    env.warp(SESSION_REFUND_TIMEOUT_SECS);
    assert_ok(env.update_config(UpdateConfigArgs {
        paused: Some(true),
        ..Default::default()
    }));
    assert_ok(env.update_arena(1, Some(false), None));
    let alice_before = env.balance(&alice.pubkey());
    assert_error(env.refund(&alice, 1), SolagelError::SessionNotRefundable);
    assert_eq!(env.balance(&alice.pubkey()), alice_before);
    assert_eq!(env.pot(1), BUY_IN);
    assert!(env.session(1, &alice.pubkey()).unwrap().activated);

    // Server settlement remains available during a pause or arena shutdown.
    let args = SettleArgs {
        session_id: env.session(1, &alice.pubkey()).unwrap().id,
        payout: BUY_IN,
        score: 100,
        kills: 1,
        xp: 10,
    };
    assert_error(
        env.settle_as(&alice, &alice.pubkey(), 1, args),
        SolagelError::Unauthorized,
    );
    assert_ok(env.settle(&alice.pubkey(), 1, BUY_IN, 100, 1, 10));
    assert_eq!(
        env.balance(&alice.pubkey()) - alice_before,
        BUY_IN + env.session_rent()
    );
    assert!(env.session(1, &alice.pubkey()).is_none());
    assert_eq!(env.arena(1).open_sessions, 0);
    assert_eq!(env.pot(1), 0);
    assert_eq!(env.profile(&alice.pubkey()).season_points, 0);
    assert_eq!(env.season(1).count, 0);
}

#[test]
fn stale_activation_cannot_admit_a_rejoined_session() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, BUY_IN, 10));
    let alice = env.new_player("alice");
    assert_ok(env.join(&alice, 1));
    let first_id = env.session(1, &alice.pubkey()).unwrap().id;
    assert_ok(env.activate(&alice.pubkey(), 1));
    assert_ok(env.settle(&alice.pubkey(), 1, BUY_IN, 0, 0, 0));
    assert_ok(env.join(&alice, 1));
    let second_id = env.session(1, &alice.pubkey()).unwrap().id;
    assert_ne!(first_id, second_id);

    let server = env.server.insecure_clone();
    assert_error(
        env.activate_as(&server, &alice.pubkey(), 1, first_id),
        SolagelError::SessionMismatch,
    );
    let session = env.session(1, &alice.pubkey()).unwrap();
    assert_eq!(session.id, second_id);
    assert!(!session.activated);
    assert_ok(env.activate(&alice.pubkey(), 1));
    assert!(env.session(1, &alice.pubkey()).unwrap().activated);
}

#[test]
fn zero_profit_settlements_do_not_enroll_wallets_for_prizes_or_change_existing_rows() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, BUY_IN, 10));
    let unused = env.new_player("unused");
    let admitted = env.new_player("admitted");
    let winner = env.new_player("winner");
    let empty_board = env.svm.get_account(&season_pda(1)).unwrap().data;

    // The server can return an unused ticket without granting a prize-eligible rank.
    let unused_before = env.balance(&unused.pubkey());
    assert_ok(env.join(&unused, 1));
    assert_ok(env.settle(&unused.pubkey(), 1, BUY_IN, 0, 0, 0));
    assert_eq!(env.balance(&unused.pubkey()), unused_before);
    assert_eq!(env.profile(&unused.pubkey()).season_points, 0);
    assert_eq!(
        env.svm.get_account(&season_pda(1)).unwrap().data,
        empty_board
    );

    // Even maximum mass score cannot earn a prize rank without capturing paid value.
    assert_ok(env.join(&admitted, 1));
    assert_ok(env.activate(&admitted.pubkey(), 1));
    assert_ok(env.settle(&admitted.pubkey(), 1, BUY_IN, u32::MAX, 10, 100));
    assert_eq!(env.profile(&admitted.pubkey()).season_points, 0);
    assert_eq!(
        env.profile(&admitted.pubkey()).best_score,
        MAX_SCORE_PER_GAME
    );
    assert_eq!(
        env.svm.get_account(&season_pda(1)).unwrap().data,
        empty_board
    );

    // Captured profit is ranked, and a later zero-profit result leaves its row untouched.
    assert_ok(env.play_paid(&winner, 1, 500, 1, 20));
    let season = env.season(1);
    assert_eq!(season.count, 1);
    assert_eq!(season.entries[0].player, winner.pubkey());
    assert_eq!(
        (season.entries[0].points, season.entries[0].best_score),
        (500, 500)
    );
    let ranked_board = env.svm.get_account(&season_pda(1)).unwrap().data;
    // A rename makes an unintended leaderboard upsert observable even if points stay flat.
    assert_ok(env.update_profile(&winner, Some("renamed"), Some(1)));
    assert_ok(env.join(&winner, 1));
    assert_ok(env.activate(&winner.pubkey(), 1));
    assert_ok(env.settle(&winner.pubkey(), 1, BUY_IN, u32::MAX, 1, 20));
    assert_eq!(env.profile(&winner.pubkey()).season_points, 500);
    assert_eq!(env.profile(&winner.pubkey()).best_score, MAX_SCORE_PER_GAME);
    assert_eq!(
        env.svm.get_account(&season_pda(1)).unwrap().data,
        ranked_board
    );

    let funder = env.funded_keypair(2 * SOL);
    assert_ok(env.fund_season(&funder, SOL));
    assert_ok(env.end_season());
    assert_error(env.claim(&unused, 1), SolagelError::NotEligible);
    assert_error(env.claim(&admitted, 1), SolagelError::NotEligible);
    let pool = SOL + 12_500; // half of the 5% fee on the winner's 500,000-lamport profit
    assert_eq!(env.prize_balance(1), pool);
    let winner_before = env.balance(&winner.pubkey());
    assert_ok(env.claim(&winner, 1));
    assert_eq!(
        env.balance(&winner.pubkey()) - winner_before,
        pool * 3_000 / 10_000
    );
    assert_eq!(env.season(1).claimed_mask, 1);
}

#[test]
fn season_points_round_down_captured_profit_independently_of_mass_score() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, BUY_IN, 10));
    let small_profit = env.new_player("small");
    let winner = env.new_player("winner");

    assert_ok(env.join(&small_profit, 1));
    assert_ok(env.activate(&small_profit.pubkey(), 1));
    env.airdrop(&arena_pda(1), 999);
    assert_ok(env.settle(&small_profit.pubkey(), 1, BUY_IN + 999, u32::MAX, 0, 0));
    assert_eq!(
        env.profile(&small_profit.pubkey()).best_score,
        MAX_SCORE_PER_GAME
    );
    assert_eq!(env.profile(&small_profit.pubkey()).season_points, 0);
    assert_eq!(env.season(1).count, 0);

    // A whole point is earned at 1,000 gross profit lamports, even with zero mass score.
    assert_ok(env.join(&winner, 1));
    assert_ok(env.activate(&winner.pubkey(), 1));
    env.airdrop(&arena_pda(1), 1_000);
    assert_ok(env.settle(&winner.pubkey(), 1, BUY_IN + 1_000, 0, 0, 0));
    let profile = env.profile(&winner.pubkey());
    assert_eq!(profile.best_score, 0);
    assert_eq!(profile.season_points, 1);
    let season = env.season(1);
    assert_eq!(season.count, 1);
    assert_eq!(season.entries[0].player, winner.pubkey());
    assert_eq!(
        (season.entries[0].points, season.entries[0].best_score),
        (1, 0)
    );
    assert_eq!(env.prize_balance(1), 49); // floor(999 * 5%) / 2 + (1000 * 5%) / 2
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
        SolagelError::Unauthorized,
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
    assert_eq!(profile.season_points, 50_000);
    assert_eq!(profile.last_played, START_TS);

    // Settling an already closed session fails.
    assert_anchor_error(
        env.settle(&alice.pubkey(), 1, 0, 0, 0, 0),
        AnchorErrorCode::AccountNotInitialized,
    );

    // Bob cannot get more than the pot.
    assert_error(
        env.settle(&bob.pubkey(), 1, 50_000_001, 10, 0, 1),
        SolagelError::InsufficientPot,
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
    assert_eq!(profile.season_points, 0);
    assert_eq!(env.config().total_games, 2);

    // Only captured profit enters the prize leaderboard; Bob's loss earns no rank.
    let season = env.season(1);
    assert_eq!(season.count, 1);
    let first = season.entries[0];
    assert_eq!(first.player, alice.pubkey());
    assert_eq!((first.points, first.best_score), (50_000, 1_234));
    assert_eq!(name_of(&first.name, first.name_len), "alice");
    assert!(season
        .entries
        .iter()
        .all(|entry| entry.player != bob.pubkey()));

    // A closed session can be opened again (new session id). Joining is blocked while
    // paused, settling is not.
    assert_error(env.join(&alice, 1), SolagelError::Paused);
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
    assert_error(env.refund(&alice, 1), SolagelError::RefundTooEarly);
    env.warp(SESSION_REFUND_TIMEOUT_SECS - 1);
    assert_error(env.refund(&alice, 1), SolagelError::RefundTooEarly);
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

    assert_error(env.sweep(1), SolagelError::ArenaHasOpenSessions);

    assert_ok(env.settle(&alice.pubkey(), 1, 120_000_000, 0, 0, 0));
    assert_error(env.sweep(1), SolagelError::ArenaHasOpenSessions);
    assert_ok(env.settle(&bob.pubkey(), 1, 30_000_000, 0, 0, 0));
    assert_eq!(env.pot(1), 50_000_000);

    // Admin only, and only to the configured treasury.
    let mallory = env.funded_keypair(SOL);
    assert_error(env.sweep_as(&mallory, 1), SolagelError::Unauthorized);
    let admin = env.admin.insecure_clone();
    let wrong_treasury = ix::sweep_arena(&admin.pubkey(), 1, &mallory.pubkey());
    assert_error(
        env.send(&[wrong_treasury], &[&admin]),
        SolagelError::Unauthorized,
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
        SolagelError::SessionMismatch,
    );
    assert!(
        env.session(1, &alice.pubkey()).is_some(),
        "new session untouched"
    );
    assert_ok(env.settle(&alice.pubkey(), 1, BUY_IN, 10, 0, 1));
}
