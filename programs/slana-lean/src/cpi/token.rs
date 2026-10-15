//! SPL Token / Token-2022 instructions. Both programs share these layouts; the caller passes
//! the token program it validated (`Config::token_program` or the `Interface` account).

use {
    super::invoke,
    crate::borsh::{wr_bytes, wr_u64},
    pinocchio::{cpi::Signer, instruction::InstructionAccount, AccountView, Address},
};

/// `InitializeAccount3 { owner }` (18): `account` must already be allocated and assigned to
/// the token program.
pub fn initialize_account3(
    program: &Address,
    account: &AccountView,
    mint: &AccountView,
    owner: &Address,
) {
    let mut data = [0u8; 33];
    data[0] = 18;
    wr_bytes(&mut data, 1, owner.as_ref());
    invoke(
        program,
        &[
            InstructionAccount::writable(account.address()),
            InstructionAccount::readonly(mint.address()),
        ],
        &[account, mint],
        &data,
        &[],
    );
}

/// `TransferChecked { amount, decimals }` (12) out of a token account whose authority signs
/// (a wallet signer of the transaction, or a PDA signing with `signers`). Always invoked, as
/// `token_interface::transfer_checked`; the callers skip zero amounts where the reference's
/// `token::transfer_from_pda` does.
#[allow(clippy::too_many_arguments)]
pub fn transfer_checked(
    program: &Address,
    from: &AccountView,
    mint: &AccountView,
    to: &AccountView,
    authority: &AccountView,
    amount: u64,
    decimals: u8,
    signers: &[Signer],
) {
    let mut data = [0u8; 10];
    data[0] = 12;
    wr_u64(&mut data, 1, amount);
    data[9] = decimals;
    invoke(
        program,
        &[
            InstructionAccount::writable(from.address()),
            InstructionAccount::readonly(mint.address()),
            InstructionAccount::writable(to.address()),
            InstructionAccount::readonly_signer(authority.address()),
        ],
        &[from, mint, to, authority],
        &data,
        signers,
    );
}

/// `Burn { amount }` (8) from a token account whose authority is the PDA signing with
/// `signers` (`token_interface::burn`, not `BurnChecked`).
pub fn burn(
    program: &Address,
    from: &AccountView,
    mint: &AccountView,
    authority: &AccountView,
    amount: u64,
    signers: &[Signer],
) {
    let mut data = [0u8; 9];
    data[0] = 8;
    wr_u64(&mut data, 1, amount);
    invoke(
        program,
        &[
            InstructionAccount::writable(from.address()),
            InstructionAccount::writable(mint.address()),
            InstructionAccount::readonly_signer(authority.address()),
        ],
        &[from, mint, authority],
        &data,
        signers,
    );
}
