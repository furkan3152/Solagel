//! Wire compatibility of the account layouts and of the account checks, through the real
//! program (`SLANA_IMPL=lean|ref`):
//! * accounts created by the program decode with the reference `AccountDeserialize` and
//!   re-serialize to exactly the stored bytes (program → reference);
//! * accounts written with the reference `AccountSerialize`, every field distinct, are read by
//!   the program at the reference offsets and partial updates leave every other byte alone
//!   (reference → program);
//! * Anchor's account-type and constraint errors (wrong owner, discriminator, length, PDA,
//!   missing accounts, bad arguments, duplicate mutable accounts, pre-funded PDAs).
//!
//! `PlayerProfile` and `Session` (118 bytes) written by the player and arena instructions are
//! checked in `stake_flow_writes_reference_layouts_and_events`.

// `TxResult` is LiteSVM's own result type; its error variant is large by design.
#![allow(clippy::result_large_err)]

mod common;

use {
    anchor_lang::{
        error::ErrorCode as AnchorErrorCode,
        prelude::Pubkey,
        solana_program::instruction::{error::InstructionError, AccountMeta, Instruction},
        AccountSerialize, Space,
    },
    common::*,
    slana::{
        constants::*,
        error::SlanaError,
        events::{ArenaCreated, TokenMintSet},
        state::{Arena, Config},
        UpdateConfigArgs,
    },
    solana_signer::Signer,
    solana_transaction_error::TransactionError,
};

fn serialize<T: AccountSerialize>(value: &T) -> Vec<u8> {
    let mut out = Vec::new();
    value.try_serialize(&mut out).unwrap();
    out
}

fn raw(env: &TestEnv, address: &Pubkey) -> Vec<u8> {
    env.svm.get_account(address).expect("account").data
}

/// Asserts a failure with a plain `ProgramError` (not a custom code).
#[track_caller]
fn assert_instruction_error(res: TxResult, expected: InstructionError) {
    match res {
        Ok(meta) => panic!("expected {expected:?}, succeeded\n{}", meta.pretty_logs()),
        Err(e) => match &e.err {
            TransactionError::InstructionError(_, err) if *err == expected => {}
            other => panic!(
                "expected {expected:?}, got {other:?}\n{}",
                e.meta.pretty_logs()
            ),
        },
    }
}

/// A `Config` with every field distinct from its neighbours, keeping the env's admin, mint,
/// token program and bump so that admin instructions still pass their checks.
fn distinctive_config(env: &TestEnv) -> Config {
    let mut c = env.config();
    c.server_authority = Pubkey::new_from_array([0x22; 32]);
    c.fee_wallet = Pubkey::new_from_array([0x33; 32]);
    c.token_decimals = DECIMALS;
    c.fee_bps = 900;
    c.settle_fee_lamports = 123_456;
    c.paused = true;
    c.total_players = 0x6162_6364_6566_6768;
    c.total_games = 0x7172_7374_7576_7778;
    c.total_sessions = 0x0811_2233_4455_6677;
    c.total_staked = 0x0899_aabb_ccdd_eeff;
    c.total_paid_out = 0x0f0e_0d0c_0b0a_0908;
    c
}

// ---------------------------------------------------------------------------------------
// program → reference
// ---------------------------------------------------------------------------------------

#[test]
fn initialize_and_set_token_mint_write_reference_layouts() {
    for kind in [MintKind::Spl, MintKind::Token2022] {
        let mut env = TestEnv::initialized_without_token();
        let data = raw(&env, &config_pda());
        assert_eq!(data.len(), 8 + Config::INIT_SPACE);
        let config = env.config();
        assert_eq!(serialize(&config), data);
        let (_, config_bump) = Pubkey::find_program_address(&[CONFIG_SEED], &slana::ID);
        assert_eq!(config.bump, config_bump);
        assert_eq!(
            (
                config.token_mint,
                config.token_program,
                config.token_decimals
            ),
            (Pubkey::default(), Pubkey::default(), 0)
        );
        // Rent-exempt at exactly the reference size.
        assert_eq!(env.balance(&config_pda()), env.rent(8 + Config::INIT_SPACE));
        assert_eq!(env.svm.get_account(&config_pda()).unwrap().owner, slana::ID);

        // set_token_mint writes exactly mint, token program and decimals.
        let mint = env.create_mint(kind, None);
        let admin = env.admin.insecure_clone();
        let mut expected = config;
        let meta = assert_ok(env.set_token_mint_as(&admin, &mint, &kind.program()));
        assert_event(
            &meta,
            &TokenMintSet {
                mint,
                token_program: kind.program(),
                decimals: DECIMALS,
            },
        );
        expected.token_mint = mint;
        expected.token_program = kind.program();
        expected.token_decimals = DECIMALS;
        assert_eq!(raw(&env, &config_pda()), serialize(&expected));
    }
}

#[test]
fn create_arena_writes_the_reference_layout_and_event() {
    let mut env = TestEnv::initialized();
    let admin = env.admin.insecure_clone();
    let (mint, program) = (env.mint, env.token_program);
    let meta = assert_ok(env.send(
        &[ix::create_arena(
            &admin.pubkey(),
            0x0102,
            ENTRY_FEE + 7,
            1_999,
            &mint,
            &program,
        )],
        &[&admin],
    ));
    assert_event(
        &meta,
        &ArenaCreated {
            arena_id: 0x0102,
            entry_fee: ENTRY_FEE + 7,
            max_sessions: 1_999,
        },
    );

    let key = arena_pda(0x0102);
    let (_, bump) =
        Pubkey::find_program_address(&[ARENA_SEED, &0x0102u16.to_le_bytes()], &slana::ID);
    let vault = vault_pda(&key);
    let (_, vault_bump) = Pubkey::find_program_address(&[VAULT_SEED, key.as_ref()], &slana::ID);
    let expected = Arena {
        id: 0x0102,
        entry_fee: ENTRY_FEE + 7,
        max_sessions: 1_999,
        open_sessions: 0,
        enabled: true,
        vault,
        vault_bump,
        total_deposited: 0,
        total_paid_out: 0,
        bump,
    };
    let data = raw(&env, &key);
    assert_eq!(data.len(), 8 + Arena::INIT_SPACE);
    assert_eq!(data, serialize(&expected));
    assert_eq!(env.balance(&key), env.rent(8 + Arena::INIT_SPACE));
}

// ---------------------------------------------------------------------------------------
// reference → program
// ---------------------------------------------------------------------------------------

#[test]
fn update_config_touches_only_its_fields() {
    let mut env = TestEnv::initialized();
    let mut expected = distinctive_config(&env);
    env.write_account(&config_pda(), &expected);
    assert_eq!(serialize(&env.config()), serialize(&expected));

    // A no-op update rewrites nothing.
    assert_ok(env.update_config(UpdateConfigArgs::default()));
    assert_eq!(raw(&env, &config_pda()), serialize(&expected));

    // Each field lands at its reference offset, every other byte stays.
    assert_ok(env.update_config(UpdateConfigArgs {
        fee_bps: Some(1_000),
        ..Default::default()
    }));
    expected.fee_bps = 1_000;
    assert_eq!(raw(&env, &config_pda()), serialize(&expected));

    let new_server = Pubkey::new_from_array([0x99; 32]);
    let new_fee_wallet = Pubkey::new_from_array([0x98; 32]);
    assert_ok(env.update_config(UpdateConfigArgs {
        server_authority: Some(new_server),
        fee_wallet: Some(new_fee_wallet),
        settle_fee_lamports: Some(77),
        paused: Some(false),
        ..Default::default()
    }));
    expected.server_authority = new_server;
    expected.fee_wallet = new_fee_wallet;
    expected.settle_fee_lamports = 77;
    expected.paused = false;
    assert_eq!(raw(&env, &config_pda()), serialize(&expected));

    let new_admin = Pubkey::new_from_array([0x97; 32]);
    assert_ok(env.update_config(UpdateConfigArgs {
        admin: Some(new_admin),
        ..Default::default()
    }));
    expected.admin = new_admin;
    assert_eq!(raw(&env, &config_pda()), serialize(&expected));
}

#[test]
fn programs_read_config_fields_at_reference_offsets() {
    let mut env = TestEnv::initialized();
    let admin = env.admin.insecure_clone();
    let base = distinctive_config(&env);

    let write = |env: &mut TestEnv, f: &dyn Fn(&mut Config)| {
        let mut c = base.clone();
        f(&mut c);
        env.write_account(&config_pda(), &c);
    };

    // The admin key and the config bump.
    write(&mut env, &|c| c.admin = Pubkey::new_from_array([6; 32]));
    assert_error(
        env.update_config(UpdateConfigArgs::default()),
        SlanaError::Unauthorized,
    );
    write(&mut env, &|c| c.bump = c.bump.wrapping_sub(1));
    assert_anchor_error(
        env.update_config(UpdateConfigArgs::default()),
        AnchorErrorCode::ConstraintSeeds,
    );
    // The stored mint / token program (create_arena's `address` constraints) ...
    write(&mut env, &|c| {
        c.token_mint = Pubkey::new_from_array([7; 32])
    });
    assert_anchor_error(
        env.create_arena(1, ENTRY_FEE, 300),
        AnchorErrorCode::ConstraintAddress,
    );
    write(&mut env, &|c| {
        c.token_program = anchor_spl::token_2022::ID;
    });
    assert_anchor_error(
        env.create_arena(1, ENTRY_FEE, 300),
        AnchorErrorCode::ConstraintAddress,
    );
    // ... the unset mint (TokenNotSet), and a set one (TokenAlreadySet).
    write(&mut env, &|c| c.token_mint = Pubkey::default());
    assert_error(env.create_arena(1, ENTRY_FEE, 300), SlanaError::TokenNotSet);
    write(&mut env, &|_| {});
    let (mint, program) = (env.mint, env.token_program);
    assert_error(
        env.set_token_mint_as(&admin, &mint, &program),
        SlanaError::TokenAlreadySet,
    );
    // The server key (sweep_loot: the distinctive config names another server) and the
    // pause flag (join).
    write(&mut env, &|c| c.paused = false);
    assert_ok(env.create_arena(1, ENTRY_FEE, 300));
    let server = env.server.insecure_clone();
    assert_error(env.sweep_loot_as(&server, 1, 0), SlanaError::Unauthorized);
    let a = env.token_player("a", ENTRY_FEE);
    write(&mut env, &|c| c.paused = true);
    assert_error(env.join(&a, 1), SlanaError::Paused);
    write(&mut env, &|c| c.paused = false);
    assert_ok(env.join(&a, 1));
}

#[test]
fn sweep_reads_decimals_and_fee_wallet_from_the_config() {
    let mut env = TestEnv::initialized();
    let admin = env.admin.insecure_clone();
    assert_ok(env.create_arena(1, ENTRY_FEE, 300));
    assert_ok(env.update_arena(1, Some(false), None, None));
    env.mint_to(&vault_pda(&arena_pda(1)), 10 * TOKEN);
    let base = env.config();

    // The decimals passed to transfer_checked come from the config: a wrong value fails in
    // the token program (SPL Token `MintDecimalsMismatch` = custom error 18).
    let mut c = base.clone();
    c.token_decimals = DECIMALS + 1;
    env.write_account(&config_pda(), &c);
    assert_instruction_error(env.sweep(1), InstructionError::Custom(18));

    // Another fee wallet: the fee wallet's ATA no longer matches.
    let mut c = base.clone();
    c.fee_wallet = Pubkey::new_unique();
    env.write_account(&config_pda(), &c);
    assert_anchor_error(
        env.sweep_as(&admin, 1),
        AnchorErrorCode::ConstraintTokenOwner,
    );

    env.write_account(&config_pda(), &base);
    assert_ok(env.sweep(1));
    assert_eq!(env.tokens(&env.fee_ata()), 10 * TOKEN);
}

#[test]
fn update_arena_touches_only_its_fields() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(4, ENTRY_FEE, 300));
    let mut expected = env.arena(4);
    expected.open_sessions = 0;
    expected.total_deposited = 0x0102_0304_0506_0708;
    expected.total_paid_out = 0x1112_1314_1516_1718;
    expected.vault_bump = 0x5a;
    env.write_account(&arena_pda(4), &expected);

    assert_ok(env.update_arena(4, None, None, None));
    assert_eq!(raw(&env, &arena_pda(4)), serialize(&expected));
    assert_ok(env.update_arena(4, Some(false), Some(1_234), Some(99)));
    expected.enabled = false;
    expected.max_sessions = 1_234;
    expected.entry_fee = 99;
    assert_eq!(raw(&env, &arena_pda(4)), serialize(&expected));

    // `open_sessions` and the arena bump / id are read at their reference offsets.
    let mut busy = expected.clone();
    busy.open_sessions = 0x0100;
    env.write_account(&arena_pda(4), &busy);
    assert_error(
        env.update_arena(4, None, None, Some(1)),
        SlanaError::ArenaBusy,
    );
    let mut bad = expected.clone();
    bad.bump = bad.bump.wrapping_sub(1);
    env.write_account(&arena_pda(4), &bad);
    assert_anchor_error(
        env.update_arena(4, Some(true), None, None),
        AnchorErrorCode::ConstraintSeeds,
    );
    let mut bad = expected.clone();
    bad.id = 5;
    env.write_account(&arena_pda(4), &bad);
    assert_anchor_error(
        env.update_arena(4, Some(true), None, None),
        AnchorErrorCode::ConstraintSeeds,
    );
}

// ---------------------------------------------------------------------------------------
// account types and constraints
// ---------------------------------------------------------------------------------------

/// `update_config` with `config` replaced by `account`.
fn update_config_with(admin: &Pubkey, account: Pubkey) -> Instruction {
    let mut ix = ix::update_config(admin, UpdateConfigArgs::default());
    ix.accounts[1].pubkey = account;
    ix
}

#[test]
fn account_type_errors_match_anchor() {
    let mut env = TestEnv::initialized();
    let admin = env.admin.insecure_clone();
    assert_ok(env.create_arena(1, ENTRY_FEE, 300));

    // Another program account type: discriminator mismatch.
    let ix = update_config_with(&admin.pubkey(), arena_pda(1));
    assert_anchor_error(
        env.send(&[ix], &[&admin]),
        AnchorErrorCode::AccountDiscriminatorMismatch,
    );
    // A non-existent account.
    let ix = update_config_with(&admin.pubkey(), Pubkey::new_unique());
    assert_anchor_error(
        env.send(&[ix], &[&admin]),
        AnchorErrorCode::AccountNotInitialized,
    );
    // The config bytes owned by another program.
    let fake = Pubkey::new_unique();
    let config_bytes = raw(&env, &config_pda());
    write_raw_account(
        &mut env.svm,
        &fake,
        Pubkey::new_unique(),
        config_bytes.clone(),
    );
    let ix = update_config_with(&admin.pubkey(), fake);
    assert_anchor_error(
        env.send(&[ix], &[&admin]),
        AnchorErrorCode::AccountOwnedByWrongProgram,
    );
    // Owned by the program: too short for a discriminator, too short for the fields.
    let short = Pubkey::new_unique();
    write_raw_account(&mut env.svm, &short, slana::ID, vec![1, 2, 3]);
    let ix = update_config_with(&admin.pubkey(), short);
    assert_anchor_error(
        env.send(&[ix], &[&admin]),
        AnchorErrorCode::AccountDiscriminatorNotFound,
    );
    let mut truncated = raw(&env, &config_pda());
    truncated.truncate(100);
    write_raw_account(&mut env.svm, &short, slana::ID, truncated);
    let ix = update_config_with(&admin.pubkey(), short);
    assert_anchor_error(
        env.send(&[ix], &[&admin]),
        AnchorErrorCode::AccountDidNotDeserialize,
    );
    // A full copy of the config at another address: the PDA check.
    let copy = Pubkey::new_unique();
    write_raw_account(&mut env.svm, &copy, slana::ID, config_bytes);
    let ix = update_config_with(&admin.pubkey(), copy);
    assert_anchor_error(env.send(&[ix], &[&admin]), AnchorErrorCode::ConstraintSeeds);
    // `mut`: the config passed read-only.
    let mut ix = ix::update_config(&admin.pubkey(), UpdateConfigArgs::default());
    ix.accounts[1] = AccountMeta::new_readonly(config_pda(), false);
    assert_anchor_error(env.send(&[ix], &[&admin]), AnchorErrorCode::ConstraintMut);
    // `Signer`: the admin does not sign (the fee payer sends).
    let mut ix = ix::update_config(&admin.pubkey(), UpdateConfigArgs::default());
    ix.accounts[0].is_signer = false;
    assert_anchor_error(env.send(&[ix], &[]), AnchorErrorCode::AccountNotSigner);
    // Missing accounts.
    let mut ix = ix::update_config(&admin.pubkey(), UpdateConfigArgs::default());
    ix.accounts.truncate(1);
    assert_anchor_error(
        env.send(&[ix], &[&admin]),
        AnchorErrorCode::AccountNotEnoughKeys,
    );
}

#[test]
fn argument_errors_match_anchor() {
    let mut env = TestEnv::initialized();
    let admin = env.admin.insecure_clone();
    let cases: Vec<Vec<u8>> = vec![
        // Option tag 2.
        vec![2],
        // Truncated `Some(admin)`.
        vec![1, 9, 9],
        // `paused: Some(2)` (bool out of range).
        {
            let mut d = vec![0u8; 5];
            d.extend_from_slice(&[1, 2]);
            d
        },
        // Truncated `fee_bps: Some(..)`.
        vec![0, 0, 0, 1, 7],
    ];
    for args in cases {
        let mut ix = ix::update_config(&admin.pubkey(), UpdateConfigArgs::default());
        ix.data.truncate(8);
        ix.data.extend_from_slice(&args);
        assert_anchor_error(
            env.send(&[ix], &[&admin]),
            AnchorErrorCode::InstructionDidNotDeserialize,
        );
    }
    // Trailing bytes are ignored.
    let mut ix = ix::update_config(&admin.pubkey(), UpdateConfigArgs::default());
    ix.data.extend_from_slice(&[7, 7, 7]);
    assert_ok(env.send(&[ix], &[&admin]));

    // Too-short or malformed arguments of the other instructions.
    let (mint, program) = (env.mint, env.token_program);
    let mut ix = ix::create_arena(&admin.pubkey(), 1, ENTRY_FEE, 300, &mint, &program);
    ix.data.pop();
    assert_anchor_error(
        env.send(&[ix], &[&admin]),
        AnchorErrorCode::InstructionDidNotDeserialize,
    );
    let mut ix = ix::update_arena(&admin.pubkey(), 1, None, None, None);
    ix.data[8] = 2;
    assert_anchor_error(
        env.send(&[ix], &[&admin]),
        AnchorErrorCode::InstructionDidNotDeserialize,
    );
    // `register_player` with a name that is not UTF-8.
    let p = env.funded_keypair(SOL);
    let mut ix = ix::register_player(&p.pubkey(), "x", 0);
    ix.data.truncate(8);
    ix.data.extend_from_slice(&[1, 0, 0, 0, 0xff, 0]);
    assert_anchor_error(
        env.send(&[ix], &[&p]),
        AnchorErrorCode::InstructionDidNotDeserialize,
    );
    // `set_token_mint` takes no arguments: trailing bytes are ignored (and the mint is set).
    let mut ix = ix::set_token_mint(&admin.pubkey(), &mint, &program);
    ix.data.extend_from_slice(&[1, 2, 3]);
    assert_error(env.send(&[ix], &[&admin]), SlanaError::TokenAlreadySet);
}

/// A system account holding `lamports` and no data.
fn prefund(env: &mut TestEnv, address: &Pubkey, lamports: u64) {
    env.svm
        .set_account(
            *address,
            solana_account::Account {
                lamports,
                data: vec![],
                owner: anchor_lang::solana_program::system_program::ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
}

#[test]
fn init_accepts_prefunded_pdas_and_rejects_existing_ones() {
    let mut env = TestEnv::deployed();
    // Anyone can send lamports to a PDA before it is created (here below the rent minimum).
    prefund(&mut env, &config_pda(), 1);
    let admin = env.admin.insecure_clone();
    let args = env.default_init_args();
    let before = env.balance(&admin.pubkey());
    assert_ok(env.initialize_as(&admin, args));
    assert_eq!(env.balance(&config_pda()), env.rent(8 + Config::INIT_SPACE));
    let paid = before - env.balance(&admin.pubkey());
    assert_eq!(paid, env.rent(8 + Config::INIT_SPACE) - 1);
    assert_eq!(serialize(&env.config()), raw(&env, &config_pda()));

    // A pre-funded arena PDA and vault PDA, then a second create of the same arena.
    let mint = env.create_mint(MintKind::Spl, None);
    assert_ok(env.set_token_mint_as(&admin, &mint, &MintKind::Spl.program()));
    env.mint = mint;
    env.token_program = MintKind::Spl.program();
    prefund(&mut env, &arena_pda(9), 10 * SOL);
    prefund(&mut env, &vault_pda(&arena_pda(9)), 5_000);
    assert_ok(env.create_arena(9, ENTRY_FEE, 300));
    assert_eq!(env.balance(&arena_pda(9)), 10 * SOL);
    assert_eq!(env.balance(&vault_pda(&arena_pda(9))), env.rent(165));
    assert_eq!(env.arena(9).id, 9);
    assert_already_in_use(env.create_arena(9, ENTRY_FEE, 300));
}

#[test]
fn initialize_checks_the_program_accounts() {
    let mut env = TestEnv::deployed();
    let mint = env.create_mint(MintKind::Spl, None);
    let admin = env.admin.insecure_clone();
    let args = env.default_init_args();

    // `program` must be this program.
    let mut ix = ix::initialize(&admin.pubkey(), args.clone());
    ix.accounts[2].pubkey = MintKind::Spl.program();
    assert_anchor_error(
        env.send(&[ix], &[&admin]),
        AnchorErrorCode::InvalidProgramId,
    );
    // `program_data` must be owned by the loader.
    let mut ix = ix::initialize(&admin.pubkey(), args.clone());
    ix.accounts[3].pubkey = mint;
    assert_anchor_error(
        env.send(&[ix], &[&admin]),
        AnchorErrorCode::AccountOwnedByWrongProgram,
    );
    // The program account itself is not a ProgramData.
    let mut ix = ix::initialize(&admin.pubkey(), args.clone());
    ix.accounts[3].pubkey = slana::ID;
    assert_anchor_error(
        env.send(&[ix], &[&admin]),
        AnchorErrorCode::AccountNotProgramData,
    );
    // A wrong config address.
    let mut ix = ix::initialize(&admin.pubkey(), args.clone());
    ix.accounts[1].pubkey = Pubkey::new_unique();
    assert_anchor_error(env.send(&[ix], &[&admin]), AnchorErrorCode::ConstraintSeeds);
    // Missing system program.
    let mut ix = ix::initialize(&admin.pubkey(), args.clone());
    ix.accounts.truncate(4);
    assert_anchor_error(
        env.send(&[ix], &[&admin]),
        AnchorErrorCode::AccountNotEnoughKeys,
    );
    assert!(env.try_fetch::<Config>(&config_pda()).is_none());
    assert_ok(env.initialize_as(&admin, args));
}

#[test]
fn dispatch_errors_match_anchor() {
    let mut env = TestEnv::initialized();
    let admin = env.admin.insecure_clone();
    let send_data = |env: &mut TestEnv, data: Vec<u8>| {
        let mut ix = ix::update_config(&admin.pubkey(), UpdateConfigArgs::default());
        ix.data = data;
        env.send(&[ix], &[&admin])
    };
    for data in [vec![], vec![1, 2, 3], vec![0; 8], vec![9; 20]] {
        assert_anchor_error(
            send_data(&mut env, data),
            AnchorErrorCode::InstructionFallbackNotFound,
        );
    }
    let mut event_cpi = anchor_lang::event::EVENT_IX_TAG_LE.to_vec();
    event_cpi.extend_from_slice(&[0; 8]);
    assert_anchor_error(
        send_data(&mut env, event_cpi),
        AnchorErrorCode::EventInstructionStub,
    );
}

// ---------------------------------------------------------------------------------------
// player and arena instructions
// ---------------------------------------------------------------------------------------

/// Register → update → join → finalize without a token account → collect → loot burn →
/// sweep: every account the program writes decodes with the reference and re-serializes to
/// exactly the stored bytes, and every event is the reference's encoding.
#[test]
fn stake_flow_writes_reference_layouts_and_events() {
    use slana::{
        events::{
            ArenaJoined, ArenaSwept, LootBurned, PlayerRegistered, ProfileUpdated, SessionRefunded,
            SessionSettled,
        },
        state::{PlayerProfile, Session},
    };
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, ENTRY_FEE, 300));

    let alice = env.funded_keypair(10 * SOL);
    let player = alice.pubkey();
    let meta = assert_ok(env.register(&alice, "Renée🚀", 5));
    assert_event(
        &meta,
        &PlayerRegistered {
            owner: player,
            name: "Renée🚀".into(),
        },
    );
    let profile_key = profile_pda(&player);
    let data = raw(&env, &profile_key);
    assert_eq!(data.len(), 8 + PlayerProfile::INIT_SPACE);
    assert_eq!(data, serialize(&env.profile(&player)));
    let meta = assert_ok(env.update_profile(&alice, Some("al"), Some(3)));
    assert_event(
        &meta,
        &ProfileUpdated {
            owner: player,
            skin: 3,
        },
    );
    let profile = env.profile(&player);
    assert_eq!(
        (name_of(&profile.name, profile.name_len), profile.skin),
        ("al".into(), 3)
    );
    assert_eq!(raw(&env, &profile_key), serialize(&profile));

    let ata = env.create_ata(&player);
    env.mint_to(&ata, 3 * ENTRY_FEE);
    let meta = assert_ok(env.join(&alice, 1));
    let session_key = session_pda(&arena_pda(1), &player);
    let session = env.session(1, &player).expect("session");
    assert_event(
        &meta,
        &ArenaJoined {
            player,
            arena_id: 1,
            session_id: session.id,
            entry_fee: ENTRY_FEE,
        },
    );
    let data = raw(&env, &session_key);
    assert_eq!(data.len(), 118);
    assert_eq!(data.len(), 8 + Session::INIT_SPACE);
    assert_eq!(data, serialize(&session));
    let (_, bump) = Pubkey::find_program_address(
        &[SESSION_SEED, arena_pda(1).as_ref(), player.as_ref()],
        &slana::ID,
    );
    assert_eq!(
        (
            session.player,
            session.arena,
            session.arena_id,
            session.entry_fee,
            session.opened_at,
            session.settle_fee,
            session.fee_bps,
            session.bump,
            session.finalized,
            session.owed,
        ),
        (
            player,
            arena_pda(1),
            1,
            ENTRY_FEE,
            START_TS,
            SETTLE_FEE_LAMPORTS,
            FEE_BPS,
            bump,
            false,
            0,
        )
    );
    assert_eq!(
        env.balance(&session_key),
        env.session_rent() + SETTLE_FEE_LAMPORTS
    );

    // Finalize without a token account (R24): the session stays, finalized with `owed`.
    let meta = assert_ok(env.settle_to(&player, 1, ENTRY_FEE, 1_234, 5, 60, None));
    assert_event(
        &meta,
        &SessionSettled {
            player,
            arena_id: 1,
            session_id: session.id,
            payout: ENTRY_FEE,
            fee: 0,
            score: 1_234,
            kills: 5,
            owed: ENTRY_FEE,
        },
    );
    let finalized = env.session(1, &player).expect("finalized session");
    assert_eq!(raw(&env, &session_key), serialize(&finalized));
    assert!(finalized.finalized);
    assert_eq!(finalized.owed, ENTRY_FEE);
    let profile = env.profile(&player);
    assert_eq!(raw(&env, &profile_key), serialize(&profile));
    assert_eq!(
        (
            profile.games_played,
            profile.kills,
            profile.best_score,
            profile.total_score,
            profile.xp,
            profile.last_played,
            profile.total_won
        ),
        (1, 5, 1_234, 1_234, 60, START_TS, ENTRY_FEE)
    );

    let meta = assert_ok(env.refund(&alice, 1));
    assert_event(
        &meta,
        &SessionRefunded {
            player,
            arena_id: 1,
            amount: ENTRY_FEE,
            finalized: true,
        },
    );
    assert!(env.session(1, &player).is_none());

    env.mint_to(&vault_pda(&arena_pda(1)), 100);
    let meta = assert_ok(env.sweep_loot(1, 23));
    assert_event(
        &meta,
        &LootBurned {
            arena_id: 1,
            amount: 23,
        },
    );

    assert_ok(env.update_arena(1, Some(false), None, None));
    let meta = assert_ok(env.sweep(1));
    assert_event(
        &meta,
        &ArenaSwept {
            arena_id: 1,
            amount: 77,
        },
    );
    assert_eq!(env.tokens(&env.fee_ata()), 77);
}

/// Anchor's duplicate-mutable and account-type checks on the arena instructions.
#[test]
fn stake_constraint_errors_match_anchor() {
    use anchor_lang::{InstructionData, ToAccountMetas};
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, ENTRY_FEE, 300));
    let a = env.token_player("a", ENTRY_FEE);
    let (mint, program) = (env.mint, env.token_program);
    let arena = arena_pda(1);
    let vault = vault_pda(&arena);

    // join: the vault as the player's token account → 2040 (before its token constraints).
    let join = Instruction::new_with_bytes(
        slana::ID,
        &slana::instruction::JoinArena {
            max_fee_bps: MAX_FEE_BPS,
            max_entry_fee: u64::MAX,
            max_settle_fee: MAX_SETTLE_FEE_LAMPORTS,
        }
        .data(),
        slana::accounts::JoinArena {
            player: a.pubkey(),
            config: config_pda(),
            profile: profile_pda(&a.pubkey()),
            arena,
            vault,
            session: session_pda(&arena, &a.pubkey()),
            player_token: vault,
            token_mint: mint,
            token_program: program,
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
    );
    assert_anchor_error(
        env.send(&[join], &[&a]),
        AnchorErrorCode::ConstraintDuplicateMutableAccount,
    );
    assert_ok(env.join(&a, 1));

    // settle: the vault as the player's token account or as the fee account → 2040; the
    // fee account read-only → 2000.
    let server = env.server.insecure_clone();
    let args = env.settle_args(&a.pubkey(), 1, 0, 0, 0, 0);
    let settle = env.settle_ix(
        &server.pubkey(),
        &a.pubkey(),
        1,
        args,
        Some(env.player_ata(&a.pubkey())),
    );
    for (index, err) in [
        (6, AnchorErrorCode::ConstraintDuplicateMutableAccount),
        (8, AnchorErrorCode::ConstraintDuplicateMutableAccount),
    ] {
        let mut bad = settle.clone();
        bad.accounts[index].pubkey = vault;
        assert_anchor_error(env.send(&[bad], &[&server]), err);
    }
    let mut bad = settle.clone();
    bad.accounts[8] = AccountMeta::new_readonly(env.fee_ata(), false);
    assert_anchor_error(env.send(&[bad], &[&server]), AnchorErrorCode::ConstraintMut);
    // A mint passed as the fee account does not deserialize as a token account.
    let mut bad = settle;
    bad.accounts[8].pubkey = mint;
    assert_instruction_error(
        env.send(&[bad], &[&server]),
        InstructionError::InvalidAccountData,
    );

    // sweep: the arena vault as the fee account → 2040; a mint → InvalidAccountData.
    let admin = env.admin.insecure_clone();
    let sweep = ix::sweep_arena(&admin.pubkey(), 1, &vault, &mint, &program);
    assert_anchor_error(
        env.send(&[sweep], &[&admin]),
        AnchorErrorCode::ConstraintDuplicateMutableAccount,
    );
    let sweep = ix::sweep_arena(&admin.pubkey(), 1, &mint, &mint, &program);
    assert_instruction_error(
        env.send(&[sweep], &[&admin]),
        InstructionError::InvalidAccountData,
    );

    // sweep_loot: truncated `amount` → 102; the vault read-only → 2000.
    let mut loot = ix::sweep_loot(&server.pubkey(), 1, 1, &mint, &program);
    loot.data.truncate(8 + 7);
    assert_anchor_error(
        env.send(&[loot], &[&server]),
        AnchorErrorCode::InstructionDidNotDeserialize,
    );
    let mut loot = ix::sweep_loot(&server.pubkey(), 1, 1, &mint, &program);
    loot.accounts[3] = AccountMeta::new_readonly(vault, false);
    assert_anchor_error(
        env.send(&[loot], &[&server]),
        AnchorErrorCode::ConstraintMut,
    );
}
