//! Seasons: leaderboard, `fund_season`, `end_season`, `claim_season_reward`, `rollover_season`.

mod common;

use {
    anchor_lang::error::ErrorCode as AnchorErrorCode,
    common::*,
    solagel::{constants::*, error::SolagelError, state::Season},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

fn assert_sorted(season: &Season) {
    let entries = &season.entries[..usize::from(season.count)];
    assert!(
        entries.windows(2).all(|w| w[0].points >= w[1].points),
        "leaderboard not sorted: {:?}",
        entries.iter().map(|e| e.points).collect::<Vec<_>>()
    );
}

fn rank_of(season: &Season, player: &Keypair) -> Option<usize> {
    season.entries[..usize::from(season.count)]
        .iter()
        .position(|e| e.player == player.pubkey())
}

#[test]
fn leaderboard_keeps_sorted_top_20() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, MIN_BUY_IN, 10));
    let players: Vec<Keypair> = (0..25)
        .map(|i| env.new_player(&format!("p{i:02}")))
        .collect();

    // Distinct scores 1 000..=25 000 in scrambled order (7 is coprime with 25).
    let score_of = |i: usize| (u32::try_from((i * 7) % 25).unwrap() + 1) * 1_000;
    for (i, player) in players.iter().enumerate() {
        assert_ok(env.play_paid(player, 1, score_of(i), 1, 10));
    }

    let season = env.season(1);
    assert_eq!(season.count, LEADERBOARD_SIZE);
    assert_sorted(&season);
    let points: Vec<u64> = season.entries.iter().map(|e| e.points).collect();
    let expected: Vec<u64> = (6..=25u64).rev().map(|s| s * 1_000).collect();
    assert_eq!(points, expected);
    for (i, player) in players.iter().enumerate() {
        let on_board = rank_of(&season, player).is_some();
        assert_eq!(
            on_board,
            score_of(i) > 5_000,
            "player {i} score {}",
            score_of(i)
        );
    }
    let top = season.entries[0];
    assert_eq!(
        name_of(&top.name, top.name_len),
        format!("p{:02}", (0..25).find(|&i| score_of(i) == 25_000).unwrap())
    );
    assert_eq!(top.best_score, 25_000);
    assert_eq!(env.config().total_games, 25);

    // An existing low-rank player with a big game climbs to the top.
    let last = season.entries[19];
    let climber = players
        .iter()
        .find(|p| p.pubkey() == last.player)
        .unwrap()
        .insecure_clone();
    assert_ok(env.play_paid(&climber, 1, 100_000, 0, 0));
    let season = env.season(1);
    assert_eq!(season.count, LEADERBOARD_SIZE);
    assert_sorted(&season);
    assert_eq!(season.entries[0].player, climber.pubkey());
    assert_eq!(season.entries[0].points, last.points + 100_000);
    assert_eq!(season.entries[0].best_score, 100_000);
    assert_eq!(
        env.profile(&climber.pubkey()).season_points,
        last.points + 100_000
    );

    // A player that was not on the board enters by beating the last entry.
    let outsider_idx = (0..25).find(|&i| score_of(i) == 3_000).unwrap();
    let outsider = players[outsider_idx].insecure_clone();
    assert!(rank_of(&season, &outsider).is_none());
    let dropped = season.entries[19];
    assert_ok(env.play_paid(&outsider, 1, 10_000, 0, 0)); // 13 000 points
    let season = env.season(1);
    assert_eq!(season.count, LEADERBOARD_SIZE);
    assert_sorted(&season);
    let rank = rank_of(&season, &outsider).expect("outsider entered the board");
    assert_eq!(season.entries[rank].points, 13_000);
    assert_eq!(season.entries[rank].best_score, 10_000);
    assert!(season.entries.iter().all(|e| e.player != dropped.player));

    // Scores below the last entry do not get in.
    let weakest_idx = (0..25).find(|&i| score_of(i) == 1_000).unwrap();
    let weakest = players[weakest_idx].insecure_clone();
    assert_ok(env.play_paid(&weakest, 1, 1, 0, 0));
    assert!(rank_of(&env.season(1), &weakest).is_none());

    // Only the server authority records games.
    let mallory = env.funded_keypair(SOL);
    let bad = ix::record_game(
        &mallory.pubkey(),
        &weakest.pubkey(),
        1,
        solagel::RecordArgs {
            score: 1_000_000,
            kills: 0,
            xp: 0,
        },
    );
    assert_error(env.send(&[bad], &[&mallory]), SolagelError::Unauthorized);
}

#[test]
fn season_lifecycle() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 100_000_000, 10));
    let alice = env.new_player("alice");
    let bob = env.new_player("bob");
    let carol = env.new_player("carol");
    let mallory = env.funded_keypair(10 * SOL);

    // Season 1 ranks captured profit: Alice 50M > Bob 30M > Carol 1M lamports.
    assert_ok(env.join(&alice, 1));
    assert_ok(env.join(&bob, 1));
    assert_ok(env.activate(&alice.pubkey(), 1));
    assert_ok(env.activate(&bob.pubkey(), 1));
    env.airdrop(&arena_pda(1), 80_000_000);
    assert_ok(env.settle(&alice.pubkey(), 1, 150_000_000, 5_000, 2, 100));
    assert_ok(env.settle(&bob.pubkey(), 1, 130_000_000, 3_000, 1, 100));
    assert_ok(env.play_paid(&carol, 1, 1_000, 0, 100));
    let fee_cuts = 2_025_000;
    assert_eq!(env.prize_balance(1), fee_cuts);

    // fund_season adds lamports to the current season.
    let funder = env.funded_keypair(10 * SOL);
    assert_error(env.fund_season(&funder, 0), SolagelError::InvalidAmount);
    let funder_before = env.balance(&funder.pubkey());
    assert_ok(env.fund_season(&funder, 2 * SOL));
    assert_eq!(funder_before - env.balance(&funder.pubkey()), 2 * SOL);
    assert_eq!(env.prize_balance(1), 2 * SOL + fee_cuts);

    // Nothing can be claimed or rolled over while the season runs.
    assert_error(env.claim(&alice, 1), SolagelError::SeasonNotFinalized);
    assert_error(env.rollover(1), SolagelError::InvalidSeason);

    // end_season is admin only; it freezes the pool and opens season 2.
    assert_error(env.end_season_as(&mallory), SolagelError::Unauthorized);
    env.warp(3_600);
    let ended_at = env.now();
    assert_ok(env.end_season());

    let pool = 2 * SOL + fee_cuts;
    let season1 = env.season(1);
    assert!(season1.finalized);
    assert_eq!(season1.ended_at, ended_at);
    assert_eq!(season1.prize_pool, pool);
    assert_eq!(season1.count, 3);
    assert_eq!(rank_of(&season1, &alice), Some(0));
    assert_eq!(rank_of(&season1, &bob), Some(1));
    assert_eq!(rank_of(&season1, &carol), Some(2));
    assert_eq!(env.config().current_season, 2);
    let season2 = env.season(2);
    assert_eq!(season2.id, 2);
    assert_eq!(season2.started_at, ended_at);
    assert!(!season2.finalized);
    assert_eq!((season2.count, season2.prize_pool), (0, 0));
    assert_eq!(env.prize_balance(2), 0);

    // From now on donations go to season 2.
    assert_ok(env.fund_season(&funder, SOL));
    assert_eq!(env.prize_balance(2), SOL);
    assert_eq!(env.prize_balance(1), pool);

    // Rank 0 receives 30 % of the pool, once.
    let before = env.balance(&alice.pubkey());
    assert_ok(env.claim(&alice, 1));
    let alice_prize = pool * 3_000 / 10_000;
    assert_eq!(env.balance(&alice.pubkey()) - before, alice_prize);
    assert_eq!(env.season(1).claimed_mask, 0b1);
    assert_error(env.claim(&alice, 1), SolagelError::AlreadyClaimed);

    // Players that are not ranked get nothing.
    assert_error(env.claim(&mallory, 1), SolagelError::NotEligible);
    // Season 2 is not finalized; season 9 does not exist.
    assert_error(env.claim(&alice, 2), SolagelError::SeasonNotFinalized);
    assert_anchor_error(env.claim(&alice, 9), AnchorErrorCode::AccountNotInitialized);

    // Rollover is admin only and waits for the claim window to close.
    assert_error(env.rollover_as(&mallory, 1), SolagelError::Unauthorized);
    assert_error(env.rollover(1), SolagelError::ClaimWindowOpen);

    // The last second of the claim window still allows claims (rank 1: 20 %).
    env.warp(CLAIM_WINDOW_SECS);
    assert_eq!(env.now(), ended_at + CLAIM_WINDOW_SECS);
    let before = env.balance(&bob.pubkey());
    assert_ok(env.claim(&bob, 1));
    let bob_prize = pool * 2_000 / 10_000;
    assert_eq!(env.balance(&bob.pubkey()) - before, bob_prize);
    assert_eq!(env.season(1).claimed_mask, 0b11);
    assert_error(env.rollover(1), SolagelError::ClaimWindowOpen);

    // One second later the window is closed, even for carol (rank 2) who never claimed.
    env.warp(1);
    assert_error(env.claim(&carol, 1), SolagelError::ClaimWindowClosed);

    // Leftovers (everything above rent) move into the current season.
    let leftover = env.prize_balance(1);
    assert_eq!(leftover, pool - alice_prize - bob_prize);
    let season2_before = env.prize_balance(2);
    assert_ok(env.rollover(1));
    assert_eq!(env.prize_balance(2) - season2_before, leftover);
    assert_eq!(env.prize_balance(1), 0);
    assert!(env.season(1).finalized);

    // A second rollover finds nothing left to move.
    assert_ok(env.rollover(1));
    assert_eq!(env.prize_balance(2), season2_before + leftover);
    assert_eq!(env.prize_balance(1), 0);

    // Season 2 starts from zero points for returning players; season 1's board is frozen.
    assert_ok(env.play_paid(&alice, 1, 700, 0, 0));
    let profile = env.profile(&alice.pubkey());
    assert_eq!(profile.season, 2);
    assert_eq!(profile.season_points, 700);
    let season2 = env.season(2);
    assert_eq!(season2.count, 1);
    assert_eq!(season2.entries[0].player, alice.pubkey());
    assert_eq!(season2.entries[0].points, 700);
    assert_eq!(env.season(1).entries[0].points, 50_000);
}
