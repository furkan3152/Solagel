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
        AccountDeserialize, InstructionData, ToAccountMetas,
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
        state::{Arena, Config, PlayerProfile, Season, Session},
        InitializeArgs, UpdateConfigArgs,
    },
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    solana_transaction_error::TransactionError,
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

static PROGRAM_SO: &[u8] =
    include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/slana.so"));

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
}

impl MintKind {
    pub fn program(self) -> Pubkey {
        match self {
            MintKind::Spl => spl_token::ID,
            MintKind::Token2022 | MintKind::Token2022TransferFee => spl_token_2022::ID,
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
    svm.add_program(slana::ID, PROGRAM_SO)
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

/// UTF-8 name stored in a profile / leaderboard entry.
pub fn name_of(bytes: &[u8; NAME_BYTES], len: u8) -> String {
    String::from_utf8(bytes[..usize::from(len)].to_vec()).expect("utf-8 name")
}
