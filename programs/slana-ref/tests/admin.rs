//! `initialize` (no token), `set_token_mint` (once, mint validation), `update_config`, and
//! the `TokenNotSet` gate of `create_arena` / `join_arena`.

mod common;

use {
    anchor_lang::{error::ErrorCode as AnchorErrorCode, prelude::Pubkey, Space},
    anchor_spl::token_2022::spl_token_2022::extension::ExtensionType,
    common::*,
    slana::{
        constants::*, error::SlanaError, events::TokenMintSet, state::Config, UpdateConfigArgs,
    },
    solana_signer::Signer,
};

/// Checks a freshly initialized config (no token yet).
fn assert_initialized_without_token(env: &TestEnv) {
    let config = env.config();
    assert_eq!(config.admin, env.admin.pubkey());
    assert_eq!(config.server_authority, env.server.pubkey());
    assert_eq!(config.fee_wallet, env.fee_wallet.pubkey());
    assert_eq!(config.token_mint, Pubkey::default());
    assert_eq!(config.token_program, Pubkey::default());
    assert_eq!(config.token_decimals, 0);
    assert_eq!(config.fee_bps, FEE_BPS);
    assert_eq!(config.settle_fee_lamports, SETTLE_FEE_LAMPORTS);
    assert!(!config.paused);
    assert_eq!(
        (
            config.total_players,
            config.total_games,
            config.total_sessions,
            config.total_staked,
            config.total_paid_out
        ),
        (0, 0, 0, 0, 0)
    );
}

#[test]
fn initialize_needs_no_mint() {
    let mut env = TestEnv::deployed();
    let admin = env.admin.insecure_clone();
    let args = env.default_init_args();
    let before = env.balance(&admin.pubkey());
    assert_ok(env.initialize_as(&admin, args.clone()));
    assert_initialized_without_token(&env);
    // The admin pays the config's rent only (fees are paid by the fee payer).
    assert_eq!(
        before - env.balance(&admin.pubkey()),
        env.rent(8 + Config::INIT_SPACE)
    );
    // A second initialize fails.
    assert_already_in_use(env.initialize_as(&admin, args));
}

#[test]
fn initialize_requires_upgrade_authority_and_valid_args() {
    let mut env = TestEnv::deployed();
    assert_eq!(upgrade_authority(&env.svm), Some(env.admin.pubkey()));
    let args = env.default_init_args();

    // Anyone but the upgrade authority is rejected.
    let mallory = env.funded_keypair(10 * SOL);
    assert_error(
        env.initialize_as(&mallory, args.clone()),
        SlanaError::Unauthorized,
    );
    assert!(env.try_fetch::<Config>(&config_pda()).is_none());

    // Invalid settings are rejected even for the upgrade authority.
    let admin = env.admin.insecure_clone();
    let mut bad = args.clone();
    bad.fee_bps = MAX_FEE_BPS + 1;
    assert_error(env.initialize_as(&admin, bad), SlanaError::InvalidFee);
    let mut bad = args.clone();
    bad.settle_fee_lamports = MAX_SETTLE_FEE_LAMPORTS + 1;
    assert_error(env.initialize_as(&admin, bad), SlanaError::InvalidFee);
    let mut bad = args.clone();
    bad.server_authority = Pubkey::default();
    assert_error(env.initialize_as(&admin, bad), SlanaError::InvalidAuthority);
    let mut bad = args.clone();
    bad.fee_wallet = Pubkey::default();
    assert_error(env.initialize_as(&admin, bad), SlanaError::InvalidAuthority);
    assert!(env.try_fetch::<Config>(&config_pda()).is_none());

    // The bounds themselves are accepted.
    let mut edge = args;
    edge.fee_bps = MAX_FEE_BPS;
    edge.settle_fee_lamports = MAX_SETTLE_FEE_LAMPORTS;
    assert_ok(env.initialize_as(&admin, edge));
    let config = env.config();
    assert_eq!(
        (config.fee_bps, config.settle_fee_lamports),
        (MAX_FEE_BPS, MAX_SETTLE_FEE_LAMPORTS)
    );
}

/// R27 regression: `initialize` only accepts this program's own ProgramData, even
/// when another program's ProgramData names the caller as upgrade authority.
#[test]
fn initialize_rejects_a_foreign_program_data() {
    use anchor_lang::solana_program::bpf_loader_upgradeable::{self, UpgradeableLoaderState};
    let mut env = TestEnv::deployed();
    let admin = env.admin.insecure_clone();
    let foreign = Pubkey::new_unique();
    let (foreign_data, _) =
        Pubkey::find_program_address(&[foreign.as_ref()], &bpf_loader_upgradeable::ID);
    let mut data = bincode::serialize(&UpgradeableLoaderState::ProgramData {
        slot: 0,
        upgrade_authority_address: Some(admin.pubkey()),
    })
    .expect("serialize ProgramData");
    data.extend_from_slice(&[0u8; 16]);
    write_raw_account(
        &mut env.svm,
        &foreign_data,
        bpf_loader_upgradeable::ID,
        data,
    );

    let mut ix = ix::initialize(&admin.pubkey(), env.default_init_args());
    ix.accounts[3].pubkey = foreign_data;
    assert_error(env.send(&[ix], &[&admin]), SlanaError::Unauthorized);
    assert!(env.try_fetch::<Config>(&config_pda()).is_none());
}

// ---------------------------------------------------------------------------------------
// set_token_mint
// ---------------------------------------------------------------------------------------

#[test]
fn set_token_mint_succeeds_once() {
    for kind in [MintKind::Spl, MintKind::Token2022Plain, MintKind::Token2022] {
        let mut env = TestEnv::initialized_without_token();
        let mint = env.create_mint(kind, None);
        let admin = env.admin.insecure_clone();
        let before = env.config();

        let meta = assert_ok(env.set_token_mint_as(&admin, &mint, &kind.program()));
        assert_event(
            &meta,
            &TokenMintSet {
                mint,
                token_program: kind.program(),
                decimals: DECIMALS,
            },
        );
        let config = env.config();
        assert_eq!(config.token_mint, mint, "{kind:?}");
        assert_eq!(config.token_program, kind.program());
        assert_eq!(config.token_decimals, DECIMALS);
        // Nothing else changes.
        assert_eq!(
            (config.admin, config.fee_wallet, config.fee_bps, config.bump),
            (before.admin, before.fee_wallet, before.fee_bps, before.bump)
        );

        // A second call fails, with the same mint or another one.
        assert_error(
            env.set_token_mint_as(&admin, &mint, &kind.program()),
            SlanaError::TokenAlreadySet,
        );
        let other = env.create_mint(MintKind::Spl, None);
        assert_error(
            env.set_token_mint_as(&admin, &other, &MintKind::Spl.program()),
            SlanaError::TokenAlreadySet,
        );
        assert_eq!(env.config().token_mint, mint);
    }
    // The plain Token-2022 mint really has no extension.
    let mut env = TestEnv::initialized_with(MintKind::Token2022Plain);
    assert!(env.mint_state(&env.mint).1.is_empty());
    assert_eq!(env.config().token_program, anchor_spl::token_2022::ID);
    // And the money path works with it.
    assert_ok(env.create_arena(1, 1_000, 300));
}

#[test]
fn set_token_mint_is_admin_only() {
    let mut env = TestEnv::initialized_without_token();
    let mint = env.create_mint(MintKind::Spl, None);
    let program = MintKind::Spl.program();
    let mallory = env.funded_keypair(SOL);
    assert_error(
        env.set_token_mint_as(&mallory, &mint, &program),
        SlanaError::Unauthorized,
    );
    // The server cannot either.
    let server = env.server.insecure_clone();
    assert_error(
        env.set_token_mint_as(&server, &mint, &program),
        SlanaError::Unauthorized,
    );
    assert_eq!(env.config().token_mint, Pubkey::default());
    let admin = env.admin.insecure_clone();
    assert_ok(env.set_token_mint_as(&admin, &mint, &program));
}

#[test]
fn set_token_mint_rejects_a_freezable_mint() {
    for kind in [MintKind::Spl, MintKind::Token2022] {
        let mut env = TestEnv::initialized_without_token();
        let freezer = env.admin.pubkey();
        let mint = env.create_mint(kind, Some(freezer));
        let admin = env.admin.insecure_clone();
        assert_error(
            env.set_token_mint_as(&admin, &mint, &kind.program()),
            SlanaError::FreezeAuthorityPresent,
        );
        assert_eq!(env.config().token_mint, Pubkey::default());
    }
}

#[test]
fn set_token_mint_rejects_denied_extensions() {
    for (kind, ext) in [
        (
            MintKind::Token2022TransferFee,
            ExtensionType::TransferFeeConfig,
        ),
        (
            MintKind::Token2022CloseAuthority,
            ExtensionType::MintCloseAuthority,
        ),
    ] {
        let mut env = TestEnv::initialized_without_token();
        let mint = env.create_mint(kind, None);
        assert_eq!(env.mint_state(&mint).1, vec![ext]);
        let admin = env.admin.insecure_clone();
        assert_error(
            env.set_token_mint_as(&admin, &mint, &kind.program()),
            SlanaError::MintNotAllowed,
        );
        assert_eq!(env.config().token_mint, Pubkey::default());
    }
}

#[test]
fn set_token_mint_checks_the_token_program() {
    let mut env = TestEnv::initialized_without_token();
    let mint = env.create_mint(MintKind::Spl, None);
    let admin = env.admin.insecure_clone();
    // An SPL Token mint with the Token-2022 program: `mint::token_program` (2022).
    assert_anchor_error(
        env.set_token_mint_as(&admin, &mint, &anchor_spl::token_2022::ID),
        AnchorErrorCode::ConstraintMintTokenProgram,
    );
    // A program that is no token program at all.
    assert_anchor_error(
        env.set_token_mint_as(
            &admin,
            &mint,
            &anchor_lang::solana_program::system_program::ID,
        ),
        AnchorErrorCode::InvalidProgramId,
    );
    // Something that is not a mint (the config itself).
    assert_anchor_error(
        env.set_token_mint_as(&admin, &config_pda(), &MintKind::Spl.program()),
        AnchorErrorCode::AccountOwnedByWrongProgram,
    );
    assert_eq!(env.config().token_mint, Pubkey::default());
}

// ---------------------------------------------------------------------------------------
// TokenNotSet
// ---------------------------------------------------------------------------------------

#[test]
fn create_arena_before_the_mint_fails_with_token_not_set() {
    for kind in [MintKind::Spl, MintKind::Token2022] {
        let mut env = TestEnv::initialized_without_token();
        // The admin passes the mint it is about to set: still refused.
        env.mint = env.create_mint(kind, None);
        env.token_program = kind.program();
        assert_error(env.create_arena(1, ENTRY_FEE, 300), SlanaError::TokenNotSet);
        assert!(env.svm.get_account(&arena_pda(1)).is_none());
        // Non-admins still get Unauthorized first.
        let mallory = env.funded_keypair(10 * SOL);
        assert_error(
            env.create_arena_as(&mallory, 1, ENTRY_FEE, 300),
            SlanaError::Unauthorized,
        );

        // Once the mint is set, the same call works.
        let (admin, mint) = (env.admin.insecure_clone(), env.mint);
        assert_ok(env.set_token_mint_as(&admin, &mint, &kind.program()));
        assert_ok(env.create_arena(1, ENTRY_FEE, 300));
    }
}

#[test]
fn join_arena_before_the_mint_fails_with_token_not_set() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, ENTRY_FEE, 300));
    let a = env.token_player("a", ENTRY_FEE);
    // Test-only state write: the config as it is before `set_token_mint`.
    let saved = env.config();
    let mut unset = saved.clone();
    unset.token_mint = Pubkey::default();
    unset.token_program = Pubkey::default();
    unset.token_decimals = 0;
    env.write_account(&config_pda(), &unset);

    assert_error(env.join(&a, 1), SlanaError::TokenNotSet);
    assert!(env.session(1, &a.pubkey()).is_none());
    assert_eq!(env.tokens(&env.player_ata(&a.pubkey())), ENTRY_FEE);

    env.write_account(&config_pda(), &saved);
    assert_ok(env.join(&a, 1));
}

// ---------------------------------------------------------------------------------------
// update_config
// ---------------------------------------------------------------------------------------

#[test]
fn update_config_validates() {
    let mut env = TestEnv::initialized();

    // Non-admins cannot.
    let mallory = env.funded_keypair(SOL);
    assert_error(
        env.update_config_as(
            &mallory,
            UpdateConfigArgs {
                paused: Some(true),
                ..Default::default()
            },
        ),
        SlanaError::Unauthorized,
    );

    // Fee bounds.
    assert_error(
        env.update_config(UpdateConfigArgs {
            fee_bps: Some(MAX_FEE_BPS + 1),
            ..Default::default()
        }),
        SlanaError::InvalidFee,
    );
    assert_ok(env.update_config(UpdateConfigArgs {
        fee_bps: Some(MAX_FEE_BPS),
        ..Default::default()
    }));
    assert_eq!(env.config().fee_bps, MAX_FEE_BPS);
    assert_ok(env.update_config(UpdateConfigArgs {
        fee_bps: Some(0),
        ..Default::default()
    }));
    assert_eq!(env.config().fee_bps, 0);

    // Settle deposit bound.
    assert_error(
        env.update_config(UpdateConfigArgs {
            settle_fee_lamports: Some(MAX_SETTLE_FEE_LAMPORTS + 1),
            ..Default::default()
        }),
        SlanaError::InvalidFee,
    );
    assert_ok(env.update_config(UpdateConfigArgs {
        settle_fee_lamports: Some(MAX_SETTLE_FEE_LAMPORTS),
        ..Default::default()
    }));
    assert_eq!(env.config().settle_fee_lamports, MAX_SETTLE_FEE_LAMPORTS);

    // Default keys are refused for every role.
    for args in [
        UpdateConfigArgs {
            admin: Some(Pubkey::default()),
            ..Default::default()
        },
        UpdateConfigArgs {
            server_authority: Some(Pubkey::default()),
            ..Default::default()
        },
        UpdateConfigArgs {
            fee_wallet: Some(Pubkey::default()),
            ..Default::default()
        },
    ] {
        assert_error(env.update_config(args), SlanaError::InvalidAuthority);
    }

    // Handing over the roles; the token mint never changes.
    let new_admin = env.funded_keypair(SOL);
    let new_server = env.funded_keypair(SOL);
    let new_fee_wallet = Pubkey::new_unique();
    assert_ok(env.update_config(UpdateConfigArgs {
        admin: Some(new_admin.pubkey()),
        server_authority: Some(new_server.pubkey()),
        fee_wallet: Some(new_fee_wallet),
        paused: Some(true),
        ..Default::default()
    }));
    let config = env.config();
    assert_eq!(config.admin, new_admin.pubkey());
    assert_eq!(config.server_authority, new_server.pubkey());
    assert_eq!(config.fee_wallet, new_fee_wallet);
    assert!(config.paused);
    assert_eq!(config.token_mint, env.mint);

    // The old admin lost its rights, the new one has them.
    let old_admin = env.admin.insecure_clone();
    assert_error(
        env.update_config_as(
            &old_admin,
            UpdateConfigArgs {
                paused: Some(false),
                ..Default::default()
            },
        ),
        SlanaError::Unauthorized,
    );
    assert_ok(env.update_config_as(
        &new_admin,
        UpdateConfigArgs {
            paused: Some(false),
            ..Default::default()
        },
    ));
    assert!(!env.config().paused);
}
