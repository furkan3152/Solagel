//! Arenas: `create_arena` (token vault), `update_arena` and the token session flow
//! (`join_arena`, `settle_session` with the fee to the fee wallet, `refund_session`,
//! `sweep_arena` to the fee wallet, `sweep_loot` burning).

mod common;

use {
    anchor_lang::{error::ErrorCode as AnchorErrorCode, prelude::Pubkey},
    common::*,
    slana::{
        constants::*,
        error::SlanaError,
        events::{ArenaSwept, LootBurned, SessionSettled},
        state::Arena,
        SettleArgs, UpdateConfigArgs,
    },
    solana_signer::Signer,
};

#[test]
fn create_arena_creates_token_vault() {
    for kind in [MintKind::Spl, MintKind::Token2022] {
        let mut env = TestEnv::initialized_with(kind);
        let mallory = env.funded_keypair(10 * SOL);

        assert_error(
            env.create_arena_as(&mallory, 1, ENTRY_FEE, 300),
            SlanaError::Unauthorized,
        );
        assert_error(env.create_arena(1, 0, 300), SlanaError::EntryFeeZero);
        assert_error(
            env.create_arena(1, ENTRY_FEE, MIN_ARENA_SESSIONS - 1),
            SlanaError::InvalidMaxSessions,
        );
        assert_error(
            env.create_arena(1, ENTRY_FEE, MAX_ARENA_SESSIONS + 1),
            SlanaError::InvalidMaxSessions,
        );
        assert!(env.try_fetch::<Arena>(&arena_pda(1)).is_none());

        assert_ok(env.create_arena(1, ENTRY_FEE, 300));
        assert_ok(env.create_arena(3, 50 * ENTRY_FEE, MAX_ARENA_SESSIONS));

        let arena_key = arena_pda(1);
        let vault = vault_pda(&arena_key);
        let arena = env.arena(1);
        assert_eq!(arena.id, 1);
        assert_eq!(arena.entry_fee, ENTRY_FEE);
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

        let big = env.arena(3);
        assert_eq!(big.max_sessions, MAX_ARENA_SESSIONS);
        assert_eq!(big.vault, vault_pda(&arena_pda(3)));
        assert_eq!(env.token_account(&big.vault).owner, arena_pda(3));

        assert_already_in_use(env.create_arena(1, ENTRY_FEE, 300));
    }
}

#[test]
fn create_arena_requires_the_config_mint() {
    let mut env = TestEnv::initialized();
    let other = env.create_mint(MintKind::Spl, None);
    let admin = env.admin.insecure_clone();
    let token_program = env.token_program;
    let bad = ix::create_arena(&admin.pubkey(), 1, ENTRY_FEE, 300, &other, &token_program);
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
    assert_ok(env.create_arena(1, ENTRY_FEE, 300));

    assert_error(
        env.update_arena_as(&mallory, 1, Some(false), None, None),
        SlanaError::Unauthorized,
    );
    assert_error(
        env.update_arena(1, None, Some(MAX_ARENA_SESSIONS + 1), None),
        SlanaError::InvalidMaxSessions,
    );
    assert_error(
        env.update_arena(1, None, Some(1), None),
        SlanaError::InvalidMaxSessions,
    );
    assert_error(
        env.update_arena(1, None, None, Some(0)),
        SlanaError::EntryFeeZero,
    );

    assert_ok(env.update_arena(1, Some(false), Some(2), Some(2 * ENTRY_FEE)));
    let arena = env.arena(1);
    assert!(!arena.enabled);
    assert_eq!(arena.max_sessions, 2);
    assert_eq!(arena.entry_fee, 2 * ENTRY_FEE);

    // `None` keeps every field.
    assert_ok(env.update_arena(1, Some(true), None, None));
    let arena = env.arena(1);
    assert!(arena.enabled);
    assert_eq!(arena.max_sessions, 2);
    assert_eq!(arena.entry_fee, 2 * ENTRY_FEE);
}

#[test]
fn update_arena_entry_fee_requires_no_open_sessions() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, ENTRY_FEE, 300));

    // Test-only state write: pretend a session is open.
    let mut arena = env.arena(1);
    arena.open_sessions = 1;
    env.write_account(&arena_pda(1), &arena);
    assert_eq!(env.arena(1).open_sessions, 1);

    assert_error(
        env.update_arena(1, None, None, Some(2 * ENTRY_FEE)),
        SlanaError::ArenaBusy,
    );
    // Enabling/disabling and capacity changes stay possible while sessions are open.
    assert_ok(env.update_arena(1, Some(false), Some(500), None));
    let arena = env.arena(1);
    assert!(!arena.enabled);
    assert_eq!(arena.max_sessions, 500);
    assert_eq!(arena.entry_fee, ENTRY_FEE);

    // Once the session is gone, the fee can change.
    let mut arena = env.arena(1);
    arena.open_sessions = 0;
    env.write_account(&arena_pda(1), &arena);
    assert_ok(env.update_arena(1, None, None, Some(2 * ENTRY_FEE)));
    assert_eq!(env.arena(1).entry_fee, 2 * ENTRY_FEE);
}

// ---------------------------------------------------------------------------------------
// join / settle / refund / sweep
// ---------------------------------------------------------------------------------------

#[test]
fn join_moves_entry_fee_and_deposit() {
    for kind in [MintKind::Spl, MintKind::Token2022] {
        let mut env = TestEnv::initialized_with(kind);
        assert_ok(env.create_arena(1, ENTRY_FEE, 300));
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
    assert_ok(env.create_arena(1, ENTRY_FEE, 2));
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

    assert_ok(env.update_arena(1, Some(false), None, None));
    assert_error(env.join(&a, 1), SlanaError::ArenaDisabled);
    assert_ok(env.update_arena(1, Some(true), None, None));

    assert_ok(env.join(&a, 1));
    assert_ok(env.join(&b, 1));
    assert_error(env.join(&c, 1), SlanaError::ArenaFull);
    assert_eq!(env.arena(1).open_sessions, 2);
}

#[test]
fn settle_pays_the_fee_to_the_fee_wallet_and_the_rest_to_the_player() {
    for kind in [MintKind::Spl, MintKind::Token2022] {
        let mut env = TestEnv::initialized_with(kind);
        assert_ok(env.create_arena(1, 1_000, 300));
        let a = env.token_player("a", 1_000);
        let b = env.token_player("b", 1_000);
        assert_ok(env.join(&a, 1));
        assert_ok(env.join(&b, 1));

        let vault = vault_pda(&arena_pda(1));
        let a_ata = env.player_ata(&a.pubkey());
        let fee_ata = env.fee_ata();
        let session_key = session_pda(&arena_pda(1), &a.pubkey());
        assert_eq!(env.tokens(&vault), 2_000);
        let supply = env.mint_supply();
        let server_before = env.balance(&env.server.pubkey());
        let a_before = env.balance(&a.pubkey());

        let meta = assert_ok(env.settle(&a.pubkey(), 1, 2_000, 4_200, 3, 120));

        // profit 1000, fee 5 % = 50 to the fee wallet; A receives 1950; nothing is burned.
        assert_eq!(env.tokens(&a_ata), 1_950);
        assert_eq!(env.tokens(&fee_ata), 50);
        assert_eq!(env.tokens(&vault), 0);
        assert_eq!(env.mint_supply(), supply);
        assert_event(
            &meta,
            &SessionSettled {
                player: a.pubkey(),
                arena_id: 1,
                session_id: 0,
                payout: 2_000,
                fee: 50,
                score: 4_200,
                kills: 3,
                owed: 0,
            },
        );

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

        // B lost everything: a zero payout settles without any token movement.
        let b_ata = env.player_ata(&b.pubkey());
        assert_ok(env.settle(&b.pubkey(), 1, 0, 10, 0, 1));
        assert_eq!(env.tokens(&b_ata), 0);
        assert_eq!(env.tokens(&fee_ata), 50);
        assert_eq!(env.arena(1).open_sessions, 0);
        assert_eq!(env.mint_supply(), supply);
    }
}

#[test]
fn settle_fee_is_rounded_down_and_only_on_profit() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300));
    let a = env.token_player("a", 1_000);
    let b = env.token_player("b", 1_000);
    let c = env.token_player("c", 1_000);
    assert_ok(env.join(&a, 1));
    assert_ok(env.join(&b, 1));
    assert_ok(env.join(&c, 1));
    let fee_ata = env.fee_ata();

    // Profit 199 at 5 % = 9.95: fee 9, A receives 1190.
    assert_ok(env.settle(&a.pubkey(), 1, 1_199, 0, 0, 0));
    assert_eq!(env.tokens(&env.player_ata(&a.pubkey())), 1_190);
    assert_eq!(env.tokens(&fee_ata), 9);
    // Payout at the entry fee: no profit, no fee.
    assert_ok(env.settle(&b.pubkey(), 1, 1_000, 0, 0, 0));
    assert_eq!(env.tokens(&env.player_ata(&b.pubkey())), 1_000);
    // Payout below the entry fee: no fee either.
    assert_ok(env.settle(&c.pubkey(), 1, 801, 0, 0, 0));
    assert_eq!(env.tokens(&env.player_ata(&c.pubkey())), 801);
    assert_eq!(env.tokens(&fee_ata), 9);
}

#[test]
fn settle_pays_any_token_account_of_the_fee_wallet() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300));
    let a = env.token_player("a", 1_000);
    let b = env.token_player("b", 1_000);
    assert_ok(env.join(&a, 1));
    assert_ok(env.join(&b, 1));
    // Not the ATA: a keypair token account owned by the fee wallet.
    let fee_wallet = env.fee_wallet.pubkey();
    let other = env.create_token_account(&fee_wallet);
    let server = env.server.insecure_clone();
    let args = env.settle_args(&a.pubkey(), 1, 2_000, 0, 0, 0);
    let ix = ix::settle_session(
        &server.pubkey(),
        &a.pubkey(),
        1,
        args,
        Some(env.player_ata(&a.pubkey())),
        &other,
        &env.mint,
        &env.token_program,
    );
    assert_ok(env.send(&[ix], &[&server]));
    assert_eq!(env.tokens(&other), 50);
    assert_eq!(env.tokens(&env.fee_ata()), 0);
    assert_eq!(env.tokens(&env.player_ata(&a.pubkey())), 1_950);
}

#[test]
fn settle_rejects_a_wrong_fee_account() {
    for kind in [MintKind::Spl, MintKind::Token2022] {
        let mut env = TestEnv::initialized_with(kind);
        assert_ok(env.create_arena(1, 1_000, 300));
        let a = env.token_player("a", 1_000);
        let b = env.token_player("b", 1_000);
        assert_ok(env.join(&a, 1));
        assert_ok(env.join(&b, 1));
        let server = env.server.insecure_clone();

        // Owned by somebody else (here the winning player's own second account and a
        // stranger's ATA): ConstraintTokenOwner.
        let stranger = Pubkey::new_unique();
        let strangers = env.create_ata(&stranger);
        let players_own = env.create_token_account(&a.pubkey());
        // Of another mint, owned by the fee wallet: ConstraintTokenMint.
        let other_mint = env.create_mint(kind, None);
        let fee_wallet = env.fee_wallet.pubkey();
        let wrong_mint = env.create_ata_of(&fee_wallet, &other_mint, &kind.program());
        // The arena vault itself: duplicate mutable account.
        let vault = vault_pda(&arena_pda(1));

        for (fee_token, err) in [
            (strangers, AnchorErrorCode::ConstraintTokenOwner),
            (players_own, AnchorErrorCode::ConstraintTokenOwner),
            (wrong_mint, AnchorErrorCode::ConstraintTokenMint),
            (vault, AnchorErrorCode::ConstraintDuplicateMutableAccount),
        ] {
            // With a profit (fee > 0) and without (fee = 0): one account list either way.
            for payout in [2_000, 1_000, 0] {
                let args = env.settle_args(&a.pubkey(), 1, payout, 0, 0, 0);
                let ix = ix::settle_session(
                    &server.pubkey(),
                    &a.pubkey(),
                    1,
                    args,
                    Some(env.player_ata(&a.pubkey())),
                    &fee_token,
                    &env.mint,
                    &env.token_program,
                );
                assert_anchor_error(env.send(&[ix], &[&server]), err);
            }
        }
        // A mint passed as the fee account does not even deserialize.
        let mint = env.mint;
        let args = env.settle_args(&a.pubkey(), 1, 2_000, 0, 0, 0);
        let ix = ix::settle_session(
            &server.pubkey(),
            &a.pubkey(),
            1,
            args,
            Some(env.player_ata(&a.pubkey())),
            &mint,
            &mint,
            &env.token_program,
        );
        assert!(env.send(&[ix], &[&server]).is_err());

        // Nothing moved; the right account settles.
        assert_eq!(env.tokens(&vault), 2_000);
        assert_eq!(env.tokens(&strangers), 0);
        assert_eq!(env.tokens(&wrong_mint), 0);
        assert_ok(env.settle(&a.pubkey(), 1, 2_000, 0, 0, 0));
        assert_eq!(env.tokens(&env.fee_ata()), 50);
    }
}

#[test]
fn settle_follows_a_new_fee_wallet() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300));
    let a = env.token_player("a", 1_000);
    let b = env.token_player("b", 1_000);
    assert_ok(env.join(&a, 1));
    assert_ok(env.join(&b, 1));
    let old_ata = env.fee_ata();

    // The admin moves the fee wallet: the old wallet's account is refused from then on.
    let new_wallet = env.funded_keypair(SOL);
    assert_ok(env.update_config(UpdateConfigArgs {
        fee_wallet: Some(new_wallet.pubkey()),
        ..Default::default()
    }));
    assert_anchor_error(
        env.settle(&a.pubkey(), 1, 2_000, 0, 0, 0),
        AnchorErrorCode::ConstraintTokenOwner,
    );
    let new_owner = new_wallet.pubkey();
    env.fee_wallet = new_wallet;
    let new_ata = env.create_ata(&new_owner);
    assert_ok(env.settle(&a.pubkey(), 1, 2_000, 0, 0, 0));
    assert_eq!(env.tokens(&new_ata), 50);
    assert_eq!(env.tokens(&old_ata), 0);
}

#[test]
fn settle_uses_the_fee_fixed_at_join() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300));
    let a = env.token_player("a", 1_000);
    let b = env.token_player("b", 1_000);
    let c = env.token_player("c", 2_000);
    assert_ok(env.join(&a, 1));
    assert_ok(env.join(&b, 1));
    assert_eq!(env.session(1, &a.pubkey()).unwrap().fee_bps, FEE_BPS);

    // The admin raises the fee while the sessions are open.
    assert_ok(env.update_config(UpdateConfigArgs {
        fee_bps: Some(MAX_FEE_BPS),
        ..Default::default()
    }));
    assert_ok(env.join(&c, 1));
    assert_eq!(env.session(1, &c.pubkey()).unwrap().fee_bps, MAX_FEE_BPS);

    // A profit of 1000 pays 5 % (50): the rate fixed at join.
    assert_ok(env.settle(&a.pubkey(), 1, 2_000, 0, 0, 0));
    assert_eq!(env.tokens(&env.player_ata(&a.pubkey())), 1_950);
    assert_eq!(env.tokens(&env.fee_ata()), 50);
    assert_ok(env.settle(&b.pubkey(), 1, 1_000, 0, 0, 0));
    // C joined after the change: 10 % of a 1000 profit.
    assert_ok(env.settle(&c.pubkey(), 1, 0, 0, 0, 0));
    let d = env.token_player("d", 1_000);
    assert_ok(env.join(&c, 1));
    assert_ok(env.join(&d, 1));
    let before = env.tokens(&env.fee_ata());
    assert_ok(env.settle(&c.pubkey(), 1, 2_000, 0, 0, 0));
    assert_eq!(env.tokens(&env.fee_ata()), before + 100);
}

#[test]
fn join_refuses_a_fee_above_the_signed_bound() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300));
    let a = env.token_player("a", 1_000);
    // The player was shown 4 % but the config says 5 %: refused, nothing moves.
    assert_error(
        env.join_max(&a, 1, FEE_BPS - 100),
        SlanaError::FeeAboveLimit,
    );
    assert!(env.session(1, &a.pubkey()).is_none());
    assert_eq!(env.tokens(&env.player_ata(&a.pubkey())), 1_000);
    // Exactly the shown rate (or a looser bound) is accepted.
    assert_ok(env.join_max(&a, 1, FEE_BPS));
    assert_eq!(env.session(1, &a.pubkey()).unwrap().fee_bps, FEE_BPS);
}

#[test]
fn settle_works_while_paused_and_requires_the_server() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, ENTRY_FEE, 300));
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
        env.settle_as(&mallory, &a.pubkey(), 1, args.clone()),
        SlanaError::Unauthorized,
    );
    // The player cannot settle their own session either.
    assert_error(
        env.settle_as(&a, &a.pubkey(), 1, args),
        SlanaError::Unauthorized,
    );
    assert_ok(env.settle(&a.pubkey(), 1, ENTRY_FEE, 1, 0, 0));
    // No profit, no fee.
    assert_eq!(env.tokens(&env.player_ata(&a.pubkey())), ENTRY_FEE);
    assert_eq!(env.tokens(&env.fee_ata()), 0);
}

#[test]
fn settle_rejects_overdraw() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, ENTRY_FEE, 300));
    let a = env.token_player("a", ENTRY_FEE);
    assert_ok(env.join(&a, 1));

    assert_error(
        env.settle(&a.pubkey(), 1, ENTRY_FEE + 1, 0, 0, 0),
        SlanaError::InsufficientPot,
    );
    // Tokens sitting elsewhere do not count: only the arena vault pays.
    let fee_ata = env.fee_ata();
    env.mint_to(&fee_ata, 10 * ENTRY_FEE);
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
    assert_ok(env.create_arena(1, ENTRY_FEE, 300));
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
        env.settle_as(&server, &a.pubkey(), 1, stale),
        SlanaError::SessionMismatch,
    );
    assert!(env.session(1, &a.pubkey()).is_some());
    assert_ok(env.settle(&a.pubkey(), 1, ENTRY_FEE, 0, 0, 0));
}

#[test]
fn refund_after_timeout_returns_tokens_and_deposit() {
    for kind in [MintKind::Spl, MintKind::Token2022] {
        let mut env = TestEnv::initialized_with(kind);
        assert_ok(env.create_arena(1, ENTRY_FEE, 300));
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
    assert_ok(env.create_arena(1, 1_000, 300));
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
fn sweep_moves_the_vault_to_the_fee_wallet() {
    for kind in [MintKind::Spl, MintKind::Token2022] {
        let mut env = TestEnv::initialized_with(kind);
        assert_ok(env.create_arena(1, 1_000, 300));
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
        assert_ok(env.update_arena(1, Some(false), None, None));
        // Open sessions block the sweep.
        assert_error(env.sweep(1), SlanaError::ArenaHasOpenSessions);
        assert_ok(env.settle(&b.pubkey(), 1, 700, 0, 0, 0));

        let vault = vault_pda(&arena_pda(1));
        let fee_ata = env.fee_ata();
        let supply = env.mint_supply();
        assert_eq!(env.tokens(&vault), 1_300);
        let meta = assert_ok(env.sweep(1));
        assert_event(
            &meta,
            &ArenaSwept {
                arena_id: 1,
                amount: 1_300,
            },
        );
        assert_eq!(env.tokens(&vault), 0);
        assert_eq!(env.tokens(&fee_ata), 1_300);
        assert_eq!(env.mint_supply(), supply);

        // An empty vault sweeps nothing.
        assert_ok(env.sweep(1));
        assert_eq!(env.tokens(&fee_ata), 1_300);
    }
}

#[test]
fn sweep_arena_rejects_a_wrong_fee_account() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300));
    assert_ok(env.update_arena(1, Some(false), None, None));
    let vault = vault_pda(&arena_pda(1));
    env.mint_to(&vault, 500);
    let admin = env.admin.insecure_clone();
    let (mint, program) = (env.mint, env.token_program);

    let admins = env.create_ata(&admin.pubkey());
    let other_mint = env.create_mint(MintKind::Spl, None);
    let fee_wallet = env.fee_wallet.pubkey();
    let wrong_mint = env.create_ata_of(&fee_wallet, &other_mint, &program);
    for (to, err) in [
        (admins, AnchorErrorCode::ConstraintTokenOwner),
        (wrong_mint, AnchorErrorCode::ConstraintTokenMint),
        (vault, AnchorErrorCode::ConstraintDuplicateMutableAccount),
    ] {
        let ix = ix::sweep_arena(&admin.pubkey(), 1, &to, &mint, &program);
        assert_anchor_error(env.send(&[ix], &[&admin]), err);
    }
    assert_eq!(env.tokens(&vault), 500);
    assert_ok(env.sweep(1));
    assert_eq!(env.tokens(&env.fee_ata()), 500);
}

#[test]
fn sweep_arena_is_not_open_to_the_server() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300));
    assert_ok(env.update_arena(1, Some(false), None, None));
    env.mint_to(&vault_pda(&arena_pda(1)), 500);

    // The server signs `sweep_loot`, never the admin-only `sweep_arena`.
    let server = env.server.insecure_clone();
    assert_error(env.sweep_as(&server, 1), SlanaError::Unauthorized);
    assert_eq!(env.tokens(&vault_pda(&arena_pda(1))), 500);
    assert_ok(env.sweep(1));
    assert_eq!(env.tokens(&env.fee_ata()), 500);
}

#[test]
fn sweep_loot_burns_part_of_a_live_vault() {
    for kind in [MintKind::Spl, MintKind::Token2022] {
        let mut env = TestEnv::initialized_with(kind);
        assert_ok(env.create_arena(1, 1_000, 300));
        let a = env.token_player("a", 1_000);
        let b = env.token_player("b", 1_000);
        assert_ok(env.join(&a, 1));
        assert_ok(env.join(&b, 1));
        let vault = vault_pda(&arena_pda(1));
        assert_eq!(env.tokens(&vault), 2_000);
        let supply = env.mint_supply();

        // The arena stays enabled with open sessions: the server burns part of the vault.
        let meta = assert_ok(env.sweep_loot(1, 600));
        assert_event(
            &meta,
            &LootBurned {
                arena_id: 1,
                amount: 600,
            },
        );
        assert_eq!(env.tokens(&vault), 1_400);
        assert_eq!(env.mint_supply(), supply - 600);
        assert_eq!(env.tokens(&env.fee_ata()), 0);
        let arena = env.arena(1);
        assert!(arena.enabled);
        assert_eq!(arena.open_sessions, 2);

        // The rest of the vault, exactly.
        assert_ok(env.sweep_loot(1, 1_400));
        assert_eq!(env.tokens(&vault), 0);
        assert_eq!(env.mint_supply(), supply - 2_000);
    }
}

#[test]
fn sweep_loot_requires_the_server() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300));
    let a = env.token_player("a", 1_000);
    assert_ok(env.join(&a, 1));
    let supply = env.mint_supply();

    let mallory = env.funded_keypair(SOL);
    assert_error(
        env.sweep_loot_as(&mallory, 1, 100),
        SlanaError::Unauthorized,
    );
    // Not the admin either.
    let admin = env.admin.insecure_clone();
    assert_error(env.sweep_loot_as(&admin, 1, 100), SlanaError::Unauthorized);
    assert_eq!(env.tokens(&vault_pda(&arena_pda(1))), 1_000);
    assert_eq!(env.mint_supply(), supply);
}

#[test]
fn sweep_loot_is_capped_by_the_vault() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300));
    let a = env.token_player("a", 1_000);
    assert_ok(env.join(&a, 1));
    let supply = env.mint_supply();

    assert_error(env.sweep_loot(1, 1_001), SlanaError::InsufficientPot);
    assert_error(env.sweep_loot(1, u64::MAX), SlanaError::InsufficientPot);
    // Tokens sitting elsewhere do not count: only the arena vault burns.
    let fee_ata = env.fee_ata();
    env.mint_to(&fee_ata, 10_000);
    assert_error(env.sweep_loot(1, 1_001), SlanaError::InsufficientPot);
    assert_eq!(env.tokens(&vault_pda(&arena_pda(1))), 1_000);
    assert_eq!(env.mint_supply(), supply + 10_000);
}

#[test]
fn sweep_loot_of_zero_does_nothing() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300));
    let vault = vault_pda(&arena_pda(1));

    // An empty vault: zero is the only amount it allows.
    assert_error(env.sweep_loot(1, 1), SlanaError::InsufficientPot);
    let meta = assert_ok(env.sweep_loot(1, 0));
    let a = env.token_player("a", 1_000);
    assert_ok(env.join(&a, 1));
    let supply = env.mint_supply();
    let meta2 = assert_ok(env.sweep_loot(1, 0));
    for meta in [meta, meta2] {
        // No burn (no token program CPI) and no event.
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
    assert_eq!(env.mint_supply(), supply);
}

#[test]
fn sweep_loot_needs_a_writable_config_mint() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300));
    env.mint_to(&vault_pda(&arena_pda(1)), 100);
    let server = env.server.insecure_clone();
    let (mint, program) = (env.mint, env.token_program);

    // Another mint: ConstraintAddress.
    let other = env.create_mint(MintKind::Spl, None);
    let ix = ix::sweep_loot(&server.pubkey(), 1, 10, &other, &program);
    assert_anchor_error(
        env.send(&[ix], &[&server]),
        AnchorErrorCode::ConstraintAddress,
    );
    // The mint read-only: ConstraintMut.
    let mut ix = ix::sweep_loot(&server.pubkey(), 1, 10, &mint, &program);
    ix.accounts[4].is_writable = false;
    assert_anchor_error(env.send(&[ix], &[&server]), AnchorErrorCode::ConstraintMut);
    assert_eq!(env.tokens(&vault_pda(&arena_pda(1))), 100);
}
