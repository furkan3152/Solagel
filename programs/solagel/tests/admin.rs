//! `initialize` and `update_config`.

mod common;

use {
    anchor_lang::Space,
    common::*,
    solagel::{constants::*, error::SolagelError, state::Config, UpdateConfigArgs},
    solana_signer::Signer,
};

#[test]
fn initialize_requires_upgrade_authority() {
    let mut env = TestEnv::deployed();
    assert_eq!(upgrade_authority(&env.svm), Some(env.admin.pubkey()));
    let args = env.default_init_args();

    // Anyone but the upgrade authority is rejected.
    let mallory = env.funded_keypair(10 * SOL);
    assert_error(
        env.initialize_as(&mallory, args.clone()),
        SolagelError::Unauthorized,
    );
    assert!(env.try_fetch::<Config>(&config_pda()).is_none());

    // Invalid fee settings are rejected even for the upgrade authority.
    let admin = env.admin.insecure_clone();
    let mut bad = args.clone();
    bad.fee_bps = MAX_FEE_BPS + 1;
    assert_error(env.initialize_as(&admin, bad), SolagelError::InvalidFee);
    let mut bad = args.clone();
    bad.season_share_bps = BPS + 1;
    assert_error(env.initialize_as(&admin, bad), SolagelError::InvalidFee);

    // The upgrade authority succeeds.
    let admin_before = env.balance(&admin.pubkey());
    assert_ok(env.initialize_as(&admin, args.clone()));

    let config = env.config();
    assert_eq!(config.admin, admin.pubkey());
    assert_eq!(config.server_authority, env.server.pubkey());
    assert_eq!(config.treasury, env.treasury.pubkey());
    assert_eq!(config.fee_bps, FEE_BPS);
    assert_eq!(config.season_share_bps, SEASON_SHARE_BPS);
    assert_eq!(config.skin_price, SKIN_PRICE);
    assert_eq!(config.current_season, 1);
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

    // Season 1 exists and is running.
    let season = env.season(1);
    assert_eq!(season.id, 1);
    assert_eq!(season.started_at, START_TS);
    assert_eq!(season.ended_at, 0);
    assert!(!season.finalized);
    assert_eq!(
        (season.count, season.claimed_mask, season.prize_pool),
        (0, 0, 0)
    );
    assert_eq!(env.prize_balance(1), 0);

    // The admin paid the rent of both accounts (fees are paid by the fee payer).
    let rent = env.rent(8 + Config::INIT_SPACE) + env.rent(8 + solagel::state::Season::INIT_SPACE);
    assert_eq!(admin_before - env.balance(&admin.pubkey()), rent);

    // A second initialize fails.
    assert_already_in_use(env.initialize_as(&admin, args));
}

#[test]
fn update_config_is_admin_only_and_validated() {
    let mut env = TestEnv::initialized();

    // The admin changes fee and pause flag; other fields stay untouched.
    assert_ok(env.update_config(UpdateConfigArgs {
        fee_bps: Some(250),
        paused: Some(true),
        ..Default::default()
    }));
    let config = env.config();
    assert_eq!(config.fee_bps, 250);
    assert!(config.paused);
    assert_eq!(config.season_share_bps, SEASON_SHARE_BPS);
    assert_eq!(config.skin_price, SKIN_PRICE);
    assert_eq!(config.admin, env.admin.pubkey());

    // Non-admins cannot.
    let mallory = env.funded_keypair(SOL);
    assert_error(
        env.update_config_as(
            &mallory,
            UpdateConfigArgs {
                paused: Some(false),
                ..Default::default()
            },
        ),
        SolagelError::Unauthorized,
    );

    // Fee bounds.
    assert_error(
        env.update_config(UpdateConfigArgs {
            fee_bps: Some(1_001),
            ..Default::default()
        }),
        SolagelError::InvalidFee,
    );
    assert_error(
        env.update_config(UpdateConfigArgs {
            season_share_bps: Some(10_001),
            ..Default::default()
        }),
        SolagelError::InvalidFee,
    );
    assert_ok(env.update_config(UpdateConfigArgs {
        fee_bps: Some(1_000),
        season_share_bps: Some(10_000),
        ..Default::default()
    }));
    let config = env.config();
    assert_eq!((config.fee_bps, config.season_share_bps), (1_000, 10_000));
    assert!(config.paused);

    // Handing over every role at once.
    let new_admin = env.funded_keypair(SOL);
    let new_server = env.funded_keypair(SOL);
    let new_treasury = env.funded_keypair(SOL);
    assert_ok(env.update_config(UpdateConfigArgs {
        admin: Some(new_admin.pubkey()),
        server_authority: Some(new_server.pubkey()),
        treasury: Some(new_treasury.pubkey()),
        skin_price: Some(1),
        paused: Some(false),
        ..Default::default()
    }));
    let config = env.config();
    assert_eq!(config.admin, new_admin.pubkey());
    assert_eq!(config.server_authority, new_server.pubkey());
    assert_eq!(config.treasury, new_treasury.pubkey());
    assert_eq!(config.skin_price, 1);
    assert!(!config.paused);

    // The old admin lost its rights, the new one has them.
    let old_admin = env.admin.insecure_clone();
    assert_error(
        env.update_config_as(
            &old_admin,
            UpdateConfigArgs {
                paused: Some(true),
                ..Default::default()
            },
        ),
        SolagelError::Unauthorized,
    );
    assert_ok(env.update_config_as(
        &new_admin,
        UpdateConfigArgs {
            paused: Some(true),
            ..Default::default()
        },
    ));
    assert!(env.config().paused);
}
