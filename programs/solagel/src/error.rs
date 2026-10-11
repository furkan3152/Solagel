use anchor_lang::prelude::*;

#[error_code]
pub enum SolagelError {
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
    #[msg("Skin is locked")]
    SkinLocked,
    #[msg("Skin already owned")]
    SkinAlreadyOwned,
    #[msg("Buy-in is below the minimum")]
    BuyInTooLow,
    #[msg("Max players must be between 2 and 100")]
    InvalidMaxPlayers,
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
    #[msg("Session has already been activated")]
    SessionAlreadyActivated,
    #[msg("Session activation deadline has passed; request a refund")]
    SessionActivationExpired,
    #[msg("Activated sessions require server settlement and cannot be refunded")]
    SessionNotRefundable,
    #[msg("This feature is unavailable during the SOL beta")]
    FeatureUnavailable,
}
