//! Seasons in tokens: `end_season`, `claim_season_reward` (season vault → winner) and
//! `rollover_season`.

mod common;

use {
    anchor_lang::prelude::Pubkey,
    common::*,
    slana::{constants::*, error::SlanaError},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

/// Season prize pool built by `pass_season`: Pass fee 2 % of the profits (1000 + 500 tokens)
/// = 30 tokens, 30 % of it to the season vault.
const POOL: u64 = 9 * TOKEN;

/// Four Pass players settle in a Pass arena with scores 300 / 200 / 100 / 50, so they rank
/// 0..3 on season 1's leaderboard; the fee shares fill `season(1).pool` with `POOL`.
fn pass_season(env: &mut TestEnv) -> Vec<Keypair> {
    assert_ok(env.create_arena(1, ENTRY_FEE, 300, true));
    let collection = Pubkey::new_unique();
    env.set_pass_collection(&collection);

    let players: Vec<Keypair> = ["a", "b", "c", "d"]
        .iter()
        .map(|name| {
            let player = env.token_player(name, ENTRY_FEE);
            let asset = fake_core_asset(&mut env.svm, &player.pubkey(), &collection);
            assert_ok(env.join_with_pass(&player, 1, &asset));
            player
        })
        .collect();

    let results = [
        (2_000 * TOKEN, 300),
        (1_500 * TOKEN, 200),
        (400 * TOKEN, 100),
        (0, 50),
    ];
    for (player, (payout, score)) in players.iter().zip(results) {
        assert_ok(env.settle(&player.pubkey(), 1, payout, score, 0, 10));
    }

    let season = env.season(1);
    assert_eq!(season.pool, POOL);
    assert_eq!(season.count, 4);
    for (rank, player) in players.iter().enumerate() {
        assert_eq!(season.entries[rank].player, player.pubkey());
    }
    assert_eq!(env.tokens(&season_vault_pda()), POOL);
    players
}

fn prize(rank: usize) -> u64 {
    POOL * u64::from(PRIZE_SHARES_BPS[rank]) / u64::from(BPS)
}

#[test]
fn season_rewards_are_paid_in_tokens() {
    let mut env = TestEnv::initialized();
    let players = pass_season(&mut env);
    let outsider = env.token_player("e", 0);

    // Not finalized yet.
    assert_error(env.claim(&players[0], 1), SlanaError::SeasonNotFinalized);
    // Only the admin ends a season.
    let not_admin = env.funded_keypair(SOL);
    let res = env.send(&[ix::end_season(&not_admin.pubkey(), 1)], &[&not_admin]);
    assert_error(res, SlanaError::Unauthorized);

    assert_ok(env.end_season());
    let now = env.now();
    let ended = env.season(1);
    assert!(ended.finalized);
    assert_eq!(ended.ended_at, now);
    assert_eq!(ended.prize_pool, POOL);
    let config = env.config();
    assert_eq!(config.current_season, 2);
    let next = env.season(2);
    assert_eq!(
        (next.id, next.started_at, next.pool, next.count),
        (2, now, 0, 0)
    );
    assert!(!next.finalized);

    // Ranks 1..3 (0-based 0..2) claim 30 / 20 / 14 % of the pool from the season vault.
    for (rank, player) in players.iter().take(3).enumerate() {
        let ata = env.player_ata(&player.pubkey());
        let before = env.tokens(&ata);
        let vault_before = env.tokens(&season_vault_pda());
        assert_ok(env.claim(player, 1));
        assert_eq!(env.tokens(&ata), before + prize(rank));
        assert_eq!(env.tokens(&season_vault_pda()), vault_before - prize(rank));
        assert_ne!(env.season(1).claimed_mask & (1 << rank), 0);
    }
    assert_eq!(prize(0), 2_700_000);
    assert_eq!(env.season(1).pool, POOL - prize(0) - prize(1) - prize(2));
    assert_eq!(env.season(1).claimed_mask, 0b111);

    // Double claim.
    assert_error(env.claim(&players[0], 1), SlanaError::AlreadyClaimed);
    // Not on the leaderboard.
    assert_error(env.claim(&outsider, 1), SlanaError::NotEligible);
    // The running season cannot be claimed.
    assert_error(env.claim(&players[3], 2), SlanaError::SeasonNotFinalized);

    // The prize must go to a token account of the winner.
    let foreign = env.player_ata(&outsider.pubkey());
    let (mint, program) = (env.mint, env.token_program);
    let winner = &players[3];
    let res = env.send(
        &[ix::claim_season_reward(
            &winner.pubkey(),
            1,
            &foreign,
            &mint,
            &program,
        )],
        &[winner],
    );
    assert!(res.is_err());
    assert_ok(env.claim(winner, 1));
    assert_eq!(env.tokens(&env.player_ata(&winner.pubkey())), prize(3));
}

#[test]
fn rewards_work_with_token_2022() {
    let mut env = TestEnv::initialized_with(MintKind::Token2022);
    let players = pass_season(&mut env);
    assert_ok(env.end_season());
    assert_ok(env.claim(&players[1], 1));
    assert_eq!(
        env.tokens(&env.player_ata(&players[1].pubkey())),
        1_490 * TOKEN + prize(1)
    );
}

#[test]
fn rollover_moves_unclaimed_after_window() {
    let mut env = TestEnv::initialized();
    let players = pass_season(&mut env);
    assert_ok(env.end_season());
    assert_ok(env.claim(&players[0], 1));

    // Still inside the claim window.
    assert_error(env.rollover(1), SlanaError::ClaimWindowOpen);

    env.warp(CLAIM_WINDOW_SECS + 1);
    assert_error(env.claim(&players[1], 1), SlanaError::ClaimWindowClosed);

    let not_admin = env.funded_keypair(SOL);
    assert_error(env.rollover_as(&not_admin, 1), SlanaError::Unauthorized);
    // The running season cannot be rolled over.
    assert_error(env.rollover(2), SlanaError::InvalidSeason);

    let vault_before = env.tokens(&season_vault_pda());
    let unclaimed = POOL - prize(0);
    assert_ok(env.rollover(1));
    assert_eq!(env.season(2).pool, unclaimed);
    let old = env.season(1);
    assert_eq!(old.pool, 0);
    assert_eq!(old.claimed_mask, (1u16 << PRIZE_RANKS) - 1);
    // Tokens stay in the (global) season vault; only the accounting moves.
    assert_eq!(env.tokens(&season_vault_pda()), vault_before);

    // Nothing left to move or claim.
    assert_ok(env.rollover(1));
    assert_eq!(env.season(2).pool, unclaimed);
    assert_error(env.claim(&players[1], 1), SlanaError::ClaimWindowClosed);

    // The rolled-over tokens are season 2's prize pool.
    assert_ok(env.end_season());
    assert_eq!(env.season(2).prize_pool, unclaimed);
}

#[test]
fn ending_twice_and_unknown_seasons_fail() {
    let mut env = TestEnv::initialized();
    assert_ok(env.end_season());
    assert_eq!(env.season(1).prize_pool, 0);
    // An empty season: nobody is eligible.
    let player = env.token_player("a", 0);
    assert_error(env.claim(&player, 1), SlanaError::NotEligible);
    // A season that does not exist.
    assert!(env.claim(&player, 7).is_err());
    assert_ok(env.end_season());
    assert_eq!(env.config().current_season, 3);
}
