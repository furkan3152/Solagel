//! Slana Pass collection, free mint (real Metaplex Core CPI) and commit–reveal.
//!
//! Needs the Core program binary: run `scripts/fetch-programs.sh` first.

mod common;

use {
    anchor_lang::prelude::Pubkey,
    common::*,
    slana::{constants::*, error::SlanaError, UpdateConfigArgs},
    solana_keypair::Keypair,
    solana_sha256_hasher::hash,
    solana_signer::Signer,
};

const BASE_URI: &str = "https://slana.example/pass/";
const SEED: [u8; 32] = [7; 32];

/// Initialized env with the real Core program loaded.
fn core_env() -> TestEnv {
    let mut env = TestEnv::initialized();
    load_mpl_core(&mut env.svm);
    env
}

/// `core_env()` + a Pass collection owned by the pass authority PDA, set in the config, a
/// committed seed hash, a base URI and an open mint.
fn mint_env() -> (TestEnv, Pubkey) {
    let mut env = core_env();
    let admin = env.admin.insecure_clone();
    let collection = env.create_core_collection(&pass_authority_pda());
    assert_ok(env.set_collection_as(&admin, &collection));
    assert_ok(env.set_seed_hash_as(&admin, hash(&SEED).to_bytes()));
    assert_ok(env.update_config(UpdateConfigArgs {
        pass_base_uri: Some(BASE_URI.to_string()),
        pass_mint_open: Some(true),
        ..Default::default()
    }));
    (env, collection)
}

/// Borsh string at `data[offset..]`; returns it and the offset after it.
fn read_string(data: &[u8], offset: usize) -> (String, usize) {
    let len = u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap()) as usize;
    let start = offset + 4;
    (
        String::from_utf8(data[start..start + len].to_vec()).unwrap(),
        start + len,
    )
}

#[test]
fn set_pass_collection_requires_pass_authority() {
    let mut env = core_env();
    let admin = env.admin.insecure_clone();
    let good = env.create_core_collection(&pass_authority_pda());

    // Admin only.
    let not_admin = env.funded_keypair(SOL);
    assert_error(
        env.set_collection_as(&not_admin, &good),
        SlanaError::Unauthorized,
    );

    // A real Core collection with another update authority.
    let other = env.create_core_collection(&admin.pubkey());
    assert_error(
        env.set_collection_as(&admin, &other),
        SlanaError::BadCollection,
    );
    // Not a Core account at all.
    let fake = Pubkey::new_unique();
    let mut data = vec![5u8];
    data.extend_from_slice(pass_authority_pda().as_ref());
    data.extend_from_slice(&[0; 16]);
    write_raw_account(&mut env.svm, &fake, slana::ID, data);
    assert_error(
        env.set_collection_as(&admin, &fake),
        SlanaError::BadCollection,
    );
    assert_eq!(env.config().pass_collection, Pubkey::default());

    assert_ok(env.set_collection_as(&admin, &good));
    assert_eq!(env.config().pass_collection, good);

    // Set once.
    assert_error(
        env.set_collection_as(&admin, &good),
        SlanaError::CollectionAlreadySet,
    );
}

#[test]
fn mint_pass_creates_core_asset_in_collection() {
    let mut env = core_env();
    let admin = env.admin.insecure_clone();
    let a = env.funded_keypair(10 * SOL);

    // 1. No collection yet.
    let (res, _) = env.mint_pass(&a);
    assert_error(res, SlanaError::CollectionNotSet);

    // 2. No seed hash yet.
    let collection = env.create_core_collection(&pass_authority_pda());
    assert_ok(env.set_collection_as(&admin, &collection));
    let (res, _) = env.mint_pass(&a);
    assert_error(res, SlanaError::SeedNotSet);

    // 3. Mint closed, or open but not started.
    assert_ok(env.set_seed_hash_as(&admin, hash(&SEED).to_bytes()));
    assert_ok(env.update_config(UpdateConfigArgs {
        pass_base_uri: Some(BASE_URI.to_string()),
        ..Default::default()
    }));
    let (res, _) = env.mint_pass(&a);
    assert_error(res, SlanaError::MintClosed);
    let later = env.now() + 100;
    assert_ok(env.update_config(UpdateConfigArgs {
        pass_mint_open: Some(true),
        pass_mint_start_ts: Some(later),
        ..Default::default()
    }));
    let (res, _) = env.mint_pass(&a);
    assert_error(res, SlanaError::MintClosed);
    env.warp(100);

    // A wrong collection account.
    let other = env.create_core_collection(&pass_authority_pda());
    let asset = Keypair::new();
    let res = env.send(
        &[ix::mint_pass(&a.pubkey(), &asset.pubkey(), &other, None)],
        &[&a, &asset],
    );
    assert_error(res, SlanaError::BadCollection);

    // Mint #1.
    let (res, asset) = env.mint_pass(&a);
    assert_ok(res);
    let account = env.svm.get_account(&asset).expect("asset");
    assert_eq!(account.owner, MPL_CORE_ID);
    let data = &account.data;
    assert_eq!(data[0], 1, "AssetV1");
    assert_eq!(&data[1..33], a.pubkey().as_ref(), "owner");
    assert_eq!(data[33], 2, "update authority = collection");
    assert_eq!(&data[34..66], collection.as_ref());
    let (name, next) = read_string(data, 66);
    assert_eq!(name, "Slana Pass #1");
    let (uri, _) = read_string(data, next);
    assert_eq!(uri, format!("{BASE_URI}1.json"));

    let config = env.config();
    assert_eq!(config.pass_minted, 1);
    let counter = env.mint_counter(&a.pubkey()).expect("mint counter");
    assert_eq!(counter.count, 1);

    // 5. Per-wallet limit (1 by default).
    let (res, _) = env.mint_pass(&a);
    assert_error(res, SlanaError::MintLimit);

    // 6. Minimum token balance.
    assert_ok(env.update_config(UpdateConfigArgs {
        pass_min_tokens: Some(100 * TOKEN),
        ..Default::default()
    }));
    let b = env.funded_keypair(10 * SOL);
    let (res, _) = env.mint_pass_with(&b, None);
    assert_error(res, SlanaError::MintMinTokens);
    let poor = env.token_player("poor", 99 * TOKEN);
    let (res, _) = env.mint_pass(&poor);
    assert_error(res, SlanaError::MintMinTokens);
    let rich = env.token_player("rich", 1_000 * TOKEN);
    let rich_ata = env.player_ata(&rich.pubkey());
    // Somebody else's token account does not count.
    let (res, _) = env.mint_pass_with(&b, Some(rich_ata));
    assert_error(res, SlanaError::MintMinTokens);
    // A token account of another mint does not count.
    let other_mint = env.create_mint(MintKind::Spl, None);
    let saved = env.mint;
    env.mint = other_mint;
    let other_ata = env.create_ata(&b.pubkey());
    env.mint_to(&other_ata, 1_000 * TOKEN);
    env.mint = saved;
    let (res, _) = env.mint_pass_with(&b, Some(other_ata));
    assert_error(res, SlanaError::MintMinTokens);

    let (res, asset2) = env.mint_pass(&rich);
    assert_ok(res);
    let data = env.svm.get_account(&asset2).expect("asset").data;
    assert_eq!(read_string(&data, 66).0, "Slana Pass #2");
    assert_eq!(env.config().pass_minted, 2);
    // Tokens are only checked, never taken.
    assert_eq!(env.tokens(&rich_ata), 1_000 * TOKEN);

    // The seed hash is frozen once minting started.
    assert_error(
        env.set_seed_hash_as(&admin, [1; 32]),
        SlanaError::SeedLocked,
    );
}

#[test]
fn per_wallet_limit_counts_each_mint() {
    let (mut env, _) = mint_env();
    assert_ok(env.update_config(UpdateConfigArgs {
        pass_per_wallet: Some(2),
        ..Default::default()
    }));
    let a = env.funded_keypair(10 * SOL);
    assert_ok(env.mint_pass(&a).0);
    assert_ok(env.mint_pass(&a).0);
    assert_eq!(env.mint_counter(&a.pubkey()).unwrap().count, 2);
    assert_error(env.mint_pass(&a).0, SlanaError::MintLimit);
}

#[test]
fn minted_pass_unlocks_pass_arena() {
    let (mut env, _) = mint_env();
    assert_ok(env.create_arena(9, ENTRY_FEE, 300, true));
    let player = env.token_player("p", ENTRY_FEE);

    assert_error(env.join(&player, 9), SlanaError::PassRequired);
    let (res, asset) = env.mint_pass(&player);
    assert_ok(res);
    assert_ok(env.join_with_pass(&player, 9, &asset));
    let session = env.session(9, &player.pubkey()).expect("session");
    assert!(session.has_pass);
    assert_eq!(session.pass_asset, asset);
    assert!(env.pass_lock(&asset).is_some());

    assert_ok(env.settle(&player.pubkey(), 9, ENTRY_FEE, 120, 1, 10));
    assert!(env.pass_lock(&asset).is_none());
    assert_eq!(env.season(1).entries[0].player, player.pubkey());
}

#[test]
fn slot_hashes_id_is_the_sysvar() {
    use anchor_lang::{prelude::SlotHashes, solana_program::sysvar::SysvarId};
    assert_eq!(SLOT_HASHES_ID, SlotHashes::id());
}

/// `mint_env()` with a supply of `supply` (set before the mint opens).
fn mint_env_with_supply(supply: u32) -> TestEnv {
    let mut env = core_env();
    let admin = env.admin.insecure_clone();
    let collection = env.create_core_collection(&pass_authority_pda());
    assert_ok(env.set_collection_as(&admin, &collection));
    assert_ok(env.set_seed_hash_as(&admin, hash(&SEED).to_bytes()));
    assert_ok(env.update_config(UpdateConfigArgs {
        pass_base_uri: Some(BASE_URI.to_string()),
        pass_supply: Some(supply),
        pass_per_wallet: Some(MAX_PASS_PER_WALLET),
        pass_mint_open: Some(true),
        ..Default::default()
    }));
    env
}

/// Ends the mint at slot `at` (close_pass_mint), returns the entropy target slot.
fn end_mint_at(env: &mut TestEnv, at: u64) -> u64 {
    env.warp_to_slot(at);
    let a = env.funded_keypair(10 * SOL);
    assert_ok(env.mint_pass(&a).0);
    assert_ok(env.close_mint());
    env.config().pass_entropy_target_slot
}

#[test]
fn sell_out_ends_the_mint_and_sets_the_target() {
    let mut env = mint_env_with_supply(2);
    let a = env.funded_keypair(10 * SOL);
    env.warp_to_slot(1_000);

    assert_ok(env.mint_pass(&a).0);
    let config = env.config();
    assert!(config.pass_mint_open && !config.pass_mint_ended);
    assert_eq!(config.pass_entropy_target_slot, 0);

    // The last Pass of the supply ends the mint and points at a future slot; nothing is
    // captured yet.
    assert_ok(env.mint_pass(&a).0);
    let config = env.config();
    assert_eq!(config.pass_minted, 2);
    assert!(!config.pass_mint_open);
    assert!(config.pass_mint_ended);
    assert_eq!(config.pass_entropy_target_slot, 1_000 + ENTROPY_DELAY_SLOTS);
    assert!(!config.pass_entropy_captured);
    assert_eq!(config.pass_entropy, [0; 32]);

    // Nothing reopens it.
    let b = env.funded_keypair(10 * SOL);
    assert_error(env.mint_pass(&b).0, SlanaError::MintClosed);
    assert_error(
        env.update_config(UpdateConfigArgs {
            pass_mint_open: Some(true),
            ..Default::default()
        }),
        SlanaError::MintEnded,
    );
    assert_error(env.close_mint(), SlanaError::MintEnded);
}

#[test]
fn close_mint_sets_the_target_and_needs_a_mint() {
    let (mut env, _) = mint_env();
    let not_admin = env.funded_keypair(SOL);
    env.warp_to_slot(5_000);
    // Nothing minted yet: there is nothing to fix.
    assert_error(env.close_mint(), SlanaError::NothingMinted);
    let a = env.funded_keypair(10 * SOL);
    assert_ok(env.mint_pass(&a).0);
    assert_error(env.close_mint_as(&not_admin), SlanaError::Unauthorized);

    assert_ok(env.close_mint());
    let config = env.config();
    assert!(!config.pass_mint_open && config.pass_mint_ended);
    assert_eq!(config.pass_entropy_target_slot, 5_000 + ENTROPY_DELAY_SLOTS);
    assert!(!config.pass_entropy_captured);
    assert_error(
        env.update_config(UpdateConfigArgs {
            pass_mint_open: Some(true),
            ..Default::default()
        }),
        SlanaError::MintEnded,
    );
    assert_error(env.close_mint(), SlanaError::MintEnded);
    let b = env.funded_keypair(10 * SOL);
    assert_error(env.mint_pass(&b).0, SlanaError::MintClosed);
}

#[test]
fn capture_before_the_target_fails() {
    let (mut env, _) = mint_env();
    let anyone = env.funded_keypair(SOL);
    // Before the mint ended there is no target.
    assert_error(env.capture_entropy_as(&anyone), SlanaError::MintStillOpen);
    let target = end_mint_at(&mut env, 2_000);

    // At or before the target slot: not yet (even if SlotHashes already shows that slot).
    env.slot_hashes_range(target - 10, target);
    env.warp_to_slot(target);
    assert_error(env.capture_entropy_as(&anyone), SlanaError::EntropyNotReady);
    // Past the target by the clock, but SlotHashes has no entry at/after it yet.
    env.slot_hashes_range(target - 10, target - 1);
    env.warp_to_slot(target + 1);
    assert_error(env.capture_entropy_as(&anyone), SlanaError::EntropyNotReady);
    assert!(!env.config().pass_entropy_captured);
}

#[test]
fn capture_after_the_target_stores_exactly_that_slots_hash() {
    let (mut env, _) = mint_env();
    let anyone = env.funded_keypair(SOL);
    let target = end_mint_at(&mut env, 3_000);
    env.warp_to_slot(target + 20);
    env.slot_hashes_range(target - 30, target + 19);

    // Any signer may capture; the stored hash is the target slot's entry, not the newest.
    assert_ok(env.capture_entropy_as(&anyone));
    let config = env.config();
    assert!(config.pass_entropy_captured);
    assert_eq!(config.pass_entropy_slot, target);
    assert_eq!(config.pass_entropy, [target as u8; 32]);

    // Idempotent: a later call with other hashes changes nothing.
    env.warp_to_slot(target + 400);
    env.slot_hashes_range(target + 300, target + 399);
    assert_ok(env.capture_entropy_as(&anyone));
    let again = env.config();
    assert_eq!(again.pass_entropy, config.pass_entropy);
    assert_eq!(again.pass_entropy_slot, target);
}

#[test]
fn capture_uses_the_next_block_when_the_target_slot_was_skipped() {
    let (mut env, _) = mint_env();
    let anyone = env.funded_keypair(SOL);
    let target = end_mint_at(&mut env, 4_000);
    env.warp_to_slot(target + 5);
    // No block at `target` and `target + 1`.
    env.set_slot_hashes(&[
        (target + 4, [4; 32]),
        (target + 3, [3; 32]),
        (target + 2, [2; 32]),
        (target - 1, [9; 32]),
    ]);
    assert_ok(env.capture_entropy_as(&anyone));
    let config = env.config();
    assert_eq!(config.pass_entropy_slot, target + 2);
    assert_eq!(config.pass_entropy, [2; 32]);
}

#[test]
fn a_missed_window_retargets_to_a_new_future_slot() {
    let (mut env, _) = mint_env();
    let admin = env.admin.insecure_clone();
    let anyone = env.funded_keypair(SOL);
    let target = end_mint_at(&mut env, 6_000);

    // Nobody captured while the target was in the window: SlotHashes has moved past it.
    let now = target + 700;
    env.warp_to_slot(now);
    env.slot_hashes_range(now - 512, now - 1);
    assert_ok(env.capture_entropy_as(&anyone));
    let config = env.config();
    assert!(!config.pass_entropy_captured);
    assert_eq!(config.pass_entropy, [0; 32]);
    assert_eq!(config.pass_entropy_target_slot, now + ENTROPY_DELAY_SLOTS);
    // Still no reveal.
    assert_error(env.reveal_as(&admin, SEED), SlanaError::EntropyNotCaptured);

    // The new target is captured normally.
    let next = now + ENTROPY_DELAY_SLOTS;
    env.warp_to_slot(next + 3);
    env.slot_hashes_range(next - 5, next + 2);
    assert_ok(env.capture_entropy_as(&anyone));
    let config = env.config();
    assert!(config.pass_entropy_captured);
    assert_eq!(config.pass_entropy_slot, next);
}

#[test]
fn capture_checks_the_slot_hashes_account() {
    let (mut env, _) = mint_env();
    let anyone = env.funded_keypair(SOL);
    let target = end_mint_at(&mut env, 7_000);
    env.warp_to_slot(target + 1);
    let mut ix = ix::capture_pass_entropy(&anyone.pubkey());
    ix.accounts[2].pubkey = anchor_lang::prelude::Pubkey::new_unique();
    assert_error(env.send(&[ix], &[&anyone]), SlanaError::BadSlotHashes);
    // An empty SlotHashes list is refused.
    env.set_slot_hashes(&[]);
    assert_error(env.capture_entropy_as(&anyone), SlanaError::BadSlotHashes);
}

#[test]
fn capture_parses_litesvm_default_slot_hashes() {
    // LiteSVM's own SlotHashes sysvar (one entry, slot 0) parses: LiteSVM does not add entries
    // when the clock warps, so its only entry is older than the target and capture waits.
    let (mut env, _) = mint_env();
    let anyone = env.funded_keypair(SOL);
    let a = env.funded_keypair(10 * SOL);
    assert_ok(env.mint_pass(&a).0);
    assert_ok(env.close_mint());
    let target = env.config().pass_entropy_target_slot;
    env.warp_to_slot(target + 1);
    assert_error(env.capture_entropy_as(&anyone), SlanaError::EntropyNotReady);
    assert!(!env.config().pass_entropy_captured);
}

#[test]
fn reveal_checks_hash_once() {
    let (mut env, _) = mint_env();
    let admin = env.admin.insecure_clone();
    let not_admin = env.funded_keypair(SOL);
    let target = end_mint_at(&mut env, 8_000);

    // Mint ended, entropy not captured yet: no reveal.
    assert_error(env.reveal_as(&admin, SEED), SlanaError::EntropyNotCaptured);
    env.warp_to_slot(target + 1);
    env.set_slot_hashes(&[(target, [0x42; 32])]);
    assert_ok(env.capture_entropy_as(&not_admin));

    assert_error(env.reveal_as(&not_admin, SEED), SlanaError::Unauthorized);
    assert_error(env.reveal_as(&admin, [8; 32]), SlanaError::SeedMismatch);
    assert!(!env.config().pass_revealed);

    assert_ok(env.reveal_as(&admin, SEED));
    let config = env.config();
    assert!(config.pass_revealed);
    assert_eq!(config.pass_seed, SEED);
    // final seed = sha256(seed || entropy)
    let mut both = SEED.to_vec();
    both.extend_from_slice(&[0x42; 32]);
    assert_eq!(config.pass_final_seed, hash(&both).to_bytes());
    assert_ne!(config.pass_final_seed, SEED);

    // Once.
    assert_error(env.reveal_as(&admin, SEED), SlanaError::AlreadyRevealed);
    assert_error(
        env.set_seed_hash_as(&admin, hash(&SEED).to_bytes()),
        SlanaError::AlreadyRevealed,
    );
    assert_error(
        env.update_config(UpdateConfigArgs {
            pass_mint_open: Some(true),
            ..Default::default()
        }),
        SlanaError::AlreadyRevealed,
    );
}

#[test]
fn reveal_needs_a_committed_seed() {
    let mut env = core_env();
    let admin = env.admin.insecure_clone();
    assert_error(env.reveal_as(&admin, SEED), SlanaError::SeedNotSet);
    // The commitment may change until the first mint.
    let commitment = hash(&SEED).to_bytes();
    assert_ok(env.set_seed_hash_as(&admin, [9; 32]));
    assert_ok(env.set_seed_hash_as(&admin, commitment));
    assert_eq!(env.config().pass_seed_hash, commitment);
    let not_admin = env.funded_keypair(SOL);
    assert_error(
        env.set_seed_hash_as(&not_admin, commitment),
        SlanaError::Unauthorized,
    );
    // Committed, but the mint never ended: no reveal.
    assert_error(env.reveal_as(&admin, SEED), SlanaError::MintStillOpen);
}

#[test]
fn reveal_only_after_the_mint_ended() {
    let (mut env, _) = mint_env();
    let admin = env.admin.insecure_clone();
    let a = env.funded_keypair(10 * SOL);
    assert_ok(env.mint_pass(&a).0);

    // Mint open and not sold out: the seed stays secret.
    assert_error(env.reveal_as(&admin, SEED), SlanaError::MintStillOpen);
    // A paused start time does not end the mint either.
    let later = env.now() + 1_000;
    assert_ok(env.update_config(UpdateConfigArgs {
        pass_mint_start_ts: Some(later),
        ..Default::default()
    }));
    assert_error(env.reveal_as(&admin, SEED), SlanaError::MintStillOpen);
    assert!(!env.config().pass_revealed);

    env.warp_to_slot(9_000);
    assert_ok(env.close_mint());
    let target = env.config().pass_entropy_target_slot;
    env.warp_to_slot(target + 2);
    env.slot_hashes_range(target - 1, target + 1);
    assert_ok(env.capture_entropy_as(&a));
    assert_ok(env.reveal_as(&admin, SEED));
    let config = env.config();
    assert_eq!(
        config.pass_final_seed,
        slana::logic::pass_final_seed(&SEED, &config.pass_entropy)
    );
    let b = env.funded_keypair(10 * SOL);
    assert_error(env.mint_pass(&b).0, SlanaError::MintClosed);
}

#[test]
fn mint_open_and_close_before_any_mint_keeps_no_entropy() {
    let (mut env, _) = mint_env();
    // Nothing minted: closing via update_config is fine and can be undone.
    assert_ok(env.update_config(UpdateConfigArgs {
        pass_mint_open: Some(false),
        ..Default::default()
    }));
    let config = env.config();
    assert!(!config.pass_mint_ended);
    assert_eq!(config.pass_entropy_target_slot, 0);
    assert_ok(env.update_config(UpdateConfigArgs {
        pass_mint_open: Some(true),
        ..Default::default()
    }));
    let a = env.funded_keypair(10 * SOL);
    assert_ok(env.mint_pass(&a).0);
    // The supply stayed frozen throughout (R17).
    assert_error(
        env.update_config(UpdateConfigArgs {
            pass_supply: Some(10),
            ..Default::default()
        }),
        SlanaError::SupplyLocked,
    );
}

#[test]
fn mint_needs_a_base_uri() {
    let mut env = core_env();
    let admin = env.admin.insecure_clone();
    let collection = env.create_core_collection(&pass_authority_pda());
    assert_ok(env.set_collection_as(&admin, &collection));
    assert_ok(env.set_seed_hash_as(&admin, hash(&SEED).to_bytes()));
    assert_ok(env.update_config(UpdateConfigArgs {
        pass_mint_open: Some(true),
        ..Default::default()
    }));
    let a = env.funded_keypair(10 * SOL);
    assert_error(env.mint_pass(&a).0, SlanaError::BadBaseUri);
    assert_eq!(env.config().pass_minted, 0);
}
