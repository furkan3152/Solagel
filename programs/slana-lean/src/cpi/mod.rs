//! Cross-program invocations. One non-generic `invoke` serves every CPI (at most
//! `MAX_CPI_ACCOUNTS` accounts); the per-program modules only build instruction data.

pub mod system;
pub mod token;

use {
    core::mem::MaybeUninit,
    pinocchio::{
        cpi::{invoke_signed_unchecked, CpiAccount, Signer},
        instruction::{InstructionAccount, InstructionView},
        AccountView, Address,
    },
};

/// Most accounts any CPI of this program passes.
const MAX_CPI_ACCOUNTS: usize = 6;

/// Invokes `program` with `metas` / `views` (same order, same length) and `data`, signed by
/// `signers`. A failing callee aborts the whole transaction, so there is nothing to return.
///
/// The program never takes `try_borrow*` guards on account data, so no borrow can be
/// outstanding here and the unchecked invoke is sound.
#[inline(never)]
// Bound: `len` counts the zipped slots, at most `MAX_CPI_ACCOUNTS`.
#[allow(clippy::arithmetic_side_effects)]
pub fn invoke(
    program: &Address,
    metas: &[InstructionAccount],
    views: &[&AccountView],
    data: &[u8],
    signers: &[Signer],
) {
    let mut accounts = [const { MaybeUninit::<CpiAccount>::uninit() }; MAX_CPI_ACCOUNTS];
    let mut len = 0;
    for (view, slot) in views.iter().zip(accounts.iter_mut()) {
        CpiAccount::init_from_account_view(view, slot);
        len += 1;
    }
    let instruction = InstructionView {
        program_id: program,
        data,
        accounts: metas,
    };
    // SAFETY: the first `len` entries were initialized above.
    unsafe {
        invoke_signed_unchecked(
            &instruction,
            core::slice::from_raw_parts(accounts.as_ptr() as *const CpiAccount, len),
            signers,
        );
    }
}
