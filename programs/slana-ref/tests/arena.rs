//! Arenas: `create_arena` (token vault), `update_arena` and the token session flow
//! (`join_arena`, `settle_session`, `refund_session`, `sweep_arena`, `sweep_loot`).
//! Pass gating and locks are covered by `pass_gate.rs`.

mod common;

use {
    anchor_lang::error::ErrorCode as AnchorErrorCode,
    common::*,
    slana::{constants::*, error::SlanaError, state::Arena, SettleArgs, UpdateConfigArgs},
    solana_signer::Signer,
};

#[test]
fn create_arena_creates_token_vault() {
    for kind in [MintKind::Spl, MintKind::Token2022] {
        let mut env = TestEnv::initialized_with(kind);
        let mallory = env.funded_keypair(10 * SOL);

        assert_error(
            env.create_arena_as(&mallory, 1, ENTRY_FEE, 300, false),
            SlanaError::Unauthorized,
        );
        assert_error(env.create_arena(1, 0, 300, false), SlanaError::EntryFeeZero);
        assert_error(
            env.create_arena(1, ENTRY_FEE, MIN_ARENA_SESSIONS - 1, false),
            SlanaError::InvalidMaxSessions,
        );
        assert_error(
            env.create_arena(1, ENTRY_FEE, MAX_ARENA_SESSIONS + 1, false),
            SlanaError::InvalidMaxSessions,
        );
        assert!(env.try_fetch::<Arena>(&arena_pda(1)).is_none());

        assert_ok(env.create_arena(1, ENTRY_FEE, 300, false));
        assert_ok(env.create_arena(3, 50 * ENTRY_FEE, MAX_ARENA_SESSIONS, true));

        let arena_key = arena_pda(1);
        let vault = vault_pda(&arena_key);
        let arena = env.arena(1);
        assert_eq!(arena.id, 1);
        assert_eq!(arena.entry_fee, ENTRY_FEE);
        assert!(!arena.requires_pass);
        assert_eq!(arena.max_sessions, 300);
        assert!(arena.enabled);
        assert_eq!(arena.vault, vault);
        assert_eq!(
            (
                arena.open_sessions,
                arena.total_deposited,
                arena.total_paid_out
            ),
            (0, 0, 0)
        );

        // The vault is a token account of the game mint with the arena PDA as authority.
        assert_eq!(env.owner_of(&vault), kind.program());
        let account = env.token_account(&vault);
        assert_eq!(account.mint, env.mint);
        assert_eq!(account.owner, arena_key);
        assert_eq!(account.amount, 0);

        let pass_arena = env.arena(3);
        assert!(pass_arena.requires_pass);
        assert_eq!(pass_arena.max_sessions, MAX_ARENA_SESSIONS);
        assert_eq!(pass_arena.vault, vault_pda(&arena_pda(3)));
        assert_eq!(env.token_account(&pass_arena.vault).owner, arena_pda(3));

        assert_already_in_use(env.create_arena(1, ENTRY_FEE, 300, false));
    }
}

#[test]
fn create_arena_requires_the_config_mint() {
    let mut env = TestEnv::initialized();
    let other = env.create_mint(MintKind::Spl, None);
    let admin = env.admin.insecure_clone();
    let token_program = env.token_program;
    let bad = ix::create_arena(
        &admin.pubkey(),
        1,
        ENTRY_FEE,
        300,
        false,
        &other,
        &token_program,
    );
    assert_anchor_error(
        env.send(&[bad], &[&admin]),
        AnchorErrorCode::ConstraintAddress,
    );
    assert!(env.try_fetch::<Arena>(&arena_pda(1)).is_none());
}

#[test]
fn update_arena_is_admin_only_and_validated() {
    let mut env = TestEnv::initialized();
    let mallory = env.funded_keypair(10 * SOL);
    assert_ok(env.create_arena(1, ENTRY_FEE, 300, false));

    assert_error(
        env.update_arena_as(&mallory, 1, Some(false), None, None, None),
        SlanaError::Unauthorized,
    );
    assert_error(
        env.update_arena(1, None, Some(MAX_ARENA_SESSIONS + 1), None, None),
        SlanaError::InvalidMaxSessions,
    );
    assert_error(
        env.update_arena(1, None, Some(1), None, None),
        SlanaError::InvalidMaxSessions,
    );
    assert_error(
        env.update_arena(1, None, None, Some(0), None),
        SlanaError::EntryFeeZero,
    );

    assert_ok(env.update_arena(1, Some(false), Some(2), Some(2 * ENTRY_FEE), Some(true)));
    let arena = env.arena(1);
    assert!(!arena.enabled);
    assert_eq!(arena.max_sessions, 2);
    assert_eq!(arena.entry_fee, 2 * ENTRY_FEE);
    assert!(arena.requires_pass);

    // `None` keeps every field.
    assert_ok(env.update_arena(1, Some(true), None, None, None));
    let arena = env.arena(1);
    assert!(arena.enabled);
    assert_eq!(arena.max_sessions, 2);
    assert_eq!(arena.entry_fee, 2 * ENTRY_FEE);
    assert!(arena.requires_pass);
}

#[test]
fn update_arena_entry_fee_requires_no_open_sessions() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, ENTRY_FEE, 300, false));

    // Test-only state write: pretend a session is open.
    let mut arena = env.arena(1);
    arena.open_sessions = 1;
    env.write_account(&arena_pda(1), &arena);
    assert_eq!(env.arena(1).open_sessions, 1);

    assert_error(
        env.update_arena(1, None, None, Some(2 * ENTRY_FEE), None),
        SlanaError::ArenaBusy,
    );
    assert_error(
        env.update_arena(1, None, None, None, Some(true)),
        SlanaError::ArenaBusy,
    );
    // Enabling/disabling and capacity changes stay possible while sessions are open.
    assert_ok(env.update_arena(1, Some(false), Some(500), None, None));
    let arena = env.arena(1);
    assert!(!arena.enabled);
    assert_eq!(arena.max_sessions, 500);
    assert_eq!(arena.entry_fee, ENTRY_FEE);
    assert!(!arena.requires_pass);

    // Once the session is gone, the fee and the Pass requirement can change.
    let mut arena = env.arena(1);
    arena.open_sessions = 0;
    env.write_account(&arena_pda(1), &arena);
    assert_ok(env.update_arena(1, None, None, Some(2 * ENTRY_FEE), Some(true)));
    let arena = env.arena(1);
    assert_eq!(arena.entry_fee, 2 * ENTRY_FEE);
    assert!(arena.requires_pass);
}

// ---------------------------------------------------------------------------------------
// join / settle / refund / sweep
// ---------------------------------------------------------------------------------------

#[test]
fn join_moves_entry_fee_and_deposit() {
    for kind in [MintKind::Spl, MintKind::Token2022] {
        let mut env = TestEnv::initialized_with(kind);
        assert_ok(env.create_arena(1, ENTRY_FEE, 300, false));
        let alice = env.token_player("alice", 5 * ENTRY_FEE);
        let alice_ata = env.player_ata(&alice.pubkey());
        let vault = vault_pda(&arena_pda(1));
        let lamports_before = env.balance(&alice.pubkey());

        assert_ok(env.join(&alice, 1));

        assert_eq!(env.tokens(&alice_ata), 4 * ENTRY_FEE);
        assert_eq!(env.tokens(&vault), ENTRY_FEE);
        let session_key = session_pda(&arena_pda(1), &alice.pubkey());
        assert_eq!(
            env.balance(&session_key),
            env.session_rent() + SETTLE_FEE_LAMPORTS
        );
        assert_eq!(
            env.balance(&alice.pubkey()),
            lamports_before - env.session_rent() - SETTLE_FEE_LAMPORTS
        );

        let session = env.session(1, &alice.pubkey()).expect("session");
        assert_eq!(session.id, 0);
        assert_eq!(session.player, alice.pubkey());
        assert_eq!(session.arena, arena_pda(1));
        assert_eq!(session.arena_id, 1);
        assert_eq!(session.entry_fee, ENTRY_FEE);
        assert_eq!(session.opened_at, START_TS);
        assert!(!session.has_pass);
        assert_eq!(session.pass_asset, anchor_lang::prelude::Pubkey::default());
        assert_eq!(session.settle_fee, SETTLE_FEE_LAMPORTS);
        assert_eq!(session.fee_bps, FEE_BPS);

        let arena = env.arena(1);
        assert_eq!(arena.open_sessions, 1);
        assert_eq!(arena.total_deposited, ENTRY_FEE);
        let config = env.config();
        assert_eq!(config.total_sessions, 1);
        assert_eq!(config.total_staked, ENTRY_FEE);
        let profile = env.profile(&alice.pubkey());
        assert_eq!(profile.stake_games, 1);
        assert_eq!(profile.total_staked, ENTRY_FEE);

        // One open session per player per arena.
        assert_already_in_use(env.join(&alice, 1));
    }
}

#[test]
fn join_checks_pause_capacity_and_balance() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, ENTRY_FEE, 2, false));
    let a = env.token_player("a", ENTRY_FEE);
    let b = env.token_player("b", ENTRY_FEE);
    let c = env.token_player("c", ENTRY_FEE);
    let poor = env.token_player("poor", ENTRY_FEE - 1);

    // Not enough tokens: the token program rejects the transfer.
    assert_custom_error(
        env.join(&poor, 1),
        anchor_spl::token::spl_token::error::TokenError::InsufficientFunds as u32,
    );
    assert!(env.session(1, &poor.pubkey()).is_none());

    assert_ok(env.update_config(UpdateConfigArgs {
        paused: Some(true),
        ..Default::default()
    }));
    assert_error(env.join(&a, 1), SlanaError::Paused);
    assert_ok(env.update_config(UpdateConfigArgs {
        paused: Some(false),
        ..Default::default()
    }));

    assert_ok(env.update_arena(1, Some(false), None, None, None));
    assert_error(env.join(&a, 1), SlanaError::ArenaDisabled);
    assert_ok(env.update_arena(1, Some(true), None, None, None));

    assert_ok(env.join(&a, 1));
    assert_ok(env.join(&b, 1));
    assert_error(env.join(&c, 1), SlanaError::ArenaFull);
    assert_eq!(env.arena(1).open_sessions, 2);
}

#[test]
fn settle_splits_fee_and_burns() {
    for kind in [MintKind::Spl, MintKind::Token2022] {
        let mut env = TestEnv::initialized_with(kind);
        assert_ok(env.create_arena(1, 1_000, 300, false));
        let a = env.token_player("a", 1_000);
        let b = env.token_player("b", 1_000);
        assert_ok(env.join(&a, 1));
        assert_ok(env.join(&b, 1));

        let vault = vault_pda(&arena_pda(1));
        let a_ata = env.player_ata(&a.pubkey());
        let session_key = session_pda(&arena_pda(1), &a.pubkey());
        assert_eq!(env.tokens(&vault), 2_000);
        let supply = env.mint_supply();
        let server_before = env.balance(&env.server.pubkey());
        let a_before = env.balance(&a.pubkey());

        assert_ok(env.settle(&a.pubkey(), 1, 2_000, 4_200, 3, 120));

        // profit 1000, fee 5 % = 50: treasury 25, burn 10, season 15; A receives 1950.
        assert_eq!(env.tokens(&a_ata), 1_950);
        assert_eq!(env.tokens(&vault), 0);
        assert_eq!(env.tokens(&treasury_vault_pda()), 25);
        assert_eq!(env.tokens(&season_vault_pda()), 15);
        assert_eq!(env.mint_supply(), supply - 10);
        assert_eq!(env.season(FIRST_SEASON).pool, 15);

        // The settle deposit pays the server; the rent goes back to the player.
        assert_eq!(
            env.balance(&env.server.pubkey()),
            server_before + SETTLE_FEE_LAMPORTS
        );
        assert!(env.session(1, &a.pubkey()).is_none());
        assert_eq!(env.balance(&session_key), 0);
        assert_eq!(env.balance(&a.pubkey()), a_before + env.session_rent());

        let arena = env.arena(1);
        assert_eq!(arena.open_sessions, 1);
        assert_eq!(arena.total_paid_out, 2_000);
        let config = env.config();
        assert_eq!(config.total_games, 1);
        assert_eq!(config.total_paid_out, 2_000);
        let profile = env.profile(&a.pubkey());
        assert_eq!(profile.total_won, 1_950);
        assert_eq!(profile.games_played, 1);
        assert_eq!(profile.best_score, 4_200);
        assert_eq!(profile.kills, 3);
        assert_eq!(profile.xp, 120);
        // No Pass: no season points, nobody on the board.
        assert_eq!(profile.season_points, 0);
        assert_eq!(env.season(FIRST_SEASON).count, 0);

        // B lost everything: a zero payout settles without any token movement.
        let b_ata = env.player_ata(&b.pubkey());
        assert_ok(env.settle(&b.pubkey(), 1, 0, 10, 0, 1));
        assert_eq!(env.tokens(&b_ata), 0);
        assert_eq!(env.arena(1).open_sessions, 0);
        assert_eq!(env.mint_supply(), supply - 10);
    }
}

#[test]
fn settle_with_pass_charges_the_pass_fee() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300, false));
    let a = env.token_player("a", 1_000);
    let b = env.token_player("b", 1_000);
    let (_, asset) = env.give_pass(&a.pubkey());
    assert_ok(env.join_with_pass(&a, 1, &asset));
    assert_ok(env.join(&b, 1));
    let supply = env.mint_supply();

    assert_ok(env.settle(&a.pubkey(), 1, 2_000, 100, 0, 0));

    // profit 1000, Pass fee 2 % = 20: treasury 10, burn 4, season 6; A receives 1980.
    assert_eq!(env.tokens(&env.player_ata(&a.pubkey())), 1_980);
    assert_eq!(env.tokens(&treasury_vault_pda()), 10);
    assert_eq!(env.tokens(&season_vault_pda()), 6);
    assert_eq!(env.mint_supply(), supply - 4);
    assert_eq!(env.season(FIRST_SEASON).pool, 6);
    assert!(env.pass_lock(&asset).is_none());
}

#[test]
fn settle_uses_the_fee_fixed_at_join() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300, false));
    let a = env.token_player("a", 1_000);
    let b = env.token_player("b", 1_000);
    let c = env.token_player("c", 2_000);
    let (_, asset) = env.give_pass(&b.pubkey());
    assert_ok(env.join(&a, 1));
    assert_ok(env.join_with_pass(&b, 1, &asset));
    assert_eq!(env.session(1, &a.pubkey()).unwrap().fee_bps, FEE_BPS);
    assert_eq!(env.session(1, &b.pubkey()).unwrap().fee_bps, PASS_FEE_BPS);

    // The admin raises both fees while the sessions are open.
    assert_ok(env.update_config(UpdateConfigArgs {
        fee_bps: Some(MAX_FEE_BPS),
        pass_fee_bps: Some(MAX_FEE_BPS),
        ..Default::default()
    }));
    assert_ok(env.join(&c, 1));
    assert_eq!(env.session(1, &c.pubkey()).unwrap().fee_bps, MAX_FEE_BPS);

    // profit 1000 each: A pays 5 % (50), B 2 % (20), both fixed at join; C, who joined
    // after the change, pays 10 % (100) on a 1000 profit.
    assert_ok(env.settle(&a.pubkey(), 1, 2_000, 0, 0, 0));
    assert_eq!(env.tokens(&env.player_ata(&a.pubkey())), 1_950);
    assert_ok(env.settle(&b.pubkey(), 1, 1_000, 0, 0, 0));
    assert_eq!(env.tokens(&env.player_ata(&b.pubkey())), 1_000);
    assert_ok(env.settle(&c.pubkey(), 1, 0, 0, 0, 0));
    assert_eq!(env.tokens(&treasury_vault_pda()), 25);
    // A new session of C after the change charges the new fee.
    let d = env.token_player("d", 1_000);
    assert_ok(env.join(&c, 1));
    assert_ok(env.join(&d, 1));
    let before = env.tokens(&treasury_vault_pda());
    assert_ok(env.settle(&c.pubkey(), 1, 2_000, 0, 0, 0));
    // fee 100: treasury 50.
    assert_eq!(env.tokens(&treasury_vault_pda()), before + 50);
}

#[test]
fn join_refuses_a_fee_above_the_signed_bound() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300, false));
    let a = env.token_player("a", 1_000);
    let b = env.token_player("b", 1_000);
    let (_, asset) = env.give_pass(&b.pubkey());
    // The player was shown 4 % but the config says 5 %: refused, nothing moves.
    assert_error(
        env.join_max(&a, 1, FEE_BPS - 100),
        SlanaError::FeeAboveLimit,
    );
    assert!(env.session(1, &a.pubkey()).is_none());
    assert_eq!(env.tokens(&env.player_ata(&a.pubkey())), 1_000);
    // The Pass rate is the one checked for a Pass join.
    assert_error(
        env.join_with_pass_max(&b, 1, &asset, PASS_FEE_BPS - 1),
        SlanaError::FeeAboveLimit,
    );
    // Exactly the shown rate (or a looser bound) is accepted.
    assert_ok(env.join_max(&a, 1, FEE_BPS));
    assert_ok(env.join_with_pass_max(&b, 1, &asset, PASS_FEE_BPS));
    assert_eq!(env.session(1, &b.pubkey()).unwrap().fee_bps, PASS_FEE_BPS);
}

#[test]
fn settle_works_while_paused_and_requires_the_server() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, ENTRY_FEE, 300, false));
    let a = env.token_player("a", ENTRY_FEE);
    assert_ok(env.join(&a, 1));
    assert_ok(env.update_config(UpdateConfigArgs {
        paused: Some(true),
        ..Default::default()
    }));

    let mallory = env.funded_keypair(SOL);
    let args = SettleArgs {
        session_id: 0,
        payout: ENTRY_FEE,
        score: 1,
        kills: 0,
        xp: 0,
    };
    assert_error(
        env.settle_as(&mallory, &a.pubkey(), 1, args.clone(), None),
        SlanaError::Unauthorized,
    );
    // The player cannot settle their own session either.
    assert_error(
        env.settle_as(&a, &a.pubkey(), 1, args, None),
        SlanaError::Unauthorized,
    );
    assert_ok(env.settle(&a.pubkey(), 1, ENTRY_FEE, 1, 0, 0));
    // No profit, no fee.
    assert_eq!(env.tokens(&env.player_ata(&a.pubkey())), ENTRY_FEE);
}

#[test]
fn settle_rejects_overdraw() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, ENTRY_FEE, 300, false));
    let a = env.token_player("a", ENTRY_FEE);
    assert_ok(env.join(&a, 1));

    assert_error(
        env.settle(&a.pubkey(), 1, ENTRY_FEE + 1, 0, 0, 0),
        SlanaError::InsufficientPot,
    );
    // Tokens sitting elsewhere do not count: only the arena vault pays.
    env.mint_to(&treasury_vault_pda(), 10 * ENTRY_FEE);
    assert_error(
        env.settle(&a.pubkey(), 1, ENTRY_FEE + 1, 0, 0, 0),
        SlanaError::InsufficientPot,
    );
    assert_eq!(env.arena(1).open_sessions, 1);
    assert_ok(env.settle(&a.pubkey(), 1, ENTRY_FEE, 0, 0, 0));
}

#[test]
fn stale_settlement_cannot_hit_a_rejoined_session() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, ENTRY_FEE, 300, false));
    let a = env.token_player("a", 2 * ENTRY_FEE);
    assert_ok(env.join(&a, 1));
    let first = env.session(1, &a.pubkey()).expect("session").id;
    assert_ok(env.settle(&a.pubkey(), 1, 0, 0, 0, 0));

    // Same session PDA, new id.
    assert_ok(env.join(&a, 1));
    let second = env.session(1, &a.pubkey()).expect("session").id;
    assert_ne!(first, second);

    let server = env.server.insecure_clone();
    let stale = SettleArgs {
        session_id: first,
        payout: ENTRY_FEE,
        score: 0,
        kills: 0,
        xp: 0,
    };
    assert_error(
        env.settle_as(&server, &a.pubkey(), 1, stale, None),
        SlanaError::SessionMismatch,
    );
    assert!(env.session(1, &a.pubkey()).is_some());
    assert_ok(env.settle(&a.pubkey(), 1, ENTRY_FEE, 0, 0, 0));
}

#[test]
fn refund_after_timeout_returns_tokens_and_deposit() {
    for kind in [MintKind::Spl, MintKind::Token2022] {
        let mut env = TestEnv::initialized_with(kind);
        assert_ok(env.create_arena(1, ENTRY_FEE, 300, false));
        let a = env.token_player("a", ENTRY_FEE);
        let mallory = env.token_player("mallory", 0);
        let a_ata = env.player_ata(&a.pubkey());
        let a_before = env.balance(&a.pubkey());
        assert_ok(env.join(&a, 1));

        assert_error(env.refund(&a, 1), SlanaError::RefundTooEarly);
        env.warp(SESSION_REFUND_TIMEOUT_SECS - 1);
        assert_error(env.refund(&a, 1), SlanaError::RefundTooEarly);
        env.warp(1);

        // Someone else cannot refund it (their session PDA does not exist).
        assert_anchor_error(
            env.refund(&mallory, 1),
            AnchorErrorCode::AccountNotInitialized,
        );

        assert_ok(env.refund(&a, 1));
        assert_eq!(env.tokens(&a_ata), ENTRY_FEE);
        assert_eq!(env.tokens(&vault_pda(&arena_pda(1))), 0);
        assert!(env.session(1, &a.pubkey()).is_none());
        // Rent and the settle deposit come back.
        assert_eq!(env.balance(&a.pubkey()), a_before);
        assert_eq!(env.arena(1).open_sessions, 0);
        assert_eq!(env.arena(1).total_paid_out, ENTRY_FEE);
    }
}

#[test]
fn refund_is_capped_by_the_vault() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300, false));
    let a = env.token_player("a", 1_000);
    let b = env.token_player("b", 1_000);
    assert_ok(env.join(&a, 1));
    assert_ok(env.join(&b, 1));
    // A cashes out 1500, leaving 500 in the vault for B.
    assert_ok(env.settle(&a.pubkey(), 1, 1_500, 0, 0, 0));
    assert_eq!(env.tokens(&vault_pda(&arena_pda(1))), 500);

    env.warp(SESSION_REFUND_TIMEOUT_SECS);
    assert_ok(env.refund(&b, 1));
    assert_eq!(env.tokens(&env.player_ata(&b.pubkey())), 500);
    assert_eq!(env.tokens(&vault_pda(&arena_pda(1))), 0);
}

#[test]
fn sweep_moves_vault_to_season_pool() {
    for kind in [MintKind::Spl, MintKind::Token2022] {
        let mut env = TestEnv::initialized_with(kind);
        assert_ok(env.create_arena(1, 1_000, 300, false));
        let a = env.token_player("a", 1_000);
        let b = env.token_player("b", 1_000);
        assert_ok(env.join(&a, 1));
        assert_ok(env.join(&b, 1));
        // A loses everything, B cashes out 700: 1300 stay in the vault.
        assert_ok(env.settle(&a.pubkey(), 1, 0, 0, 0, 0));

        let mallory = env.funded_keypair(SOL);
        assert_error(env.sweep_as(&mallory, 1), SlanaError::Unauthorized);
        // Enabled arenas cannot be swept.
        assert_error(env.sweep(1), SlanaError::ArenaBusy);
        assert_ok(env.update_arena(1, Some(false), None, None, None));
        // Open sessions block the sweep.
        assert_error(env.sweep(1), SlanaError::ArenaHasOpenSessions);
        assert_ok(env.settle(&b.pubkey(), 1, 700, 0, 0, 0));

        let vault = vault_pda(&arena_pda(1));
        assert_eq!(env.tokens(&vault), 1_300);
        assert_ok(env.sweep(1));
        assert_eq!(env.tokens(&vault), 0);
        assert_eq!(env.tokens(&season_vault_pda()), 1_300);
        assert_eq!(env.season(FIRST_SEASON).pool, 1_300);

        // An empty vault sweeps nothing.
        assert_ok(env.sweep(1));
        assert_eq!(env.season(FIRST_SEASON).pool, 1_300);
    }
}

#[test]
fn sweep_loot_moves_part_of_a_live_vault_to_the_season_pool() {
    use slana::events::LootSwept;
    for kind in [MintKind::Spl, MintKind::Token2022] {
        let mut env = TestEnv::initialized_with(kind);
        assert_ok(env.create_arena(1, 1_000, 300, false));
        let a = env.token_player("a", 1_000);
        let b = env.token_player("b", 1_000);
        assert_ok(env.join(&a, 1));
        assert_ok(env.join(&b, 1));
        let vault = vault_pda(&arena_pda(1));
        assert_eq!(env.tokens(&vault), 2_000);

        // The arena stays enabled with open sessions: the server sweeps part of the vault.
        let meta = assert_ok(env.sweep_loot(1, 600));
        assert_event(
            &meta,
            &LootSwept {
                arena_id: 1,
                season_id: FIRST_SEASON,
                amount: 600,
            },
        );
        assert_eq!(env.tokens(&vault), 1_400);
        assert_eq!(env.tokens(&season_vault_pda()), 600);
        assert_eq!(env.season(FIRST_SEASON).pool, 600);
        let arena = env.arena(1);
        assert!(arena.enabled);
        assert_eq!(arena.open_sessions, 2);

        // The rest of the vault, exactly.
        assert_ok(env.sweep_loot(1, 1_400));
        assert_eq!(env.tokens(&vault), 0);
        assert_eq!(env.tokens(&season_vault_pda()), 2_000);
        assert_eq!(env.season(FIRST_SEASON).pool, 2_000);
    }
}

#[test]
fn sweep_loot_requires_the_server() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300, false));
    let a = env.token_player("a", 1_000);
    assert_ok(env.join(&a, 1));

    let mallory = env.funded_keypair(SOL);
    assert_error(
        env.sweep_loot_as(&mallory, 1, 100),
        SlanaError::Unauthorized,
    );
    // Not the admin either.
    let admin = env.admin.insecure_clone();
    assert_error(env.sweep_loot_as(&admin, 1, 100), SlanaError::Unauthorized);
    assert_eq!(env.tokens(&vault_pda(&arena_pda(1))), 1_000);
    assert_eq!(env.season(FIRST_SEASON).pool, 0);
}

#[test]
fn sweep_loot_is_capped_by_the_vault() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300, false));
    let a = env.token_player("a", 1_000);
    assert_ok(env.join(&a, 1));

    assert_error(env.sweep_loot(1, 1_001), SlanaError::InsufficientPot);
    assert_error(env.sweep_loot(1, u64::MAX), SlanaError::InsufficientPot);
    // Tokens sitting elsewhere do not count: only the arena vault pays.
    env.mint_to(&season_vault_pda(), 10_000);
    assert_error(env.sweep_loot(1, 1_001), SlanaError::InsufficientPot);
    assert_eq!(env.tokens(&vault_pda(&arena_pda(1))), 1_000);
    assert_eq!(env.season(FIRST_SEASON).pool, 0);
}

#[test]
fn sweep_loot_of_zero_does_nothing() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300, false));
    let vault = vault_pda(&arena_pda(1));

    // An empty vault: zero is the only amount it allows.
    assert_error(env.sweep_loot(1, 1), SlanaError::InsufficientPot);
    let meta = assert_ok(env.sweep_loot(1, 0));
    let a = env.token_player("a", 1_000);
    assert_ok(env.join(&a, 1));
    let meta2 = assert_ok(env.sweep_loot(1, 0));
    for meta in [meta, meta2] {
        // No transfer (no token program CPI) and no event.
        assert!(
            !meta.logs.iter().any(|l| l.starts_with("Program data: ")),
            "unexpected event\n{}",
            meta.pretty_logs()
        );
        assert!(
            !meta.logs.iter().any(|l| l.contains("invoke [2]")),
            "unexpected CPI\n{}",
            meta.pretty_logs()
        );
    }
    assert_eq!(env.tokens(&vault), 1_000);
    assert_eq!(env.tokens(&season_vault_pda()), 0);
    assert_eq!(env.season(FIRST_SEASON).pool, 0);
}

#[test]
fn sweep_loot_only_pays_the_current_season() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300, false));
    let a = env.token_player("a", 1_000);
    assert_ok(env.join(&a, 1));
    assert_ok(env.end_season());
    assert_eq!(env.config().current_season, FIRST_SEASON + 1);

    let server = env.server.insecure_clone();
    assert_anchor_error(
        env.sweep_loot_to(&server, 1, FIRST_SEASON, 100),
        AnchorErrorCode::ConstraintSeeds,
    );
    let (old, new) = (
        env.season(FIRST_SEASON).pool,
        env.season(FIRST_SEASON + 1).pool,
    );
    assert_ok(env.sweep_loot(1, 100));
    assert_eq!(env.season(FIRST_SEASON).pool, old);
    assert_eq!(env.season(FIRST_SEASON + 1).pool, new + 100);
}

#[test]
fn sweep_arena_is_not_open_to_the_server() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300, false));
    assert_ok(env.update_arena(1, Some(false), None, None, None));
    env.mint_to(&vault_pda(&arena_pda(1)), 500);

    // The server signs `sweep_loot`, never the admin-only `sweep_arena`.
    let server = env.server.insecure_clone();
    assert_error(env.sweep_as(&server, 1), SlanaError::Unauthorized);
    assert_eq!(env.tokens(&vault_pda(&arena_pda(1))), 500);
    assert_eq!(env.season(FIRST_SEASON).pool, 0);
    assert_ok(env.sweep(1));
    assert_eq!(env.season(FIRST_SEASON).pool, 500);
}
