//! Shared LiteSVM harness for the Slana integration tests.
//!
//! The program is deployed with the upgradeable loader (BPF loader v3) and the test admin is
//! made its upgrade authority, so `initialize`'s ProgramData check runs for real. LiteSVM's
//! default programs (SPL Token, Token-2022, Associated Token Account) are loaded, and the
//! token helpers below build real mints and token accounts with their instructions.

#![allow(dead_code)]
// `TxResult` is LiteSVM's own result type; its error variant is large by design.
#![allow(clippy::result_large_err)]

use {
    anchor_lang::{
        error::ErrorCode as AnchorErrorCode,
        prelude::{Clock, Pubkey},
        solana_program::{
            bpf_loader_upgradeable::{self, UpgradeableLoaderState},
            instruction::{error::InstructionError, AccountMeta, Instruction},
            system_instruction, system_program,
        },
        AccountDeserialize, InstructionData, Space, ToAccountMetas,
    },
    anchor_spl::{
        associated_token::{
            get_associated_token_address_with_program_id,
            spl_associated_token_account::instruction::create_associated_token_account,
        },
        token::spl_token,
        token_2022::spl_token_2022::{
            self,
            extension::{
                metadata_pointer, transfer_fee, BaseStateWithExtensions, ExtensionType,
                StateWithExtensions,
            },
            state::{Account as TokenAccountState, Mint as MintState},
        },
    },
    litesvm::{
        types::{FailedTransactionMetadata, TransactionMetadata},
        LiteSVM,
    },
    slana::{
        constants::*,
        error::SlanaError,
        state::{Arena, Config, MintCounter, PassLock, PlayerProfile, Season, Session},
        InitializeArgs, JoinLimits, SettleArgs, UpdateConfigArgs,
    },
    solana_account::Account as SolanaAccount,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    solana_transaction_error::TransactionError,
    std::sync::LazyLock,
};

pub type TxResult = Result<TransactionMetadata, FailedTransactionMetadata>;

pub const SOL: u64 = 1_000_000_000;
/// Unix time the tests start at.
pub const START_TS: i64 = 1_760_000_000;
/// $SLANA (a pump.fun token) has 6 decimals.
pub const DECIMALS: u8 = 6;
/// One whole token in base units.
pub const TOKEN: u64 = 1_000_000;
pub const FEE_BPS: u16 = 500;
pub const PASS_FEE_BPS: u16 = 200;
pub const TREASURY_BPS: u16 = 5_000;
pub const SEASON_BPS: u16 = 3_000;
pub const BURN_BPS: u16 = 2_000;
pub const SETTLE_FEE_LAMPORTS: u64 = 20_000;
pub const ENTRY_FEE: u64 = 1_000 * TOKEN;

// ---------------------------------------------------------------------------------------
// Program under test: `SLANA_IMPL=lean` (default) or `ref`
// ---------------------------------------------------------------------------------------

/// Which build of the program the suite runs against, both deployed at `slana::ID`:
/// - `lean` (default): `target/deploy/slana_lean.so`, the Pinocchio program that is deployed
///   (`scripts/build-lean.sh`);
/// - `ref`: `target/deploy/slana.so`, the Anchor reference (`anchor build`), never deployed.
///
/// Instructions are always built, and accounts decoded, with the reference crate's Anchor
/// types: that is the conformance contract between the two builds.
pub fn program_impl() -> &'static str {
    static IMPL: LazyLock<&'static str> =
        LazyLock::new(|| match std::env::var("SLANA_IMPL").as_deref() {
            Err(_) | Ok("") | Ok("lean") => "lean",
            Ok("ref") => "ref",
            Ok(other) => panic!("SLANA_IMPL must be `lean` or `ref`, not `{other}`"),
        });
    *IMPL
}

/// Path of the `.so` selected by `SLANA_IMPL`.
pub fn program_so_path() -> String {
    let file = match program_impl() {
        "ref" => "slana.so",
        _ => "slana_lean.so",
    };
    format!("{}/../deploy/{file}", env!("CARGO_TARGET_TMPDIR"))
}

static PROGRAM_SO: LazyLock<Vec<u8>> = LazyLock::new(|| {
    let path = program_so_path();
    let hint = match program_impl() {
        "ref" => "run `anchor build --ignore-keys` at the repo root",
        _ => "run scripts/build-lean.sh",
    };
    std::fs::read(&path).unwrap_or_else(|e| panic!("{path} is missing ({e}): {hint}"))
});

// ---------------------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------------------

pub fn program_data_pda() -> Pubkey {
    bpf_loader_upgradeable::get_program_data_address(&slana::ID)
}

pub fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[CONFIG_SEED], &slana::ID).0
}

pub fn profile_pda(owner: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[PROFILE_SEED, owner.as_ref()], &slana::ID).0
}

pub fn arena_pda(id: u16) -> Pubkey {
    Pubkey::find_program_address(&[ARENA_SEED, &id.to_le_bytes()], &slana::ID).0
}

/// Token vault of an arena: `["vault", arena]`.
pub fn vault_pda(arena: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[VAULT_SEED, arena.as_ref()], &slana::ID).0
}

pub fn treasury_vault_pda() -> Pubkey {
    Pubkey::find_program_address(&[TREASURY_VAULT_SEED], &slana::ID).0
}

pub fn season_vault_pda() -> Pubkey {
    Pubkey::find_program_address(&[SEASON_VAULT_SEED], &slana::ID).0
}

pub fn session_pda(arena: &Pubkey, player: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[SESSION_SEED, arena.as_ref(), player.as_ref()], &slana::ID).0
}

pub fn season_pda(id: u32) -> Pubkey {
    Pubkey::find_program_address(&[SEASON_SEED, &id.to_le_bytes()], &slana::ID).0
}

/// Lock of a Pass asset while it backs an open session: `["pass_lock", asset]`.
pub fn pass_lock_pda(asset: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[PASS_LOCK_SEED, asset.as_ref()], &slana::ID).0
}

/// Signer PDA that is the update authority of the Pass collection: `["pass_authority"]`.
pub fn pass_authority_pda() -> Pubkey {
    Pubkey::find_program_address(&[PASS_AUTHORITY_SEED], &slana::ID).0
}

/// Per-wallet Pass mint counter: `["pass_minted", minter]`.
pub fn mint_counter_pda(minter: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[PASS_MINTED_SEED, minter.as_ref()], &slana::ID).0
}

pub fn ata(owner: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Pubkey {
    get_associated_token_address_with_program_id(owner, mint, token_program)
}

// ---------------------------------------------------------------------------------------
// Instruction builders (Anchor `instruction::X{..}.data()` + `accounts::X{..}`)
// ---------------------------------------------------------------------------------------

pub mod ix {
    use super::*;

    fn build(data: Vec<u8>, accounts: impl ToAccountMetas) -> Instruction {
        Instruction::new_with_bytes(slana::ID, &data, accounts.to_account_metas(None))
    }

    pub fn initialize(
        admin: &Pubkey,
        mint: &Pubkey,
        token_program: &Pubkey,
        args: InitializeArgs,
    ) -> Instruction {
        build(
            slana::instruction::Initialize { args }.data(),
            slana::accounts::Initialize {
                admin: *admin,
                config: config_pda(),
                season: season_pda(FIRST_SEASON),
                token_mint: *mint,
                token_program: *token_program,
                treasury_vault: treasury_vault_pda(),
                season_vault: season_vault_pda(),
                program: slana::ID,
                program_data: program_data_pda(),
                system_program: system_program::ID,
            },
        )
    }

    pub fn update_config(admin: &Pubkey, args: UpdateConfigArgs) -> Instruction {
        build(
            slana::instruction::UpdateConfig { args }.data(),
            slana::accounts::UpdateConfig {
                admin: *admin,
                config: config_pda(),
            },
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_arena(
        admin: &Pubkey,
        id: u16,
        entry_fee: u64,
        max_sessions: u16,
        requires_pass: bool,
        mint: &Pubkey,
        token_program: &Pubkey,
    ) -> Instruction {
        let arena = arena_pda(id);
        build(
            slana::instruction::CreateArena {
                id,
                entry_fee,
                max_sessions,
                requires_pass,
            }
            .data(),
            slana::accounts::CreateArena {
                admin: *admin,
                config: config_pda(),
                arena,
                vault: vault_pda(&arena),
                token_mint: *mint,
                token_program: *token_program,
                system_program: system_program::ID,
            },
        )
    }

    pub fn update_arena(
        admin: &Pubkey,
        id: u16,
        enabled: Option<bool>,
        max_sessions: Option<u16>,
        entry_fee: Option<u64>,
        requires_pass: Option<bool>,
    ) -> Instruction {
        build(
            slana::instruction::UpdateArena {
                enabled,
                max_sessions,
                entry_fee,
                requires_pass,
            }
            .data(),
            slana::accounts::UpdateArena {
                admin: *admin,
                config: config_pda(),
                arena: arena_pda(id),
            },
        )
    }

    pub fn withdraw_treasury(
        admin: &Pubkey,
        destination: &Pubkey,
        mint: &Pubkey,
        token_program: &Pubkey,
        amount: u64,
    ) -> Instruction {
        build(
            slana::instruction::WithdrawTreasury { amount }.data(),
            slana::accounts::WithdrawTreasury {
                admin: *admin,
                config: config_pda(),
                treasury_vault: treasury_vault_pda(),
                destination: *destination,
                token_mint: *mint,
                token_program: *token_program,
            },
        )
    }

    pub fn register_player(owner: &Pubkey, name: &str, skin: u8) -> Instruction {
        build(
            slana::instruction::RegisterPlayer {
                name: name.to_string(),
                skin,
            }
            .data(),
            slana::accounts::RegisterPlayer {
                owner: *owner,
                config: config_pda(),
                profile: profile_pda(owner),
                system_program: system_program::ID,
            },
        )
    }

    pub fn update_profile(owner: &Pubkey, name: Option<&str>, skin: Option<u8>) -> Instruction {
        update_profile_of(owner, &profile_pda(owner), name, skin)
    }

    /// `update_profile` with an explicit profile account (to test foreign profiles).
    pub fn update_profile_of(
        owner: &Pubkey,
        profile: &Pubkey,
        name: Option<&str>,
        skin: Option<u8>,
    ) -> Instruction {
        build(
            slana::instruction::UpdateProfile {
                name: name.map(str::to_string),
                skin,
            }
            .data(),
            slana::accounts::UpdateProfile {
                owner: *owner,
                profile: *profile,
            },
        )
    }

    pub fn join_arena(
        player: &Pubkey,
        arena_id: u16,
        mint: &Pubkey,
        token_program: &Pubkey,
        limits: JoinLimits,
    ) -> Instruction {
        let arena = arena_pda(arena_id);
        build(
            slana::instruction::JoinArena {
                max_fee_bps: limits.max_fee_bps,
                max_entry_fee: limits.max_entry_fee,
                max_settle_fee: limits.max_settle_fee,
            }
            .data(),
            slana::accounts::JoinArena {
                player: *player,
                config: config_pda(),
                profile: profile_pda(player),
                arena,
                vault: vault_pda(&arena),
                session: session_pda(&arena, player),
                player_token: ata(player, mint, token_program),
                token_mint: *mint,
                token_program: *token_program,
                system_program: system_program::ID,
            },
        )
    }

    pub fn join_arena_with_pass(
        player: &Pubkey,
        arena_id: u16,
        pass_asset: &Pubkey,
        mint: &Pubkey,
        token_program: &Pubkey,
        limits: JoinLimits,
    ) -> Instruction {
        let arena = arena_pda(arena_id);
        build(
            slana::instruction::JoinArenaWithPass {
                max_fee_bps: limits.max_fee_bps,
                max_entry_fee: limits.max_entry_fee,
                max_settle_fee: limits.max_settle_fee,
            }
            .data(),
            slana::accounts::JoinArenaWithPass {
                player: *player,
                config: config_pda(),
                profile: profile_pda(player),
                arena,
                vault: vault_pda(&arena),
                session: session_pda(&arena, player),
                player_token: ata(player, mint, token_program),
                token_mint: *mint,
                token_program: *token_program,
                pass_asset: *pass_asset,
                pass_lock: pass_lock_pda(pass_asset),
                system_program: system_program::ID,
            },
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn settle_session(
        server: &Pubkey,
        player: &Pubkey,
        arena_id: u16,
        season: u32,
        args: SettleArgs,
        pass_lock: Option<Pubkey>,
        player_token: Option<Pubkey>,
        mint: &Pubkey,
        token_program: &Pubkey,
    ) -> Instruction {
        let arena = arena_pda(arena_id);
        build(
            slana::instruction::SettleSession { args }.data(),
            slana::accounts::SettleSession {
                server: *server,
                config: config_pda(),
                arena,
                vault: vault_pda(&arena),
                session: session_pda(&arena, player),
                player: *player,
                player_token,
                profile: profile_pda(player),
                season: season_pda(season),
                treasury_vault: treasury_vault_pda(),
                season_vault: season_vault_pda(),
                token_mint: *mint,
                token_program: *token_program,
                pass_lock,
            },
        )
    }

    pub fn refund_session(
        player: &Pubkey,
        arena_id: u16,
        pass_lock: Option<Pubkey>,
        mint: &Pubkey,
        token_program: &Pubkey,
    ) -> Instruction {
        let arena = arena_pda(arena_id);
        build(
            slana::instruction::RefundSession {}.data(),
            slana::accounts::RefundSession {
                player: *player,
                config: config_pda(),
                arena,
                vault: vault_pda(&arena),
                session: session_pda(&arena, player),
                player_token: ata(player, mint, token_program),
                token_mint: *mint,
                token_program: *token_program,
                pass_lock,
            },
        )
    }

    pub fn sweep_arena(
        admin: &Pubkey,
        arena_id: u16,
        season: u32,
        mint: &Pubkey,
        token_program: &Pubkey,
    ) -> Instruction {
        let arena = arena_pda(arena_id);
        build(
            slana::instruction::SweepArena {}.data(),
            slana::accounts::SweepArena {
                admin: *admin,
                config: config_pda(),
                arena,
                vault: vault_pda(&arena),
                season: season_pda(season),
                season_vault: season_vault_pda(),
                token_mint: *mint,
                token_program: *token_program,
            },
        )
    }

    pub fn claim_season_reward(
        claimer: &Pubkey,
        season_id: u32,
        claimer_token: &Pubkey,
        mint: &Pubkey,
        token_program: &Pubkey,
    ) -> Instruction {
        build(
            slana::instruction::ClaimSeasonReward { season_id }.data(),
            slana::accounts::ClaimSeasonReward {
                claimer: *claimer,
                config: config_pda(),
                season: season_pda(season_id),
                season_vault: season_vault_pda(),
                claimer_token: *claimer_token,
                token_mint: *mint,
                token_program: *token_program,
            },
        )
    }

    pub fn rollover_season(admin: &Pubkey, season_id: u32, current_season: u32) -> Instruction {
        build(
            slana::instruction::RolloverSeason { season_id }.data(),
            slana::accounts::RolloverSeason {
                admin: *admin,
                config: config_pda(),
                old_season: season_pda(season_id),
                current_season: season_pda(current_season),
            },
        )
    }

    pub fn set_pass_collection(admin: &Pubkey, collection: &Pubkey) -> Instruction {
        build(
            slana::instruction::SetPassCollection {}.data(),
            slana::accounts::SetPassCollection {
                admin: *admin,
                config: config_pda(),
                collection: *collection,
                pass_authority: pass_authority_pda(),
            },
        )
    }

    pub fn set_pass_seed_hash(admin: &Pubkey, hash: [u8; 32]) -> Instruction {
        build(
            slana::instruction::SetPassSeedHash { hash }.data(),
            slana::accounts::SetPassSeedHash {
                admin: *admin,
                config: config_pda(),
            },
        )
    }

    pub fn mint_pass(
        minter: &Pubkey,
        asset: &Pubkey,
        collection: &Pubkey,
        minter_token: Option<Pubkey>,
    ) -> Instruction {
        build(
            slana::instruction::MintPass {}.data(),
            slana::accounts::MintPass {
                minter: *minter,
                asset: *asset,
                config: config_pda(),
                collection: *collection,
                pass_authority: pass_authority_pda(),
                mint_counter: mint_counter_pda(minter),
                minter_token,
                mpl_core_program: MPL_CORE_ID,
                system_program: system_program::ID,
            },
        )
    }

    pub fn close_pass_mint(admin: &Pubkey) -> Instruction {
        build(
            slana::instruction::ClosePassMint {}.data(),
            slana::accounts::ClosePassMint {
                admin: *admin,
                config: config_pda(),
            },
        )
    }

    pub fn capture_pass_entropy(signer: &Pubkey) -> Instruction {
        build(
            slana::instruction::CapturePassEntropy {}.data(),
            slana::accounts::CapturePassEntropy {
                signer: *signer,
                config: config_pda(),
                slot_hashes: SLOT_HASHES_ID,
            },
        )
    }

    pub fn reveal_pass(admin: &Pubkey, seed: [u8; 32]) -> Instruction {
        build(
            slana::instruction::RevealPass { seed }.data(),
            slana::accounts::RevealPass {
                admin: *admin,
                config: config_pda(),
            },
        )
    }

    /// Metaplex Core `CreateCollectionV2` (discriminator 21) with no plugins: accounts
    /// collection (w, s), update_authority, payer (w, s), system_program.
    pub fn core_create_collection(
        collection: &Pubkey,
        update_authority: &Pubkey,
        payer: &Pubkey,
        name: &str,
        uri: &str,
    ) -> Instruction {
        let mut data = vec![21u8];
        borsh_string(&mut data, name);
        borsh_string(&mut data, uri);
        data.extend_from_slice(&[0, 0]); // plugins None, external_plugin_adapters None
        Instruction {
            program_id: MPL_CORE_ID,
            accounts: vec![
                AccountMeta::new(*collection, true),
                AccountMeta::new_readonly(*update_authority, false),
                AccountMeta::new(*payer, true),
                AccountMeta::new_readonly(system_program::ID, false),
            ],
            data,
        }
    }

    pub fn end_season(admin: &Pubkey, current_season: u32) -> Instruction {
        build(
            slana::instruction::EndSeason {}.data(),
            slana::accounts::EndSeason {
                admin: *admin,
                config: config_pda(),
                season: season_pda(current_season),
                next_season: season_pda(current_season + 1),
                system_program: system_program::ID,
            },
        )
    }
}

// ---------------------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------------------

#[track_caller]
pub fn assert_ok(res: TxResult) -> TransactionMetadata {
    match res {
        Ok(meta) => meta,
        Err(e) => panic!("transaction failed: {:?}\n{}", e.err, e.meta.pretty_logs()),
    }
}

/// Asserts that the transaction failed with `InstructionError::Custom(code)`.
#[track_caller]
pub fn assert_custom_error(res: TxResult, code: u32) -> FailedTransactionMetadata {
    match res {
        Ok(meta) => panic!(
            "expected custom error {code}, but the transaction succeeded\n{}",
            meta.pretty_logs()
        ),
        Err(e) => {
            match &e.err {
                TransactionError::InstructionError(_, InstructionError::Custom(c))
                    if *c == code => {}
                other => panic!(
                    "expected custom error {code}, got {other:?}\n{}",
                    e.meta.pretty_logs()
                ),
            }
            e
        }
    }
}

/// Asserts that the transaction failed with the given program error.
#[track_caller]
pub fn assert_error(res: TxResult, err: SlanaError) {
    assert_custom_error(res, err.into());
}

/// Asserts that the transaction failed with the given Anchor framework error.
#[track_caller]
pub fn assert_anchor_error(res: TxResult, err: AnchorErrorCode) {
    assert_custom_error(res, err.into());
}

/// Asserts that an `init` failed because the account already exists
/// (System Program `AccountAlreadyInUse` = custom error 0).
#[track_caller]
pub fn assert_already_in_use(res: TxResult) {
    let failed = assert_custom_error(res, 0);
    assert!(
        failed
            .meta
            .logs
            .iter()
            .any(|l| l.contains("already in use")),
        "expected an 'already in use' log\n{}",
        failed.meta.pretty_logs()
    );
}

// ---------------------------------------------------------------------------------------
// Mints
// ---------------------------------------------------------------------------------------

/// How a test mint is built.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MintKind {
    /// Classic SPL Token mint.
    Spl,
    /// Token-2022 mint with a MetadataPointer extension (allowed, like pump.fun tokens).
    Token2022,
    /// Token-2022 mint with a TransferFeeConfig extension (denied).
    Token2022TransferFee,
    /// Token-2022 mint with a MintCloseAuthority extension (denied).
    Token2022CloseAuthority,
}

impl MintKind {
    pub fn program(self) -> Pubkey {
        match self {
            MintKind::Spl => spl_token::ID,
            MintKind::Token2022
            | MintKind::Token2022TransferFee
            | MintKind::Token2022CloseAuthority => spl_token_2022::ID,
        }
    }
}

// ---------------------------------------------------------------------------------------
// Test environment
// ---------------------------------------------------------------------------------------

pub struct TestEnv {
    pub svm: LiteSVM,
    /// Pays every transaction fee, so balance checks of other accounts stay exact.
    pub payer: Keypair,
    /// Upgrade authority of the program and admin of the config.
    pub admin: Keypair,
    pub server: Keypair,
    /// Mint authority of every test mint.
    pub mint_authority: Keypair,
    /// The game token (set by `initialized*`, `Pubkey::default()` before).
    pub mint: Pubkey,
    /// Token program owning `mint`.
    pub token_program: Pubkey,
}

impl TestEnv {
    /// Program deployed as an upgradeable program with `admin` as upgrade authority.
    /// `initialize` has not been called yet and no mint exists.
    pub fn deployed() -> Self {
        let admin = Keypair::new();
        let mut svm = LiteSVM::new();
        deploy_upgradeable(&mut svm, &admin.pubkey());

        let mut clock = svm.get_sysvar::<Clock>();
        clock.unix_timestamp = START_TS;
        svm.set_sysvar(&clock);

        let mut env = Self {
            svm,
            payer: Keypair::new(),
            admin,
            server: Keypair::new(),
            mint_authority: Keypair::new(),
            mint: Pubkey::default(),
            token_program: spl_token::ID,
        };
        let (payer, admin, server) = (env.payer.pubkey(), env.admin.pubkey(), env.server.pubkey());
        env.airdrop(&payer, 1_000 * SOL);
        env.airdrop(&admin, 100 * SOL);
        env.airdrop(&server, SOL);
        env
    }

    /// `deployed()` + an SPL Token game mint + `initialize` with the default arguments.
    pub fn initialized() -> Self {
        Self::initialized_with(MintKind::Spl)
    }

    /// `deployed()` + a game mint of `kind` + `initialize` with the default arguments.
    pub fn initialized_with(kind: MintKind) -> Self {
        let mut env = Self::deployed();
        let mint = env.create_mint(kind, None);
        env.mint = mint;
        env.token_program = kind.program();
        let admin = env.admin.insecure_clone();
        let args = env.default_init_args();
        assert_ok(env.initialize_as(&admin, &mint, &kind.program(), args));
        env
    }

    pub fn default_init_args(&self) -> InitializeArgs {
        InitializeArgs {
            server_authority: self.server.pubkey(),
            fee_bps: FEE_BPS,
            pass_fee_bps: PASS_FEE_BPS,
            treasury_bps: TREASURY_BPS,
            season_bps: SEASON_BPS,
            burn_bps: BURN_BPS,
            settle_fee_lamports: SETTLE_FEE_LAMPORTS,
        }
    }

    // ----- transactions ------------------------------------------------------------------

    /// Sends `ixs` with `payer` as fee payer, signed by `signers` (deduplicated).
    pub fn send(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> TxResult {
        let mut all: Vec<&Keypair> = vec![&self.payer];
        for signer in signers {
            if !all.iter().any(|k| k.pubkey() == signer.pubkey()) {
                all.push(signer);
            }
        }
        let message = Message::new_with_blockhash(
            ixs,
            Some(&self.payer.pubkey()),
            &self.svm.latest_blockhash(),
        );
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(message), &all)
            .expect("sign transaction");
        let res = self.svm.send_transaction(tx);
        // A fresh blockhash keeps identical follow-up transactions from being deduplicated.
        self.svm.expire_blockhash();
        res
    }

    pub fn airdrop(&mut self, to: &Pubkey, lamports: u64) {
        self.svm.airdrop(to, lamports).expect("airdrop");
        self.svm.expire_blockhash();
    }

    pub fn funded_keypair(&mut self, lamports: u64) -> Keypair {
        let kp = Keypair::new();
        self.airdrop(&kp.pubkey(), lamports);
        kp
    }

    /// A funded (10 SOL) and registered player with skin 0.
    pub fn new_player(&mut self, name: &str) -> Keypair {
        let kp = self.funded_keypair(10 * SOL);
        assert_ok(self.register(&kp, name, 0));
        kp
    }

    pub fn initialize_as(
        &mut self,
        signer: &Keypair,
        mint: &Pubkey,
        token_program: &Pubkey,
        args: InitializeArgs,
    ) -> TxResult {
        self.send(
            &[ix::initialize(&signer.pubkey(), mint, token_program, args)],
            &[signer],
        )
    }

    pub fn update_config_as(&mut self, signer: &Keypair, args: UpdateConfigArgs) -> TxResult {
        self.send(&[ix::update_config(&signer.pubkey(), args)], &[signer])
    }

    pub fn update_config(&mut self, args: UpdateConfigArgs) -> TxResult {
        let admin = self.admin.insecure_clone();
        self.update_config_as(&admin, args)
    }

    pub fn create_arena_as(
        &mut self,
        signer: &Keypair,
        id: u16,
        entry_fee: u64,
        max_sessions: u16,
        requires_pass: bool,
    ) -> TxResult {
        let (mint, token_program) = (self.mint, self.token_program);
        self.send(
            &[ix::create_arena(
                &signer.pubkey(),
                id,
                entry_fee,
                max_sessions,
                requires_pass,
                &mint,
                &token_program,
            )],
            &[signer],
        )
    }

    pub fn create_arena(
        &mut self,
        id: u16,
        entry_fee: u64,
        max_sessions: u16,
        requires_pass: bool,
    ) -> TxResult {
        let admin = self.admin.insecure_clone();
        self.create_arena_as(&admin, id, entry_fee, max_sessions, requires_pass)
    }

    pub fn update_arena_as(
        &mut self,
        signer: &Keypair,
        id: u16,
        enabled: Option<bool>,
        max_sessions: Option<u16>,
        entry_fee: Option<u64>,
        requires_pass: Option<bool>,
    ) -> TxResult {
        self.send(
            &[ix::update_arena(
                &signer.pubkey(),
                id,
                enabled,
                max_sessions,
                entry_fee,
                requires_pass,
            )],
            &[signer],
        )
    }

    pub fn update_arena(
        &mut self,
        id: u16,
        enabled: Option<bool>,
        max_sessions: Option<u16>,
        entry_fee: Option<u64>,
        requires_pass: Option<bool>,
    ) -> TxResult {
        let admin = self.admin.insecure_clone();
        self.update_arena_as(&admin, id, enabled, max_sessions, entry_fee, requires_pass)
    }

    pub fn withdraw_treasury_as(
        &mut self,
        signer: &Keypair,
        destination: &Pubkey,
        amount: u64,
    ) -> TxResult {
        let (mint, token_program) = (self.mint, self.token_program);
        self.send(
            &[ix::withdraw_treasury(
                &signer.pubkey(),
                destination,
                &mint,
                &token_program,
                amount,
            )],
            &[signer],
        )
    }

    pub fn register(&mut self, owner: &Keypair, name: &str, skin: u8) -> TxResult {
        self.send(
            &[ix::register_player(&owner.pubkey(), name, skin)],
            &[owner],
        )
    }

    pub fn update_profile(
        &mut self,
        owner: &Keypair,
        name: Option<&str>,
        skin: Option<u8>,
    ) -> TxResult {
        self.send(&[ix::update_profile(&owner.pubkey(), name, skin)], &[owner])
    }

    pub fn end_season(&mut self) -> TxResult {
        let admin = self.admin.insecure_clone();
        let season = self.config().current_season;
        self.send(&[ix::end_season(&admin.pubkey(), season)], &[&admin])
    }

    // ----- arenas & sessions ---------------------------------------------------------------

    /// A registered player (10 SOL) with a game-token ATA holding `tokens` base units.
    pub fn token_player(&mut self, name: &str, tokens: u64) -> Keypair {
        let kp = self.new_player(name);
        let account = self.create_ata(&kp.pubkey());
        if tokens > 0 {
            self.mint_to(&account, tokens);
        }
        kp
    }

    /// The player's game-token ATA.
    pub fn player_ata(&self, player: &Pubkey) -> Pubkey {
        ata(player, &self.mint, &self.token_program)
    }

    /// Game-token balance of a token account.
    pub fn tokens(&self, address: &Pubkey) -> u64 {
        self.token_account(address).amount
    }

    pub fn mint_supply(&self) -> u64 {
        self.mint_state(&self.mint).0.supply
    }

    /// Limits that accept whatever the arena and config currently charge (up to the caps).
    pub fn loose_limits() -> JoinLimits {
        JoinLimits {
            max_fee_bps: MAX_FEE_BPS,
            max_entry_fee: u64::MAX,
            max_settle_fee: MAX_SETTLE_FEE_LAMPORTS,
        }
    }

    /// `join_arena` accepting any fee up to the program's cap (`MAX_FEE_BPS`).
    pub fn join(&mut self, player: &Keypair, arena_id: u16) -> TxResult {
        self.join_max(player, arena_id, MAX_FEE_BPS)
    }

    /// `join_arena` with the fee bound the player signed.
    pub fn join_max(&mut self, player: &Keypair, arena_id: u16, max_fee_bps: u16) -> TxResult {
        self.join_limits(
            player,
            arena_id,
            JoinLimits {
                max_fee_bps,
                ..Self::loose_limits()
            },
        )
    }

    /// `join_arena` with all three signed bounds.
    pub fn join_limits(&mut self, player: &Keypair, arena_id: u16, limits: JoinLimits) -> TxResult {
        let (mint, program) = (self.mint, self.token_program);
        self.send(
            &[ix::join_arena(
                &player.pubkey(),
                arena_id,
                &mint,
                &program,
                limits,
            )],
            &[player],
        )
    }

    pub fn join_with_pass(&mut self, player: &Keypair, arena_id: u16, asset: &Pubkey) -> TxResult {
        self.join_with_pass_max(player, arena_id, asset, MAX_FEE_BPS)
    }

    pub fn join_with_pass_max(
        &mut self,
        player: &Keypair,
        arena_id: u16,
        asset: &Pubkey,
        max_fee_bps: u16,
    ) -> TxResult {
        self.join_with_pass_limits(
            player,
            arena_id,
            asset,
            JoinLimits {
                max_fee_bps,
                ..Self::loose_limits()
            },
        )
    }

    pub fn join_with_pass_limits(
        &mut self,
        player: &Keypair,
        arena_id: u16,
        asset: &Pubkey,
        limits: JoinLimits,
    ) -> TxResult {
        let (mint, program) = (self.mint, self.token_program);
        self.send(
            &[ix::join_arena_with_pass(
                &player.pubkey(),
                arena_id,
                asset,
                &mint,
                &program,
                limits,
            )],
            &[player],
        )
    }

    /// `settle_session` signed by `signer` with explicit arguments and lock account, paying
    /// into the player's associated token account.
    pub fn settle_as(
        &mut self,
        signer: &Keypair,
        player: &Pubkey,
        arena_id: u16,
        args: SettleArgs,
        pass_lock: Option<Pubkey>,
    ) -> TxResult {
        let token = Some(self.player_ata(player));
        self.settle_as_with(signer, player, arena_id, args, pass_lock, token)
    }

    /// `settle_session` with an explicit (optional) player token account.
    pub fn settle_as_with(
        &mut self,
        signer: &Keypair,
        player: &Pubkey,
        arena_id: u16,
        args: SettleArgs,
        pass_lock: Option<Pubkey>,
        player_token: Option<Pubkey>,
    ) -> TxResult {
        let (mint, program) = (self.mint, self.token_program);
        let season = self.config().current_season;
        self.send(
            &[ix::settle_session(
                &signer.pubkey(),
                player,
                arena_id,
                season,
                args,
                pass_lock,
                player_token,
                &mint,
                &program,
            )],
            &[signer],
        )
    }

    /// Server settlement of the player's open session (its id and Pass lock read from chain).
    pub fn settle(
        &mut self,
        player: &Pubkey,
        arena_id: u16,
        payout: u64,
        score: u32,
        kills: u16,
        xp: u32,
    ) -> TxResult {
        let token = Some(self.player_ata(player));
        self.settle_to(player, arena_id, payout, score, kills, xp, token)
    }

    /// Server settlement without a player token account: finalizes the session with `owed`.
    pub fn settle_finalize(&mut self, player: &Pubkey, arena_id: u16, payout: u64) -> TxResult {
        self.settle_to(player, arena_id, payout, 0, 0, 0, None)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn settle_to(
        &mut self,
        player: &Pubkey,
        arena_id: u16,
        payout: u64,
        score: u32,
        kills: u16,
        xp: u32,
        player_token: Option<Pubkey>,
    ) -> TxResult {
        let session = self
            .session(arena_id, player)
            .expect("open session to settle");
        let lock = session.has_pass.then(|| pass_lock_pda(&session.pass_asset));
        let server = self.server.insecure_clone();
        self.settle_as_with(
            &server,
            player,
            arena_id,
            SettleArgs {
                session_id: session.id,
                payout,
                score,
                kills,
                xp,
            },
            lock,
            player_token,
        )
    }

    pub fn refund_with(
        &mut self,
        player: &Keypair,
        arena_id: u16,
        pass_lock: Option<Pubkey>,
    ) -> TxResult {
        let (mint, program) = (self.mint, self.token_program);
        self.send(
            &[ix::refund_session(
                &player.pubkey(),
                arena_id,
                pass_lock,
                &mint,
                &program,
            )],
            &[player],
        )
    }

    /// Refund of the player's open session (with its Pass lock when it has one).
    pub fn refund(&mut self, player: &Keypair, arena_id: u16) -> TxResult {
        let lock = self
            .session(arena_id, &player.pubkey())
            .filter(|s| s.has_pass && !s.finalized)
            .map(|s| pass_lock_pda(&s.pass_asset));
        self.refund_with(player, arena_id, lock)
    }

    pub fn sweep_as(&mut self, signer: &Keypair, arena_id: u16) -> TxResult {
        let (mint, program) = (self.mint, self.token_program);
        let season = self.config().current_season;
        self.send(
            &[ix::sweep_arena(
                &signer.pubkey(),
                arena_id,
                season,
                &mint,
                &program,
            )],
            &[signer],
        )
    }

    pub fn sweep(&mut self, arena_id: u16) -> TxResult {
        let admin = self.admin.insecure_clone();
        self.sweep_as(&admin, arena_id)
    }

    pub fn pass_lock(&self, asset: &Pubkey) -> Option<PassLock> {
        self.try_fetch(&pass_lock_pda(asset))
    }

    /// Rent of a `Session` account.
    pub fn session_rent(&self) -> u64 {
        self.rent(8 + Session::INIT_SPACE)
    }

    /// Rent of a `PassLock` account.
    pub fn pass_lock_rent(&self) -> u64 {
        self.rent(8 + PassLock::INIT_SPACE)
    }

    // ----- Slana Pass (fake Metaplex Core accounts) ----------------------------------------

    /// Test-only config write: sets `config.pass_collection`.
    pub fn set_pass_collection(&mut self, collection: &Pubkey) {
        let mut config = self.config();
        config.pass_collection = *collection;
        self.write_account(&config_pda(), &config);
    }

    /// A fresh Pass collection (set in the config) and a Pass asset of it owned by `owner`.
    pub fn give_pass(&mut self, owner: &Pubkey) -> (Pubkey, Pubkey) {
        let collection = Pubkey::new_unique();
        self.set_pass_collection(&collection);
        let asset = fake_core_asset(&mut self.svm, owner, &collection);
        (collection, asset)
    }

    // ----- seasons -------------------------------------------------------------------------

    /// `claim_season_reward` by `claimer` into their game-token ATA.
    pub fn claim(&mut self, claimer: &Keypair, season_id: u32) -> TxResult {
        let (mint, program) = (self.mint, self.token_program);
        let to = self.player_ata(&claimer.pubkey());
        self.send(
            &[ix::claim_season_reward(
                &claimer.pubkey(),
                season_id,
                &to,
                &mint,
                &program,
            )],
            &[claimer],
        )
    }

    pub fn rollover_as(&mut self, signer: &Keypair, season_id: u32) -> TxResult {
        let current = self.config().current_season;
        self.send(
            &[ix::rollover_season(&signer.pubkey(), season_id, current)],
            &[signer],
        )
    }

    pub fn rollover(&mut self, season_id: u32) -> TxResult {
        let admin = self.admin.insecure_clone();
        self.rollover_as(&admin, season_id)
    }

    // ----- Slana Pass (real Metaplex Core) -------------------------------------------------

    /// Creates a real Core collection whose update authority is `update_authority`.
    pub fn create_core_collection(&mut self, update_authority: &Pubkey) -> Pubkey {
        let collection = Keypair::new();
        let payer = self.payer.pubkey();
        assert_ok(self.send(
            &[ix::core_create_collection(
                &collection.pubkey(),
                update_authority,
                &payer,
                "Slana Pass",
                "https://slana.example/pass/collection.json",
            )],
            &[&collection],
        ));
        collection.pubkey()
    }

    pub fn set_collection_as(&mut self, signer: &Keypair, collection: &Pubkey) -> TxResult {
        self.send(
            &[ix::set_pass_collection(&signer.pubkey(), collection)],
            &[signer],
        )
    }

    pub fn set_seed_hash_as(&mut self, signer: &Keypair, hash: [u8; 32]) -> TxResult {
        self.send(&[ix::set_pass_seed_hash(&signer.pubkey(), hash)], &[signer])
    }

    pub fn close_mint_as(&mut self, signer: &Keypair) -> TxResult {
        self.send(&[ix::close_pass_mint(&signer.pubkey())], &[signer])
    }

    pub fn close_mint(&mut self) -> TxResult {
        let admin = self.admin.insecure_clone();
        self.close_mint_as(&admin)
    }

    pub fn capture_entropy_as(&mut self, signer: &Keypair) -> TxResult {
        self.send(&[ix::capture_pass_entropy(&signer.pubkey())], &[signer])
    }

    pub fn slot(&self) -> u64 {
        self.svm.get_sysvar::<Clock>().slot
    }

    /// Sets the clock's slot (the SlotHashes sysvar is not touched; see `set_slot_hashes`).
    pub fn warp_to_slot(&mut self, slot: u64) {
        self.svm.warp_to_slot(slot);
    }

    /// SlotHashes with one entry per slot in `from..=to` (newest first), hash byte = slot as u8.
    pub fn slot_hashes_range(&mut self, from: u64, to: u64) {
        let entries: Vec<(u64, [u8; 32])> = (from..=to).rev().map(|s| (s, [s as u8; 32])).collect();
        self.set_slot_hashes(&entries);
    }

    /// Replaces the SlotHashes sysvar with `entries` (newest first), in its bincode layout.
    pub fn set_slot_hashes(&mut self, entries: &[(u64, [u8; 32])]) {
        let mut data = (entries.len() as u64).to_le_bytes().to_vec();
        for (slot, hash) in entries {
            data.extend_from_slice(&slot.to_le_bytes());
            data.extend_from_slice(hash);
        }
        // The real account is always sized for 512 entries.
        data.resize(data.len().max(8 + 512 * 40), 0);
        let account = SolanaAccount {
            lamports: self.rent(data.len()),
            data,
            owner: anchor_lang::prelude::pubkey!("Sysvar1111111111111111111111111111111111111"),
            executable: false,
            rent_epoch: 0,
        };
        self.svm
            .set_account(SLOT_HASHES_ID, account)
            .expect("set slot hashes");
    }

    pub fn reveal_as(&mut self, signer: &Keypair, seed: [u8; 32]) -> TxResult {
        self.send(&[ix::reveal_pass(&signer.pubkey(), seed)], &[signer])
    }

    /// `mint_pass` of a fresh asset keypair into the configured collection; returns the
    /// result and the asset address.
    pub fn mint_pass_with(
        &mut self,
        minter: &Keypair,
        minter_token: Option<Pubkey>,
    ) -> (TxResult, Pubkey) {
        let asset = Keypair::new();
        // Before a collection is set, any writable account stands in for it.
        let collection = Some(self.config().pass_collection)
            .filter(|c| *c != Pubkey::default())
            .unwrap_or_else(Pubkey::new_unique);
        let res = self.send(
            &[ix::mint_pass(
                &minter.pubkey(),
                &asset.pubkey(),
                &collection,
                minter_token,
            )],
            &[minter, &asset],
        );
        (res, asset.pubkey())
    }

    /// `mint_pass` passing the minter's game-token ATA when it exists.
    pub fn mint_pass(&mut self, minter: &Keypair) -> (TxResult, Pubkey) {
        let ata = self.player_ata(&minter.pubkey());
        let token = self.svm.get_account(&ata).map(|_| ata);
        self.mint_pass_with(minter, token)
    }

    pub fn mint_counter(&self, minter: &Pubkey) -> Option<MintCounter> {
        self.try_fetch(&mint_counter_pda(minter))
    }

    // ----- tokens ------------------------------------------------------------------------

    /// Creates a mint of `kind` with `DECIMALS` decimals, `mint_authority` as mint authority
    /// and the given freeze authority.
    pub fn create_mint(&mut self, kind: MintKind, freeze_authority: Option<Pubkey>) -> Pubkey {
        let mint = Keypair::new();
        let program = kind.program();
        let authority = self.mint_authority.pubkey();
        let payer = self.payer.pubkey();

        let extensions: &[ExtensionType] = match kind {
            MintKind::Spl => &[],
            MintKind::Token2022 => &[ExtensionType::MetadataPointer],
            MintKind::Token2022TransferFee => &[ExtensionType::TransferFeeConfig],
            MintKind::Token2022CloseAuthority => &[ExtensionType::MintCloseAuthority],
        };
        let space =
            ExtensionType::try_calculate_account_len::<MintState>(extensions).expect("mint length");
        let lamports = self.svm.minimum_balance_for_rent_exemption(space);

        let mut ixs = vec![system_instruction::create_account(
            &payer,
            &mint.pubkey(),
            lamports,
            space as u64,
            &program,
        )];
        match kind {
            MintKind::Spl => {}
            MintKind::Token2022 => ixs.push(
                metadata_pointer::instruction::initialize(
                    &program,
                    &mint.pubkey(),
                    Some(authority),
                    Some(mint.pubkey()),
                )
                .expect("metadata pointer ix"),
            ),
            MintKind::Token2022TransferFee => ixs.push(
                transfer_fee::instruction::initialize_transfer_fee_config(
                    &program,
                    &mint.pubkey(),
                    Some(&authority),
                    Some(&authority),
                    100,
                    u64::MAX,
                )
                .expect("transfer fee ix"),
            ),
            MintKind::Token2022CloseAuthority => ixs.push(
                spl_token_2022::instruction::initialize_mint_close_authority(
                    &program,
                    &mint.pubkey(),
                    Some(&authority),
                )
                .expect("mint close authority ix"),
            ),
        }
        ixs.push(
            spl_token_2022::instruction::initialize_mint2(
                &program,
                &mint.pubkey(),
                &authority,
                freeze_authority.as_ref(),
                DECIMALS,
            )
            .expect("initialize mint ix"),
        );
        assert_ok(self.send(&ixs, &[&mint]));
        mint.pubkey()
    }

    /// Creates the associated token account of `owner` for the game mint.
    pub fn create_ata(&mut self, owner: &Pubkey) -> Pubkey {
        let (mint, program) = (self.mint, self.token_program);
        let payer = self.payer.pubkey();
        assert_ok(self.send(
            &[create_associated_token_account(
                &payer, owner, &mint, &program,
            )],
            &[],
        ));
        ata(owner, &mint, &program)
    }

    /// Mints `amount` game tokens into the token account `to`.
    pub fn mint_to(&mut self, to: &Pubkey, amount: u64) {
        let (mint, program) = (self.mint, self.token_program);
        let authority = self.mint_authority.insecure_clone();
        let ix = spl_token_2022::instruction::mint_to(
            &program,
            &mint,
            to,
            &authority.pubkey(),
            &[],
            amount,
        )
        .expect("mint_to ix");
        assert_ok(self.send(&[ix], &[&authority]));
    }

    /// Token account state (base fields; extensions ignored).
    #[track_caller]
    pub fn token_account(&self, address: &Pubkey) -> TokenAccountState {
        let account = self
            .svm
            .get_account(address)
            .unwrap_or_else(|| panic!("token account {address} does not exist"));
        StateWithExtensions::<TokenAccountState>::unpack(&account.data)
            .expect("unpack token account")
            .base
    }

    /// Owner program of `address`.
    #[track_caller]
    pub fn owner_of(&self, address: &Pubkey) -> Pubkey {
        self.svm
            .get_account(address)
            .unwrap_or_else(|| panic!("account {address} does not exist"))
            .owner
    }

    /// Mint state (base fields) plus its extension types.
    #[track_caller]
    pub fn mint_state(&self, address: &Pubkey) -> (MintState, Vec<ExtensionType>) {
        let account = self.svm.get_account(address).expect("mint account");
        let state = StateWithExtensions::<MintState>::unpack(&account.data).expect("unpack mint");
        let types = state.get_extension_types().expect("extension types");
        (state.base, types)
    }

    // ----- state -------------------------------------------------------------------------

    pub fn try_fetch<T: AccountDeserialize>(&self, address: &Pubkey) -> Option<T> {
        let account = self.svm.get_account(address)?;
        if account.lamports == 0 || account.data.is_empty() {
            return None;
        }
        Some(T::try_deserialize(&mut account.data.as_slice()).expect("deserialize account"))
    }

    #[track_caller]
    pub fn fetch<T: AccountDeserialize>(&self, address: &Pubkey) -> T {
        self.try_fetch(address)
            .unwrap_or_else(|| panic!("account {address} does not exist"))
    }

    pub fn config(&self) -> Config {
        self.fetch(&config_pda())
    }

    pub fn profile(&self, owner: &Pubkey) -> PlayerProfile {
        self.fetch(&profile_pda(owner))
    }

    pub fn arena(&self, id: u16) -> Arena {
        self.fetch(&arena_pda(id))
    }

    pub fn season(&self, id: u32) -> Season {
        self.fetch(&season_pda(id))
    }

    pub fn session(&self, arena_id: u16, player: &Pubkey) -> Option<Session> {
        self.try_fetch(&session_pda(&arena_pda(arena_id), player))
    }

    /// Overwrites a program account with `value` (test-only state surgery).
    pub fn write_account<T: anchor_lang::AccountSerialize>(&mut self, address: &Pubkey, value: &T) {
        let mut account = self.svm.get_account(address).expect("account to overwrite");
        let mut data = Vec::with_capacity(account.data.len());
        value.try_serialize(&mut data).expect("serialize account");
        assert!(data.len() <= account.data.len());
        account.data[..data.len()].copy_from_slice(&data);
        self.svm
            .set_account(*address, account)
            .expect("set account");
    }

    /// Lamports of `address` (0 when the account does not exist).
    pub fn balance(&self, address: &Pubkey) -> u64 {
        self.svm.get_balance(address).unwrap_or(0)
    }

    pub fn rent(&self, data_len: usize) -> u64 {
        self.svm.minimum_balance_for_rent_exemption(data_len)
    }

    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    /// Moves the clock forward by `secs` seconds.
    pub fn warp(&mut self, secs: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp += secs;
        self.svm.set_sysvar(&clock);
    }
}

/// Deploys the program with the upgradeable loader and makes `authority` its upgrade
/// authority. `LiteSVM::add_program` already creates the loader-v3 `Program` account and
/// its `ProgramData` account (with no authority); the ProgramData header is rewritten here.
pub fn deploy_upgradeable(svm: &mut LiteSVM, authority: &Pubkey) {
    svm.add_program(slana::ID, &PROGRAM_SO)
        .expect("load program");

    let program_account = svm.get_account(&slana::ID).expect("program account");
    assert_eq!(program_account.owner, bpf_loader_upgradeable::ID);
    assert!(program_account.executable);
    let program_state: UpgradeableLoaderState =
        bincode::deserialize(&program_account.data).expect("program state");
    assert_eq!(
        program_state,
        UpgradeableLoaderState::Program {
            programdata_address: program_data_pda()
        }
    );

    let programdata_address = program_data_pda();
    let mut programdata = svm
        .get_account(&programdata_address)
        .expect("programdata account");
    let metadata_len = UpgradeableLoaderState::size_of_programdata_metadata();
    let slot =
        match bincode::deserialize(&programdata.data[..metadata_len]).expect("programdata state") {
            UpgradeableLoaderState::ProgramData { slot, .. } => slot,
            other => panic!("expected ProgramData, got {other:?}"),
        };
    let header = bincode::serialize(&UpgradeableLoaderState::ProgramData {
        slot,
        upgrade_authority_address: Some(*authority),
    })
    .expect("serialize ProgramData header");
    assert_eq!(header.len(), metadata_len);
    programdata.data[..metadata_len].copy_from_slice(&header);
    svm.set_account(programdata_address, programdata)
        .expect("set programdata");
}

/// Upgrade authority stored in the ProgramData account.
pub fn upgrade_authority(svm: &LiteSVM) -> Option<Pubkey> {
    let programdata = svm.get_account(&program_data_pda())?;
    match bincode::deserialize(
        &programdata.data[..UpgradeableLoaderState::size_of_programdata_metadata()],
    )
    .ok()?
    {
        UpgradeableLoaderState::ProgramData {
            upgrade_authority_address,
            ..
        } => upgrade_authority_address,
        _ => None,
    }
}

// ---------------------------------------------------------------------------------------
// Metaplex Core
// ---------------------------------------------------------------------------------------

/// Loads the real Metaplex Core program (dumped from mainnet by `scripts/fetch-programs.sh`).
pub fn load_mpl_core(svm: &mut LiteSVM) {
    let path = concat!(env!("CARGO_TARGET_TMPDIR"), "/../programs/mpl_core.so");
    let bytes = std::fs::read(path)
        .unwrap_or_else(|e| panic!("{path} is missing ({e}): run scripts/fetch-programs.sh first"));
    svm.add_program(MPL_CORE_ID, &bytes).expect("load mpl_core");
}

// ---------------------------------------------------------------------------------------
// Fake Metaplex Core accounts
// ---------------------------------------------------------------------------------------

/// Borsh `String`: u32 little-endian length + bytes.
pub fn borsh_string(out: &mut Vec<u8>, value: &str) {
    out.extend_from_slice(&(value.len() as u32).to_le_bytes());
    out.extend_from_slice(value.as_bytes());
}

/// `BaseAssetV1` bytes: key 1 | owner | UpdateAuthority::Collection(collection) | name | uri |
/// seq None.
pub fn core_asset_data(owner: &Pubkey, collection: &Pubkey) -> Vec<u8> {
    let mut data = vec![1u8];
    data.extend_from_slice(owner.as_ref());
    data.push(2);
    data.extend_from_slice(collection.as_ref());
    borsh_string(&mut data, "Slana Pass #7");
    borsh_string(&mut data, "https://slana.example/pass/7.json");
    data.push(0);
    data
}

/// Writes an account owned by `MPL_CORE_ID` that looks like a Core asset of `collection`
/// owned by `owner`, and returns its address.
pub fn fake_core_asset(svm: &mut LiteSVM, owner: &Pubkey, collection: &Pubkey) -> Pubkey {
    let address = Pubkey::new_unique();
    write_core_account(svm, &address, core_asset_data(owner, collection));
    address
}

/// Rewrites the owner of a fake Core asset (simulates a transfer of the Pass).
pub fn set_core_asset_owner(svm: &mut LiteSVM, asset: &Pubkey, owner: &Pubkey) {
    let mut account = svm.get_account(asset).expect("core asset");
    account.data[1..33].copy_from_slice(owner.as_ref());
    svm.set_account(*asset, account).expect("set core asset");
}

/// Writes `data` into `address` as an `MPL_CORE_ID`-owned, rent-exempt account.
pub fn write_core_account(svm: &mut LiteSVM, address: &Pubkey, data: Vec<u8>) {
    write_raw_account(svm, address, MPL_CORE_ID, data);
}

/// Writes `data` into `address` as a rent-exempt account owned by `owner`.
pub fn write_raw_account(svm: &mut LiteSVM, address: &Pubkey, owner: Pubkey, data: Vec<u8>) {
    let lamports = svm.minimum_balance_for_rent_exemption(data.len());
    svm.set_account(
        *address,
        SolanaAccount {
            lamports,
            data,
            owner,
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("set account");
}

/// UTF-8 name stored in a profile / leaderboard entry.
pub fn name_of(bytes: &[u8; NAME_BYTES], len: u8) -> String {
    String::from_utf8(bytes[..usize::from(len)].to_vec()).expect("utf-8 name")
}
