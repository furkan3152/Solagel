use anchor_lang::prelude::*;

#[error_code]
pub enum SlanaError {
    #[msg("Signer is not authorized for this action")]
    Unauthorized,
    #[msg("Program is paused")]
    Paused,
    #[msg("Invalid fee configuration")]
    InvalidFee,
    #[msg("Name must be 1-16 bytes of UTF-8 without control characters")]
    InvalidName,
    #[msg("Invalid skin id")]
    InvalidSkin,
    #[msg("Arena is disabled")]
    ArenaDisabled,
    #[msg("Arena is full")]
    ArenaFull,
    #[msg("Amount exceeds the available pot")]
    InsufficientPot,
    #[msg("Session cannot be refunded yet")]
    RefundTooEarly,
    #[msg("Season is already finalized")]
    SeasonFinalized,
    #[msg("Season is not finalized")]
    SeasonNotFinalized,
    #[msg("Not eligible for a season reward")]
    NotEligible,
    #[msg("Reward already claimed")]
    AlreadyClaimed,
    #[msg("Claim window is closed")]
    ClaimWindowClosed,
    #[msg("Claim window is still open")]
    ClaimWindowOpen,
    #[msg("Invalid season")]
    InvalidSeason,
    #[msg("Arena still has open sessions")]
    ArenaHasOpenSessions,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Settlement is for a different session")]
    SessionMismatch,
    #[msg("Token mint is not allowed (wrong program or forbidden Token-2022 extension)")]
    MintNotAllowed,
    #[msg("Token mint must not have a freeze authority")]
    FreezeAuthorityPresent,
    #[msg("This arena requires a Slana Pass")]
    PassRequired,
    #[msg("Slana Pass is not owned by the player")]
    PassNotOwned,
    #[msg("Asset is not part of the Slana Pass collection")]
    PassWrongCollection,
    #[msg("Slana Pass is already used by an open session")]
    PassInUse,
    #[msg("Pass mint is closed")]
    MintClosed,
    #[msg("Pass mint is sold out")]
    MintSoldOut,
    #[msg("Pass mint limit per wallet reached")]
    MintLimit,
    #[msg("Not enough tokens to mint a Pass")]
    MintMinTokens,
    #[msg("Seed does not match the committed hash")]
    SeedMismatch,
    #[msg("Pass seed hash is not set")]
    SeedNotSet,
    #[msg("Pass traits are already revealed")]
    AlreadyRevealed,
    #[msg("Pass collection is already set")]
    CollectionAlreadySet,
    #[msg("Pass collection is not set")]
    CollectionNotSet,
    #[msg("Invalid Pass collection")]
    BadCollection,
    #[msg("Fee split must sum to 10000 basis points")]
    BadSplit,
    #[msg("Arena has open sessions")]
    ArenaBusy,
    #[msg("Invalid Pass base URI")]
    BadBaseUri,
    #[msg("Max sessions must be between 2 and 2000")]
    InvalidMaxSessions,
    #[msg("Entry fee must be greater than zero")]
    EntryFeeZero,
}
