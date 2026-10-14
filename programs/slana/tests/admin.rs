//! `initialize` (mint validation, vaults), `update_config` and `withdraw_treasury`.

mod common;

use {
    anchor_lang::{error::ErrorCode as AnchorErrorCode, Space},
    anchor_spl::token_2022::spl_token_2022::extension::ExtensionType,
    common::*,
    slana::{constants::*, error::SlanaError, state::Config, UpdateConfigArgs},
    solana_signer::Signer,
};

/// Checks a freshly initialized config and both vaults for a mint of `kind`.
fn assert_initialized(env: &TestEnv, kind: MintKind) {
    let config = env.config();
    assert_eq!(config.admin, env.admin.pubkey());
    assert_eq!(config.server_authority, env.server.pubkey());
    assert_eq!(config.token_mint, env.mint);
    assert_eq!(config.token_program, kind.program());
    assert_eq!(config.token_decimals, DECIMALS);
    assert_eq!(
        (
            config.fee_bps,
            config.pass_fee_bps,
            config.treasury_bps,
            config.season_bps,
            config.burn_bps
        ),
        (FEE_BPS, PASS_FEE_BPS, TREASURY_BPS, SEASON_BPS, BURN_BPS)
    );
    assert_eq!(config.settle_fee_lamports, SETTLE_FEE_LAMPORTS);
    assert_eq!(config.current_season, FIRST_SEASON);
    assert!(!config.paused);
    assert_eq!(config.pass_collection, Default::default());
    assert_eq!(config.pass_base_uri_len, 0);
    assert_eq!(config.pass_supply, DEFAULT_PASS_SUPPLY);
    assert_eq!(config.pass_per_wallet, DEFAULT_PASS_PER_WALLET);
    assert_eq!(config.pass_minted, 0);
    assert_eq!(config.pass_min_tokens, 0);
    assert!(!config.pass_mint_open);
    assert!(!config.pass_revealed);
    assert_eq!(config.pass_seed_hash, [0; 32]);

    // Both vaults are token accounts of the game mint, owned by the token program, with the
    // config PDA as authority.
    for vault in [treasury_vault_pda(), season_vault_pda()] {
        assert_eq!(env.owner_of(&vault), kind.program());
        let account = env.token_account(&vault);
        assert_eq!(account.mint, env.mint);
        assert_eq!(account.owner, config_pda());
        assert_eq!(account.amount, 0);
        assert!(account.delegate.is_none());
        assert!(account.close_authority.is_none());
    }

    // Season 1 exists and is running.
    let season = env.season(FIRST_SEASON);
    assert_eq!(season.id, FIRST_SEASON);
    assert_eq!(season.started_at, START_TS);
    assert!(!season.finalized);
}

#[test]
fn initialize_with_spl_mint() {
    let env = TestEnv::initialized_with(MintKind::Spl);
    assert_initialized(&env, MintKind::Spl);
}

#[test]
fn initialize_with_token2022_mint() {
    let env = TestEnv::initialized_with(MintKind::Token2022);
    // The MetadataPointer extension is allowed.
    assert_eq!(
        env.mint_state(&env.mint).1,
        vec![ExtensionType::MetadataPointer]
    );
    assert_initialized(&env, MintKind::Token2022);
}

#[test]
fn initialize_rejects_freezable_mint() {
    for kind in [MintKind::Spl, MintKind::Token2022] {
        let mut env = TestEnv::deployed();
        let freezer = env.admin.pubkey();
        let mint = env.create_mint(kind, Some(freezer));
        let admin = env.admin.insecure_clone();
        let args = env.default_init_args();
        assert_error(
            env.initialize_as(&admin, &mint, &kind.program(), args),
            SlanaError::FreezeAuthorityPresent,
        );
        assert!(env.try_fetch::<Config>(&config_pda()).is_none());
    }
}

#[test]
fn initialize_rejects_transfer_fee_mint() {
    let mut env = TestEnv::deployed();
    let kind = MintKind::Token2022TransferFee;
    let mint = env.create_mint(kind, None);
    assert_eq!(
        env.mint_state(&mint).1,
        vec![ExtensionType::TransferFeeConfig]
    );
    let admin = env.admin.insecure_clone();
    let args = env.default_init_args();
    assert_error(
        env.initialize_as(&admin, &mint, &kind.program(), args),
        SlanaError::MintNotAllowed,
    );
    assert!(env.try_fetch::<Config>(&config_pda()).is_none());
}

#[test]
fn initialize_rejects_mint_close_authority() {
    let mut env = TestEnv::deployed();
    let kind = MintKind::Token2022CloseAuthority;
    let mint = env.create_mint(kind, None);
    assert_eq!(
        env.mint_state(&mint).1,
        vec![ExtensionType::MintCloseAuthority]
    );
    let admin = env.admin.insecure_clone();
    let args = env.default_init_args();
    assert_error(
        env.initialize_as(&admin, &mint, &kind.program(), args),
        SlanaError::MintNotAllowed,
    );
    assert!(env.try_fetch::<Config>(&config_pda()).is_none());
}

#[test]
fn initialize_requires_upgrade_authority() {
    let mut env = TestEnv::deployed();
    assert_eq!(upgrade_authority(&env.svm), Some(env.admin.pubkey()));
    let mint = env.create_mint(MintKind::Spl, None);
    env.mint = mint;
    let program = MintKind::Spl.program();
    let args = env.default_init_args();

    // Anyone but the upgrade authority is rejected.
    let mallory = env.funded_keypair(10 * SOL);
    assert_error(
        env.initialize_as(&mallory, &mint, &program, args.clone()),
        SlanaError::Unauthorized,
    );
    assert!(env.try_fetch::<Config>(&config_pda()).is_none());

    // Invalid fee settings are rejected even for the upgrade authority.
    let admin = env.admin.insecure_clone();
    let mut bad = args.clone();
    bad.fee_bps = MAX_FEE_BPS + 1;
    assert_error(
        env.initialize_as(&admin, &mint, &program, bad),
        SlanaError::InvalidFee,
    );
    let mut bad = args.clone();
    bad.pass_fee_bps = FEE_BPS + 1;
    assert_error(
        env.initialize_as(&admin, &mint, &program, bad),
        SlanaError::InvalidFee,
    );
    let mut bad = args.clone();
    bad.settle_fee_lamports = MAX_SETTLE_FEE_LAMPORTS + 1;
    assert_error(
        env.initialize_as(&admin, &mint, &program, bad),
        SlanaError::InvalidFee,
    );
    let mut bad = args.clone();
    bad.burn_bps += 1;
    assert_error(
        env.initialize_as(&admin, &mint, &program, bad),
        SlanaError::BadSplit,
    );

    // The upgrade authority succeeds and pays the rent of the config, season 1 and both
    // vaults (fees are paid by the fee payer).
    let admin_before = env.balance(&admin.pubkey());
    assert_ok(env.initialize_as(&admin, &mint, &program, args.clone()));
    assert_initialized(&env, MintKind::Spl);
    let config = env.config();
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
    let vault_rent = env.balance(&treasury_vault_pda()) + env.balance(&season_vault_pda());
    let rent = env.rent(8 + Config::INIT_SPACE)
        + env.rent(8 + slana::state::Season::INIT_SPACE)
        + vault_rent;
    assert_eq!(admin_before - env.balance(&admin.pubkey()), rent);

    // A second initialize fails.
    assert_already_in_use(env.initialize_as(&admin, &mint, &program, args));
}

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

    // Split must sum to 10 000.
    assert_error(
        env.update_config(UpdateConfigArgs {
            split: Some([5_000, 3_000, 1_999]),
            ..Default::default()
        }),
        SlanaError::BadSplit,
    );
    assert_error(
        env.update_config(UpdateConfigArgs {
            split: Some([10_000, 1, 0]),
            ..Default::default()
        }),
        SlanaError::BadSplit,
    );
    assert_error(
        env.update_config(UpdateConfigArgs {
            split: Some([u16::MAX, u16::MAX, 2]),
            ..Default::default()
        }),
        SlanaError::BadSplit,
    );
    assert_ok(env.update_config(UpdateConfigArgs {
        split: Some([0, 10_000, 0]),
        ..Default::default()
    }));
    let config = env.config();
    assert_eq!(
        (config.treasury_bps, config.season_bps, config.burn_bps),
        (0, 10_000, 0)
    );

    // Fee bounds.
    assert_error(
        env.update_config(UpdateConfigArgs {
            fee_bps: Some(MAX_FEE_BPS + 1),
            ..Default::default()
        }),
        SlanaError::InvalidFee,
    );
    assert_error(
        env.update_config(UpdateConfigArgs {
            pass_fee_bps: Some(FEE_BPS + 1),
            ..Default::default()
        }),
        SlanaError::InvalidFee,
    );
    // Lowering the fee below the stored pass fee is rejected too.
    assert_error(
        env.update_config(UpdateConfigArgs {
            fee_bps: Some(PASS_FEE_BPS - 1),
            ..Default::default()
        }),
        SlanaError::InvalidFee,
    );
    assert_ok(env.update_config(UpdateConfigArgs {
        fee_bps: Some(100),
        pass_fee_bps: Some(100),
        ..Default::default()
    }));
    assert_ok(env.update_config(UpdateConfigArgs {
        fee_bps: Some(MAX_FEE_BPS),
        pass_fee_bps: Some(0),
        ..Default::default()
    }));
    let config = env.config();
    assert_eq!((config.fee_bps, config.pass_fee_bps), (MAX_FEE_BPS, 0));

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

    // Base URI.
    let too_long = "x".repeat(usize::from(MAX_BASE_URI_LEN) + 1);
    assert_error(
        env.update_config(UpdateConfigArgs {
            pass_base_uri: Some(too_long),
            ..Default::default()
        }),
        SlanaError::BadBaseUri,
    );
    let uri = "https://slana.example/pass/";
    assert_ok(env.update_config(UpdateConfigArgs {
        pass_base_uri: Some(uri.to_string()),
        ..Default::default()
    }));
    let config = env.config();
    assert_eq!(
        &config.pass_base_uri[..usize::from(config.pass_base_uri_len)],
        uri.as_bytes()
    );
    let max_uri = "y".repeat(usize::from(MAX_BASE_URI_LEN));
    assert_ok(env.update_config(UpdateConfigArgs {
        pass_base_uri: Some(max_uri.clone()),
        ..Default::default()
    }));
    assert_eq!(usize::from(env.config().pass_base_uri_len), max_uri.len());

    // Pass mint parameters.
    assert_error(
        env.update_config(UpdateConfigArgs {
            pass_supply: Some(MAX_PASS_SUPPLY + 1),
            ..Default::default()
        }),
        SlanaError::InvalidAmount,
    );
    assert_error(
        env.update_config(UpdateConfigArgs {
            pass_per_wallet: Some(MAX_PASS_PER_WALLET + 1),
            ..Default::default()
        }),
        SlanaError::InvalidAmount,
    );
    assert_ok(env.update_config(UpdateConfigArgs {
        pass_supply: Some(MAX_PASS_SUPPLY),
        pass_per_wallet: Some(MAX_PASS_PER_WALLET),
        pass_min_tokens: Some(5 * TOKEN),
        pass_mint_open: Some(true),
        pass_mint_start_ts: Some(START_TS + 60),
        ..Default::default()
    }));
    let config = env.config();
    assert_eq!(config.pass_supply, MAX_PASS_SUPPLY);
    assert_eq!(config.pass_per_wallet, MAX_PASS_PER_WALLET);
    assert_eq!(config.pass_min_tokens, 5 * TOKEN);
    assert!(config.pass_mint_open);
    assert_eq!(config.pass_mint_start_ts, START_TS + 60);

    // After a Pass is minted (test-only state write) the base URI is frozen and the supply
    // cannot drop below the minted count.
    let mut config = env.config();
    config.pass_minted = 5;
    env.write_account(&config_pda(), &config);
    assert_error(
        env.update_config(UpdateConfigArgs {
            pass_base_uri: Some("https://other.example/".to_string()),
            ..Default::default()
        }),
        SlanaError::BadBaseUri,
    );
    assert_error(
        env.update_config(UpdateConfigArgs {
            pass_supply: Some(4),
            ..Default::default()
        }),
        SlanaError::InvalidAmount,
    );
    assert_ok(env.update_config(UpdateConfigArgs {
        pass_supply: Some(5),
        ..Default::default()
    }));
    assert_eq!(env.config().pass_supply, 5);

    // Handing over the roles; the token mint never changes.
    let new_admin = env.funded_keypair(SOL);
    let new_server = env.funded_keypair(SOL);
    assert_ok(env.update_config(UpdateConfigArgs {
        admin: Some(new_admin.pubkey()),
        server_authority: Some(new_server.pubkey()),
        paused: Some(true),
        ..Default::default()
    }));
    let config = env.config();
    assert_eq!(config.admin, new_admin.pubkey());
    assert_eq!(config.server_authority, new_server.pubkey());
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

#[test]
fn withdraw_treasury_admin_only() {
    for kind in [MintKind::Spl, MintKind::Token2022] {
        let mut env = TestEnv::initialized_with(kind);
        let admin = env.admin.insecure_clone();
        let treasury = treasury_vault_pda();
        // Pre-fund the treasury vault (mint-to needs only the mint authority).
        env.mint_to(&treasury, 1_000 * TOKEN);
        let admin_ata = env.create_ata(&admin.pubkey());

        // Non-admins cannot withdraw, not even into their own account.
        let mallory = env.funded_keypair(SOL);
        let mallory_ata = env.create_ata(&mallory.pubkey());
        assert_error(
            env.withdraw_treasury_as(&mallory, &mallory_ata, TOKEN),
            SlanaError::Unauthorized,
        );

        // Zero and more than the balance are rejected.
        assert_error(
            env.withdraw_treasury_as(&admin, &admin_ata, 0),
            SlanaError::InvalidAmount,
        );
        assert_error(
            env.withdraw_treasury_as(&admin, &admin_ata, 1_000 * TOKEN + 1),
            SlanaError::InsufficientPot,
        );

        // A destination of another mint is rejected.
        let other_mint = env.create_mint(kind, None);
        let other_ata = ata(&admin.pubkey(), &other_mint, &kind.program());
        let payer = env.payer.pubkey();
        assert_ok(env.send(
            &[anchor_spl::associated_token::spl_associated_token_account::instruction::create_associated_token_account(
                &payer,
                &admin.pubkey(),
                &other_mint,
                &kind.program(),
            )],
            &[],
        ));
        assert_anchor_error(
            env.withdraw_treasury_as(&admin, &other_ata, TOKEN),
            AnchorErrorCode::ConstraintTokenMint,
        );

        // The admin withdraws to any account of the game mint (here its own ATA, then
        // mallory's).
        assert_ok(env.withdraw_treasury_as(&admin, &admin_ata, 400 * TOKEN));
        assert_eq!(env.token_account(&admin_ata).amount, 400 * TOKEN);
        assert_eq!(env.token_account(&treasury).amount, 600 * TOKEN);
        assert_ok(env.withdraw_treasury_as(&admin, &mallory_ata, 600 * TOKEN));
        assert_eq!(env.token_account(&mallory_ata).amount, 600 * TOKEN);
        assert_eq!(env.token_account(&treasury).amount, 0);
    }
}
