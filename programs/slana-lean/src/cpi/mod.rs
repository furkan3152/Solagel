//! Cross-program invocations. One non-generic `invoke` serves every CPI (at most
//! `MAX_CPI_ACCOUNTS` accounts); the per-program modules only build instruction data.

pub mod system;
pub mod token;

use {
    crate::error::{Error, Result},
    core::mem::MaybeUninit,
    pinocchio::{
        cpi::{invoke_signed_unchecked, CpiAccount, Signer},
        instruction::{InstructionAccount, InstructionView},
        AccountView, Address,
    },
};

/// Most accounts any CPI of this program passes.
const MAX_CPI_ACCOUNTS: usize = 6;

/// Invokes `program` with `metas` and the account `views` and `data`, signed by `signers`. A
/// failing callee aborts the whole transaction. `views` may be fewer than `metas` (a meta can
/// repeat a passed account, as Core's `CreateV2` does with its own id), never more: more
/// views than `MAX_CPI_ACCOUNTS` or than `metas` is `InvalidArgument` (a programming error,
/// never silently truncated).
///
/// The program never takes `try_borrow*` guards on account data, so no borrow can be
/// outstanding here and the unchecked invoke is sound.
#[inline(never)]
pub fn invoke(
    program: &Address,
    metas: &[InstructionAccount],
    views: &[&AccountView],
    data: &[u8],
    signers: &[Signer],
) -> Result {
    let len = views.len();
    if len > MAX_CPI_ACCOUNTS || len > metas.len() {
        return Err(Error::INVALID_ARGUMENT);
    }
    let mut accounts = [const { MaybeUninit::<CpiAccount>::uninit() }; MAX_CPI_ACCOUNTS];
    for (view, slot) in views.iter().zip(accounts.iter_mut()) {
        CpiAccount::init_from_account_view(view, slot);
    }
    let instruction = InstructionView {
        program_id: program,
        data,
        accounts: metas,
    };
    // SAFETY: `len <= MAX_CPI_ACCOUNTS`, so the zip above initialized the first `len` entries.
    unsafe {
        invoke_signed_unchecked(
            &instruction,
            core::slice::from_raw_parts(accounts.as_ptr() as *const CpiAccount, len),
            signers,
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use {
        super::*,
        pinocchio::account::{RuntimeAccount, NOT_BORROWED},
    };

    fn raw(n: u8) -> RuntimeAccount {
        RuntimeAccount {
            borrow_state: NOT_BORROWED,
            is_signer: 0,
            is_writable: 1,
            executable: 0,
            padding: [0; 4],
            address: Address::new_from_array([n; 32]),
            owner: Address::new_from_array([0; 32]),
            lamports: 1,
            data_len: 0,
        }
    }

    /// More views than metas, or than `MAX_CPI_ACCOUNTS`, fails before any CPI is made.
    #[test]
    fn invoke_rejects_extra_views() {
        let mut raws: Vec<RuntimeAccount> = (0..=MAX_CPI_ACCOUNTS as u8).map(raw).collect();
        // SAFETY: each view points at its own live `RuntimeAccount` with no data.
        let views: Vec<AccountView> = raws
            .iter_mut()
            .map(|r| unsafe { AccountView::new_unchecked(r) })
            .collect();
        let refs: Vec<&AccountView> = views.iter().collect();
        let metas: Vec<InstructionAccount> = views
            .iter()
            .map(|v| InstructionAccount::writable(v.address()))
            .collect();
        let program = Address::new_from_array([9; 32]);
        // 2 views, 1 meta.
        assert_eq!(
            invoke(&program, &metas[..1], &refs[..2], &[], &[]),
            Err(Error::INVALID_ARGUMENT)
        );
        // MAX + 1 views and metas.
        assert_eq!(
            invoke(&program, &metas, &refs, &[], &[]),
            Err(Error::INVALID_ARGUMENT)
        );
    }
}
