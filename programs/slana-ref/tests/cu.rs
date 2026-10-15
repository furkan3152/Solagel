//! Compute units of every instruction on its success path, for the program under test
//! (`SLANA_IMPL=lean|ref`). Prints one `CU <instruction> <units>` line per instruction; CI
//! runs it against both builds and prints them side by side (`--nocapture`).
//!
//! Needs the Core program binary for the Pass instructions: run `scripts/fetch-programs.sh`.

// `TxResult` is LiteSVM's own result type; its error variant is large by design.
#![allow(clippy::result_large_err)]

mod common;

use {
    common::*,
    slana::{constants::*, UpdateConfigArgs},
    solana_sha256_hasher::hash,
    solana_signer::Signer,
};

const SEED: [u8; 32] = [7; 32];

fn cu(name: &str, res: TxResult) {
    let meta = assert_ok(res);
    println!("CU {name} {}", meta.compute_units_consumed);
}

#[test]
fn compute_units_per_instruction() {
    // ----- config, arenas, profiles, stakes ----------------------------------------------
    let mut env = TestEnv::deployed();
    let admin = env.admin.insecure_clone();
    env.mint = env.create_mint(MintKind::Spl, None);
    let (mint, program) = (env.mint, env.token_program);
    let args = env.default_init_args();
    cu(
        "initialize",
        env.initialize_as(&admin, &mint, &program, args),
    );
    cu(
        "update_config",
        env.update_config(UpdateConfigArgs {
            fee_bps: Some(FEE_BPS),
            ..Default::default()
        }),
    );
    cu("create_arena", env.create_arena(1, ENTRY_FEE, 300, false));
    cu(
        "update_arena",
        env.update_arena(1, None, Some(301), None, None),
    );

    let a = env.token_player("a", 3 * ENTRY_FEE);
    let b = env.funded_keypair(10 * SOL);
    cu("register_player", env.register(&b, "bob", 1));
    cu(
        "update_profile",
        env.update_profile(&a, Some("al"), Some(3)),
    );

    let c = env.token_player("c", ENTRY_FEE);
    assert_ok(env.join(&c, 1));
    cu("join_arena", env.join(&a, 1));
    cu(
        "settle_session (paid)",
        env.settle(&a.pubkey(), 1, 2 * ENTRY_FEE, 300, 2, 10),
    );
    assert_ok(env.join(&a, 1));
    cu(
        "settle_session (finalize, R24)",
        env.settle_to(&a.pubkey(), 1, ENTRY_FEE, 100, 0, 5, None),
    );
    cu("refund_session (finalized)", env.refund(&a, 1));

    let (_, asset) = env.give_pass(&a.pubkey());
    cu("join_arena_with_pass", env.join_with_pass(&a, 1, &asset));
    env.warp(SESSION_REFUND_TIMEOUT_SECS + 1);
    cu("refund_session (timeout, Pass)", env.refund(&a, 1));

    let destination = env.player_ata(&a.pubkey());
    let treasury = env.tokens(&treasury_vault_pda());
    assert!(treasury > 0);
    cu(
        "withdraw_treasury",
        env.withdraw_treasury_as(&admin, &destination, treasury),
    );
    assert_ok(env.refund(&c, 1));
    assert_ok(env.update_arena(1, Some(false), None, None, None));
    env.mint_to(&vault_pda(&arena_pda(1)), 77);
    cu("sweep_arena", env.sweep(1));

    // ----- seasons ------------------------------------------------------------------------
    cu("end_season", env.end_season());
    let mut season = env.season(1);
    assert!(season.prize_pool > 0);
    season.entries[0].player = a.pubkey();
    season.count = season.count.max(1);
    env.write_account(&season_pda(1), &season);
    cu("claim_season_reward", env.claim(&a, 1));
    env.warp(CLAIM_WINDOW_SECS + 1);
    cu("rollover_season", env.rollover(1));

    // ----- Pass ---------------------------------------------------------------------------
    let mut env = TestEnv::initialized();
    load_mpl_core(&mut env.svm);
    let admin = env.admin.insecure_clone();
    let collection = env.create_core_collection(&pass_authority_pda());
    cu(
        "set_pass_collection",
        env.set_collection_as(&admin, &collection),
    );
    cu(
        "set_pass_seed_hash",
        env.set_seed_hash_as(&admin, hash(&SEED).to_bytes()),
    );
    assert_ok(env.update_config(UpdateConfigArgs {
        pass_base_uri: Some("https://slana.example/pass/".to_string()),
        pass_mint_open: Some(true),
        ..Default::default()
    }));
    let minter = env.funded_keypair(10 * SOL);
    cu("mint_pass (counter created)", env.mint_pass(&minter).0);
    assert_ok(env.update_config(UpdateConfigArgs {
        pass_per_wallet: Some(2),
        ..Default::default()
    }));
    cu("mint_pass (counter loaded)", env.mint_pass(&minter).0);
    cu("close_pass_mint", env.close_mint());
    env.warp_to_slot(3_000);
    cu("reveal_pass", env.reveal_as(&admin, SEED));
    let target = env.config().pass_entropy_target_slot;
    env.warp_to_slot(target + 20);
    env.slot_hashes_range(target - 30, target + 19);
    let anyone = env.funded_keypair(SOL);
    cu("capture_pass_entropy", env.capture_entropy_as(&anyone));
}
