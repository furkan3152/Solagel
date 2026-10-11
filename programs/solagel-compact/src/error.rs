use crate::prelude::ProgramError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum SolagelError {
    Unauthorized = 6000,
    Paused,
    InvalidFee,
    InvalidName,
    InvalidSkin,
    SkinLocked,
    SkinAlreadyOwned,
    BuyInTooLow,
    InvalidMaxPlayers,
    ArenaDisabled,
    ArenaFull,
    InsufficientPot,
    RefundTooEarly,
    SeasonFinalized,
    SeasonNotFinalized,
    NotEligible,
    AlreadyClaimed,
    ClaimWindowClosed,
    ClaimWindowOpen,
    InvalidSeason,
    ArenaHasOpenSessions,
    InvalidAmount,
    MathOverflow,
    SessionMismatch,
    SessionAlreadyActivated,
    SessionActivationExpired,
    SessionNotRefundable,
    FeatureUnavailable,
}

impl From<SolagelError> for ProgramError {
    fn from(error: SolagelError) -> Self {
        Self::Custom(error as u32)
    }
}

/// Preserve externally visible Anchor validation error numbers.
pub const fn anchor(code: u32) -> ProgramError {
    ProgramError::Custom(code)
}
