//! Shared LiteSVM harness for the Solagel integration tests.
//!
//! The program is deployed with the upgradeable loader (BPF loader v3) and the test admin is
//! made its upgrade authority, so `initialize`'s ProgramData check runs for real.

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
            system_program,
        },
        AccountDeserialize, InstructionData, Space, ToAccountMetas,
    },
    litesvm::{
        types::{FailedTransactionMetadata, TransactionMetadata},
        LiteSVM,
    },
    solagel::{
        constants::*,
        error::SolagelError,
        state::{Arena, Config, PlayerProfile, Season, Session},
        InitializeArgs, RecordArgs, SettleArgs, UpdateConfigArgs,
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
pub const FEE_BPS: u16 = 500;
pub const SEASON_SHARE_BPS: u16 = 5_000;
pub const SKIN_PRICE: u64 = 50_000_000;

static PROGRAM_SO: &[u8] = include_bytes!(concat!(
    env!("CARGO_TARGET_TMPDIR"),
    "/../deploy/solagel.so"
));

// ---------------------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------------------

pub fn program_data_pda() -> Pubkey {
    bpf_loader_upgradeable::get_program_data_address(&solagel::ID)
}

pub fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[CONFIG_SEED], &solagel::ID).0
}

pub fn profile_pda(owner: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[PROFILE_SEED, owner.as_ref()], &solagel::ID).0
}

pub fn arena_pda(id: u16) -> Pubkey {
    Pubkey::find_program_address(&[ARENA_SEED, &id.to_le_bytes()], &solagel::ID).0
}

pub fn session_pda(arena: &Pubkey, player: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[SESSION_SEED, arena.as_ref(), player.as_ref()],
        &solagel::ID,
    )
    .0
}

pub fn season_pda(id: u32) -> Pubkey {
    Pubkey::find_program_address(&[SEASON_SEED, &id.to_le_bytes()], &solagel::ID).0
}

// ---------------------------------------------------------------------------------------
// Instruction builders (Anchor `instruction::X{..}.data()` + `accounts::X{..}`)
// ---------------------------------------------------------------------------------------

pub mod ix {
    use super::*;

    fn build(data: Vec<u8>, accounts: impl ToAccountMetas) -> Instruction {
        Instruction::new_with_bytes(solagel::ID, &data, accounts.to_account_metas(None))
    }

    pub fn initialize(admin: &Pubkey, args: InitializeArgs) -> Instruction {
        build(
            solagel::instruction::Initialize { args }.data(),
            solagel::accounts::Initialize {
                admin: *admin,
                config: config_pda(),
                season: season_pda(FIRST_SEASON),
                program: solagel::ID,
                program_data: program_data_pda(),
                system_program: system_program::ID,
            },
        )
    }

    pub fn update_config(admin: &Pubkey, args: UpdateConfigArgs) -> Instruction {
        build(
            solagel::instruction::UpdateConfig { args }.data(),
            solagel::accounts::UpdateConfig {
                admin: *admin,
                config: config_pda(),
            },
        )
    }

    pub fn create_arena(admin: &Pubkey, id: u16, buy_in: u64, max_players: u16) -> Instruction {
        build(
            solagel::instruction::CreateArena {
                id,
                buy_in,
                max_players,
            }
            .data(),
            solagel::accounts::CreateArena {
                admin: *admin,
                config: config_pda(),
                arena: arena_pda(id),
                system_program: system_program::ID,
            },
        )
    }

    pub fn update_arena(
        admin: &Pubkey,
        id: u16,
        enabled: Option<bool>,
        max_players: Option<u16>,
    ) -> Instruction {
        build(
            solagel::instruction::UpdateArena {
                enabled,
                max_players,
            }
            .data(),
            solagel::accounts::UpdateArena {
                admin: *admin,
                config: config_pda(),
                arena: arena_pda(id),
            },
        )
    }

    pub fn register_player(owner: &Pubkey, name: &str, skin: u8) -> Instruction {
        build(
            solagel::instruction::RegisterPlayer {
                name: name.to_string(),
                skin,
            }
            .data(),
            solagel::accounts::RegisterPlayer {
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
            solagel::instruction::UpdateProfile {
                name: name.map(str::to_string),
                skin,
            }
            .data(),
            solagel::accounts::UpdateProfile {
                owner: *owner,
                profile: *profile,
            },
        )
    }

    pub fn buy_skin(owner: &Pubkey, treasury: &Pubkey, skin: u8) -> Instruction {
        build(
            solagel::instruction::BuySkin { skin }.data(),
            solagel::accounts::BuySkin {
                owner: *owner,
                config: config_pda(),
                profile: profile_pda(owner),
                treasury: *treasury,
                system_program: system_program::ID,
            },
        )
    }

    pub fn join_arena(player: &Pubkey, arena_id: u16) -> Instruction {
        let arena = arena_pda(arena_id);
        build(
            solagel::instruction::JoinArena {}.data(),
            solagel::accounts::JoinArena {
                player: *player,
                config: config_pda(),
                profile: profile_pda(player),
                arena,
                session: session_pda(&arena, player),
                system_program: system_program::ID,
            },
        )
    }

    pub fn settle_session(
        server: &Pubkey,
        player: &Pubkey,
        arena_id: u16,
        season_id: u32,
        treasury: &Pubkey,
        args: SettleArgs,
    ) -> Instruction {
        let arena = arena_pda(arena_id);
        settle_session_with(
            server,
            player,
            arena_id,
            &session_pda(&arena, player),
            season_id,
            treasury,
            args,
        )
    }

    pub fn activate_session(
        server: &Pubkey,
        player: &Pubkey,
        arena_id: u16,
        session_id: u64,
    ) -> Instruction {
        let arena = arena_pda(arena_id);
        build(
            solagel::instruction::ActivateSession { session_id }.data(),
            solagel::accounts::ActivateSession {
                server: *server,
                config: config_pda(),
                arena,
                session: session_pda(&arena, player),
            },
        )
    }

    /// `settle_session` with an explicit session account.
    pub fn settle_session_with(
        server: &Pubkey,
        player: &Pubkey,
        arena_id: u16,
        session: &Pubkey,
        season_id: u32,
        treasury: &Pubkey,
        args: SettleArgs,
    ) -> Instruction {
        build(
            solagel::instruction::SettleSession { args }.data(),
            solagel::accounts::SettleSession {
                server: *server,
                config: config_pda(),
                arena: arena_pda(arena_id),
                session: *session,
                player: *player,
                profile: profile_pda(player),
                season: season_pda(season_id),
                treasury: *treasury,
            },
        )
    }

    pub fn record_game(
        server: &Pubkey,
        player: &Pubkey,
        season_id: u32,
        args: RecordArgs,
    ) -> Instruction {
        build(
            solagel::instruction::RecordGame { args }.data(),
            solagel::accounts::RecordGame {
                server: *server,
                config: config_pda(),
                profile: profile_pda(player),
                season: season_pda(season_id),
            },
        )
    }

    pub fn refund_session(player: &Pubkey, arena_id: u16) -> Instruction {
        let arena = arena_pda(arena_id);
        build(
            solagel::instruction::RefundSession {}.data(),
            solagel::accounts::RefundSession {
                player: *player,
                arena,
                session: session_pda(&arena, player),
            },
        )
    }

    pub fn sweep_arena(admin: &Pubkey, arena_id: u16, treasury: &Pubkey) -> Instruction {
        build(
            solagel::instruction::SweepArena {}.data(),
            solagel::accounts::SweepArena {
                admin: *admin,
                config: config_pda(),
                arena: arena_pda(arena_id),
                treasury: *treasury,
            },
        )
    }

    pub fn fund_season(funder: &Pubkey, season_id: u32, amount: u64) -> Instruction {
        build(
            solagel::instruction::FundSeason { amount }.data(),
            solagel::accounts::FundSeason {
                funder: *funder,
                config: config_pda(),
                season: season_pda(season_id),
                system_program: system_program::ID,
            },
        )
    }

    pub fn end_season(admin: &Pubkey, current_season: u32) -> Instruction {
        build(
            solagel::instruction::EndSeason {}.data(),
            solagel::accounts::EndSeason {
                admin: *admin,
                config: config_pda(),
                season: season_pda(current_season),
                next_season: season_pda(current_season + 1),
                system_program: system_program::ID,
            },
        )
    }

    pub fn claim_season_reward(claimer: &Pubkey, season_id: u32) -> Instruction {
        build(
            solagel::instruction::ClaimSeasonReward { season_id }.data(),
            solagel::accounts::ClaimSeasonReward {
                claimer: *claimer,
                season: season_pda(season_id),
            },
        )
    }

    pub fn rollover_season(admin: &Pubkey, season_id: u32, current_season: u32) -> Instruction {
        build(
            solagel::instruction::RolloverSeason { season_id }.data(),
            solagel::accounts::RolloverSeason {
                admin: *admin,
                config: config_pda(),
                old_season: season_pda(season_id),
                current_season: season_pda(current_season),
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
pub fn assert_error(res: TxResult, err: SolagelError) {
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
// Test environment
// ---------------------------------------------------------------------------------------

pub struct TestEnv {
    pub svm: LiteSVM,
    /// Pays every transaction fee, so balance checks of other accounts stay exact.
    pub payer: Keypair,
    /// Upgrade authority of the program and admin of the config.
    pub admin: Keypair,
    pub server: Keypair,
    pub treasury: Keypair,
}

impl TestEnv {
    /// Program deployed as an upgradeable program with `admin` as upgrade authority.
    /// `initialize` has not been called yet.
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
            treasury: Keypair::new(),
        };
        let (payer, admin, server, treasury) = (
            env.payer.pubkey(),
            env.admin.pubkey(),
            env.server.pubkey(),
            env.treasury.pubkey(),
        );
        env.airdrop(&payer, 1_000 * SOL);
        env.airdrop(&admin, 100 * SOL);
        env.airdrop(&server, SOL);
        env.airdrop(&treasury, SOL);
        env
    }

    /// `deployed()` + `initialize` with the default arguments.
    pub fn initialized() -> Self {
        let mut env = Self::deployed();
        let admin = env.admin.insecure_clone();
        let args = env.default_init_args();
        assert_ok(env.initialize_as(&admin, args));
        env
    }

    pub fn default_init_args(&self) -> InitializeArgs {
        InitializeArgs {
            server_authority: self.server.pubkey(),
            treasury: self.treasury.pubkey(),
            fee_bps: FEE_BPS,
            season_share_bps: SEASON_SHARE_BPS,
            skin_price: SKIN_PRICE,
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
        buy_in: u64,
        max_players: u16,
    ) -> TxResult {
        self.send(
            &[ix::create_arena(&signer.pubkey(), id, buy_in, max_players)],
            &[signer],
        )
    }

    pub fn create_arena(&mut self, id: u16, buy_in: u64, max_players: u16) -> TxResult {
        let admin = self.admin.insecure_clone();
        self.create_arena_as(&admin, id, buy_in, max_players)
    }

    pub fn update_arena_as(
        &mut self,
        signer: &Keypair,
        id: u16,
        enabled: Option<bool>,
        max_players: Option<u16>,
    ) -> TxResult {
        self.send(
            &[ix::update_arena(&signer.pubkey(), id, enabled, max_players)],
            &[signer],
        )
    }

    pub fn update_arena(
        &mut self,
        id: u16,
        enabled: Option<bool>,
        max_players: Option<u16>,
    ) -> TxResult {
        let admin = self.admin.insecure_clone();
        self.update_arena_as(&admin, id, enabled, max_players)
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

    pub fn buy_skin(&mut self, owner: &Keypair, skin: u8) -> TxResult {
        let treasury = self.config().treasury;
        self.send(&[ix::buy_skin(&owner.pubkey(), &treasury, skin)], &[owner])
    }

    pub fn join(&mut self, player: &Keypair, arena_id: u16) -> TxResult {
        self.send(&[ix::join_arena(&player.pubkey(), arena_id)], &[player])
    }

    pub fn activate_as(
        &mut self,
        signer: &Keypair,
        player: &Pubkey,
        arena_id: u16,
        session_id: u64,
    ) -> TxResult {
        self.send(
            &[ix::activate_session(
                &signer.pubkey(),
                player,
                arena_id,
                session_id,
            )],
            &[signer],
        )
    }

    pub fn activate(&mut self, player: &Pubkey, arena_id: u16) -> TxResult {
        let server = self.server.insecure_clone();
        let session_id = self.session(arena_id, player).map_or(u64::MAX, |s| s.id);
        self.activate_as(&server, player, arena_id, session_id)
    }

    /// A complete admitted paid game with fixture profit chosen to yield `score` points.
    /// Extra pot funding represents value captured from other paid tickets.
    pub fn play_paid(
        &mut self,
        player: &Keypair,
        arena_id: u16,
        score: u32,
        kills: u16,
        xp: u32,
    ) -> TxResult {
        let buy_in = self.arena(arena_id).buy_in;
        assert_ok(self.join(player, arena_id));
        assert_ok(self.activate(&player.pubkey(), arena_id));
        let profit = u64::from(score) * 1_000;
        if profit > 0 {
            self.airdrop(&arena_pda(arena_id), profit);
        }
        self.settle(
            &player.pubkey(),
            arena_id,
            buy_in + profit,
            score,
            kills,
            xp,
        )
    }

    pub fn settle_as(
        &mut self,
        signer: &Keypair,
        player: &Pubkey,
        arena_id: u16,
        args: SettleArgs,
    ) -> TxResult {
        let config = self.config();
        self.send(
            &[ix::settle_session(
                &signer.pubkey(),
                player,
                arena_id,
                config.current_season,
                &config.treasury,
                args,
            )],
            &[signer],
        )
    }

    /// Server-signed `settle_session`.
    pub fn settle(
        &mut self,
        player: &Pubkey,
        arena_id: u16,
        payout: u64,
        score: u32,
        kills: u16,
        xp: u32,
    ) -> TxResult {
        let server = self.server.insecure_clone();
        let session_id = self.session(arena_id, player).map_or(u64::MAX, |s| s.id);
        self.settle_as(
            &server,
            player,
            arena_id,
            SettleArgs {
                session_id,
                payout,
                score,
                kills,
                xp,
            },
        )
    }

    /// Server-signed `record_game` into the current season.
    pub fn record(&mut self, player: &Pubkey, score: u32, kills: u16, xp: u32) -> TxResult {
        let server = self.server.insecure_clone();
        let season = self.config().current_season;
        self.send(
            &[ix::record_game(
                &server.pubkey(),
                player,
                season,
                RecordArgs { score, kills, xp },
            )],
            &[&server],
        )
    }

    pub fn refund(&mut self, player: &Keypair, arena_id: u16) -> TxResult {
        self.send(&[ix::refund_session(&player.pubkey(), arena_id)], &[player])
    }

    pub fn sweep_as(&mut self, signer: &Keypair, arena_id: u16) -> TxResult {
        let treasury = self.config().treasury;
        self.send(
            &[ix::sweep_arena(&signer.pubkey(), arena_id, &treasury)],
            &[signer],
        )
    }

    pub fn sweep(&mut self, arena_id: u16) -> TxResult {
        let admin = self.admin.insecure_clone();
        self.sweep_as(&admin, arena_id)
    }

    pub fn fund_season(&mut self, funder: &Keypair, amount: u64) -> TxResult {
        let season = self.config().current_season;
        self.send(
            &[ix::fund_season(&funder.pubkey(), season, amount)],
            &[funder],
        )
    }

    pub fn end_season_as(&mut self, signer: &Keypair) -> TxResult {
        let season = self.config().current_season;
        self.send(&[ix::end_season(&signer.pubkey(), season)], &[signer])
    }

    pub fn end_season(&mut self) -> TxResult {
        let admin = self.admin.insecure_clone();
        self.end_season_as(&admin)
    }

    pub fn claim(&mut self, claimer: &Keypair, season_id: u32) -> TxResult {
        self.send(
            &[ix::claim_season_reward(&claimer.pubkey(), season_id)],
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

    /// Lamports of `address` (0 when the account does not exist).
    pub fn balance(&self, address: &Pubkey) -> u64 {
        self.svm.get_balance(address).unwrap_or(0)
    }

    pub fn rent(&self, data_len: usize) -> u64 {
        self.svm.minimum_balance_for_rent_exemption(data_len)
    }

    pub fn session_rent(&self) -> u64 {
        self.rent(8 + Session::INIT_SPACE)
    }

    /// Arena pot: lamports above the arena's rent-exempt minimum.
    pub fn pot(&self, arena_id: u16) -> u64 {
        self.balance(&arena_pda(arena_id)) - self.rent(8 + Arena::INIT_SPACE)
    }

    /// Season prize money: lamports above the season's rent-exempt minimum.
    pub fn prize_balance(&self, season_id: u32) -> u64 {
        self.balance(&season_pda(season_id)) - self.rent(8 + Season::INIT_SPACE)
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
    svm.add_program(solagel::ID, PROGRAM_SO)
        .expect("load program");

    let program_account = svm.get_account(&solagel::ID).expect("program account");
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
