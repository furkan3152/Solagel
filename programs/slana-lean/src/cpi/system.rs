//! System program instructions (bincode: u32 discriminator + fields).

use {
    super::invoke,
    crate::{
        borsh::{wr_bytes, wr_u64},
        constants::SYSTEM_PROGRAM_ID,
    },
    pinocchio::{cpi::Signer, instruction::InstructionAccount, AccountView, Address},
};

/// `CreateAccount { lamports, space, owner }`; `from` and `to` sign.
pub fn create_account(
    from: &AccountView,
    to: &AccountView,
    lamports: u64,
    space: u64,
    owner: &Address,
    signers: &[Signer],
) {
    let mut data = [0u8; 52];
    wr_u64(&mut data, 4, lamports);
    wr_u64(&mut data, 12, space);
    wr_bytes(&mut data, 20, owner.as_ref());
    invoke(
        &SYSTEM_PROGRAM_ID,
        &[
            InstructionAccount::writable_signer(from.address()),
            InstructionAccount::writable_signer(to.address()),
        ],
        &[from, to],
        &data,
        signers,
    );
}

/// `Transfer { lamports }` from a system-owned signer.
pub fn transfer(from: &AccountView, to: &AccountView, lamports: u64) {
    let mut data = [0u8; 12];
    data[0] = 2;
    wr_u64(&mut data, 4, lamports);
    invoke(
        &SYSTEM_PROGRAM_ID,
        &[
            InstructionAccount::writable_signer(from.address()),
            InstructionAccount::writable(to.address()),
        ],
        &[from, to],
        &data,
        &[],
    );
}

/// `Allocate { space }`.
pub fn allocate(account: &AccountView, space: u64, signers: &[Signer]) {
    let mut data = [0u8; 12];
    data[0] = 8;
    wr_u64(&mut data, 4, space);
    invoke(
        &SYSTEM_PROGRAM_ID,
        &[InstructionAccount::writable_signer(account.address())],
        &[account],
        &data,
        signers,
    );
}

/// `Assign { owner }`.
pub fn assign(account: &AccountView, owner: &Address, signers: &[Signer]) {
    let mut data = [0u8; 36];
    data[0] = 1;
    wr_bytes(&mut data, 4, owner.as_ref());
    invoke(
        &SYSTEM_PROGRAM_ID,
        &[InstructionAccount::writable_signer(account.address())],
        &[account],
        &data,
        signers,
    );
}
