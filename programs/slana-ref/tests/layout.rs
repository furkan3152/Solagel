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
//! `PlayerProfile`, `Session` (151 bytes), `PassLock` and leaderboard rows written by the
//! player and arena instructions are checked in `stake_flow_writes_reference_layouts_and_events`;
//! `MintCounter`, the Pass events and the reveal fields of `Config` are checked in
//! `pass_flow_writes_reference_layouts_and_events`.

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
        events::{ArenaCreated, PassCollectionSet, TreasuryWithdrawn},
        state::{Arena, Config, Season},
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
/// token program and bumps so that admin instructions still pass their checks.
fn distinctive_config(env: &TestEnv) -> Config {
    let mut c = env.config();
    let mut uri = [0u8; BASE_URI_BYTES];
    uri.iter_mut()
        .enumerate()
        .for_each(|(i, b)| *b = (i as u8) | 0x40);
    c.server_authority = Pubkey::new_from_array([0x22; 32]);
    c.token_decimals = DECIMALS;
    c.fee_bps = 900;
    c.pass_fee_bps = 800;
    c.treasury_bps = 7_001;
    c.season_bps = 2_002;
    c.burn_bps = 997;
    c.settle_fee_lamports = 123_456;
    c.current_season = 0x0102_0304;
    c.paused = true;
    c.pass_collection = Pubkey::default();
    c.pass_base_uri = uri;
    c.pass_base_uri_len = 0x5a;
    c.pass_supply = 0x0a0b;
    c.pass_minted = 0;
    c.pass_per_wallet = 7;
    c.pass_min_tokens = 0x1112_1314_1516_1718;
    c.pass_mint_open = false;
    c.pass_mint_start_ts = -0x2122_2324_2526_2728;
    c.pass_mint_opened = false;
    c.pass_mint_ended = false;
    c.pass_seed_hash = [0x31; 32];
    c.pass_seed = [0x32; 32];
    c.pass_revealed = false;
    c.pass_seed_revealed = false;
    c.pass_entropy_target_slot = 0x4142_4344_4546_4748;
    c.pass_entropy_captured = true;
    c.pass_entropy = [0x33; 32];
    c.pass_entropy_slot = 0x5152_5354_5556_5758;
    c.pass_final_seed = [0x34; 32];
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
fn initialize_writes_reference_layouts() {
    for kind in [MintKind::Spl, MintKind::Token2022] {
        let env = TestEnv::initialized_with(kind);

        let data = raw(&env, &config_pda());
        assert_eq!(data.len(), 8 + Config::INIT_SPACE);
        let config = env.config();
        assert_eq!(serialize(&config), data);
        let (_, config_bump) = Pubkey::find_program_address(&[CONFIG_SEED], &slana::ID);
        let (_, treasury_bump) = Pubkey::find_program_address(&[TREASURY_VAULT_SEED], &slana::ID);
        let (_, season_vault_bump) = Pubkey::find_program_address(&[SEASON_VAULT_SEED], &slana::ID);
        assert_eq!(
            (
                config.bump,
                config.treasury_vault_bump,
                config.season_vault_bump
            ),
            (config_bump, treasury_bump, season_vault_bump)
        );
        assert_eq!(&config.pass_base_uri, &[0; BASE_URI_BYTES]);
        assert_eq!(config.pass_seed, [0; 32]);
        assert_eq!(config.pass_entropy_slot, 0);
        assert_eq!(config.pass_mint_start_ts, 0);

        let data = raw(&env, &season_pda(FIRST_SEASON));
        assert_eq!(data.len(), 8 + Season::INIT_SPACE);
        let season = env.season(FIRST_SEASON);
        assert_eq!(serialize(&season), data);
        let (_, season_bump) =
            Pubkey::find_program_address(&[SEASON_SEED, &FIRST_SEASON.to_le_bytes()], &slana::ID);
        assert_eq!(season.bump, season_bump);
        assert_eq!((season.ended_at, season.pool, season.count), (0, 0, 0));
        assert!(season.entries.iter().all(|e| *e == Default::default()));

        // Rent-exempt at exactly the reference size.
        assert_eq!(env.balance(&config_pda()), env.rent(8 + Config::INIT_SPACE));
        assert_eq!(
            env.balance(&season_pda(FIRST_SEASON)),
            env.rent(8 + Season::INIT_SPACE)
        );
        assert_eq!(env.svm.get_account(&config_pda()).unwrap().owner, slana::ID);
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
            true,
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
            requires_pass: true,
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
        requires_pass: true,
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
    assert_ok(env.update_config(UpdateConfigArgs {
        server_authority: Some(new_server),
        pass_fee_bps: Some(3),
        split: Some([1, 2, 9_997]),
        settle_fee_lamports: Some(77),
        paused: Some(false),
        pass_base_uri: Some("ipfs://x/".into()),
        pass_supply: Some(9_999),
        pass_per_wallet: Some(2),
        pass_min_tokens: Some(5),
        pass_mint_open: Some(true),
        pass_mint_start_ts: Some(-9),
        ..Default::default()
    }));
    expected.server_authority = new_server;
    expected.pass_fee_bps = 3;
    expected.treasury_bps = 1;
    expected.season_bps = 2;
    expected.burn_bps = 9_997;
    expected.settle_fee_lamports = 77;
    expected.paused = false;
    let mut uri = [0u8; BASE_URI_BYTES];
    uri[..9].copy_from_slice(b"ipfs://x/");
    expected.pass_base_uri = uri;
    expected.pass_base_uri_len = 9;
    expected.pass_supply = 9_999;
    expected.pass_per_wallet = 2;
    expected.pass_min_tokens = 5;
    expected.pass_mint_open = true;
    expected.pass_mint_opened = true;
    expected.pass_mint_start_ts = -9;
    assert_eq!(raw(&env, &config_pda()), serialize(&expected));

    // set_pass_seed_hash writes only the hash.
    let admin = env.admin.insecure_clone();
    assert_ok(env.set_seed_hash_as(&admin, [0x77; 32]));
    expected.pass_seed_hash = [0x77; 32];
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
    let uri = |s: &str| UpdateConfigArgs {
        pass_base_uri: Some(s.into()),
        ..Default::default()
    };

    write(&mut env, &|c| c.pass_minted = 1);
    assert_error(env.update_config(uri("a/")), SlanaError::BadBaseUri);
    assert_error(
        env.set_seed_hash_as(&admin, [1; 32]),
        SlanaError::SeedLocked,
    );
    write(&mut env, &|c| c.pass_mint_opened = true);
    assert_error(
        env.update_config(UpdateConfigArgs {
            pass_supply: Some(5),
            ..Default::default()
        }),
        SlanaError::SupplyLocked,
    );
    write(&mut env, &|c| c.pass_mint_ended = true);
    assert_error(
        env.update_config(UpdateConfigArgs {
            pass_mint_open: Some(true),
            ..Default::default()
        }),
        SlanaError::MintEnded,
    );
    write(&mut env, &|c| c.pass_revealed = true);
    assert_error(
        env.set_seed_hash_as(&admin, [1; 32]),
        SlanaError::AlreadyRevealed,
    );
    write(&mut env, &|c| c.pass_seed_revealed = true);
    assert_error(
        env.update_config(UpdateConfigArgs {
            pass_mint_open: Some(true),
            ..Default::default()
        }),
        SlanaError::AlreadyRevealed,
    );
    write(&mut env, &|c| {
        c.pass_mint_open = true;
        c.pass_minted = 3;
    });
    assert_error(
        env.update_config(UpdateConfigArgs {
            pass_mint_open: Some(false),
            ..Default::default()
        }),
        SlanaError::UseCloseMint,
    );
    write(&mut env, &|c| {
        c.pass_collection = Pubkey::new_from_array([5; 32])
    });
    let collection = Pubkey::new_unique();
    assert_error(
        env.set_collection_as(&admin, &collection),
        SlanaError::CollectionAlreadySet,
    );
    // `fee_bps` / `pass_fee_bps` are read back when only one of them changes.
    write(&mut env, &|c| c.fee_bps = 10);
    assert_error(
        env.update_config(UpdateConfigArgs {
            pass_fee_bps: Some(11),
            ..Default::default()
        }),
        SlanaError::InvalidFee,
    );
    write(&mut env, &|c| c.pass_fee_bps = 12);
    assert_error(
        env.update_config(UpdateConfigArgs {
            fee_bps: Some(11),
            ..Default::default()
        }),
        SlanaError::InvalidFee,
    );
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
    // The stored mint / token program (create_arena's `address` constraints).
    write(&mut env, &|c| {
        c.token_mint = Pubkey::new_from_array([7; 32])
    });
    assert_anchor_error(
        env.create_arena(1, ENTRY_FEE, 300, false),
        AnchorErrorCode::ConstraintAddress,
    );
    write(&mut env, &|c| {
        c.token_program = anchor_spl::token_2022::ID;
    });
    assert_anchor_error(
        env.create_arena(1, ENTRY_FEE, 300, false),
        AnchorErrorCode::ConstraintAddress,
    );
}

#[test]
fn withdraw_reads_bumps_and_decimals_from_the_config() {
    let mut env = TestEnv::initialized();
    let admin = env.admin.insecure_clone();
    env.mint_to(&treasury_vault_pda(), 10 * TOKEN);
    let to = env.create_ata(&admin.pubkey());
    let base = env.config();

    let mut c = base.clone();
    c.treasury_vault_bump = c.treasury_vault_bump.wrapping_sub(1);
    env.write_account(&config_pda(), &c);
    assert_anchor_error(
        env.withdraw_treasury_as(&admin, &to, TOKEN),
        AnchorErrorCode::ConstraintSeeds,
    );

    // The decimals passed to transfer_checked come from the config: a wrong value fails in
    // the token program (SPL Token `MintDecimalsMismatch` = custom error 18).
    let mut c = base.clone();
    c.token_decimals = DECIMALS + 1;
    env.write_account(&config_pda(), &c);
    assert_instruction_error(
        env.withdraw_treasury_as(&admin, &to, TOKEN),
        InstructionError::Custom(18),
    );

    env.write_account(&config_pda(), &base);
    let meta = assert_ok(env.withdraw_treasury_as(&admin, &to, TOKEN));
    assert_event(
        &meta,
        &TreasuryWithdrawn {
            destination: to,
            amount: TOKEN,
        },
    );
    assert_eq!(env.tokens(&to), TOKEN);
}

#[test]
fn update_arena_touches_only_its_fields() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(4, ENTRY_FEE, 300, false));
    let mut expected = env.arena(4);
    expected.open_sessions = 0;
    expected.total_deposited = 0x0102_0304_0506_0708;
    expected.total_paid_out = 0x1112_1314_1516_1718;
    expected.vault_bump = 0x5a;
    env.write_account(&arena_pda(4), &expected);

    assert_ok(env.update_arena(4, None, None, None, None));
    assert_eq!(raw(&env, &arena_pda(4)), serialize(&expected));
    assert_ok(env.update_arena(4, Some(false), Some(1_234), Some(99), Some(true)));
    expected.enabled = false;
    expected.max_sessions = 1_234;
    expected.entry_fee = 99;
    expected.requires_pass = true;
    assert_eq!(raw(&env, &arena_pda(4)), serialize(&expected));

    // `open_sessions` and the arena bump / id are read at their reference offsets.
    let mut busy = expected.clone();
    busy.open_sessions = 0x0100;
    env.write_account(&arena_pda(4), &busy);
    assert_error(
        env.update_arena(4, None, None, Some(1), None),
        SlanaError::ArenaBusy,
    );
    let mut bad = expected.clone();
    bad.bump = bad.bump.wrapping_sub(1);
    env.write_account(&arena_pda(4), &bad);
    assert_anchor_error(
        env.update_arena(4, Some(true), None, None, None),
        AnchorErrorCode::ConstraintSeeds,
    );
    let mut bad = expected.clone();
    bad.id = 5;
    env.write_account(&arena_pda(4), &bad);
    assert_anchor_error(
        env.update_arena(4, Some(true), None, None, None),
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
    assert_ok(env.create_arena(1, ENTRY_FEE, 300, false));

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
            let mut d = vec![0u8; 6];
            d.extend_from_slice(&[1, 2]);
            d
        },
        // `pass_base_uri: Some("\xff")` (not UTF-8).
        {
            let mut d = vec![0u8; 7];
            d.extend_from_slice(&[1, 1, 0, 0, 0, 0xff]);
            d
        },
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

    // Too-short arguments of the other instructions.
    let (mint, program) = (env.mint, env.token_program);
    let mut ix = ix::create_arena(&admin.pubkey(), 1, ENTRY_FEE, 300, false, &mint, &program);
    ix.data.pop();
    assert_anchor_error(
        env.send(&[ix], &[&admin]),
        AnchorErrorCode::InstructionDidNotDeserialize,
    );
    let mut ix = ix::create_arena(&admin.pubkey(), 1, ENTRY_FEE, 300, false, &mint, &program);
    *ix.data.last_mut().unwrap() = 2;
    assert_anchor_error(
        env.send(&[ix], &[&admin]),
        AnchorErrorCode::InstructionDidNotDeserialize,
    );
    let mut ix = ix::set_pass_seed_hash(&admin.pubkey(), [1; 32]);
    ix.data.pop();
    assert_anchor_error(
        env.send(&[ix], &[&admin]),
        AnchorErrorCode::InstructionDidNotDeserialize,
    );
}

#[test]
fn withdraw_rejects_the_vault_as_its_own_destination() {
    let mut env = TestEnv::initialized();
    let admin = env.admin.insecure_clone();
    env.mint_to(&treasury_vault_pda(), TOKEN);
    let vault = treasury_vault_pda();
    assert_anchor_error(
        env.withdraw_treasury_as(&admin, &vault, 1),
        AnchorErrorCode::ConstraintDuplicateMutableAccount,
    );
    // Another token account of the mint whose authority is not the config, as the vault.
    let other = env.create_ata(&admin.pubkey());
    let to = env.create_ata(&Pubkey::new_unique());
    let mut ix = ix::withdraw_treasury(&admin.pubkey(), &to, &env.mint, &env.token_program, 1);
    ix.accounts[2].pubkey = other;
    assert_anchor_error(env.send(&[ix], &[&admin]), AnchorErrorCode::ConstraintSeeds);
    // A mint passed as a token account.
    let mint = env.mint;
    assert_instruction_error(
        env.withdraw_treasury_as(&admin, &mint, 1),
        InstructionError::InvalidAccountData,
    );
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
    let mint = env.create_mint(MintKind::Spl, None);
    env.mint = mint;
    // Anyone can send lamports to a PDA before it is created (here below the rent minimum).
    prefund(&mut env, &config_pda(), 1);
    prefund(&mut env, &treasury_vault_pda(), 5_000);
    let admin = env.admin.insecure_clone();
    let args = env.default_init_args();
    let before = env.balance(&admin.pubkey());
    assert_ok(env.initialize_as(&admin, &mint, &MintKind::Spl.program(), args));
    assert_eq!(env.balance(&config_pda()), env.rent(8 + Config::INIT_SPACE));
    assert_eq!(env.balance(&treasury_vault_pda()), env.rent(165));
    let paid = before - env.balance(&admin.pubkey());
    let expected =
        env.rent(8 + Config::INIT_SPACE) - 1 + env.rent(8 + Season::INIT_SPACE) + env.rent(165) * 2
            - 5_000;
    assert_eq!(paid, expected);
    assert_eq!(serialize(&env.config()), raw(&env, &config_pda()));

    // A pre-funded arena PDA, then a second create of the same arena.
    env.token_program = MintKind::Spl.program();
    prefund(&mut env, &arena_pda(9), 10 * SOL);
    assert_ok(env.create_arena(9, ENTRY_FEE, 300, false));
    assert_eq!(env.balance(&arena_pda(9)), 10 * SOL);
    assert_eq!(env.arena(9).id, 9);
    assert_already_in_use(env.create_arena(9, ENTRY_FEE, 300, false));
}

#[test]
fn set_pass_collection_layout_and_event() {
    let mut env = TestEnv::initialized();
    load_mpl_core(&mut env.svm);
    let admin = env.admin.insecure_clone();
    let collection = env.create_core_collection(&pass_authority_pda());
    let mut expected = env.config();
    let meta = assert_ok(env.set_collection_as(&admin, &collection));
    assert_event(&meta, &PassCollectionSet { collection });
    expected.pass_collection = collection;
    assert_eq!(raw(&env, &config_pda()), serialize(&expected));

    // `pass_authority` must be the canonical PDA.
    let mut fresh = TestEnv::initialized();
    let admin = fresh.admin.insecure_clone();
    let mut ix = ix::set_pass_collection(&admin.pubkey(), &collection);
    ix.accounts[3].pubkey = Pubkey::new_unique();
    assert_anchor_error(
        fresh.send(&[ix], &[&admin]),
        AnchorErrorCode::ConstraintSeeds,
    );
}

#[test]
fn initialize_checks_the_program_accounts() {
    let mut env = TestEnv::deployed();
    let mint = env.create_mint(MintKind::Spl, None);
    let admin = env.admin.insecure_clone();
    let args = env.default_init_args();
    let program = MintKind::Spl.program();

    // `program` must be this program.
    let mut ix = ix::initialize(&admin.pubkey(), &mint, &program, args.clone());
    ix.accounts[7].pubkey = program;
    assert_anchor_error(
        env.send(&[ix], &[&admin]),
        AnchorErrorCode::InvalidProgramId,
    );
    // `program_data` must be owned by the loader.
    let mut ix = ix::initialize(&admin.pubkey(), &mint, &program, args.clone());
    ix.accounts[8].pubkey = mint;
    assert_anchor_error(
        env.send(&[ix], &[&admin]),
        AnchorErrorCode::AccountOwnedByWrongProgram,
    );
    // The program account itself is not a ProgramData.
    let mut ix = ix::initialize(&admin.pubkey(), &mint, &program, args.clone());
    ix.accounts[8].pubkey = slana::ID;
    assert_anchor_error(
        env.send(&[ix], &[&admin]),
        AnchorErrorCode::AccountNotProgramData,
    );
    // A token program that is neither SPL Token nor Token-2022.
    let mut ix = ix::initialize(&admin.pubkey(), &mint, &program, args.clone());
    ix.accounts[4].pubkey = anchor_lang::solana_program::system_program::ID;
    assert_anchor_error(
        env.send(&[ix], &[&admin]),
        AnchorErrorCode::InvalidProgramId,
    );
    // The mint owned by SPL Token, the token program Token-2022: the treasury vault's
    // `InitializeAccount3` CPI into Token-2022 refuses the SPL Token mint (`IncorrectProgramId`).
    let token_2022 = anchor_spl::token_2022::ID;
    let ix = ix::initialize(&admin.pubkey(), &mint, &token_2022, args.clone());
    assert_instruction_error(
        env.send(&[ix], &[&admin]),
        InstructionError::IncorrectProgramId,
    );
    // A wrong config address.
    let mut ix = ix::initialize(&admin.pubkey(), &mint, &program, args.clone());
    ix.accounts[1].pubkey = Pubkey::new_unique();
    assert_anchor_error(env.send(&[ix], &[&admin]), AnchorErrorCode::ConstraintSeeds);
    // Missing system program.
    let mut ix = ix::initialize(&admin.pubkey(), &mint, &program, args.clone());
    ix.accounts.truncate(9);
    assert_anchor_error(
        env.send(&[ix], &[&admin]),
        AnchorErrorCode::AccountNotEnoughKeys,
    );
    assert!(env.try_fetch::<Config>(&config_pda()).is_none());
    assert_ok(env.initialize_as(&admin, &mint, &program, args));
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

/// Register → update → Pass join → finalize without a token account → collect → loot sweep →
/// sweep: every account the program writes decodes with the reference and re-serializes to
/// exactly the stored bytes, and every event is the reference's encoding.
#[test]
fn stake_flow_writes_reference_layouts_and_events() {
    use slana::{
        events::{
            ArenaJoined, ArenaSwept, LootSwept, PlayerRegistered, ProfileUpdated, SessionRefunded,
            SessionSettled,
        },
        state::{PassLock, PlayerProfile, Session},
    };
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, ENTRY_FEE, 300, false));

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
    let (_, asset) = env.give_pass(&player);
    let meta = assert_ok(env.join_with_pass(&alice, 1, &asset));
    let session_key = session_pda(&arena_pda(1), &player);
    let session = env.session(1, &player).expect("session");
    assert_event(
        &meta,
        &ArenaJoined {
            player,
            arena_id: 1,
            session_id: session.id,
            entry_fee: ENTRY_FEE,
            has_pass: true,
        },
    );
    let data = raw(&env, &session_key);
    assert_eq!(data.len(), 151);
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
            session.has_pass,
            session.pass_asset,
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
            true,
            asset,
            SETTLE_FEE_LAMPORTS,
            PASS_FEE_BPS,
            bump,
            false,
            0,
        )
    );
    assert_eq!(
        env.balance(&session_key),
        env.session_rent() + SETTLE_FEE_LAMPORTS
    );
    let lock_key = pass_lock_pda(&asset);
    let lock = env.pass_lock(&asset).expect("lock");
    let data = raw(&env, &lock_key);
    assert_eq!(data.len(), 8 + PassLock::INIT_SPACE);
    assert_eq!(data, serialize(&lock));
    let (_, lock_bump) =
        Pubkey::find_program_address(&[PASS_LOCK_SEED, asset.as_ref()], &slana::ID);
    assert_eq!(
        (lock.session, lock.player, lock.bump),
        (session_key, player, lock_bump)
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
            burned: 0,
            has_pass: true,
            score: 1_234,
            kills: 5,
            owed: ENTRY_FEE,
        },
    );
    let finalized = env.session(1, &player).expect("finalized session");
    assert_eq!(raw(&env, &session_key), serialize(&finalized));
    assert!(finalized.finalized);
    assert_eq!(finalized.owed, ENTRY_FEE);
    assert!(env.pass_lock(&asset).is_none());
    assert_eq!(raw(&env, &profile_key), serialize(&env.profile(&player)));
    let season = env.season(FIRST_SEASON);
    assert_eq!(raw(&env, &season_pda(FIRST_SEASON)), serialize(&season));
    assert_eq!(season.count, 1);
    assert_eq!(
        (
            season.entries[0].player,
            season.entries[0].points,
            season.entries[0].best_score
        ),
        (player, 1_234, 1_234)
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
        &LootSwept {
            arena_id: 1,
            season_id: FIRST_SEASON,
            amount: 23,
        },
    );
    assert_eq!(env.season(FIRST_SEASON).pool, 23);
    assert_eq!(
        raw(&env, &season_pda(FIRST_SEASON)),
        serialize(&env.season(FIRST_SEASON))
    );

    assert_ok(env.update_arena(1, Some(false), None, None, None));
    let meta = assert_ok(env.sweep(1));
    assert_event(
        &meta,
        &ArenaSwept {
            arena_id: 1,
            season_id: FIRST_SEASON,
            amount: 77,
        },
    );
    assert_eq!(env.season(FIRST_SEASON).pool, 100);
}

/// Anchor's duplicate-mutable and seeds checks on the arena instructions.
#[test]
fn stake_constraint_errors_match_anchor() {
    use anchor_lang::{InstructionData, ToAccountMetas};
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, ENTRY_FEE, 300, false));
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

    // settle: treasury and season vaults swapped → 2006.
    let session = env.session(1, &a.pubkey()).expect("session");
    let mut settle = ix::settle_session(
        &env.server.pubkey(),
        &a.pubkey(),
        1,
        FIRST_SEASON,
        slana::SettleArgs {
            session_id: session.id,
            payout: 0,
            score: 0,
            kills: 0,
            xp: 0,
        },
        None,
        Some(env.player_ata(&a.pubkey())),
        &mint,
        &program,
    );
    settle.accounts[9].pubkey = season_vault_pda();
    settle.accounts[10].pubkey = treasury_vault_pda();
    let server = env.server.insecure_clone();
    assert_anchor_error(
        env.send(&[settle.clone()], &[&server]),
        AnchorErrorCode::ConstraintSeeds,
    );
    // ... and the vault as the player's token account → 2040.
    settle.accounts[9].pubkey = treasury_vault_pda();
    settle.accounts[10].pubkey = season_vault_pda();
    settle.accounts[6].pubkey = vault;
    assert_anchor_error(
        env.send(&[settle], &[&server]),
        AnchorErrorCode::ConstraintDuplicateMutableAccount,
    );

    // sweep: the arena vault as the season vault → 2040.
    let mut sweep = ix::sweep_arena(&env.admin.pubkey(), 1, FIRST_SEASON, &mint, &program);
    sweep.accounts[5].pubkey = vault;
    let admin = env.admin.insecure_clone();
    assert_anchor_error(
        env.send(&[sweep], &[&admin]),
        AnchorErrorCode::ConstraintDuplicateMutableAccount,
    );

    // sweep_loot: the same → 2040; truncated `amount` → 102.
    let mut loot = ix::sweep_loot(&server.pubkey(), 1, FIRST_SEASON, 1, &mint, &program);
    loot.accounts[5].pubkey = vault;
    assert_anchor_error(
        env.send(&[loot], &[&server]),
        AnchorErrorCode::ConstraintDuplicateMutableAccount,
    );
    let mut loot = ix::sweep_loot(&server.pubkey(), 1, FIRST_SEASON, 1, &mint, &program);
    loot.data.truncate(8 + 7);
    assert_anchor_error(
        env.send(&[loot], &[&server]),
        AnchorErrorCode::InstructionDidNotDeserialize,
    );
}

/// Pass mint (sell-out), reveal, a missed entropy window and the capture: the `MintCounter`
/// and `Config` the program writes decode with the reference and re-serialize to the stored
/// bytes, and every Pass event matches the reference's `Event::data()`.
#[test]
fn pass_flow_writes_reference_layouts_and_events() {
    use slana::{
        events::{
            PassEntropyCaptured, PassEntropyRetargeted, PassMintEnded, PassMinted, PassRevealed,
            PassSeedRevealed,
        },
        state::MintCounter,
    };
    let seed = [7u8; 32];
    let mut env = TestEnv::initialized();
    load_mpl_core(&mut env.svm);
    let admin = env.admin.insecure_clone();
    let collection = env.create_core_collection(&pass_authority_pda());
    assert_ok(env.set_collection_as(&admin, &collection));
    assert_ok(env.set_seed_hash_as(&admin, solana_sha256_hasher::hash(&seed).to_bytes()));
    assert_ok(env.update_config(UpdateConfigArgs {
        pass_base_uri: Some("https://slana.example/pass/".into()),
        pass_supply: Some(1),
        pass_mint_open: Some(true),
        ..Default::default()
    }));

    let minter = env.funded_keypair(10 * SOL);
    let (res, asset) = env.mint_pass(&minter);
    let meta = assert_ok(res);
    assert_event(
        &meta,
        &PassMinted {
            minter: minter.pubkey(),
            asset,
            number: 1,
        },
    );
    // The only Pass of the supply: sold out.
    assert_event(&meta, &PassMintEnded { minted: 1 });
    let counter_key = mint_counter_pda(&minter.pubkey());
    let data = raw(&env, &counter_key);
    assert_eq!(data.len(), 8 + MintCounter::INIT_SPACE);
    let counter = env.mint_counter(&minter.pubkey()).expect("counter");
    assert_eq!(counter.count, 1);
    assert_eq!(data, serialize(&counter));

    env.warp_to_slot(5_000);
    let meta = assert_ok(env.reveal_as(&admin, seed));
    let target = 5_000 + ENTROPY_DELAY_SLOTS;
    assert_event(
        &meta,
        &PassSeedRevealed {
            seed,
            entropy_target_slot: target,
        },
    );

    let anyone = env.funded_keypair(SOL);
    let now = target + 700;
    env.warp_to_slot(now);
    env.slot_hashes_range(now - 512, now - 1);
    let meta = assert_ok(env.capture_entropy_as(&anyone));
    let next = now + ENTROPY_DELAY_SLOTS;
    assert_event(
        &meta,
        &PassEntropyRetargeted {
            missed_target_slot: target,
            entropy_target_slot: next,
        },
    );

    env.warp_to_slot(next + 3);
    env.slot_hashes_range(next - 5, next + 2);
    let meta = assert_ok(env.capture_entropy_as(&anyone));
    let entropy = [next as u8; 32];
    let final_seed = slana::logic::pass_final_seed(&seed, &entropy);
    assert_event(
        &meta,
        &PassEntropyCaptured {
            slot: next,
            entropy,
        },
    );
    assert_event(
        &meta,
        &PassRevealed {
            seed,
            entropy,
            final_seed,
        },
    );
    let config = env.config();
    assert!(config.pass_revealed && config.pass_entropy_captured);
    assert_eq!(config.pass_final_seed, final_seed);
    assert_eq!(raw(&env, &config_pda()), serialize(&config));
}
