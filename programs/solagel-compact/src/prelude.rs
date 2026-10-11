pub use crate::{emit, error, require, require_eq, require_gte, require_keys_eq, ID};
pub use borsh::{BorshDeserialize, BorshSerialize};
pub use solana_account_info::AccountInfo;
pub use solana_clock::Clock;
pub use solana_program_error::ProgramError;
pub use solana_pubkey::Pubkey;
pub use solana_rent::Rent;
pub use solana_sysvar::Sysvar;

pub type Result<T> = core::result::Result<T, ProgramError>;

/// Anchor instruction decoders accept trailing instruction data.
pub fn decode<T: BorshDeserialize>(data: &[u8]) -> Result<T> {
    T::deserialize(&mut &data[..]).map_err(|_| ProgramError::Custom(102))
}

#[macro_export]
macro_rules! error {
    ($error:expr) => {
        $crate::prelude::ProgramError::from($error)
    };
}

#[macro_export]
macro_rules! require {
    ($condition:expr, $error:expr $(,)?) => {
        if !$condition {
            return Err($crate::error!($error));
        }
    };
}

#[macro_export]
macro_rules! require_gte {
    ($left:expr, $right:expr, $error:expr $(,)?) => {
        $crate::require!($left >= $right, $error);
    };
}

#[macro_export]
macro_rules! require_eq {
    ($left:expr, $right:expr, $error:expr $(,)?) => {
        $crate::require!($left == $right, $error);
    };
}

#[macro_export]
macro_rules! require_keys_eq {
    ($left:expr, $right:expr, $error:expr $(,)?) => {
        $crate::require_eq!($left, $right, $error);
    };
}

#[macro_export]
macro_rules! emit {
    ($event:expr) => {
        $crate::events::emit(&$event)?
    };
}
