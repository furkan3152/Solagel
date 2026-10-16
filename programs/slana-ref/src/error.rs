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
    #[msg("Arena still has open sessions")]
    ArenaHasOpenSessions,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Settlement is for a different session")]
    SessionMismatch,
    #[msg("Token mint is not allowed (wrong program or forbidden Token-2022 extension)")]
    MintNotAllowed,
    #[msg("Token mint must not have a freeze authority")]
    FreezeAuthorityPresent,
    #[msg("Arena has open sessions")]
    ArenaBusy,
    #[msg("Max sessions must be between 2 and 2000")]
    InvalidMaxSessions,
    #[msg("Entry fee must be greater than zero")]
    EntryFeeZero,
    #[msg("The fee rate is above the limit the player signed")]
    FeeAboveLimit,
    #[msg("The entry fee is above the limit the player signed")]
    EntryFeeAboveLimit,
    #[msg("The settle deposit is above the limit the player signed")]
    SettleFeeAboveLimit,
    #[msg("Session is already settled; the player collects the payout with refund_session")]
    SessionFinalized,
    #[msg("Authority must not be the default public key")]
    InvalidAuthority,
    #[msg("The game token mint is not set yet")]
    TokenNotSet,
    #[msg("The game token mint is already set")]
    TokenAlreadySet,
}
