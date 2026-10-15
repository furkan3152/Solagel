//! Conformance for Token-2022 game mints with variable-length extensions (the real $SLANA is a
//! pump.fun token; pump.fun's Token-2022 mints carry MetadataPointer + TokenMetadata). The
//! mint's TLV data then ends with a variable-length TokenMetadata entry (name / symbol / uri),
//! optionally next to GroupPointer, InterestBearingConfig or ScaledUiAmount. The whole money
//! path (initialize, create_arena, join, settle with fee split and burn) must behave the same
//! under both builds (`SLANA_IMPL=ref|lean`).

mod common;

use {
    anchor_spl::{
        token_2022::spl_token_2022::{
            extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
            state::{Account as TokenAccountState, Mint as MintState},
        },
        token_2022_extensions::spl_token_metadata_interface::state::TokenMetadata,
    },
    common::*,
    slana::constants::*,
    solana_signer::Signer,
};

const KINDS: [MintKind; 3] = [
    MintKind::Token2022Metadata,
    MintKind::Token2022MetadataGroupInterest,
    MintKind::Token2022MetadataScaledUi,
];

fn expected_extensions(kind: MintKind) -> Vec<ExtensionType> {
    match kind {
        MintKind::Token2022Metadata => {
            vec![ExtensionType::MetadataPointer, ExtensionType::TokenMetadata]
        }
        MintKind::Token2022MetadataGroupInterest => vec![
            ExtensionType::MetadataPointer,
            ExtensionType::GroupPointer,
            ExtensionType::InterestBearingConfig,
            ExtensionType::TokenMetadata,
        ],
        MintKind::Token2022MetadataScaledUi => vec![
            ExtensionType::MetadataPointer,
            ExtensionType::ScaledUiAmount,
            ExtensionType::TokenMetadata,
        ],
        _ => unreachable!(),
    }
}

/// The mint's TokenMetadata, read back with spl-token-2022.
fn token_metadata(env: &TestEnv) -> TokenMetadata {
    let account = env.svm.get_account(&env.mint).expect("mint account");
    let state = StateWithExtensions::<MintState>::unpack(&account.data).expect("unpack mint");
    state
        .get_variable_len_extension::<TokenMetadata>()
        .expect("token metadata")
}

#[test]
fn token2022_mint_with_variable_length_extensions_full_money_path() {
    for kind in KINDS {
        // initialize: the variable-length TokenMetadata (and its neighbours) are allowed.
        let mut env = TestEnv::initialized_with(kind);
        let (mint_state, types) = env.mint_state(&env.mint);
        assert_eq!(types, expected_extensions(kind), "{kind:?}");
        assert!(mint_state.freeze_authority.is_none());
        let metadata = token_metadata(&env);
        assert_eq!(
            (metadata.name.as_str(), metadata.symbol.as_str(), metadata.uri.as_str()),
            (META_NAME, META_SYMBOL, META_URI)
        );
        let mint_len = env.svm.get_account(&env.mint).unwrap().data.len();
        assert!(mint_len > ExtensionType::try_calculate_account_len::<MintState>(&types[..1]).unwrap());
        let config = env.config();
        assert_eq!(config.token_mint, env.mint);
        assert_eq!(config.token_program, kind.program());
        assert_eq!(config.token_decimals, DECIMALS);

        // create_arena: the vault is a plain Token-2022 account (no mint extension here needs
        // an account extension), owned by the token program and holding nothing.
        assert_ok(env.create_arena(1, 1_000, 300, false));
        let vault = vault_pda(&arena_pda(1));
        assert_eq!(env.owner_of(&vault), kind.program(), "{kind:?}");
        assert_eq!(
            env.svm.get_account(&vault).unwrap().data.len(),
            ExtensionType::try_calculate_account_len::<TokenAccountState>(&[]).unwrap(),
            "{kind:?}"
        );
        assert_eq!(env.tokens(&vault), 0);
        assert_eq!(env.token_account(&vault).mint, env.mint);

        // join: both entry fees move into the vault.
        let a = env.token_player("a", 1_000);
        let b = env.token_player("b", 1_000);
        assert_ok(env.join(&a, 1));
        assert_ok(env.join(&b, 1));
        assert_eq!(env.tokens(&vault), 2_000);
        assert_eq!(env.tokens(&env.player_ata(&a.pubkey())), 0);
        let supply = env.mint_supply();
        assert_eq!(supply, 2_000);

        // settle a winner: payout 1500 → profit 500, fee 5 % = 25 (treasury 12, season 8,
        // burn 5); A receives 1475.
        assert_ok(env.settle(&a.pubkey(), 1, 1_500, 42, 1, 3));
        assert_eq!(env.tokens(&env.player_ata(&a.pubkey())), 1_475, "{kind:?}");
        assert_eq!(env.tokens(&treasury_vault_pda()), 12);
        assert_eq!(env.season(FIRST_SEASON).pool, 8);
        assert_eq!(env.tokens(&season_vault_pda()), 8);
        assert_eq!(env.mint_supply(), supply - 5, "{kind:?}");
        assert!(env.session(1, &a.pubkey()).is_none());

        // settle a loser: payout 500 (no profit, no fee).
        assert_ok(env.settle(&b.pubkey(), 1, 500, 7, 0, 1));
        assert_eq!(env.tokens(&env.player_ata(&b.pubkey())), 500);
        assert_eq!(env.tokens(&vault), 0);
        assert_eq!(env.mint_supply(), supply - 5);
        let arena = env.arena(1);
        assert_eq!(arena.open_sessions, 0);
        assert_eq!(arena.total_paid_out, 2_000);

        // The mint and its metadata are untouched by the program.
        assert_eq!(env.svm.get_account(&env.mint).unwrap().data.len(), mint_len);
        assert_eq!(token_metadata(&env).name, META_NAME);
        assert_eq!(env.mint_state(&env.mint).1, expected_extensions(kind));
    }
}
