//! Two-phase settlement (R24): `settle_session` without a player token account
//! finalizes the session with `owed`; `refund_session` then collects exactly `owed` at once.
//! A losing player can no longer block settlement and self-refund the entry fee. Also the
//! join limits (M3) and the update_config authority guard (M4).

mod common;

use {
    anchor_lang::{error::ErrorCode as AnchorErrorCode, prelude::Pubkey},
    anchor_spl::token_2022::spl_token_2022::{
        self, extension::memo_transfer, extension::ExtensionType,
    },
    common::*,
    slana::{constants::*, error::SlanaError, JoinLimits, SettleArgs, UpdateConfigArgs},
    solana_signer::Signer,
};

/// Closes the player's (empty) ATA, as a loser trying to make settlement fail would.
fn close_ata(env: &mut TestEnv, player: &solana_keypair::Keypair) {
    let account = env.player_ata(&player.pubkey());
    let ix = spl_token_2022::instruction::close_account(
        &env.token_program,
        &account,
        &player.pubkey(),
        &player.pubkey(),
        &[],
    )
    .expect("close_account ix");
    assert_ok(env.send(&[ix], &[player]));
    assert_eq!(env.balance(&account), 0);
}

#[test]
fn loser_closing_their_token_account_cannot_get_the_entry_fee_back() {
    for kind in [MintKind::Spl, MintKind::Token2022] {
        let mut env = TestEnv::initialized_with(kind);
        assert_ok(env.create_arena(1, 1_000, 300, false));
        let a = env.token_player("a", 1_000);
        let b = env.token_player("b", 1_000);
        assert_ok(env.join(&a, 1));
        assert_ok(env.join(&b, 1));
        // B lost and closes the (now empty) token account before the server settles.
        close_ata(&mut env, &b);
        let vault = vault_pda(&arena_pda(1));

        // A won B's stake: paid now.
        assert_ok(env.settle(&a.pubkey(), 1, 2_000, 10, 1, 1));
        assert_eq!(env.tokens(&env.player_ata(&a.pubkey())), 1_950);

        // Paying B with a token account fails (it no longer exists) ...
        assert_anchor_error(
            env.settle(&b.pubkey(), 1, 0, 0, 0, 0),
            AnchorErrorCode::AccountNotInitialized,
        );
        // ... so the server settles without it. Nothing is owed: the session closes at once.
        let server_before = env.balance(&env.server.pubkey());
        assert_ok(env.settle_finalize(&b.pubkey(), 1, 0));
        assert!(env.session(1, &b.pubkey()).is_none());
        assert_eq!(
            env.balance(&env.server.pubkey()),
            server_before + SETTLE_FEE_LAMPORTS
        );
        assert_eq!(env.arena(1).open_sessions, 0);
        assert_eq!(env.profile(&b.pubkey()).games_played, 1);

        // Even after 24 h there is nothing left to refund.
        env.warp(SESSION_REFUND_TIMEOUT_SECS + 1);
        env.create_ata(&b.pubkey());
        assert_anchor_error(env.refund(&b, 1), AnchorErrorCode::AccountNotInitialized);
        assert_eq!(env.tokens(&env.player_ata(&b.pubkey())), 0);
        assert_eq!(env.tokens(&vault), 0);
    }
}

#[test]
fn partial_payout_without_token_account_is_owed_and_collected_at_once() {
    for kind in [MintKind::Spl, MintKind::Token2022] {
        let mut env = TestEnv::initialized_with(kind);
        assert_ok(env.create_arena(1, 1_000, 300, false));
        let a = env.token_player("a", 1_000);
        let b = env.token_player("b", 1_000);
        assert_ok(env.join(&a, 1));
        assert_ok(env.join(&b, 1));
        close_ata(&mut env, &b);
        let vault = vault_pda(&arena_pda(1));
        let session_key = session_pda(&arena_pda(1), &b.pubkey());
        let supply = env.mint_supply();
        let server_before = env.balance(&env.server.pubkey());

        // B cashes out 1500 (profit 500, fee 5 % = 25: treasury 12, season 8, burn 5;
        // B is owed 1475).
        assert_ok(env.settle_to(&b.pubkey(), 1, 1_500, 99, 2, 7, None));
        let session = env
            .session(1, &b.pubkey())
            .expect("finalized session stays open");
        assert!(session.finalized);
        assert_eq!(session.owed, 1_475);
        // The fee split happened; the owed share stays in the vault.
        assert_eq!(env.tokens(&vault), 2_000 - 1_500 + 1_475);
        assert_eq!(env.mint_supply(), supply - 5);
        assert_eq!(env.tokens(&treasury_vault_pda()), 12);
        assert_eq!(env.season(FIRST_SEASON).pool, 8);
        // The server got its deposit; the session keeps only its rent.
        assert_eq!(
            env.balance(&env.server.pubkey()),
            server_before + SETTLE_FEE_LAMPORTS
        );
        assert_eq!(env.balance(&session_key), env.session_rent());
        // The session still counts as open: its owed tokens cannot be swept.
        assert_eq!(env.arena(1).open_sessions, 2);
        assert_eq!(env.arena(1).total_paid_out, 25);
        let profile = env.profile(&b.pubkey());
        assert_eq!(profile.total_won, 1_475);
        assert_eq!(profile.games_played, 1);
        assert_eq!(profile.best_score, 99);

        // A second settlement of the same session is refused (with or without an account).
        env.create_ata(&b.pubkey());
        assert_error(
            env.settle_finalize(&b.pubkey(), 1, 1_000),
            SlanaError::SessionFinalized,
        );
        assert_error(
            env.settle(&b.pubkey(), 1, 1_000, 0, 0, 0),
            SlanaError::SessionFinalized,
        );
        // A new join on the same arena is refused while the payout waits (PDA in use).
        env.mint_to(&env.player_ata(&b.pubkey()), 1_000);
        assert_already_in_use(env.join(&b, 1));

        // Collect before 24 h: exactly the owed amount, not the entry fee.
        let b_lamports = env.balance(&b.pubkey());
        assert_ok(env.refund(&b, 1));
        assert_eq!(env.tokens(&env.player_ata(&b.pubkey())), 1_000 + 1_475);
        assert_eq!(env.tokens(&vault), 500);
        assert!(env.session(1, &b.pubkey()).is_none());
        assert_eq!(env.balance(&b.pubkey()), b_lamports + env.session_rent());
        assert_eq!(env.arena(1).open_sessions, 1);
        assert_eq!(env.arena(1).total_paid_out, 1_500);
        assert_eq!(env.config().total_paid_out, 1_500);
        // Collected once only.
        assert_anchor_error(env.refund(&b, 1), AnchorErrorCode::AccountNotInitialized);
        // Now B can join again.
        assert_ok(env.join(&b, 1));
    }
}

#[test]
fn collect_pays_at_most_the_vault() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300, false));
    let a = env.token_player("a", 1_000);
    assert_ok(env.join(&a, 1));
    close_ata(&mut env, &a);
    assert_ok(env.settle_finalize(&a.pubkey(), 1, 1_000));
    assert_eq!(env.session(1, &a.pubkey()).unwrap().owed, 1_000);
    env.create_ata(&a.pubkey());
    assert_ok(env.refund(&a, 1));
    assert_eq!(env.tokens(&env.player_ata(&a.pubkey())), 1_000);
    assert_eq!(env.tokens(&vault_pda(&arena_pda(1))), 0);
}

#[test]
fn unsettled_refund_still_waits_24h_and_returns_the_entry_fee() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300, false));
    let a = env.token_player("a", 1_000);
    assert_ok(env.join(&a, 1));
    assert!(!env.session(1, &a.pubkey()).unwrap().finalized);
    assert_error(env.refund(&a, 1), SlanaError::RefundTooEarly);
    env.warp(SESSION_REFUND_TIMEOUT_SECS);
    assert_ok(env.refund(&a, 1));
    assert_eq!(env.tokens(&env.player_ata(&a.pubkey())), 1_000);
}

#[test]
fn sweep_waits_for_a_finalized_session_to_be_collected() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300, false));
    let a = env.token_player("a", 1_000);
    let b = env.token_player("b", 1_000);
    assert_ok(env.join(&a, 1));
    assert_ok(env.join(&b, 1));
    assert_ok(env.settle(&a.pubkey(), 1, 0, 0, 0, 0));
    close_ata(&mut env, &b);
    assert_ok(env.settle_finalize(&b.pubkey(), 1, 2_000));
    assert_ok(env.update_arena(1, Some(false), None, None, None));

    assert_error(env.sweep(1), SlanaError::ArenaHasOpenSessions);
    env.create_ata(&b.pubkey());
    assert_ok(env.refund(&b, 1));
    assert_eq!(env.tokens(&env.player_ata(&b.pubkey())), 1_950);
    assert_eq!(env.arena(1).open_sessions, 0);
    assert_ok(env.sweep(1));
}

#[test]
fn finalize_frees_the_pass_and_collect_takes_no_lock() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300, false));
    assert_ok(env.create_arena(2, 1_000, 300, false));
    let a = env.token_player("a", 2_000);
    let b = env.token_player("b", 1_000);
    let (_, asset) = env.give_pass(&a.pubkey());
    assert_ok(env.join_with_pass(&a, 1, &asset));
    assert_ok(env.join(&b, 1));
    let lock_rent = env.pass_lock_rent();
    let a_lamports = env.balance(&a.pubkey());

    // A wins B's stake but has no usable token account at settlement time.
    assert_ok(env.settle_to(&a.pubkey(), 1, 2_000, 500, 1, 1, None));
    // The lock is closed back to A: the Pass can back a new session right away.
    assert!(env.pass_lock(&asset).is_none());
    assert_eq!(env.balance(&a.pubkey()), a_lamports + lock_rent);
    // Pass fee 2 % on 1000 profit = 20: A is owed 1980; season points were recorded.
    let session = env.session(1, &a.pubkey()).unwrap();
    assert_eq!(session.owed, 1_980);
    assert!(env.profile(&a.pubkey()).season_points > 0);
    assert_ok(env.join_with_pass(&a, 2, &asset));

    // Collecting with any Pass lock is refused (it would close someone's live lock).
    assert_error(
        env.refund_with(&a, 1, Some(pass_lock_pda(&asset))),
        SlanaError::PassInUse,
    );
    assert!(env.pass_lock(&asset).is_some());
    let before = env.tokens(&env.player_ata(&a.pubkey()));
    assert_ok(env.refund_with(&a, 1, None));
    assert_eq!(env.tokens(&env.player_ata(&a.pubkey())), before + 1_980);
}

#[test]
fn memo_required_token_account_falls_back_to_finalize() {
    let mut env = TestEnv::initialized_with(MintKind::Token2022);
    assert_ok(env.create_arena(1, 1_000, 300, false));
    let a = env.token_player("a", 1_000);
    let b = env.token_player("b", 1_000);
    assert_ok(env.join(&a, 1));
    assert_ok(env.join(&b, 1));
    let b_ata = env.player_ata(&b.pubkey());
    let program = env.token_program;

    // B requires memos on incoming transfers: a plain transfer into it fails.
    let realloc = spl_token_2022::instruction::reallocate(
        &program,
        &b_ata,
        &b.pubkey(),
        &b.pubkey(),
        &[],
        &[ExtensionType::MemoTransfer],
    )
    .expect("reallocate ix");
    let enable = memo_transfer::instruction::enable_required_transfer_memos(
        &program,
        &b_ata,
        &b.pubkey(),
        &[],
    )
    .expect("enable memos ix");
    assert_ok(env.send(&[realloc, enable], &[&b]));

    let no_memo = spl_token_2022::error::TokenError::NoMemo as u32;
    assert_custom_error(env.settle(&b.pubkey(), 1, 1_500, 0, 0, 0), no_memo);
    assert_ok(env.settle_finalize(&b.pubkey(), 1, 1_500));
    assert_eq!(env.session(1, &b.pubkey()).unwrap().owed, 1_475);
    // The player's own account still refuses the payout until they lift the memo rule.
    assert_custom_error(env.refund(&b, 1), no_memo);
    let disable = memo_transfer::instruction::disable_required_transfer_memos(
        &program,
        &b_ata,
        &b.pubkey(),
        &[],
    )
    .expect("disable memos ix");
    assert_ok(env.send(&[disable], &[&b]));
    assert_ok(env.refund(&b, 1));
    assert_eq!(env.tokens(&b_ata), 1_475);
}

#[test]
fn join_refuses_entry_or_settle_fee_above_the_signed_bound() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300, false));
    let a = env.token_player("a", 1_000);
    let b = env.token_player("b", 1_000);
    let (_, asset) = env.give_pass(&b.pubkey());
    let exact = JoinLimits {
        max_fee_bps: FEE_BPS,
        max_entry_fee: 1_000,
        max_settle_fee: SETTLE_FEE_LAMPORTS,
    };
    assert_error(
        env.join_limits(
            &a,
            1,
            JoinLimits {
                max_entry_fee: 999,
                ..exact
            },
        ),
        SlanaError::EntryFeeAboveLimit,
    );
    assert_error(
        env.join_limits(
            &a,
            1,
            JoinLimits {
                max_settle_fee: SETTLE_FEE_LAMPORTS - 1,
                ..exact
            },
        ),
        SlanaError::SettleFeeAboveLimit,
    );
    let pass_exact = JoinLimits {
        max_fee_bps: PASS_FEE_BPS,
        ..exact
    };
    assert_error(
        env.join_with_pass_limits(
            &b,
            1,
            &asset,
            JoinLimits {
                max_entry_fee: 1,
                ..pass_exact
            },
        ),
        SlanaError::EntryFeeAboveLimit,
    );
    assert_error(
        env.join_with_pass_limits(
            &b,
            1,
            &asset,
            JoinLimits {
                max_settle_fee: 0,
                ..pass_exact
            },
        ),
        SlanaError::SettleFeeAboveLimit,
    );
    assert!(env.session(1, &a.pubkey()).is_none());
    assert_eq!(env.tokens(&env.player_ata(&a.pubkey())), 1_000);
    assert_ok(env.join_limits(&a, 1, exact));
    assert_ok(env.join_with_pass_limits(&b, 1, &asset, pass_exact));
}

#[test]
fn update_config_refuses_default_authorities() {
    let mut env = TestEnv::initialized();
    assert_error(
        env.update_config(UpdateConfigArgs {
            admin: Some(Pubkey::default()),
            ..Default::default()
        }),
        SlanaError::InvalidAuthority,
    );
    assert_error(
        env.update_config(UpdateConfigArgs {
            server_authority: Some(Pubkey::default()),
            ..Default::default()
        }),
        SlanaError::InvalidAuthority,
    );
    assert_eq!(env.config().admin, env.admin.pubkey());
}

#[test]
fn settle_args_session_id_still_guards_finalized_sessions() {
    // A stale settlement for an old id hits SessionMismatch before anything else.
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300, false));
    let a = env.token_player("a", 1_000);
    assert_ok(env.join(&a, 1));
    let id = env.session(1, &a.pubkey()).unwrap().id;
    let server = env.server.insecure_clone();
    assert_error(
        env.settle_as_with(
            &server,
            &a.pubkey(),
            1,
            SettleArgs {
                session_id: id + 1,
                payout: 0,
                score: 0,
                kills: 0,
                xp: 0,
            },
            None,
            None,
        ),
        SlanaError::SessionMismatch,
    );
}

// ----- attack scenarios (security review): exact errors under both implementations --

/// Arenas 1 and 2 with `a` joined to both; returns the env and `a`.
fn two_arena_env() -> (TestEnv, solana_keypair::Keypair) {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300, false));
    assert_ok(env.create_arena(2, 1_000, 300, false));
    let a = env.token_player("a", 2_000);
    assert_ok(env.join(&a, 1));
    assert_ok(env.join(&a, 2));
    (env, a)
}

/// `settle_session` of `player`'s session in `arena_id` paying into `player_token`.
fn settle_ix(
    env: &TestEnv,
    player: &Pubkey,
    arena_id: u16,
    payout: u64,
    player_token: Option<Pubkey>,
) -> anchor_lang::solana_program::instruction::Instruction {
    let session_id = env.session(arena_id, player).map_or(0, |s| s.id);
    ix::settle_session(
        &env.server.pubkey(),
        player,
        arena_id,
        env.config().current_season,
        SettleArgs {
            session_id,
            payout,
            score: 0,
            kills: 0,
            xp: 0,
        },
        None,
        player_token,
        &env.mint,
        &env.token_program,
    )
}

/// Settle/refund of arena 1's session with arena 2's vault, or of arena 2 with arena 1's
/// session: the vault / session seeds fail (2006).
#[test]
fn settle_and_refund_reject_another_arenas_vault_or_session() {
    let (mut env, a) = two_arena_env();
    let server = env.server.insecure_clone();
    let token = Some(env.player_ata(&a.pubkey()));
    let seeds = AnchorErrorCode::ConstraintSeeds;

    let mut settle = settle_ix(&env, &a.pubkey(), 1, 1_000, token);
    settle.accounts[3].pubkey = vault_pda(&arena_pda(2));
    assert_anchor_error(env.send(&[settle], &[&server]), seeds);
    let mut settle = settle_ix(&env, &a.pubkey(), 2, 1_000, token);
    settle.accounts[4].pubkey = session_pda(&arena_pda(1), &a.pubkey());
    assert_anchor_error(env.send(&[settle], &[&server]), seeds);

    env.warp(SESSION_REFUND_TIMEOUT_SECS + 1);
    let (mint, program) = (env.mint, env.token_program);
    let mut refund = ix::refund_session(&a.pubkey(), 1, None, &mint, &program);
    refund.accounts[3].pubkey = vault_pda(&arena_pda(2));
    assert_anchor_error(env.send(&[refund], &[&a]), seeds);
    let mut refund = ix::refund_session(&a.pubkey(), 2, None, &mint, &program);
    refund.accounts[4].pubkey = session_pda(&arena_pda(1), &a.pubkey());
    assert_anchor_error(env.send(&[refund], &[&a]), seeds);

    // Nothing moved: both sessions are still open and settle normally.
    assert_eq!(env.arena(1).open_sessions, 1);
    assert_eq!(env.arena(2).open_sessions, 1);
    assert_ok(env.settle(&a.pubkey(), 1, 1_000, 0, 0, 0));
    assert_ok(env.settle(&a.pubkey(), 2, 1_000, 0, 0, 0));
}

/// A session refunded before settlement is closed: the late settlement finds no account
/// (3012) and pays nothing.
#[test]
fn settle_after_an_unsettled_refund_fails() {
    let (mut env, a) = two_arena_env();
    let server = env.server.insecure_clone();
    let token = Some(env.player_ata(&a.pubkey()));
    let settle = settle_ix(&env, &a.pubkey(), 1, 1_000, token);
    env.warp(SESSION_REFUND_TIMEOUT_SECS + 1);
    assert_ok(env.refund(&a, 1));
    let before = env.tokens(&env.player_ata(&a.pubkey()));
    assert_anchor_error(
        env.send(&[settle], &[&server]),
        AnchorErrorCode::AccountNotInitialized,
    );
    assert_eq!(env.tokens(&env.player_ata(&a.pubkey())), before);
    assert_eq!(env.tokens(&vault_pda(&arena_pda(1))), 0);
}

/// The same instruction twice in one transaction: the first closes the session, the second
/// finds no account (3012), and the transaction reverts as a whole.
#[test]
fn settle_and_refund_cannot_run_twice_in_one_transaction() {
    let (mut env, a) = two_arena_env();
    let server = env.server.insecure_clone();
    let token = Some(env.player_ata(&a.pubkey()));
    let (mint, program) = (env.mint, env.token_program);
    let not_init = AnchorErrorCode::AccountNotInitialized;

    let settle = settle_ix(&env, &a.pubkey(), 1, 1_000, token);
    assert_anchor_error(
        env.send(&[settle.clone(), settle.clone()], &[&server]),
        not_init,
    );
    // settle (pay) then refund: the refund needs the player's signature too.
    let refund = ix::refund_session(&a.pubkey(), 1, None, &mint, &program);
    env.warp(SESSION_REFUND_TIMEOUT_SECS + 1);
    assert_anchor_error(
        env.send(&[settle, refund.clone()], &[&server, &a]),
        not_init,
    );
    assert_anchor_error(env.send(&[refund.clone(), refund], &[&a]), not_init);

    // All three reverted: the session is still open with its stake.
    assert!(env.session(1, &a.pubkey()).is_some());
    assert_eq!(env.tokens(&vault_pda(&arena_pda(1))), 1_000);
    assert_ok(env.refund(&a, 1));
}

/// The arena vault as the refund's `player_token` → 2040.
#[test]
fn refund_rejects_the_vault_as_player_token() {
    let (mut env, a) = two_arena_env();
    env.warp(SESSION_REFUND_TIMEOUT_SECS + 1);
    let (mint, program) = (env.mint, env.token_program);
    let mut refund = ix::refund_session(&a.pubkey(), 1, None, &mint, &program);
    refund.accounts[5].pubkey = vault_pda(&arena_pda(1));
    assert_anchor_error(
        env.send(&[refund], &[&a]),
        AnchorErrorCode::ConstraintDuplicateMutableAccount,
    );
}

/// A `player_token` of somebody else (2015) or of another mint (2014), for settle and refund.
#[test]
fn settle_and_refund_reject_a_foreign_player_token() {
    let (mut env, a) = two_arena_env();
    let server = env.server.insecure_clone();
    let b = env.token_player("b", 0);
    let others = env.player_ata(&b.pubkey());
    let other_mint = env.create_mint(MintKind::Spl, None);
    let saved = env.mint;
    env.mint = other_mint;
    let wrong_mint = env.create_ata(&a.pubkey());
    env.mint = saved;
    let (mint, program) = (env.mint, env.token_program);

    for (token, err) in [
        (others, AnchorErrorCode::ConstraintTokenOwner),
        (wrong_mint, AnchorErrorCode::ConstraintTokenMint),
    ] {
        let settle = settle_ix(&env, &a.pubkey(), 1, 1_000, Some(token));
        assert_anchor_error(env.send(&[settle], &[&server]), err);
    }
    env.warp(SESSION_REFUND_TIMEOUT_SECS + 1);
    for (token, err) in [
        (others, AnchorErrorCode::ConstraintTokenOwner),
        (wrong_mint, AnchorErrorCode::ConstraintTokenMint),
    ] {
        let mut refund = ix::refund_session(&a.pubkey(), 1, None, &mint, &program);
        refund.accounts[5].pubkey = token;
        assert_anchor_error(env.send(&[refund], &[&a]), err);
    }
    assert_eq!(env.tokens(&others), 0);
    assert_eq!(env.tokens(&wrong_mint), 0);
}
