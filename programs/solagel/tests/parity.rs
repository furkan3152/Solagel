//! Differential transaction checks against the reference and compact SBF artifacts.
//! Run explicitly after building both:
//! `cargo test -p solagel --test parity -- --ignored`

mod common;

use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::instruction::{error::InstructionError, Instruction},
        AccountSerialize,
    },
    common::*,
    solagel::{constants::*, RecordArgs, SettleArgs, UpdateConfigArgs},
    solana_keypair::Keypair,
    solana_signer::Signer,
    solana_transaction_error::TransactionError,
    std::collections::BTreeSet,
};

struct Pair {
    reference: TestEnv,
    compact: TestEnv,
    tracked: BTreeSet<Pubkey>,
}

impl Pair {
    fn new() -> Self {
        let reference = std::fs::read(concat!(
            env!("CARGO_TARGET_TMPDIR"),
            "/../deploy/solagel.so"
        ))
        .expect("build the reference SBF artifact first");
        let compact_path = std::env::var_os("SOLAGEL_PARITY_PROGRAM").unwrap_or_else(|| {
            concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/solagel_compact.so").into()
        });
        let compact = std::fs::read(compact_path).expect("build the compact SBF artifact first");
        let reference = TestEnv::deployed_with_program(&reference);
        let compact = TestEnv::deployed_with_program(&compact);
        assert_eq!(reference.admin.pubkey(), compact.admin.pubkey());
        assert_eq!(reference.server.pubkey(), compact.server.pubkey());
        assert_eq!(reference.treasury.pubkey(), compact.treasury.pubkey());
        assert_eq!(reference.payer.pubkey(), compact.payer.pubkey());
        let tracked = [
            reference.admin.pubkey(),
            reference.server.pubkey(),
            reference.treasury.pubkey(),
            reference.payer.pubkey(),
        ]
        .into_iter()
        .collect();
        Self {
            reference,
            compact,
            tracked,
        }
    }

    fn fund(&mut self, key: Pubkey, amount: u64) {
        self.reference.airdrop(&key, amount);
        self.compact.airdrop(&key, amount);
        self.tracked.insert(key);
        self.assert_accounts();
    }

    fn warp(&mut self, seconds: i64) {
        self.reference.warp(seconds);
        self.compact.warp(seconds);
    }

    fn profile_fixture(&mut self, player: &Pubkey, xp: u64, premium_skins: u32) {
        let key = profile_pda(player);
        let mut profile = self.reference.profile(player);
        profile.xp = xp;
        profile.premium_skins = premium_skins;
        let mut account = self.reference.svm.get_account(&key).unwrap();
        profile
            .try_serialize(&mut account.data.as_mut_slice())
            .unwrap();
        self.reference
            .svm
            .set_account(key, account.clone())
            .unwrap();
        self.compact.svm.set_account(key, account).unwrap();
        self.assert_accounts();
    }

    fn assert_accounts(&self) {
        for key in &self.tracked {
            if *key == solagel::ID || *key == program_data_pda() {
                continue; // The executable bytes and its storage rent intentionally differ.
            }
            assert_eq!(
                self.reference.svm.get_account(key),
                self.compact.svm.get_account(key),
                "account parity failed for {key}"
            );
        }
        let mut reference = self.reference.svm.get_program_accounts(&solagel::ID);
        let mut compact = self.compact.svm.get_program_accounts(&solagel::ID);
        reference.sort_by_key(|(address, _)| *address);
        compact.sort_by_key(|(address, _)| *address);
        assert_eq!(reference, compact, "program account set or bytes differ");
    }

    fn send(&mut self, instruction: Instruction, signers: &[&Keypair], should_succeed: bool) {
        self.send_checked(instruction, signers, should_succeed, false);
    }

    fn send_checked(
        &mut self,
        instruction: Instruction,
        signers: &[&Keypair],
        should_succeed: bool,
        permit_bounded_string_rejection: bool,
    ) {
        self.tracked
            .extend(instruction.accounts.iter().map(|account| account.pubkey));
        // Failed transactions may charge the separate payer, but must not mutate game state.
        let before: Vec<_> = self
            .tracked
            .iter()
            .filter(|key| {
                **key != self.reference.payer.pubkey()
                    && **key != solagel::ID
                    && **key != program_data_pda()
            })
            .map(|key| (*key, self.reference.svm.get_account(key)))
            .collect();
        let reference = self
            .reference
            .send(std::slice::from_ref(&instruction), signers);
        let compact = self.compact.send(&[instruction], signers);
        let reference_error = reference.as_ref().err().map(|error| &error.err);
        let compact_error = compact.as_ref().err().map(|error| &error.err);
        assert_eq!(
            reference.is_ok(),
            should_succeed,
            "reference: {reference:?}"
        );
        let reference_logs = match &reference {
            Ok(meta) => &meta.logs,
            Err(error) => &error.meta.logs,
        };
        let compact_logs = match &compact {
            Ok(meta) => &meta.logs,
            Err(error) => &error.meta.logs,
        };
        // Deliberate improvement for the single u32::MAX string-length fixture below:
        // Anchor allocates from the untrusted length and aborts with out-of-memory. The
        // borrowed decoder bounds the input first and returns its normal decode error.
        // Only this precise failure pair is permitted; account/event assertions still apply.
        let bounded_string_rejection = permit_bounded_string_rejection
            && matches!(
                reference_error,
                Some(TransactionError::InstructionError(
                    0,
                    InstructionError::ProgramFailedToComplete
                ))
            )
            && reference_logs
                .iter()
                .any(|line| line.contains("memory allocation failed, out of memory"))
            && matches!(
                compact_error,
                Some(TransactionError::InstructionError(
                    0,
                    InstructionError::Custom(102)
                ))
            );
        assert!(
            compact_error == reference_error || bounded_string_rejection,
            "different transaction outcome; reference={reference:?}; compact={compact:?}"
        );
        let events = |logs: &[String]| {
            logs.iter()
                .filter_map(|line| line.strip_prefix("Program data: "))
                .map(str::to_owned)
                .collect::<Vec<_>>()
        };
        assert_eq!(
            events(reference_logs),
            events(compact_logs),
            "structured event ABI differs"
        );
        if permit_bounded_string_rejection {
            assert!(events(reference_logs).is_empty());
            assert!(events(compact_logs).is_empty());
        }
        self.assert_accounts();
        if !should_succeed {
            for (key, account) in before {
                assert_eq!(
                    self.reference.svm.get_account(&key),
                    account,
                    "rejected reference transaction mutated {key}"
                );
                assert_eq!(
                    self.compact.svm.get_account(&key),
                    account,
                    "rejected compact transaction mutated {key}"
                );
            }
        }
    }

    fn settle(
        &mut self,
        server: &Keypair,
        player: &Pubkey,
        payout: u64,
        score: u32,
        success: bool,
    ) {
        let config = self.reference.config();
        let session = self.reference.session(1, player).unwrap();
        self.send(
            ix::settle_session(
                &server.pubkey(),
                player,
                1,
                config.current_season,
                &config.treasury,
                SettleArgs {
                    session_id: session.id,
                    payout,
                    score,
                    kills: 1,
                    xp: 500,
                },
            ),
            &[server],
            success,
        );
    }
}

#[test]
#[ignore = "requires both reference and compact SBF binaries"]
fn all_instruction_lifecycles_match_accounts_money_events_and_rejections() {
    let mut pair = Pair::new();
    let admin = pair.reference.admin.insecure_clone();
    let server = pair.reference.server.insecure_clone();
    let treasury = pair.reference.treasury.pubkey();
    let alice = Keypair::new_from_array([11; 32]);
    let bob = Keypair::new_from_array([12; 32]);
    let mallory = Keypair::new_from_array([13; 32]);
    for player in [&alice, &bob, &mallory] {
        pair.fund(player.pubkey(), 10 * SOL);
    }

    let init = pair.reference.default_init_args();
    pair.send(
        ix::initialize(&mallory.pubkey(), init.clone()),
        &[&mallory],
        false,
    );
    pair.send(
        ix::initialize(&admin.pubkey(), init.clone()),
        &[&admin],
        true,
    );
    pair.send(ix::initialize(&admin.pubkey(), init), &[&admin], false);
    pair.send(
        ix::create_arena(&admin.pubkey(), 1, 100_000_000, 2),
        &[&admin],
        true,
    );
    pair.send(
        ix::create_arena(&admin.pubkey(), 1, 100_000_000, 2),
        &[&admin],
        false,
    );
    pair.send(
        ix::update_arena(&mallory.pubkey(), 1, Some(false), None),
        &[&mallory],
        false,
    );
    pair.send(
        ix::update_arena(&admin.pubkey(), 1, Some(false), Some(4)),
        &[&admin],
        true,
    );
    pair.send(
        ix::update_arena(&admin.pubkey(), 1, Some(true), None),
        &[&admin],
        true,
    );
    for (player, name) in [(&alice, "alice"), (&bob, "bob")] {
        pair.send(
            ix::register_player(&player.pubkey(), name, 0),
            &[player],
            true,
        );
    }
    pair.send(
        ix::register_player(&alice.pubkey(), "again", 0),
        &[&alice],
        false,
    );
    pair.send(
        ix::update_profile(&alice.pubkey(), Some("Alice 🚀"), Some(7)),
        &[&alice],
        true,
    );
    pair.send(
        ix::buy_skin(&alice.pubkey(), &treasury, 16),
        &[&alice],
        false,
    );
    let record = RecordArgs {
        score: 1_000_001,
        kills: 2,
        xp: 2_001,
    };
    pair.send(
        ix::record_game(&mallory.pubkey(), &alice.pubkey(), 1, record.clone()),
        &[&mallory],
        false,
    );
    let mut with_trailing = ix::record_game(&server.pubkey(), &alice.pubkey(), 1, record);
    with_trailing.data.extend([7, 8, 9]);
    pair.send(with_trailing, &[&server], true);
    pair.send(
        ix::update_profile(&alice.pubkey(), None, Some(10)),
        &[&alice],
        true,
    );

    pair.send(
        ix::update_config(
            &admin.pubkey(),
            UpdateConfigArgs {
                paused: Some(true),
                ..Default::default()
            },
        ),
        &[&admin],
        true,
    );
    pair.send(ix::join_arena(&alice.pubkey(), 1), &[&alice], false);
    pair.send(
        ix::update_config(
            &admin.pubkey(),
            UpdateConfigArgs {
                paused: Some(false),
                ..Default::default()
            },
        ),
        &[&admin],
        true,
    );
    for player in [&alice, &bob] {
        pair.send(ix::join_arena(&player.pubkey(), 1), &[player], true);
        pair.send(ix::refund_session(&player.pubkey(), 1), &[player], false);
        let id = pair.reference.session(1, &player.pubkey()).unwrap().id;
        pair.send(
            ix::activate_session(&server.pubkey(), &player.pubkey(), 1, id),
            &[&server],
            true,
        );
    }
    pair.send(
        ix::sweep_arena(&admin.pubkey(), 1, &treasury),
        &[&admin],
        false,
    );
    pair.settle(&server, &alice.pubkey(), 201_000_000, 10, false);
    pair.settle(&server, &alice.pubkey(), 150_000_000, u32::MAX, true);
    pair.settle(&server, &bob.pubkey(), 50_000_000, 10, true);
    pair.send(ix::join_arena(&bob.pubkey(), 1), &[&bob], true);
    pair.warp(SESSION_REFUND_TIMEOUT_SECS);
    pair.send(ix::refund_session(&bob.pubkey(), 1), &[&bob], true);
    pair.fund(arena_pda(1), 10_000_000);
    pair.send(
        ix::sweep_arena(&admin.pubkey(), 1, &treasury),
        &[&admin],
        true,
    );

    pair.send(ix::fund_season(&bob.pubkey(), 1, SOL), &[&bob], true);
    pair.send(
        ix::claim_season_reward(&alice.pubkey(), 1),
        &[&alice],
        false,
    );
    pair.send(ix::end_season(&admin.pubkey(), 1), &[&admin], true);
    pair.send(ix::fund_season(&bob.pubkey(), 1, SOL), &[&bob], false);
    pair.send(ix::claim_season_reward(&bob.pubkey(), 1), &[&bob], false);
    pair.send(ix::claim_season_reward(&alice.pubkey(), 1), &[&alice], true);
    pair.send(
        ix::claim_season_reward(&alice.pubkey(), 1),
        &[&alice],
        false,
    );
    pair.send(ix::rollover_season(&admin.pubkey(), 2, 2), &[&admin], false);
    pair.warp(CLAIM_WINDOW_SECS);
    pair.send(ix::rollover_season(&admin.pubkey(), 1, 2), &[&admin], false);
    pair.warp(1);
    pair.send(ix::rollover_season(&admin.pubkey(), 1, 2), &[&admin], true);
    pair.send(ix::rollover_season(&admin.pubkey(), 1, 2), &[&admin], true);

    pair.send(
        ix::update_config(
            &admin.pubkey(),
            UpdateConfigArgs {
                admin: Some(mallory.pubkey()),
                server_authority: Some(mallory.pubkey()),
                ..Default::default()
            },
        ),
        &[&admin],
        true,
    );
    pair.send(
        ix::update_config(
            &admin.pubkey(),
            UpdateConfigArgs {
                paused: Some(true),
                ..Default::default()
            },
        ),
        &[&admin],
        false,
    );
    pair.send(
        ix::update_config(
            &mallory.pubkey(),
            UpdateConfigArgs {
                paused: Some(true),
                ..Default::default()
            },
        ),
        &[&mallory],
        true,
    );
    pair.send(
        ix::record_game(
            &server.pubkey(),
            &alice.pubkey(),
            2,
            RecordArgs {
                score: 10,
                kills: 0,
                xp: 1,
            },
        ),
        &[&server],
        false,
    );
    pair.send(
        ix::record_game(
            &mallory.pubkey(),
            &alice.pubkey(),
            2,
            RecordArgs {
                score: 10,
                kills: 0,
                xp: 1,
            },
        ),
        &[&mallory],
        true,
    );
}

#[test]
#[ignore = "requires both reference and compact SBF binaries"]
fn malformed_instruction_abi_rejects_without_mutating_accounts() {
    let mut pair = Pair::new();
    let admin = pair.reference.admin.insecure_clone();
    pair.send(
        ix::initialize(&admin.pubkey(), pair.reference.default_init_args()),
        &[&admin],
        true,
    );
    let normal = ix::update_config(&admin.pubkey(), UpdateConfigArgs::default());

    for length in 0..8 {
        let mut missing_discriminator = normal.clone();
        missing_discriminator.data.truncate(length);
        pair.send(missing_discriminator, &[&admin], false);
    }

    let mut unknown_discriminator = normal.clone();
    unknown_discriminator.data[..8].fill(0xff);
    pair.send(unknown_discriminator, &[&admin], false);

    let mut missing_argument = normal.clone();
    missing_argument.data.truncate(8);
    pair.send(missing_argument, &[&admin], false);

    let mut invalid_option_tag = normal.clone();
    invalid_option_tag.data[8] = 2;
    pair.send(invalid_option_tag, &[&admin], false);

    let mut invalid_argument_and_missing_account = normal.clone();
    invalid_argument_and_missing_account.data[8] = 2;
    invalid_argument_and_missing_account.accounts.truncate(1);
    pair.send(invalid_argument_and_missing_account, &[&admin], false);

    let mut missing_account = normal;
    missing_account.accounts.truncate(1);
    pair.send(missing_account, &[&admin], false);

    let alice = Keypair::new_from_array([11; 32]);
    pair.fund(alice.pubkey(), 10 * SOL);
    let mut invalid_utf8 = ix::register_player(&alice.pubkey(), "a", 0);
    invalid_utf8.data[12] = 0xff;
    pair.send(invalid_utf8, &[&alice], false);
}

#[test]
#[ignore = "requires both reference and compact SBF binaries"]
fn every_skin_unlock_boundary_matches_the_reference() {
    let mut pair = Pair::new();
    let admin = pair.reference.admin.insecure_clone();
    let alice = Keypair::new_from_array([11; 32]);
    pair.fund(alice.pubkey(), 10 * SOL);
    pair.send(
        ix::initialize(&admin.pubkey(), pair.reference.default_init_args()),
        &[&admin],
        true,
    );
    pair.send(
        ix::register_player(&alice.pubkey(), "alice", 0),
        &[&alice],
        true,
    );
    for skin in 0..FREE_SKINS {
        pair.send(
            ix::update_profile(&alice.pubkey(), None, Some(skin)),
            &[&alice],
            true,
        );
    }
    for (index, level) in LEVEL_SKIN_REQUIREMENTS.iter().enumerate() {
        let skin = LEVEL_SKIN_START + index as u8;
        let threshold = u64::from(level - 1).pow(2) * XP_LEVEL_DIVISOR;
        for (xp, allowed) in [(threshold - 1, false), (threshold, true), (u64::MAX, true)] {
            pair.profile_fixture(&alice.pubkey(), xp, 0);
            pair.send(
                ix::update_profile(&alice.pubkey(), None, Some(skin)),
                &[&alice],
                allowed,
            );
        }
    }
    for skin in PREMIUM_SKIN_START..SKIN_COUNT {
        pair.profile_fixture(&alice.pubkey(), u64::MAX, 0);
        pair.send(
            ix::update_profile(&alice.pubkey(), None, Some(skin)),
            &[&alice],
            false,
        );
        pair.profile_fixture(&alice.pubkey(), 0, 1 << (skin - PREMIUM_SKIN_START));
        pair.send(
            ix::update_profile(&alice.pubkey(), None, Some(skin)),
            &[&alice],
            true,
        );
    }
    pair.profile_fixture(&alice.pubkey(), u64::MAX, u32::MAX);
    for invalid_skin in [SKIN_COUNT, u8::MAX] {
        pair.send(
            ix::update_profile(&alice.pubkey(), None, Some(invalid_skin)),
            &[&alice],
            false,
        );
    }
}

#[test]
#[ignore = "requires both reference and compact SBF binaries"]
fn string_and_option_decoders_preserve_unicode_and_malformed_input_behavior() {
    let mut pair = Pair::new();
    let admin = pair.reference.admin.insecure_clone();
    let alice = Keypair::new_from_array([11; 32]);
    pair.fund(alice.pubkey(), 10 * SOL);
    pair.send(
        ix::initialize(&admin.pubkey(), pair.reference.default_init_args()),
        &[&admin],
        true,
    );
    pair.send(
        ix::register_player(&alice.pubkey(), "alice", 0),
        &[&alice],
        true,
    );

    for (name, allowed) in [
        ("éééééééé", true),
        ("🚀🚀🚀🚀", true),
        ("a\u{200d}b", true),
        ("\u{00a0}", true),
        ("\u{2028}", true),
        ("\u{0085}", false),
        ("abc\0", false),
        ("", false),
        ("\u{007f}", false),
        ("\u{009f}", false),
        ("ééééééééé", false),
    ] {
        pair.send(
            ix::update_profile(&alice.pubkey(), Some(name), None),
            &[&alice],
            allowed,
        );
    }

    // Valid UTF-8 is separate from the game name rules, and both must match.
    for bytes in [
        &[0xff][..],
        &[0xed, 0xa0, 0x80],
        &[0xc0, 0xaf],
        &[0x80],
        &[0xe2, 0x82],
    ] {
        let mut invalid = ix::register_player(&alice.pubkey(), "a", 0);
        invalid.data.truncate(8);
        invalid
            .data
            .extend_from_slice(&(bytes.len() as u32).to_le_bytes());
        invalid.data.extend_from_slice(bytes);
        invalid.data.push(0);
        pair.send(invalid, &[&alice], false);
    }
    for length in [0_u32, 2, u32::MAX] {
        let mut invalid = ix::register_player(&alice.pubkey(), "a", 0);
        invalid.data.truncate(8);
        invalid.data.extend_from_slice(&length.to_le_bytes());
        if length != 0 {
            invalid.data.push(b'a');
        } // Missing name bytes or trailing skin.
        pair.send_checked(invalid, &[&alice], false, length == u32::MAX);
    }
    for prefix_bytes in 0..4 {
        let mut truncated = ix::register_player(&alice.pubkey(), "a", 0);
        truncated.data.truncate(8 + prefix_bytes);
        pair.send(truncated, &[&alice], false);
    }

    for value in [2, 255] {
        let mut invalid_bool = ix::update_config(
            &admin.pubkey(),
            UpdateConfigArgs {
                paused: Some(true),
                ..Default::default()
            },
        );
        *invalid_bool.data.last_mut().unwrap() = value;
        pair.send(invalid_bool, &[&admin], false);
    }
    let mut truncated_key = ix::update_config(
        &admin.pubkey(),
        UpdateConfigArgs {
            admin: Some(alice.pubkey()),
            ..Default::default()
        },
    );
    truncated_key.data.truncate(9 + 31);
    pair.send(truncated_key, &[&admin], false);
    let mut truncated_bool = ix::update_config(
        &admin.pubkey(),
        UpdateConfigArgs {
            paused: Some(true),
            ..Default::default()
        },
    );
    truncated_bool.data.pop();
    pair.send(truncated_bool, &[&admin], false);
}

#[test]
#[ignore = "requires both reference and compact SBF binaries"]
fn account_bool_tags_and_extended_account_storage_match_the_reference() {
    let mut pair = Pair::new();
    let admin = pair.reference.admin.insecure_clone();
    let server = pair.reference.server.insecure_clone();
    let alice = Keypair::new_from_array([11; 32]);
    pair.fund(alice.pubkey(), 10 * SOL);
    pair.send(
        ix::initialize(&admin.pubkey(), pair.reference.default_init_args()),
        &[&admin],
        true,
    );
    pair.send(
        ix::create_arena(&admin.pubkey(), 1, 100_000_000, 4),
        &[&admin],
        true,
    );
    pair.send(
        ix::register_player(&alice.pubkey(), "alice", 0),
        &[&alice],
        true,
    );
    pair.send(ix::join_arena(&alice.pubkey(), 1), &[&alice], true);
    let session = session_pda(&arena_pda(1), &alice.pubkey());
    let session_id = pair.reference.session(1, &alice.pubkey()).unwrap().id;

    let cases = [
        (
            config_pda(),
            120,
            ix::update_config(&admin.pubkey(), UpdateConfigArgs::default()),
            &admin,
        ),
        (
            arena_pda(1),
            20,
            ix::update_arena(&admin.pubkey(), 1, None, None),
            &admin,
        ),
        (
            session,
            98,
            ix::activate_session(&server.pubkey(), &alice.pubkey(), 1, session_id),
            &server,
        ),
        (
            season_pda(1),
            28,
            ix::fund_season(&alice.pubkey(), 1, 1_000_000),
            &alice,
        ),
    ];
    for (key, offset, instruction, signer) in cases {
        let original = pair.reference.svm.get_account(&key).unwrap();
        for invalid_bool in [2, 255] {
            let mut account = original.clone();
            account.data[offset] = invalid_bool;
            pair.reference
                .svm
                .set_account(key, account.clone())
                .unwrap();
            pair.compact.svm.set_account(key, account).unwrap();
            pair.send(instruction.clone(), &[signer], false);
        }
        pair.reference
            .svm
            .set_account(key, original.clone())
            .unwrap();
        pair.compact.svm.set_account(key, original).unwrap();
    }

    // Account extensions are valid; only serialized fields change and rent uses actual length.
    for key in [
        config_pda(),
        profile_pda(&alice.pubkey()),
        arena_pda(1),
        session,
        season_pda(1),
    ] {
        let mut account = pair.reference.svm.get_account(&key).unwrap();
        let old_rent = pair.reference.rent(account.data.len());
        account
            .data
            .extend_from_slice(&[0xa5, 0x5a, 0xfe, 0x42, 0x11]);
        account.lamports += pair.reference.rent(account.data.len()) - old_rent;
        pair.reference
            .svm
            .set_account(key, account.clone())
            .unwrap();
        pair.compact.svm.set_account(key, account).unwrap();
    }
    pair.send(
        ix::update_config(
            &admin.pubkey(),
            UpdateConfigArgs {
                paused: Some(false),
                ..Default::default()
            },
        ),
        &[&admin],
        true,
    );
    pair.send(
        ix::update_profile(&alice.pubkey(), Some("extended"), None),
        &[&alice],
        true,
    );
    pair.send(
        ix::update_arena(&admin.pubkey(), 1, None, Some(5)),
        &[&admin],
        true,
    );
    pair.send(
        ix::activate_session(&server.pubkey(), &alice.pubkey(), 1, session_id),
        &[&server],
        true,
    );
    pair.settle(&server, &alice.pubkey(), 100_000_000, 1, true);
    pair.send(
        ix::fund_season(&alice.pubkey(), 1, 1_000_000),
        &[&alice],
        true,
    );
    pair.send(ix::end_season(&admin.pubkey(), 1), &[&admin], true);
}

#[test]
#[ignore = "requires both reference and compact SBF binaries"]
fn exhausted_season_counter_rejects_atomically_with_a_checked_compact_error() {
    let mut pair = Pair::new();
    let admin = pair.reference.admin.insecure_clone();
    pair.send(
        ix::initialize(&admin.pubkey(), pair.reference.default_init_args()),
        &[&admin],
        true,
    );

    let maximum = u32::MAX;
    let (season_address, bump) =
        Pubkey::find_program_address(&[SEASON_SEED, &maximum.to_le_bytes()], &solagel::ID);
    let mut config = pair.reference.config();
    config.current_season = maximum;
    let mut config_account = pair.reference.svm.get_account(&config_pda()).unwrap();
    config
        .try_serialize(&mut config_account.data.as_mut_slice())
        .unwrap();
    let mut season = pair.reference.season(1);
    season.id = maximum;
    season.bump = bump;
    let mut season_account = pair.reference.svm.get_account(&season_pda(1)).unwrap();
    season
        .try_serialize(&mut season_account.data.as_mut_slice())
        .unwrap();
    for environment in [&mut pair.reference, &mut pair.compact] {
        environment
            .svm
            .set_account(config_pda(), config_account.clone())
            .unwrap();
        environment
            .svm
            .set_account(season_address, season_account.clone())
            .unwrap();
    }
    pair.fund(season_address, SOL);

    // The normal builder adds one on the host. Construct the no-argument instruction
    // using a safe fixture ID, then supply the maximum season and would-be wrapped PDA.
    let mut instruction = ix::end_season(&admin.pubkey(), 0);
    instruction.accounts[2].pubkey = season_address;
    instruction.accounts[3].pubkey = season_pda(0);
    pair.tracked
        .extend(instruction.accounts.iter().map(|account| account.pubkey));
    let before: Vec<_> = pair
        .tracked
        .iter()
        .filter(|key| {
            **key != pair.reference.payer.pubkey()
                && **key != solagel::ID
                && **key != program_data_pda()
        })
        .map(|key| (*key, pair.reference.svm.get_account(key)))
        .collect();

    let reference = pair
        .reference
        .send(std::slice::from_ref(&instruction), &[&admin])
        .unwrap_err();
    let compact = pair.compact.send(&[instruction], &[&admin]).unwrap_err();
    // Anchor's unchecked addition in its generated next-season seed panics first.
    // Compact deliberately reports the existing MathOverflow error instead of panicking.
    // Keep this exception local: normal parity checks still require identical errors.
    assert_eq!(
        reference.err,
        TransactionError::InstructionError(0, InstructionError::ProgramFailedToComplete)
    );
    assert!(
        reference
            .meta
            .logs
            .iter()
            .any(|line| line.contains("overflow")),
        "{}",
        reference.meta.pretty_logs()
    );
    assert!(!reference
        .meta
        .logs
        .iter()
        .any(|line| line.contains("out of memory")));
    assert_eq!(
        compact.err,
        TransactionError::InstructionError(0, InstructionError::Custom(6022))
    );
    for logs in [&reference.meta.logs, &compact.meta.logs] {
        assert!(logs.iter().all(|line| !line.starts_with("Program data: ")));
    }
    pair.assert_accounts();
    for (key, account) in before {
        assert_eq!(
            pair.reference.svm.get_account(&key),
            account,
            "reference changed {key}"
        );
        assert_eq!(
            pair.compact.svm.get_account(&key),
            account,
            "compact changed {key}"
        );
    }
    assert_eq!(pair.reference.config().current_season, maximum);
    assert_eq!(pair.reference.prize_balance(maximum), SOL);
    assert!(pair.reference.svm.get_account(&season_pda(0)).is_none());
    assert!(pair.compact.svm.get_account(&season_pda(0)).is_none());
}
