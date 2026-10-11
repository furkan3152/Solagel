//! Runtime and account-validation boundaries that a smaller implementation must preserve.
//! These execute the same deployed SBF artifact as the existing lifecycle tests.

mod common;

use {
    anchor_lang::{
        error::ErrorCode as AnchorErrorCode,
        prelude::{Pubkey, Rent},
        solana_program::system_program,
        AccountSerialize, Space,
    },
    common::*,
    solagel::{
        constants::*,
        error::SolagelError,
        state::{Arena, Config, PlayerProfile, Season},
        RecordArgs, SettleArgs, UpdateConfigArgs,
    },
    solana_signer::Signer,
};

type AccountSnapshot = (Pubkey, Option<(u64, Vec<u8>, Pubkey, bool)>);

fn snapshot(env: &TestEnv, keys: &[Pubkey]) -> Vec<AccountSnapshot> {
    keys.iter()
        .map(|key| {
            (
                *key,
                env.svm.get_account(key).map(|account| {
                    (
                        account.lamports,
                        account.data,
                        account.owner,
                        account.executable,
                    )
                }),
            )
        })
        .collect()
}

fn assert_unchanged(env: &TestEnv, before: &[AccountSnapshot]) {
    let keys: Vec<Pubkey> = before.iter().map(|entry| entry.0).collect();
    assert_eq!(snapshot(env, &keys), before);
}

fn funded_life() -> (TestEnv, solana_keypair::Keypair) {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 100_000_000, 10));
    let player = env.new_player("alice");
    assert_ok(env.join(&player, 1));
    (env, player)
}

fn settlement(
    env: &TestEnv,
    player: &Pubkey,
    payout: u64,
) -> anchor_lang::solana_program::instruction::Instruction {
    ix::settle_session(
        &env.server.pubkey(),
        player,
        1,
        env.config().current_season,
        &env.config().treasury,
        SettleArgs {
            session_id: env.session(1, player).unwrap().id,
            payout,
            score: 10,
            kills: 1,
            xp: 2,
        },
    )
}

fn liability_keys(env: &TestEnv, player: &Pubkey) -> Vec<Pubkey> {
    vec![
        config_pda(),
        arena_pda(1),
        session_pda(&arena_pda(1), player),
        profile_pda(player),
        season_pda(env.config().current_season),
        *player,
        env.config().treasury,
    ]
}

#[test]
fn prefunded_system_pdas_initialize_without_losing_existing_lamports() {
    let mut env = TestEnv::deployed();
    let config_rent = env.rent(8 + Config::INIT_SPACE);
    let season_rent = env.rent(8 + Season::INIT_SPACE);
    env.airdrop(&config_pda(), config_rent + 17);
    env.airdrop(&season_pda(1), season_rent + 23);
    let admin = env.admin.insecure_clone();
    let admin_before = env.balance(&admin.pubkey());
    assert_ok(env.initialize_as(&admin, env.default_init_args()));
    assert_eq!(env.balance(&admin.pubkey()), admin_before);
    assert_eq!(env.balance(&config_pda()), config_rent + 17);
    assert_eq!(env.prize_balance(1), 23);

    let player = env.funded_keypair(10 * SOL);
    let profile = profile_pda(&player.pubkey());
    let profile_rent = env.rent(8 + PlayerProfile::INIT_SPACE);
    env.airdrop(&profile, profile_rent + 31);
    let before = env.balance(&player.pubkey());
    assert_ok(env.register(&player, "prefunded", 0));
    assert_eq!(env.balance(&player.pubkey()), before);
    assert_eq!(env.balance(&profile), profile_rent + 31);

    assert_ok(env.create_arena(1, MIN_BUY_IN, 10));
    let session = session_pda(&arena_pda(1), &player.pubkey());
    let prefund = env.session_rent() + 47;
    env.airdrop(&session, prefund);
    let before = env.balance(&player.pubkey());
    assert_ok(env.join(&player, 1));
    assert_eq!(before - env.balance(&player.pubkey()), MIN_BUY_IN);
    assert_eq!(env.balance(&session), prefund);
    assert_eq!(env.pot(1), MIN_BUY_IN);
    assert_eq!(env.config().total_sessions, 1);
    assert_eq!(env.config().total_staked, MIN_BUY_IN);
    env.warp(SESSION_REFUND_TIMEOUT_SECS);
    assert_ok(env.refund(&player, 1));
    assert_eq!(env.balance(&player.pubkey()), before + prefund);
    assert_eq!(env.balance(&session), 0);
    assert_eq!(env.pot(1), 0);
}

#[test]
fn privileged_and_exit_instructions_require_actual_signatures() {
    let (mut env, player) = funded_life();
    let server = env.server.pubkey();
    let session_id = env.session(1, &player.pubkey()).unwrap().id;
    let mut instructions = vec![
        ix::update_config(
            &env.admin.pubkey(),
            UpdateConfigArgs {
                paused: Some(true),
                ..Default::default()
            },
        ),
        ix::activate_session(&server, &player.pubkey(), 1, session_id),
        settlement(&env, &player.pubkey(), 100_000_000),
        ix::refund_session(&player.pubkey(), 1),
        ix::claim_season_reward(&player.pubkey(), 1),
    ];
    let before = snapshot(&env, &liability_keys(&env, &player.pubkey()));
    for instruction in &mut instructions {
        instruction.accounts[0].is_signer = false;
        assert_anchor_error(
            env.send(std::slice::from_ref(instruction), &[]),
            AnchorErrorCode::AccountNotSigner,
        );
        assert_unchanged(&env, &before);
    }
}

#[test]
fn settlement_requires_writable_accounts_and_rejects_duplicate_typed_aliases() {
    let (mut env, player) = funded_life();
    let server = env.server.insecure_clone();
    let before = snapshot(&env, &liability_keys(&env, &player.pubkey()));
    let mut readonly = settlement(&env, &player.pubkey(), 100_000_000);
    readonly.accounts[2].is_writable = false;
    assert_anchor_error(
        env.send(&[readonly], &[&server]),
        AnchorErrorCode::ConstraintMut,
    );
    assert_unchanged(&env, &before);

    let mut aliased = settlement(&env, &player.pubkey(), 100_000_000);
    aliased.accounts[2].pubkey = config_pda();
    assert!(
        env.send(&[aliased], &[&server]).is_err(),
        "config must not serve as the arena vault"
    );
    assert_unchanged(&env, &before);
}

#[test]
fn stored_owner_discriminator_and_pda_are_independent_security_checks() {
    let mut env = TestEnv::initialized();
    let admin = env.admin.insecure_clone();
    let instruction = ix::update_config(
        &admin.pubkey(),
        UpdateConfigArgs {
            paused: Some(true),
            ..Default::default()
        },
    );
    let original = env.svm.get_account(&config_pda()).unwrap();

    let mut wrong_owner = original.clone();
    wrong_owner.owner = system_program::ID;
    env.svm.set_account(config_pda(), wrong_owner).unwrap();
    assert_anchor_error(
        env.send(std::slice::from_ref(&instruction), &[&admin]),
        AnchorErrorCode::AccountOwnedByWrongProgram,
    );

    let mut wrong_type = original.clone();
    wrong_type.data[..8].fill(0);
    env.svm.set_account(config_pda(), wrong_type).unwrap();
    assert_anchor_error(
        env.send(std::slice::from_ref(&instruction), &[&admin]),
        AnchorErrorCode::AccountDiscriminatorMismatch,
    );

    env.svm.set_account(config_pda(), original.clone()).unwrap();
    let impostor = Pubkey::new_unique();
    env.svm.set_account(impostor, original.clone()).unwrap();
    let mut wrong_seed = instruction;
    wrong_seed.accounts[1].pubkey = impostor;
    assert_anchor_error(
        env.send(&[wrong_seed], &[&admin]),
        AnchorErrorCode::ConstraintSeeds,
    );
    assert_eq!(env.svm.get_account(&config_pda()).unwrap(), original);
    assert_eq!(env.svm.get_account(&impostor).unwrap(), original);
}

#[test]
fn system_program_substitution_cannot_move_money_or_create_a_ticket() {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, MIN_BUY_IN, 10));
    let player = env.new_player("alice");
    let mut instruction = ix::join_arena(&player.pubkey(), 1);
    instruction.accounts[5].pubkey = solagel::ID;
    let before = snapshot(&env, &liability_keys(&env, &player.pubkey()));
    assert_anchor_error(
        env.send(&[instruction], &[&player]),
        AnchorErrorCode::InvalidProgramId,
    );
    assert_unchanged(&env, &before);
}

#[test]
fn initialization_rejects_forged_programdata_and_rolls_back_created_accounts() {
    let mut env = TestEnv::deployed();
    let admin = env.admin.insecure_clone();
    let programdata = env.svm.get_account(&program_data_pda()).unwrap();
    let impostor = Pubkey::new_unique();
    env.svm.set_account(impostor, programdata.clone()).unwrap();
    let before = snapshot(&env, &[admin.pubkey(), config_pda(), season_pda(1)]);

    // A real loader-owned ProgramData copy is not this executable's ProgramData.
    let mut wrong_address = ix::initialize(&admin.pubkey(), env.default_init_args());
    wrong_address.accounts[4].pubkey = impostor;
    assert_error(
        env.send(&[wrong_address], &[&admin]),
        SolagelError::Unauthorized,
    );
    assert_unchanged(&env, &before);

    // Correct bytes at the expected address do not bypass the loader ownership check.
    let mut wrong_owner = programdata;
    wrong_owner.owner = system_program::ID;
    env.svm
        .set_account(program_data_pda(), wrong_owner)
        .unwrap();
    assert_anchor_error(
        env.initialize_as(&admin, env.default_init_args()),
        AnchorErrorCode::AccountOwnedByWrongProgram,
    );
    assert_unchanged(&env, &before);
}

#[test]
fn a_previous_season_cannot_receive_new_results_funding_or_settlements() {
    let (mut env, player) = funded_life();
    assert_ok(env.end_season());
    let server = env.server.insecure_clone();
    let mut settle = settlement(&env, &player.pubkey(), 100_000_000);
    settle.accounts[6].pubkey = season_pda(1);
    let record = ix::record_game(
        &server.pubkey(),
        &player.pubkey(),
        1,
        RecordArgs {
            score: 100,
            kills: 1,
            xp: 10,
        },
    );
    let fund = ix::fund_season(&player.pubkey(), 1, SOL);
    let mut keys = liability_keys(&env, &player.pubkey());
    keys.push(season_pda(1));
    let before = snapshot(&env, &keys);
    assert_anchor_error(
        env.send(&[settle], &[&server]),
        AnchorErrorCode::ConstraintSeeds,
    );
    assert_anchor_error(
        env.send(&[record], &[&server]),
        AnchorErrorCode::ConstraintSeeds,
    );
    assert_anchor_error(
        env.send(&[fund], &[&player]),
        AnchorErrorCode::ConstraintSeeds,
    );
    assert_unchanged(&env, &before);
    assert_ok(env.settle(&player.pubkey(), 1, 100_000_000, 100, 1, 10));
    assert_eq!(env.pot(1), 0);
    assert!(env.session(1, &player.pubkey()).is_none());
}

#[test]
fn allowed_treasury_aliases_conserve_lamports_through_credit_and_close() {
    for treasury_is_session in [false, true] {
        let (mut env, player) = funded_life();
        let session = session_pda(&arena_pda(1), &player.pubkey());
        let treasury = if treasury_is_session {
            session
        } else {
            season_pda(1)
        };
        assert_ok(env.update_config(UpdateConfigArgs {
            treasury: Some(treasury),
            ..Default::default()
        }));
        env.airdrop(&arena_pda(1), 50_000_000);
        let player_before = env.balance(&player.pubkey());
        let season_before = env.balance(&season_pda(1));
        let session_rent = env.balance(&session);
        assert_ok(env.settle(&player.pubkey(), 1, 150_000_000, 10, 1, 2));
        let player_gain = env.balance(&player.pubkey()) - player_before;
        let season_gain = env.balance(&season_pda(1)) - season_before;
        assert_eq!(
            player_gain,
            147_500_000 + session_rent + if treasury_is_session { 1_250_000 } else { 0 }
        );
        assert_eq!(
            season_gain,
            if treasury_is_session {
                1_250_000
            } else {
                2_500_000
            }
        );
        assert_eq!(player_gain + season_gain, 150_000_000 + session_rent);
        assert_eq!(env.pot(1), 0);
        assert_eq!(env.balance(&session), 0);
    }
}

#[test]
fn a_late_settlement_error_rolls_back_every_money_move_and_preserves_the_claim() {
    let (mut env, player) = funded_life();
    let mut config = env.config();
    config.total_games = u64::MAX;
    let mut account = env.svm.get_account(&config_pda()).unwrap();
    config
        .try_serialize(&mut account.data.as_mut_slice())
        .unwrap();
    env.svm.set_account(config_pda(), account).unwrap();
    let before = snapshot(&env, &liability_keys(&env, &player.pubkey()));
    assert_error(
        env.settle(&player.pubkey(), 1, 100_000_000, 1, 0, 0),
        SolagelError::MathOverflow,
    );
    assert_unchanged(&env, &before);
    assert_eq!(env.arena(1).open_sessions, 1);
}

#[test]
fn account_creation_and_vault_exits_use_runtime_rent() {
    let mut env = TestEnv::deployed();
    // The harness and Anchor use different Rust Rent versions but the same sysvar ABI.
    let rent = Rent::with_lamports_per_byte(13_920);
    let rent_address: Pubkey = "SysvarRent111111111111111111111111111111111"
        .parse()
        .unwrap();
    let mut rent_account = env.svm.get_account(&rent_address).unwrap();
    rent_account.data = bincode::serialize(&rent).unwrap();
    env.svm.set_account(rent_address, rent_account).unwrap();
    let admin = env.admin.insecure_clone();
    assert_ok(env.initialize_as(&admin, env.default_init_args()));
    assert_ok(env.create_arena(1, MIN_BUY_IN, 10));
    let arena_minimum = rent.minimum_balance(8 + Arena::INIT_SPACE);
    assert_eq!(env.balance(&arena_pda(1)), arena_minimum);
    let player = env.new_player("alice");
    assert_ok(env.join(&player, 1));
    assert_ok(env.settle(&player.pubkey(), 1, MIN_BUY_IN, 1, 0, 0));
    assert_eq!(env.balance(&arena_pda(1)), arena_minimum);
    assert_eq!(
        env.balance(&season_pda(1)),
        rent.minimum_balance(8 + Season::INIT_SPACE)
    );
}
