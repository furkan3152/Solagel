//! Compute units of every instruction on its success path, for the program under test
//! (`SLANA_IMPL=lean|ref`). Prints one `CU <instruction> <units>` line per instruction; CI
//! runs it against both builds and prints them side by side (`--nocapture`).

// `TxResult` is LiteSVM's own result type; its error variant is large by design.
#![allow(clippy::result_large_err)]

mod common;

use {
    common::*,
    slana::{constants::*, UpdateConfigArgs},
    solana_signer::Signer,
};

fn cu(name: &str, res: TxResult) {
    let meta = assert_ok(res);
    println!("CU {name} {}", meta.compute_units_consumed);
}

#[test]
fn compute_units_per_instruction() {
    let mut env = TestEnv::deployed();
    let admin = env.admin.insecure_clone();
    let args = env.default_init_args();
    cu("initialize", env.initialize_as(&admin, args));
    let mint = env.create_mint(MintKind::Spl, None);
    let program = MintKind::Spl.program();
    cu(
        "set_token_mint",
        env.set_token_mint_as(&admin, &mint, &program),
    );
    env.mint = mint;
    env.token_program = program;
    let fee_wallet = env.fee_wallet.pubkey();
    env.create_ata(&fee_wallet);
    cu(
        "update_config",
        env.update_config(UpdateConfigArgs {
            fee_bps: Some(FEE_BPS),
            ..Default::default()
        }),
    );
    cu("create_arena", env.create_arena(1, ENTRY_FEE, 300));
    cu("update_arena", env.update_arena(1, None, Some(301), None));

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

    assert_ok(env.join(&a, 1));
    env.warp(SESSION_REFUND_TIMEOUT_SECS + 1);
    cu("refund_session (timeout)", env.refund(&a, 1));

    assert_ok(env.refund(&c, 1));
    env.mint_to(&vault_pda(&arena_pda(1)), 100);
    cu("sweep_loot", env.sweep_loot(1, 23));
    assert_ok(env.update_arena(1, Some(false), None, None));
    cu("sweep_arena", env.sweep(1));
}
