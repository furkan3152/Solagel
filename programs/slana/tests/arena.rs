//! Arenas: `create_arena` (token vault) and `update_arena`.
//!
//! The token-based `join_arena` / `settle_session` / `refund_session` / `sweep_arena` flows are
//! covered by the Task 4 tests.

mod common;

use {
    anchor_lang::error::ErrorCode as AnchorErrorCode,
    common::*,
    slana::{constants::*, error::SlanaError, state::Arena},
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
