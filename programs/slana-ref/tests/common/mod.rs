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
            instruction::{error::InstructionError, Instruction},
            system_instruction, system_program,
        },
        AccountDeserialize, InstructionData, Space, ToAccountMetas,
    },
    anchor_spl::token_2022_extensions::spl_token_metadata_interface::{
        instruction::initialize as token_metadata_initialize, state::TokenMetadata,
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
                group_pointer, interest_bearing_mint, metadata_pointer, scaled_ui_amount,
                transfer_fee, BaseStateWithExtensions, ExtensionType, StateWithExtensions,
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
        state::{Arena, Config, PlayerProfile, Session},
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

pub fn session_pda(arena: &Pubkey, player: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[SESSION_SEED, arena.as_ref(), player.as_ref()], &slana::ID).0
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

    pub fn initialize(admin: &Pubkey, args: InitializeArgs) -> Instruction {
        build(
            slana::instruction::Initialize { args }.data(),
            slana::accounts::Initialize {
                admin: *admin,
                config: config_pda(),
                program: slana::ID,
                program_data: program_data_pda(),
                system_program: system_program::ID,
            },
        )
    }

    pub fn set_token_mint(admin: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Instruction {
        build(
            slana::instruction::SetTokenMint {}.data(),
            slana::accounts::SetTokenMint {
                admin: *admin,
                config: config_pda(),
                token_mint: *mint,
                token_program: *token_program,
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

    pub fn create_arena(
        admin: &Pubkey,
        id: u16,
        entry_fee: u64,
        max_sessions: u16,
        mint: &Pubkey,
        token_program: &Pubkey,
    ) -> Instruction {
        let arena = arena_pda(id);
        build(
            slana::instruction::CreateArena {
                id,
                entry_fee,
                max_sessions,
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
    ) -> Instruction {
        build(
            slana::instruction::UpdateArena {
                enabled,
                max_sessions,
                entry_fee,
            }
            .data(),
            slana::accounts::UpdateArena {
                admin: *admin,
                config: config_pda(),
                arena: arena_pda(id),
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

    #[allow(clippy::too_many_arguments)]
    pub fn settle_session(
        server: &Pubkey,
        player: &Pubkey,
        arena_id: u16,
        args: SettleArgs,
        player_token: Option<Pubkey>,
        fee_wallet_token: &Pubkey,
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
                fee_wallet_token: *fee_wallet_token,
                token_mint: *mint,
                token_program: *token_program,
            },
        )
    }

    pub fn refund_session(
        player: &Pubkey,
        arena_id: u16,
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
            },
        )
    }

    pub fn sweep_arena(
        admin: &Pubkey,
        arena_id: u16,
        fee_wallet_token: &Pubkey,
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
                fee_wallet_token: *fee_wallet_token,
                token_mint: *mint,
                token_program: *token_program,
            },
        )
    }

    pub fn sweep_loot(
        server: &Pubkey,
        arena_id: u16,
        amount: u64,
        mint: &Pubkey,
        token_program: &Pubkey,
    ) -> Instruction {
        let arena = arena_pda(arena_id);
        build(
            slana::instruction::SweepLoot { amount }.data(),
            slana::accounts::SweepLoot {
                server: *server,
                config: config_pda(),
                arena,
                vault: vault_pda(&arena),
                token_mint: *mint,
                token_program: *token_program,
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

/// Standard base64, for matching `Program data:` event logs.
pub fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(T[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

#[track_caller]
pub fn assert_event<E: anchor_lang::Event>(meta: &litesvm::types::TransactionMetadata, event: &E) {
    let line = format!("Program data: {}", base64(&event.data()));
    assert!(
        meta.logs.iter().any(|l| l == &line),
        "missing `{line}`\n{}",
        meta.pretty_logs()
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
    /// Token-2022 mint without any extension (allowed).
    Token2022Plain,
    /// Token-2022 mint with a TransferFeeConfig extension (denied).
    Token2022TransferFee,
    /// Token-2022 mint with a MintCloseAuthority extension (denied).
    Token2022CloseAuthority,
    /// Token-2022 mint like a pump.fun Token-2022 token: MetadataPointer (to itself) plus the
    /// variable-length TokenMetadata extension (name / symbol / uri) after it (allowed).
    Token2022Metadata,
    /// `Token2022Metadata` plus GroupPointer and InterestBearingConfig (allowed).
    Token2022MetadataGroupInterest,
    /// `Token2022Metadata` plus ScaledUiAmount (allowed). Token-2022 refuses ScaledUiAmount
    /// together with InterestBearingConfig, so it gets its own mint.
    Token2022MetadataScaledUi,
}

/// The TokenMetadata the `Token2022Metadata*` mints carry (pump.fun-style values).
pub const META_NAME: &str = "Slana Test Coin";
pub const META_SYMBOL: &str = "SLANA";
pub const META_URI: &str =
    "https://ipfs.io/ipfs/QmSlanaTestCoinMetadataUriThatIsRatherLongLikePumpFun1234567890";

impl MintKind {
    /// Whether the mint carries the variable-length TokenMetadata extension.
    pub fn has_token_metadata(self) -> bool {
        matches!(
            self,
            MintKind::Token2022Metadata
                | MintKind::Token2022MetadataGroupInterest
                | MintKind::Token2022MetadataScaledUi
        )
    }

    pub fn program(self) -> Pubkey {
        match self {
            MintKind::Spl => spl_token::ID,
            MintKind::Token2022
            | MintKind::Token2022Plain
            | MintKind::Token2022TransferFee
            | MintKind::Token2022CloseAuthority
            | MintKind::Token2022Metadata
            | MintKind::Token2022MetadataGroupInterest
            | MintKind::Token2022MetadataScaledUi => spl_token_2022::ID,
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
    /// `Config::fee_wallet`: owner of the token account that receives the fees.
    pub fee_wallet: Keypair,
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
            fee_wallet: Keypair::new(),
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

    /// `deployed()` + `initialize` with the default arguments: no token mint yet.
    pub fn initialized_without_token() -> Self {
        let mut env = Self::deployed();
        let admin = env.admin.insecure_clone();
        let args = env.default_init_args();
        assert_ok(env.initialize_as(&admin, args));
        env
    }

    /// `deployed()` + an SPL Token game mint + `initialize` + `set_token_mint`.
    pub fn initialized() -> Self {
        Self::initialized_with(MintKind::Spl)
    }

    /// `initialized_without_token()` + a game mint of `kind` set with `set_token_mint`, and
    /// the fee wallet's associated token account of it.
    pub fn initialized_with(kind: MintKind) -> Self {
        let mut env = Self::initialized_without_token();
        let mint = env.create_mint(kind, None);
        let admin = env.admin.insecure_clone();
        assert_ok(env.set_token_mint_as(&admin, &mint, &kind.program()));
        env.mint = mint;
        env.token_program = kind.program();
        let fee_wallet = env.fee_wallet.pubkey();
        env.create_ata(&fee_wallet);
        env
    }

    pub fn default_init_args(&self) -> InitializeArgs {
        InitializeArgs {
            fee_bps: FEE_BPS,
            settle_fee_lamports: SETTLE_FEE_LAMPORTS,
            server_authority: self.server.pubkey(),
            fee_wallet: self.fee_wallet.pubkey(),
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

    pub fn initialize_as(&mut self, signer: &Keypair, args: InitializeArgs) -> TxResult {
        self.send(&[ix::initialize(&signer.pubkey(), args)], &[signer])
    }

    pub fn set_token_mint_as(
        &mut self,
        signer: &Keypair,
        mint: &Pubkey,
        token_program: &Pubkey,
    ) -> TxResult {
        self.send(
            &[ix::set_token_mint(&signer.pubkey(), mint, token_program)],
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
    ) -> TxResult {
        let (mint, token_program) = (self.mint, self.token_program);
        self.send(
            &[ix::create_arena(
                &signer.pubkey(),
                id,
                entry_fee,
                max_sessions,
                &mint,
                &token_program,
            )],
            &[signer],
        )
    }

    pub fn create_arena(&mut self, id: u16, entry_fee: u64, max_sessions: u16) -> TxResult {
        let admin = self.admin.insecure_clone();
        self.create_arena_as(&admin, id, entry_fee, max_sessions)
    }

    pub fn update_arena_as(
        &mut self,
        signer: &Keypair,
        id: u16,
        enabled: Option<bool>,
        max_sessions: Option<u16>,
        entry_fee: Option<u64>,
    ) -> TxResult {
        self.send(
            &[ix::update_arena(
                &signer.pubkey(),
                id,
                enabled,
                max_sessions,
                entry_fee,
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
    ) -> TxResult {
        let admin = self.admin.insecure_clone();
        self.update_arena_as(&admin, id, enabled, max_sessions, entry_fee)
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

    /// The fee wallet's game-token ATA (created by `initialized_with`).
    pub fn fee_ata(&self) -> Pubkey {
        ata(&self.fee_wallet.pubkey(), &self.mint, &self.token_program)
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

    /// `settle_session` instruction of `player`'s session in `arena_id` signed by `server`,
    /// paying the fee into the fee wallet's ATA.
    pub fn settle_ix(
        &self,
        server: &Pubkey,
        player: &Pubkey,
        arena_id: u16,
        args: SettleArgs,
        player_token: Option<Pubkey>,
    ) -> Instruction {
        ix::settle_session(
            server,
            player,
            arena_id,
            args,
            player_token,
            &self.fee_ata(),
            &self.mint,
            &self.token_program,
        )
    }

    /// `settle_session` signed by `signer` with explicit arguments, paying into the player's
    /// associated token account.
    pub fn settle_as(
        &mut self,
        signer: &Keypair,
        player: &Pubkey,
        arena_id: u16,
        args: SettleArgs,
    ) -> TxResult {
        let token = Some(self.player_ata(player));
        self.settle_as_with(signer, player, arena_id, args, token)
    }

    /// `settle_session` with an explicit (optional) player token account.
    pub fn settle_as_with(
        &mut self,
        signer: &Keypair,
        player: &Pubkey,
        arena_id: u16,
        args: SettleArgs,
        player_token: Option<Pubkey>,
    ) -> TxResult {
        let ix = self.settle_ix(&signer.pubkey(), player, arena_id, args, player_token);
        self.send(&[ix], &[signer])
    }

    /// The `SettleArgs` of the player's open session (its id read from chain).
    pub fn settle_args(
        &self,
        player: &Pubkey,
        arena_id: u16,
        payout: u64,
        score: u32,
        kills: u16,
        xp: u32,
    ) -> SettleArgs {
        let session = self
            .session(arena_id, player)
            .expect("open session to settle");
        SettleArgs {
            session_id: session.id,
            payout,
            score,
            kills,
            xp,
        }
    }

    /// Server settlement of the player's open session.
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
        let args = self.settle_args(player, arena_id, payout, score, kills, xp);
        let server = self.server.insecure_clone();
        self.settle_as_with(&server, player, arena_id, args, player_token)
    }

    /// Refund (or collection of a finalized payout) of the player's open session.
    pub fn refund(&mut self, player: &Keypair, arena_id: u16) -> TxResult {
        let (mint, program) = (self.mint, self.token_program);
        self.send(
            &[ix::refund_session(
                &player.pubkey(),
                arena_id,
                &mint,
                &program,
            )],
            &[player],
        )
    }

    /// `sweep_arena` signed by `signer` into the fee wallet's ATA.
    pub fn sweep_as(&mut self, signer: &Keypair, arena_id: u16) -> TxResult {
        let (mint, program, to) = (self.mint, self.token_program, self.fee_ata());
        self.send(
            &[ix::sweep_arena(
                &signer.pubkey(),
                arena_id,
                &to,
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

    /// `sweep_loot` (burn) signed by `signer`.
    pub fn sweep_loot_as(&mut self, signer: &Keypair, arena_id: u16, amount: u64) -> TxResult {
        let (mint, program) = (self.mint, self.token_program);
        self.send(
            &[ix::sweep_loot(
                &signer.pubkey(),
                arena_id,
                amount,
                &mint,
                &program,
            )],
            &[signer],
        )
    }

    /// `sweep_loot` (burn) signed by the server authority.
    pub fn sweep_loot(&mut self, arena_id: u16, amount: u64) -> TxResult {
        let server = self.server.insecure_clone();
        self.sweep_loot_as(&server, arena_id, amount)
    }

    /// Rent of a `Session` account.
    pub fn session_rent(&self) -> u64 {
        self.rent(8 + Session::INIT_SPACE)
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
            MintKind::Spl | MintKind::Token2022Plain => &[],
            MintKind::Token2022 => &[ExtensionType::MetadataPointer],
            MintKind::Token2022TransferFee => &[ExtensionType::TransferFeeConfig],
            MintKind::Token2022CloseAuthority => &[ExtensionType::MintCloseAuthority],
            MintKind::Token2022Metadata => &[ExtensionType::MetadataPointer],
            MintKind::Token2022MetadataGroupInterest => &[
                ExtensionType::MetadataPointer,
                ExtensionType::GroupPointer,
                ExtensionType::InterestBearingConfig,
            ],
            MintKind::Token2022MetadataScaledUi => &[
                ExtensionType::MetadataPointer,
                ExtensionType::ScaledUiAmount,
            ],
        };
        let space =
            ExtensionType::try_calculate_account_len::<MintState>(extensions).expect("mint length");
        // TokenMetadata is variable-length: Token-2022 reallocs the mint when it is initialized
        // (after InitializeMint), so the account is created at the fixed size but funded for
        // the final one.
        let metadata = kind.has_token_metadata().then(|| TokenMetadata {
            update_authority: Some(authority).try_into().expect("update authority"),
            mint: mint.pubkey(),
            name: META_NAME.into(),
            symbol: META_SYMBOL.into(),
            uri: META_URI.into(),
            additional_metadata: vec![],
        });
        let final_space = space
            + metadata
                .as_ref()
                .map_or(0, |m| m.tlv_size_of().expect("metadata length"));
        let lamports = self.svm.minimum_balance_for_rent_exemption(final_space);

        let mut ixs = vec![system_instruction::create_account(
            &payer,
            &mint.pubkey(),
            lamports,
            space as u64,
            &program,
        )];
        match kind {
            MintKind::Spl | MintKind::Token2022Plain => {}
            MintKind::Token2022 | MintKind::Token2022Metadata => ixs.push(
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
            MintKind::Token2022MetadataGroupInterest => {
                ixs.push(
                    metadata_pointer::instruction::initialize(
                        &program,
                        &mint.pubkey(),
                        Some(authority),
                        Some(mint.pubkey()),
                    )
                    .expect("metadata pointer ix"),
                );
                ixs.push(
                    group_pointer::instruction::initialize(
                        &program,
                        &mint.pubkey(),
                        Some(authority),
                        Some(mint.pubkey()),
                    )
                    .expect("group pointer ix"),
                );
                ixs.push(
                    interest_bearing_mint::instruction::initialize(
                        &program,
                        &mint.pubkey(),
                        Some(authority),
                        500,
                    )
                    .expect("interest bearing ix"),
                );
            }
            MintKind::Token2022MetadataScaledUi => {
                ixs.push(
                    metadata_pointer::instruction::initialize(
                        &program,
                        &mint.pubkey(),
                        Some(authority),
                        Some(mint.pubkey()),
                    )
                    .expect("metadata pointer ix"),
                );
                ixs.push(
                    scaled_ui_amount::instruction::initialize(
                        &program,
                        &mint.pubkey(),
                        Some(authority),
                        2.5,
                    )
                    .expect("scaled ui amount ix"),
                );
            }
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
        let mint_authority = self.mint_authority.insecure_clone();
        let mut signers = vec![&mint];
        if let Some(m) = metadata {
            ixs.push(token_metadata_initialize(
                &program,
                &mint.pubkey(),
                &authority,
                &mint.pubkey(),
                &authority,
                m.name,
                m.symbol,
                m.uri,
            ));
            signers.push(&mint_authority);
        }
        assert_ok(self.send(&ixs, &signers));
        mint.pubkey()
    }

    /// Creates the associated token account of `owner` for the game mint.
    pub fn create_ata(&mut self, owner: &Pubkey) -> Pubkey {
        let (mint, program) = (self.mint, self.token_program);
        self.create_ata_of(owner, &mint, &program)
    }

    /// Creates a token account of the game mint owned by `owner` at a fresh keypair address
    /// (not an associated token account).
    pub fn create_token_account(&mut self, owner: &Pubkey) -> Pubkey {
        let (mint, program) = (self.mint, self.token_program);
        let account = Keypair::new();
        let payer = self.payer.pubkey();
        let len = ExtensionType::try_calculate_account_len::<TokenAccountState>(&[])
            .expect("account length");
        let lamports = self.svm.minimum_balance_for_rent_exemption(len);
        let ixs = [
            system_instruction::create_account(
                &payer,
                &account.pubkey(),
                lamports,
                len as u64,
                &program,
            ),
            spl_token_2022::instruction::initialize_account3(
                &program,
                &account.pubkey(),
                &mint,
                owner,
            )
            .expect("initialize account ix"),
        ];
        assert_ok(self.send(&ixs, &[&account]));
        account.pubkey()
    }

    /// Creates the associated token account of `owner` for `mint`.
    pub fn create_ata_of(&mut self, owner: &Pubkey, mint: &Pubkey, program: &Pubkey) -> Pubkey {
        let payer = self.payer.pubkey();
        assert_ok(self.send(
            &[create_associated_token_account(
                &payer, owner, mint, program,
            )],
            &[],
        ));
        ata(owner, mint, program)
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

/// UTF-8 name stored in a profile.
pub fn name_of(bytes: &[u8; NAME_BYTES], len: u8) -> String {
    String::from_utf8(bytes[..usize::from(len)].to_vec()).expect("utf-8 name")
}
