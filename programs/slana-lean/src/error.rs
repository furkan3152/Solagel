//! Error codes, numerically identical to the reference.
//!
//! * `SlanaError` (6000 + variant index, append-only) — `programs/slana-ref/src/error.rs`;
//! * the Anchor built-in codes the reference raises through its account constraints and
//!   account types (`anchor_lang::error::ErrorCode`).
//!
//! The unit tests compare every constant with the reference enum and with `anchor_lang`.
//!
//! [`Error`] is the `u64` the program hands back to the runtime (a custom code as is, a builtin
//! `ProgramError` as `n << 32`), so `Result<()>` is a single register and no conversion table
//! is linked in.

use core::num::NonZeroU64;

/// A failed instruction: the exact `u64` returned to the runtime.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(transparent)]
pub struct Error(NonZeroU64);

pub type Result<T = ()> = core::result::Result<T, Error>;

const fn builtin(n: u64) -> Error {
    match NonZeroU64::new(n << 32) {
        Some(v) => Error(v),
        None => panic!("builtin error 0"),
    }
}

impl Error {
    /// `ProgramError::Custom(0)`.
    pub const CUSTOM_ZERO: Error = builtin(1);
    /// `ProgramError::InvalidArgument`.
    pub const INVALID_ARGUMENT: Error = builtin(2);
    /// `ProgramError::InvalidAccountData`.
    pub const INVALID_ACCOUNT_DATA: Error = builtin(4);
    /// `ProgramError::UninitializedAccount`.
    pub const UNINITIALIZED_ACCOUNT: Error = builtin(10);
    /// `ProgramError::UnsupportedSysvar`.
    pub const UNSUPPORTED_SYSVAR: Error = builtin(17);
    /// `ProgramError::ArithmeticOverflow`.
    pub const ARITHMETIC_OVERFLOW: Error = builtin(24);

    /// The value returned to the runtime.
    #[inline(always)]
    pub const fn code(self) -> u64 {
        self.0.get()
    }
}

// ----- Anchor built-ins ------------------------------------------------------------------

pub const INSTRUCTION_FALLBACK_NOT_FOUND: u32 = 101;
pub const INSTRUCTION_DID_NOT_DESERIALIZE: u32 = 102;
pub const EVENT_INSTRUCTION_STUB: u32 = 1500;
pub const CONSTRAINT_MUT: u32 = 2000;
pub const CONSTRAINT_SEEDS: u32 = 2006;
pub const CONSTRAINT_CLOSE: u32 = 2011;
pub const CONSTRAINT_ADDRESS: u32 = 2012;
pub const CONSTRAINT_TOKEN_MINT: u32 = 2014;
pub const CONSTRAINT_TOKEN_OWNER: u32 = 2015;
pub const CONSTRAINT_TOKEN_TOKEN_PROGRAM: u32 = 2021;
pub const CONSTRAINT_MINT_TOKEN_PROGRAM: u32 = 2022;
pub const CONSTRAINT_DUPLICATE_MUTABLE_ACCOUNT: u32 = 2040;
pub const ACCOUNT_DISCRIMINATOR_NOT_FOUND: u32 = 3001;
pub const ACCOUNT_DISCRIMINATOR_MISMATCH: u32 = 3002;
pub const ACCOUNT_DID_NOT_DESERIALIZE: u32 = 3003;
pub const ACCOUNT_NOT_ENOUGH_KEYS: u32 = 3005;
pub const ACCOUNT_OWNED_BY_WRONG_PROGRAM: u32 = 3007;
pub const INVALID_PROGRAM_ID: u32 = 3008;
pub const INVALID_PROGRAM_EXECUTABLE: u32 = 3009;
pub const ACCOUNT_NOT_SIGNER: u32 = 3010;
pub const ACCOUNT_NOT_INITIALIZED: u32 = 3012;
pub const ACCOUNT_NOT_PROGRAM_DATA: u32 = 3013;
pub const DECLARED_PROGRAM_ID_MISMATCH: u32 = 4100;
pub const TRYING_TO_INIT_PAYER_AS_PROGRAM_ACCOUNT: u32 = 4101;

// ----- SlanaError ---------------------------------------------------------------------------

pub const UNAUTHORIZED: u32 = 6000;
pub const PAUSED: u32 = 6001;
pub const INVALID_FEE: u32 = 6002;
pub const INVALID_NAME: u32 = 6003;
pub const INVALID_SKIN: u32 = 6004;
pub const ARENA_DISABLED: u32 = 6005;
pub const ARENA_FULL: u32 = 6006;
pub const INSUFFICIENT_POT: u32 = 6007;
pub const REFUND_TOO_EARLY: u32 = 6008;
pub const SEASON_FINALIZED: u32 = 6009;
pub const SEASON_NOT_FINALIZED: u32 = 6010;
pub const NOT_ELIGIBLE: u32 = 6011;
pub const ALREADY_CLAIMED: u32 = 6012;
pub const CLAIM_WINDOW_CLOSED: u32 = 6013;
pub const CLAIM_WINDOW_OPEN: u32 = 6014;
pub const INVALID_SEASON: u32 = 6015;
pub const ARENA_HAS_OPEN_SESSIONS: u32 = 6016;
pub const INVALID_AMOUNT: u32 = 6017;
pub const MATH_OVERFLOW: u32 = 6018;
pub const SESSION_MISMATCH: u32 = 6019;
pub const MINT_NOT_ALLOWED: u32 = 6020;
pub const FREEZE_AUTHORITY_PRESENT: u32 = 6021;
pub const PASS_REQUIRED: u32 = 6022;
pub const PASS_NOT_OWNED: u32 = 6023;
pub const PASS_WRONG_COLLECTION: u32 = 6024;
pub const PASS_IN_USE: u32 = 6025;
pub const MINT_CLOSED: u32 = 6026;
pub const MINT_SOLD_OUT: u32 = 6027;
pub const MINT_LIMIT: u32 = 6028;
pub const MINT_MIN_TOKENS: u32 = 6029;
pub const SEED_MISMATCH: u32 = 6030;
pub const SEED_NOT_SET: u32 = 6031;
pub const ALREADY_REVEALED: u32 = 6032;
pub const COLLECTION_ALREADY_SET: u32 = 6033;
pub const COLLECTION_NOT_SET: u32 = 6034;
pub const BAD_COLLECTION: u32 = 6035;
pub const BAD_SPLIT: u32 = 6036;
pub const ARENA_BUSY: u32 = 6037;
pub const BAD_BASE_URI: u32 = 6038;
pub const INVALID_MAX_SESSIONS: u32 = 6039;
pub const ENTRY_FEE_ZERO: u32 = 6040;
pub const SEED_LOCKED: u32 = 6041;
pub const MINT_STILL_OPEN: u32 = 6042;
pub const MINT_ENDED: u32 = 6043;
pub const SUPPLY_LOCKED: u32 = 6044;
pub const USE_CLOSE_MINT: u32 = 6045;
pub const BAD_SLOT_HASHES: u32 = 6046;
pub const NOTHING_MINTED: u32 = 6047;
pub const ENTROPY_NOT_READY: u32 = 6048;
pub const ENTROPY_NOT_CAPTURED: u32 = 6049;
pub const SEED_NOT_REVEALED: u32 = 6050;
pub const FEE_ABOVE_LIMIT: u32 = 6051;
pub const ENTRY_FEE_ABOVE_LIMIT: u32 = 6052;
pub const SETTLE_FEE_ABOVE_LIMIT: u32 = 6053;
pub const SESSION_FINALIZED: u32 = 6054;
pub const INVALID_AUTHORITY: u32 = 6055;

/// `ProgramError::Custom(code)`. Out of line and cold: every failure path shares it.
#[cold]
#[inline(never)]
pub fn err(code: u32) -> Error {
    match NonZeroU64::new(code as u64) {
        Some(v) => Error(v),
        None => Error::CUSTOM_ZERO,
    }
}

/// `Err(err(code))` unless `ok`.
#[inline(always)]
pub fn require(ok: bool, code: u32) -> Result {
    if ok {
        Ok(())
    } else {
        Err(err(code))
    }
}

#[cfg(test)]
mod tests {
    use {super::*, anchor_lang::error::ErrorCode as A, slana::error::SlanaError as S};

    fn a(code: A) -> u32 {
        code.into()
    }

    #[test]
    fn builtin_errors_match_program_error() {
        use pinocchio::error::ProgramError as P;
        let table = [
            (Error::INVALID_ARGUMENT, P::InvalidArgument),
            (Error::INVALID_ACCOUNT_DATA, P::InvalidAccountData),
            (Error::UNINITIALIZED_ACCOUNT, P::UninitializedAccount),
            (Error::UNSUPPORTED_SYSVAR, P::UnsupportedSysvar),
            (Error::ARITHMETIC_OVERFLOW, P::ArithmeticOverflow),
            (err(0), P::Custom(0)),
            (err(6000), P::Custom(6000)),
        ];
        for (lean, reference) in table {
            let name = format!("{reference:?}");
            assert_eq!(lean.code(), u64::from(reference), "{name}");
        }
    }

    #[test]
    fn anchor_builtins_match() {
        let table = [
            (
                INSTRUCTION_FALLBACK_NOT_FOUND,
                A::InstructionFallbackNotFound,
            ),
            (
                INSTRUCTION_DID_NOT_DESERIALIZE,
                A::InstructionDidNotDeserialize,
            ),
            (EVENT_INSTRUCTION_STUB, A::EventInstructionStub),
            (DECLARED_PROGRAM_ID_MISMATCH, A::DeclaredProgramIdMismatch),
            (CONSTRAINT_MUT, A::ConstraintMut),
            (CONSTRAINT_SEEDS, A::ConstraintSeeds),
            (CONSTRAINT_CLOSE, A::ConstraintClose),
            (CONSTRAINT_ADDRESS, A::ConstraintAddress),
            (CONSTRAINT_TOKEN_MINT, A::ConstraintTokenMint),
            (CONSTRAINT_TOKEN_OWNER, A::ConstraintTokenOwner),
            (
                CONSTRAINT_TOKEN_TOKEN_PROGRAM,
                A::ConstraintTokenTokenProgram,
            ),
            (CONSTRAINT_MINT_TOKEN_PROGRAM, A::ConstraintMintTokenProgram),
            (
                CONSTRAINT_DUPLICATE_MUTABLE_ACCOUNT,
                A::ConstraintDuplicateMutableAccount,
            ),
            (
                ACCOUNT_DISCRIMINATOR_NOT_FOUND,
                A::AccountDiscriminatorNotFound,
            ),
            (
                ACCOUNT_DISCRIMINATOR_MISMATCH,
                A::AccountDiscriminatorMismatch,
            ),
            (ACCOUNT_DID_NOT_DESERIALIZE, A::AccountDidNotDeserialize),
            (ACCOUNT_NOT_ENOUGH_KEYS, A::AccountNotEnoughKeys),
            (
                ACCOUNT_OWNED_BY_WRONG_PROGRAM,
                A::AccountOwnedByWrongProgram,
            ),
            (INVALID_PROGRAM_ID, A::InvalidProgramId),
            (INVALID_PROGRAM_EXECUTABLE, A::InvalidProgramExecutable),
            (ACCOUNT_NOT_SIGNER, A::AccountNotSigner),
            (ACCOUNT_NOT_INITIALIZED, A::AccountNotInitialized),
            (ACCOUNT_NOT_PROGRAM_DATA, A::AccountNotProgramData),
            (
                TRYING_TO_INIT_PAYER_AS_PROGRAM_ACCOUNT,
                A::TryingToInitPayerAsProgramAccount,
            ),
        ];
        for (lean, reference) in table {
            assert_eq!(lean, a(reference), "{reference:?}");
        }
    }

    /// Every `SlanaError` variant, in declaration order, with its lean constant.
    fn slana_table() -> Vec<(u32, S)> {
        vec![
            (UNAUTHORIZED, S::Unauthorized),
            (PAUSED, S::Paused),
            (INVALID_FEE, S::InvalidFee),
            (INVALID_NAME, S::InvalidName),
            (INVALID_SKIN, S::InvalidSkin),
            (ARENA_DISABLED, S::ArenaDisabled),
            (ARENA_FULL, S::ArenaFull),
            (INSUFFICIENT_POT, S::InsufficientPot),
            (REFUND_TOO_EARLY, S::RefundTooEarly),
            (SEASON_FINALIZED, S::SeasonFinalized),
            (SEASON_NOT_FINALIZED, S::SeasonNotFinalized),
            (NOT_ELIGIBLE, S::NotEligible),
            (ALREADY_CLAIMED, S::AlreadyClaimed),
            (CLAIM_WINDOW_CLOSED, S::ClaimWindowClosed),
            (CLAIM_WINDOW_OPEN, S::ClaimWindowOpen),
            (INVALID_SEASON, S::InvalidSeason),
            (ARENA_HAS_OPEN_SESSIONS, S::ArenaHasOpenSessions),
            (INVALID_AMOUNT, S::InvalidAmount),
            (MATH_OVERFLOW, S::MathOverflow),
            (SESSION_MISMATCH, S::SessionMismatch),
            (MINT_NOT_ALLOWED, S::MintNotAllowed),
            (FREEZE_AUTHORITY_PRESENT, S::FreezeAuthorityPresent),
            (PASS_REQUIRED, S::PassRequired),
            (PASS_NOT_OWNED, S::PassNotOwned),
            (PASS_WRONG_COLLECTION, S::PassWrongCollection),
            (PASS_IN_USE, S::PassInUse),
            (MINT_CLOSED, S::MintClosed),
            (MINT_SOLD_OUT, S::MintSoldOut),
            (MINT_LIMIT, S::MintLimit),
            (MINT_MIN_TOKENS, S::MintMinTokens),
            (SEED_MISMATCH, S::SeedMismatch),
            (SEED_NOT_SET, S::SeedNotSet),
            (ALREADY_REVEALED, S::AlreadyRevealed),
            (COLLECTION_ALREADY_SET, S::CollectionAlreadySet),
            (COLLECTION_NOT_SET, S::CollectionNotSet),
            (BAD_COLLECTION, S::BadCollection),
            (BAD_SPLIT, S::BadSplit),
            (ARENA_BUSY, S::ArenaBusy),
            (BAD_BASE_URI, S::BadBaseUri),
            (INVALID_MAX_SESSIONS, S::InvalidMaxSessions),
            (ENTRY_FEE_ZERO, S::EntryFeeZero),
            (SEED_LOCKED, S::SeedLocked),
            (MINT_STILL_OPEN, S::MintStillOpen),
            (MINT_ENDED, S::MintEnded),
            (SUPPLY_LOCKED, S::SupplyLocked),
            (USE_CLOSE_MINT, S::UseCloseMint),
            (BAD_SLOT_HASHES, S::BadSlotHashes),
            (NOTHING_MINTED, S::NothingMinted),
            (ENTROPY_NOT_READY, S::EntropyNotReady),
            (ENTROPY_NOT_CAPTURED, S::EntropyNotCaptured),
            (SEED_NOT_REVEALED, S::SeedNotRevealed),
            (FEE_ABOVE_LIMIT, S::FeeAboveLimit),
            (ENTRY_FEE_ABOVE_LIMIT, S::EntryFeeAboveLimit),
            (SETTLE_FEE_ABOVE_LIMIT, S::SettleFeeAboveLimit),
            (SESSION_FINALIZED, S::SessionFinalized),
            (INVALID_AUTHORITY, S::InvalidAuthority),
        ]
    }

    #[test]
    fn slana_errors_match_the_reference() {
        for (lean, reference) in slana_table() {
            let name = format!("{reference:?}");
            assert_eq!(lean, u32::from(reference), "{name}");
        }
    }

    /// The table is complete: the IDL the SDK ships lists exactly these codes and names.
    #[test]
    fn slana_errors_match_the_idl() {
        let idl: serde_json::Value =
            serde_json::from_str(include_str!("../../../packages/sdk/src/idl/slana.json")).unwrap();
        let from_idl: Vec<(u64, String)> = idl["errors"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| {
                (
                    e["code"].as_u64().unwrap(),
                    e["name"].as_str().unwrap().to_owned(),
                )
            })
            .collect();
        let ours: Vec<(u64, String)> = slana_table()
            .into_iter()
            .map(|(code, r)| (u64::from(code), format!("{r:?}")))
            .collect();
        assert_eq!(ours, from_idl);
    }
}
