//! Account creation under both Rent sysvar shapes, and PDAs that were pre-funded before init.
//!
//! * SIMD-0194 sets `exemption_threshold` to 1.0 (with a doubled per-byte rate) where the
//!   legacy cluster has 2.0. The reference computes the minimum with solana-rent; the lean
//!   program reads the sysvar bytes and multiplies by 2 only for exactly 2.0. Each init path
//!   (register_player → profile, join → session, mint_pass → mint counter) must fund exactly
//!   `(len + 128) × lamports_per_byte × threshold` under both, for both builds. The per-byte
//!   rate under 1.0 is chosen so a wrong factor would show.
//! * Anyone can send lamports to a PDA before it exists; `init` then tops it up, allocates and
//!   assigns instead of `CreateAccount` (profile via register_player, session via join).

mod common;

use {
    anchor_lang::{prelude::Pubkey, solana_program::system_program, Space},
    common::*,
    slana::{
        state::{MintCounter, PlayerProfile, Session},
        UpdateConfigArgs,
    },
    solana_keypair::Keypair,
    solana_rent::Rent,
    solana_sha256_hasher::hash,
    solana_signer::Signer,
};

const SEED: [u8; 32] = [7; 32];

fn set_rent(env: &mut TestEnv, lamports_per_byte: u64, threshold: f64) {
    #[allow(deprecated)]
    let rent = Rent {
        lamports_per_byte,
        exemption_threshold: threshold.to_le_bytes(),
        burn_percent: 50,
    };
    env.svm.set_sysvar(&rent);
    assert_eq!(
        env.svm.get_sysvar::<Rent>().lamports_per_byte,
        lamports_per_byte
    );
}

/// `(len + 128) × rate × threshold`, by hand.
fn expected_rent(len: usize, lamports_per_byte: u64, factor: u64) -> u64 {
    (len as u64 + 128) * lamports_per_byte * factor
}

/// Initialized env, SPL game mint, arena 1, Core loaded and an open Pass mint.
fn full_env() -> TestEnv {
    let mut env = TestEnv::initialized();
    assert_ok(env.create_arena(1, 1_000, 300, false));
    load_mpl_core(&mut env.svm);
    let admin = env.admin.insecure_clone();
    let collection = env.create_core_collection(&pass_authority_pda());
    assert_ok(env.set_collection_as(&admin, &collection));
    assert_ok(env.set_seed_hash_as(&admin, hash(&SEED).to_bytes()));
    assert_ok(env.update_config(UpdateConfigArgs {
        pass_base_uri: Some("https://slana.example/pass/".to_string()),
        pass_mint_open: Some(true),
        ..Default::default()
    }));
    env
}

/// A wallet with SOL and 1000 game tokens in its ATA, not yet registered.
fn wallet(env: &mut TestEnv) -> Keypair {
    let kp = env.funded_keypair(10 * SOL);
    let account = env.create_ata(&kp.pubkey());
    env.mint_to(&account, 1_000);
    kp
}

#[test]
fn init_paths_fund_the_rent_minimum_under_threshold_one_and_two() {
    // (lamports_per_byte, threshold, factor): SIMD-0194 with a rate that is not 2 × 3480,
    // then the legacy shape.
    for (rate, threshold, factor) in [(5_000u64, 1.0f64, 1u64), (3_480, 2.0, 2)] {
        let mut env = full_env();
        set_rent(&mut env, rate, threshold);
        let profile_len = 8 + PlayerProfile::INIT_SPACE;
        let session_len = 8 + Session::INIT_SPACE;
        let counter_len = 8 + MintCounter::INIT_SPACE;
        // The harness (solana-rent) agrees with the formula.
        assert_eq!(env.rent(profile_len), expected_rent(profile_len, rate, factor));

        // register_player → profile.
        let p = wallet(&mut env);
        let before = env.balance(&p.pubkey());
        assert_ok(env.register(&p, "rent", 0));
        let profile_rent = expected_rent(profile_len, rate, factor);
        assert_eq!(env.balance(&profile_pda(&p.pubkey())), profile_rent, "rate {rate}");
        assert_eq!(before - env.balance(&p.pubkey()), profile_rent);

        // join → session (rent + the settle deposit).
        let before = env.balance(&p.pubkey());
        assert_ok(env.join(&p, 1));
        let session = session_pda(&arena_pda(1), &p.pubkey());
        let session_rent = expected_rent(session_len, rate, factor);
        assert_eq!(
            env.balance(&session),
            session_rent + SETTLE_FEE_LAMPORTS,
            "rate {rate}"
        );
        assert_eq!(
            before - env.balance(&p.pubkey()),
            session_rent + SETTLE_FEE_LAMPORTS
        );

        // mint_pass → mint counter.
        let (res, _) = env.mint_pass(&p);
        assert_ok(res);
        assert_eq!(
            env.balance(&mint_counter_pda(&p.pubkey())),
            expected_rent(counter_len, rate, factor),
            "rate {rate}"
        );
        assert_eq!(env.mint_counter(&p.pubkey()).unwrap().count, 1);

        // Settling closes the session and returns its rent at the same rate.
        let before = env.balance(&p.pubkey());
        assert_ok(env.settle(&p.pubkey(), 1, 1_000, 1, 0, 0));
        assert!(env.session(1, &p.pubkey()).is_none());
        assert_eq!(env.balance(&p.pubkey()) - before, session_rent);
    }
}

/// A system account holding `lamports` and no data, as left by a plain transfer.
fn prefund(env: &mut TestEnv, address: &Pubkey, lamports: u64) {
    env.svm
        .set_account(
            *address,
            solana_account::Account {
                lamports,
                data: vec![],
                owner: system_program::ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
}

#[test]
fn register_player_initializes_a_prefunded_profile() {
    let profile_len = 8 + PlayerProfile::INIT_SPACE;
    // Below the rent minimum (topped up), and above it (nothing more to pay).
    for extra in [1u64, 10 * SOL] {
        let mut env = TestEnv::initialized();
        let rent = env.rent(profile_len);
        let pre = if extra == 1 { 1 } else { rent + extra };
        let p = env.funded_keypair(10 * SOL);
        let profile = profile_pda(&p.pubkey());
        prefund(&mut env, &profile, pre);
        let before = env.balance(&p.pubkey());
        assert_ok(env.register(&p, "early", 3));
        assert_eq!(env.owner_of(&profile), slana::ID);
        assert_eq!(env.balance(&profile), pre.max(rent));
        assert_eq!(before - env.balance(&p.pubkey()), rent.saturating_sub(pre));
        let state = env.profile(&p.pubkey());
        assert_eq!(state.owner, p.pubkey());
        assert_eq!(name_of(&state.name, state.name_len), "early");
        assert_eq!(state.skin, 3);
        // The profile now exists: a second registration is refused.
        assert_already_in_use(env.register(&p, "again", 0));
    }
}

#[test]
fn join_initializes_a_prefunded_session() {
    let session_len = 8 + Session::INIT_SPACE;
    for extra in [1u64, 10 * SOL] {
        let mut env = TestEnv::initialized();
        assert_ok(env.create_arena(1, 1_000, 300, false));
        let rent = env.rent(session_len);
        let pre = if extra == 1 { 1 } else { rent + extra };
        let p = env.token_player("early", 1_000);
        let session = session_pda(&arena_pda(1), &p.pubkey());
        prefund(&mut env, &session, pre);
        let before = env.balance(&p.pubkey());
        assert_ok(env.join(&p, 1));
        assert_eq!(env.owner_of(&session), slana::ID);
        // The settle deposit comes on top of whatever the account holds after init.
        assert_eq!(
            env.balance(&session),
            pre.max(rent) + SETTLE_FEE_LAMPORTS
        );
        assert_eq!(
            before - env.balance(&p.pubkey()),
            rent.saturating_sub(pre) + SETTLE_FEE_LAMPORTS
        );
        let s = env.session(1, &p.pubkey()).expect("session");
        assert_eq!(s.player, p.pubkey());
        assert_eq!(s.entry_fee, 1_000);
        assert_eq!(s.settle_fee, SETTLE_FEE_LAMPORTS);
        assert_eq!(env.tokens(&vault_pda(&arena_pda(1))), 1_000);
        assert_eq!(env.arena(1).open_sessions, 1);
    }
}
