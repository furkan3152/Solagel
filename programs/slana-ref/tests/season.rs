//! Seasons in tokens: `end_season`, `claim_season_reward` (season vault → winner) and
//! `rollover_season`.

// `TxResult` is LiteSVM's own result type; its error variant is large by design.
#![allow(clippy::result_large_err)]

mod common;

use {
    anchor_lang::{
        error::ErrorCode as AnchorErrorCode, prelude::Pubkey,
        solana_program::instruction::Instruction, AccountSerialize, Space,
    },
    common::*,
    slana::{
        constants::*,
        error::SlanaError,
        events::{RewardClaimed, SeasonEnded, SeasonRolledOver},
        state::{LeaderEntry, Season},
    },
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
    assert_anchor_error(res, AnchorErrorCode::ConstraintTokenOwner);
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
    // A season that does not exist: its account is an empty system account.
    assert_anchor_error(
        env.claim(&player, 7),
        AnchorErrorCode::AccountNotInitialized,
    );
    assert_anchor_error(env.rollover(7), AnchorErrorCode::AccountNotInitialized);
    assert_ok(env.end_season());
    assert_eq!(env.config().current_season, 3);
}

fn serialize<T: AccountSerialize>(value: &T) -> Vec<u8> {
    let mut out = Vec::new();
    value.try_serialize(&mut out).unwrap();
    out
}

/// The stored bytes of season `id` are exactly the reference serialization of the decoded
/// account (lean writes → reference reads).
#[track_caller]
fn assert_season_bytes(env: &TestEnv, id: u32) {
    let data = env.svm.get_account(&season_pda(id)).expect("season").data;
    assert_eq!(data.len(), 8 + Season::INIT_SPACE);
    assert_eq!(data, serialize(&env.season(id)));
}

/// `end_season`, `claim_season_reward` and `rollover_season` write the reference layouts and
/// emit the reference events.
#[test]
fn season_flow_writes_reference_layouts_and_events() {
    let mut env = TestEnv::initialized();
    let players = pass_season(&mut env);

    let meta = assert_ok(env.end_season());
    assert_event(
        &meta,
        &SeasonEnded {
            season_id: 1,
            prize_pool: POOL,
        },
    );
    assert_season_bytes(&env, 1);
    assert_season_bytes(&env, 2);
    let config = env.config();
    let raw = env.svm.get_account(&config_pda()).expect("config").data;
    assert_eq!(raw, serialize(&config));
    let (_, bump) = Pubkey::find_program_address(&[SEASON_SEED, &2u32.to_le_bytes()], &slana::ID);
    assert_eq!(env.season(2).bump, bump);

    let winner = &players[2];
    let meta = assert_ok(env.claim(winner, 1));
    assert_event(
        &meta,
        &RewardClaimed {
            season_id: 1,
            player: winner.pubkey(),
            rank: 2,
            amount: prize(2),
        },
    );
    assert_season_bytes(&env, 1);
    assert_eq!(env.season(1).claimed_mask, 0b100);

    env.warp(CLAIM_WINDOW_SECS + 1);
    let meta = assert_ok(env.rollover(1));
    assert_event(
        &meta,
        &SeasonRolledOver {
            from: 1,
            to: 2,
            amount: POOL - prize(2),
        },
    );
    assert_season_bytes(&env, 1);
    assert_season_bytes(&env, 2);
}

/// A ranked player of a season without a pool claims a zero prize: no transfer, the rank is
/// marked claimed and cannot be claimed again (also not twice in one transaction).
#[test]
fn zero_prizes_and_double_claims() {
    let mut env = TestEnv::initialized();
    let a = env.token_player("a", 0);
    let b = env.token_player("b", 0);
    let mut season = env.season(1);
    for (i, p) in [&a, &b].iter().enumerate() {
        season.entries[i] = LeaderEntry {
            player: p.pubkey(),
            points: 10 - i as u64,
            ..Default::default()
        };
    }
    season.count = 2;
    env.write_account(&season_pda(1), &season);
    assert_ok(env.end_season());

    let meta = assert_ok(env.claim(&a, 1));
    assert_event(
        &meta,
        &RewardClaimed {
            season_id: 1,
            player: a.pubkey(),
            rank: 0,
            amount: 0,
        },
    );
    assert_eq!(env.season(1).claimed_mask, 0b1);
    assert_eq!(env.tokens(&env.player_ata(&a.pubkey())), 0);
    assert_error(env.claim(&a, 1), SlanaError::AlreadyClaimed);

    // Twice in one transaction: the second sees the first's mask.
    let (mint, program) = (env.mint, env.token_program);
    let ata = env.player_ata(&b.pubkey());
    let claim = ix::claim_season_reward(&b.pubkey(), 1, &ata, &mint, &program);
    let res = env.send(&[claim.clone(), claim], &[&b]);
    assert_error(res, SlanaError::AlreadyClaimed);
    assert_eq!(env.season(1).claimed_mask, 0b1);
    assert_ok(env.claim(&b, 1));
    assert_eq!(env.season(1).claimed_mask, 0b11);
}

/// Anchor's account-type and constraint errors on the three season instructions, in the
/// reference's order.
#[test]
fn season_constraint_errors_match_anchor() {
    use AnchorErrorCode as A;
    let mut env = TestEnv::initialized();
    let players = pass_season(&mut env);
    let admin = env.admin.insecure_clone();
    let (mint, program) = (env.mint, env.token_program);

    // ----- end_season ------------------------------------------------------------------
    let end = |env: &mut TestEnv, edit: &dyn Fn(&mut Instruction), sign: bool| {
        let mut ix = ix::end_season(&admin.pubkey(), 1);
        edit(&mut ix);
        if sign {
            env.send(&[ix], &[&admin])
        } else {
            env.send(&[ix], &[])
        }
    };
    // admin: Signer → 3010.
    assert_anchor_error(
        end(&mut env, &|ix| ix.accounts[0].is_signer = false, false),
        A::AccountNotSigner,
    );
    // config: Account<Config> → a season is another type (3002).
    assert_anchor_error(
        end(&mut env, &|ix| ix.accounts[1].pubkey = season_pda(1), true),
        A::AccountDiscriminatorMismatch,
    );
    // system_program: Program<System> → 3008.
    assert_anchor_error(
        end(
            &mut env,
            &|ix| ix.accounts[4].pubkey = Pubkey::new_unique(),
            true,
        ),
        A::InvalidProgramId,
    );
    // A missing account → 3005.
    assert_anchor_error(
        end(&mut env, &|ix| ix.accounts.truncate(4), true),
        A::AccountNotEnoughKeys,
    );
    // next_season: seeds = [SEASON_SEED, current + 1] → 2006.
    assert_anchor_error(
        end(&mut env, &|ix| ix.accounts[3].pubkey = season_pda(3), true),
        A::ConstraintSeeds,
    );
    // config / season: mut → 2000.
    for i in [1, 2] {
        assert_anchor_error(
            end(&mut env, &|ix| ix.accounts[i].is_writable = false, true),
            A::ConstraintMut,
        );
    }
    assert_ok(env.end_season());
    assert_eq!(env.config().current_season, 2);
    // The old accounts again: next_season must now be season 3 (init seeds → 2006).
    assert_anchor_error(end(&mut env, &|_| {}, true), A::ConstraintSeeds);
    // season: seeds = [SEASON_SEED, current_season] → season 1 is not current (2006),
    // after the init of season 3 (rolled back with the failure).
    assert_anchor_error(
        end(&mut env, &|ix| ix.accounts[3].pubkey = season_pda(3), true),
        A::ConstraintSeeds,
    );
    assert!(env.svm.get_account(&season_pda(3)).is_none());

    // ----- claim_season_reward ---------------------------------------------------------
    let winner = players[0].insecure_clone();
    let ata = env.player_ata(&winner.pubkey());
    let other_mint = env.create_mint(MintKind::Spl, None);
    let saved = env.mint;
    env.mint = other_mint;
    let other_ata = env.create_ata(&winner.pubkey());
    env.mint = saved;
    let claim = |env: &mut TestEnv, edit: &dyn Fn(&mut Instruction), sign: bool| {
        let mut ix = ix::claim_season_reward(&winner.pubkey(), 1, &ata, &mint, &program);
        edit(&mut ix);
        if sign {
            env.send(&[ix], &[&winner])
        } else {
            env.send(&[ix], &[])
        }
    };
    // A short `season_id` → 102 (before any account).
    assert_anchor_error(
        claim(&mut env, &|ix| ix.data.truncate(8 + 3), true),
        A::InstructionDidNotDeserialize,
    );
    // claimer: Signer → 3010.
    assert_anchor_error(
        claim(&mut env, &|ix| ix.accounts[0].is_signer = false, false),
        A::AccountNotSigner,
    );
    // The season vault as the winner's token account → 2040 (before its constraints).
    assert_anchor_error(
        claim(
            &mut env,
            &|ix| ix.accounts[4].pubkey = season_vault_pda(),
            true,
        ),
        A::ConstraintDuplicateMutableAccount,
    );
    // season: seeds = [SEASON_SEED, season_id] → season 2 for season_id 1 (2006); mut (2000).
    assert_anchor_error(
        claim(&mut env, &|ix| ix.accounts[2].pubkey = season_pda(2), true),
        A::ConstraintSeeds,
    );
    assert_anchor_error(
        claim(&mut env, &|ix| ix.accounts[2].is_writable = false, true),
        A::ConstraintMut,
    );
    // season_vault: seeds = [SEASON_VAULT_SEED] (2006); mut (2000).
    assert_anchor_error(
        claim(
            &mut env,
            &|ix| ix.accounts[3].pubkey = treasury_vault_pda(),
            true,
        ),
        A::ConstraintSeeds,
    );
    assert_anchor_error(
        claim(&mut env, &|ix| ix.accounts[3].is_writable = false, true),
        A::ConstraintMut,
    );
    // claimer_token: mut (2000); token::mint (2014); token::token_program (2021).
    assert_anchor_error(
        claim(&mut env, &|ix| ix.accounts[4].is_writable = false, true),
        A::ConstraintMut,
    );
    assert_anchor_error(
        claim(&mut env, &|ix| ix.accounts[4].pubkey = other_ata, true),
        A::ConstraintTokenMint,
    );
    assert_anchor_error(
        claim(
            &mut env,
            &|ix| ix.accounts[6].pubkey = MintKind::Token2022.program(),
            true,
        ),
        A::ConstraintTokenTokenProgram,
    );
    // token_mint: address = config.token_mint → 2012 (the other mint and its account).
    assert_anchor_error(
        claim(
            &mut env,
            &|ix| {
                ix.accounts[4].pubkey = other_ata;
                ix.accounts[5].pubkey = other_mint;
            },
            true,
        ),
        A::ConstraintAddress,
    );
    assert_eq!(env.season(1).claimed_mask, 0);
    let before = env.tokens(&ata);
    assert_ok(claim(&mut env, &|_| {}, true));
    assert_eq!(env.tokens(&ata), before + prize(0));

    // ----- rollover_season ---------------------------------------------------------------
    env.warp(CLAIM_WINDOW_SECS + 1);
    let roll = |env: &mut TestEnv, edit: &dyn Fn(&mut Instruction), sign: bool| {
        let mut ix = ix::rollover_season(&admin.pubkey(), 1, 2);
        edit(&mut ix);
        if sign {
            env.send(&[ix], &[&admin])
        } else {
            env.send(&[ix], &[])
        }
    };
    assert_anchor_error(
        roll(&mut env, &|ix| ix.data.truncate(8 + 2), true),
        A::InstructionDidNotDeserialize,
    );
    assert_anchor_error(
        roll(&mut env, &|ix| ix.accounts[0].is_signer = false, false),
        A::AccountNotSigner,
    );
    // old_season: seeds = [SEASON_SEED, season_id] (2006); mut (2000).
    assert_anchor_error(
        roll(&mut env, &|ix| ix.accounts[2].pubkey = season_pda(2), true),
        A::ConstraintSeeds,
    );
    assert_anchor_error(
        roll(&mut env, &|ix| ix.accounts[2].is_writable = false, true),
        A::ConstraintMut,
    );
    // current_season: seeds = [SEASON_SEED, config.current_season] → season 1 again (2006);
    // mut (2000).
    assert_anchor_error(
        roll(&mut env, &|ix| ix.accounts[3].pubkey = season_pda(1), true),
        A::ConstraintSeeds,
    );
    assert_anchor_error(
        roll(&mut env, &|ix| ix.accounts[3].is_writable = false, true),
        A::ConstraintMut,
    );
    let unclaimed = POOL - prize(0);
    let meta = assert_ok(roll(&mut env, &|_| {}, true));
    assert_event(
        &meta,
        &SeasonRolledOver {
            from: 1,
            to: 2,
            amount: unclaimed,
        },
    );
    assert_eq!(env.season(2).pool, unclaimed);
}
