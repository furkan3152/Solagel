//! Account validation, mirroring what Anchor's account types and constraints check, with the
//! same error codes:
//!
//! | Anchor                                 | lean                       | error                       |
//! |----------------------------------------|----------------------------|-----------------------------|
//! | next account missing                   | [`at`]                     | 3005 AccountNotEnoughKeys   |
//! | `Signer<'info>`                        | [`check_signer`]           | 3010 AccountNotSigner       |
//! | `#[account(mut)]`                      | [`check_writable`]         | 2000 ConstraintMut          |
//! | `Program<'info, T>` / `Interface<..>`  | [`check_program`]          | 3008 / 3009                 |
//! | `Account<'info, T>` (owner, disc, len) | [`load`]                   | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | `seeds = [..], bump = stored` (+ `mut`) | [`check_pda_seeds`]        | 2006 / 2000                 |
//! | `seeds = [..], bump` (canonical)       | [`find_pda`] + key compare | 2006 ConstraintSeeds        |
//! | `init, payer, space, seeds, bump`      | [`init_pda`]               | system program / 4101       |
//! | `Option<T>` (None = program id)        | `kind::OPT`, [`is_none`]   | as `T` when Some            |
//! | `close = dest`                         | [`close`]                  | 2011 ConstraintClose        |
//!
//! Account data is never borrowed through `try_borrow*`; [`load`] and [`data`] hand out the
//! data as a fixed-size array after the length was checked.

use {
    crate::error::{Error, Result},
    crate::{
        cpi::system,
        error::{
            err, ACCOUNT_DID_NOT_DESERIALIZE, ACCOUNT_DISCRIMINATOR_MISMATCH,
            ACCOUNT_DISCRIMINATOR_NOT_FOUND, ACCOUNT_NOT_ENOUGH_KEYS, ACCOUNT_NOT_INITIALIZED,
            ACCOUNT_NOT_PROGRAM_DATA, ACCOUNT_NOT_SIGNER, ACCOUNT_OWNED_BY_WRONG_PROGRAM,
            CONSTRAINT_CLOSE, CONSTRAINT_MUT, CONSTRAINT_SEEDS, INVALID_PROGRAM_EXECUTABLE,
            INVALID_PROGRAM_ID, TRYING_TO_INIT_PAYER_AS_PROGRAM_ACCOUNT,
        },
        ID,
    },
    pinocchio::{
        cpi::{Seed, Signer},
        sysvars::{get_sysvar, rent::RENT_ID},
        AccountView, Address,
    },
};

/// The `i`-th instruction account, or `AccountNotEnoughKeys`.
#[inline(always)]
pub fn at(accounts: &[AccountView], i: usize) -> Result<&AccountView> {
    accounts.get(i).ok_or_else(|| err(ACCOUNT_NOT_ENOUGH_KEYS))
}

/// `Signer<'info>`.
#[inline(never)]
pub fn check_signer(acc: &AccountView) -> Result {
    if acc.is_signer() {
        Ok(())
    } else {
        Err(err(ACCOUNT_NOT_SIGNER))
    }
}

/// `#[account(mut)]`.
#[inline(never)]
pub fn check_writable(acc: &AccountView) -> Result {
    if acc.is_writable() {
        Ok(())
    } else {
        Err(err(CONSTRAINT_MUT))
    }
}

/// `Program<'info, T>`: the key is `id` (`InvalidProgramId`) and the account is executable
/// (`InvalidProgramExecutable`).
#[inline(never)]
pub fn check_program(acc: &AccountView, id: &Address) -> Result {
    if acc.address() != id {
        return Err(err(INVALID_PROGRAM_ID));
    }
    check_executable(acc)
}

/// The executable half of `Program<'info, T>` / `Interface<'info, T>`.
#[inline(never)]
pub fn check_executable(acc: &AccountView) -> Result {
    if acc.executable() {
        Ok(())
    } else {
        Err(err(INVALID_PROGRAM_EXECUTABLE))
    }
}

/// The owner half of `Account<'info, T>` / `InterfaceAccount`: an empty system account is
/// `AccountNotInitialized`, any other owner than `owner` is `AccountOwnedByWrongProgram`.
#[inline(never)]
pub fn check_owner(acc: &AccountView, owner: &Address) -> Result {
    if acc.owned_by(&crate::constants::SYSTEM_PROGRAM_ID) && acc.lamports() == 0 {
        return Err(err(ACCOUNT_NOT_INITIALIZED));
    }
    if !acc.owned_by(owner) {
        return Err(err(ACCOUNT_OWNED_BY_WRONG_PROGRAM));
    }
    Ok(())
}

/// `Account<'info, T>` for a program account of `space` bytes: owner (as [`check_owner`]),
/// then `T::try_deserialize`: shorter than 8 bytes `AccountDiscriminatorNotFound`, another
/// discriminator `AccountDiscriminatorMismatch`, too short for the fields
/// `AccountDidNotDeserialize`.
#[inline(never)]
pub fn check_account(acc: &AccountView, disc: &[u8; 8], space: usize) -> Result {
    check_owner(acc, &ID)?;
    // SAFETY: no mutable borrow of the data exists (see the module docs).
    let data = unsafe { acc.borrow_unchecked() };
    let Some(head) = data.first_chunk::<8>() else {
        return Err(err(ACCOUNT_DISCRIMINATOR_NOT_FOUND));
    };
    if head != disc {
        return Err(err(ACCOUNT_DISCRIMINATOR_MISMATCH));
    }
    if data.len() < space {
        return Err(err(ACCOUNT_DID_NOT_DESERIALIZE));
    }
    Ok(())
}

/// [`check_account`], then the data as `[u8; N]` (`N` = the type's `SPACE`).
#[inline(always)]
#[allow(clippy::mut_from_ref)]
pub fn load<'a, const N: usize>(acc: &'a AccountView, disc: &[u8; 8]) -> Result<&'a mut [u8; N]> {
    check_account(acc, disc, N)?;
    // SAFETY: `check_account` verified `data_len >= N`.
    Ok(unsafe { data(acc) })
}

/// The first `N` data bytes of `acc`, in place.
///
/// # Safety
///
/// `acc.data_len() >= N`, and no other live reference to the same bytes is used meanwhile.
#[inline(always)]
#[allow(clippy::mut_from_ref)]
pub unsafe fn data<const N: usize>(acc: &AccountView) -> &mut [u8; N] {
    unsafe { &mut *(acc.data_ptr() as *mut [u8; N]) }
}

/// The first `N` data bytes of `acc`, read only. Use it wherever the bytes are only read, and
/// to read an account's own fields (its bump) before the key or seed check that proves it is
/// distinct from another account the handler later views mutably.
///
/// # Safety
///
/// `acc.data_len() >= N`, and no mutable reference to the same bytes is live meanwhile.
#[inline(always)]
pub unsafe fn data_ref<const N: usize>(acc: &AccountView) -> &[u8; N] {
    unsafe { &*(acc.data_ptr() as *const [u8; N]) }
}

// ----- account types, table driven ------------------------------------------------------

/// What Anchor's account type checks when it deserializes one account (`try_accounts`).
/// A handler lists its accounts' kinds in declaration order and [`parse`] checks them in
/// that order, so the first failing account reports its error, and a missing account
/// `AccountNotEnoughKeys` only once every earlier account passed, exactly like Anchor.
pub mod kind {
    /// `UncheckedAccount`, or an `init` account (only taken here; created later).
    pub const ANY: u8 = 0;
    /// `Signer<'info>`.
    pub const SIGNER: u8 = 1;
    /// `Program<'info, Slana>`.
    pub const SELF_PROGRAM: u8 = 2;
    /// `Program<'info, System>`.
    pub const SYSTEM_PROGRAM: u8 = 3;
    /// `Interface<'info, TokenInterface>`.
    pub const TOKEN_PROGRAM: u8 = 4;
    /// `InterfaceAccount<'info, Mint>`.
    pub const MINT: u8 = 5;
    /// `InterfaceAccount<'info, TokenAccount>`.
    pub const TOKEN_ACCOUNT: u8 = 6;
    /// `Account<'info, ProgramData>`.
    pub const PROGRAM_DATA: u8 = 7;
    /// `Account<'info, Config>` and the other program accounts (`8 + index` into
    /// `PROGRAM_ACCOUNTS`).
    pub const CONFIG: u8 = 8;
    pub const PROFILE: u8 = 9;
    pub const ARENA: u8 = 10;
    pub const SESSION: u8 = 11;
    pub const PASS_LOCK: u8 = 12;
    pub const SEASON: u8 = 13;
    pub const MINT_COUNTER: u8 = 14;
    /// Flag: `Option<T>` (Anchor encodes `None` as the program id, which is consumed and not
    /// checked). Use [`super::is_none`] in the handler.
    pub const OPT: u8 = 0x80;
}

/// An `Option<..>` account passed as `None` (its key is the program id).
#[inline(always)]
pub fn is_none(acc: &AccountView) -> bool {
    acc.address() == &ID
}

/// `(DISCRIMINATOR, SPACE)` of the program accounts, in `kind::CONFIG..` order.
const PROGRAM_ACCOUNTS: [(&[u8; 8], usize); 7] = {
    use crate::state::*;
    [
        (&config::DISCRIMINATOR, config::SPACE),
        (&profile::DISCRIMINATOR, profile::SPACE),
        (&arena::DISCRIMINATOR, arena::SPACE),
        (&session::DISCRIMINATOR, session::SPACE),
        (&pass_lock::DISCRIMINATOR, pass_lock::SPACE),
        (&season::DISCRIMINATOR, season::SPACE),
        (&mint_counter::DISCRIMINATOR, mint_counter::SPACE),
    ]
};

/// Checks `accounts` against `kinds` (see [`kind`]) in order and returns the first
/// `kinds.len()` accounts.
#[inline(always)]
pub fn parse<'a, const N: usize>(
    accounts: &'a [AccountView],
    kinds: &[u8; N],
) -> Result<&'a [AccountView; N]> {
    check_kinds(accounts, kinds)?;
    accounts
        .first_chunk::<N>()
        .ok_or_else(|| err(ACCOUNT_NOT_ENOUGH_KEYS))
}

/// [`parse`] for a kinds list chosen at run time (no account array is returned).
#[inline(never)]
pub fn check_kinds(accounts: &[AccountView], kinds: &[u8]) -> Result {
    for (i, &k) in kinds.iter().enumerate() {
        let acc = at(accounts, i)?;
        if k & kind::OPT != 0 && is_none(acc) {
            continue;
        }
        let k = k & !kind::OPT;
        match k {
            kind::ANY => {}
            kind::SIGNER => check_signer(acc)?,
            kind::SELF_PROGRAM => check_program(acc, &ID)?,
            kind::SYSTEM_PROGRAM => check_program(acc, &crate::constants::SYSTEM_PROGRAM_ID)?,
            kind::TOKEN_PROGRAM => crate::token::check_token_program(acc)?,
            kind::MINT => {
                crate::token::load_mint(acc)?;
            }
            kind::TOKEN_ACCOUNT => {
                crate::token::load_token_account(acc)?;
            }
            kind::PROGRAM_DATA => {
                program_data_authority(acc)?;
            }
            _ => {
                let Some((disc, space)) =
                    PROGRAM_ACCOUNTS.get(usize::from(k.wrapping_sub(kind::CONFIG)))
                else {
                    return Err(Error::INVALID_ARGUMENT);
                };
                check_account(acc, disc, *space)?;
            }
        }
    }
    Ok(())
}

/// `Account<'info, ProgramData>` (`UpgradeableLoaderState` bincode: u32 tag, `ProgramData` =
/// 3 then slot u64 and `Option<Pubkey>`): owner the upgradeable loader (3012 / 3007), a
/// malformed state `InvalidAccountData` (Anchor maps bincode errors to it), another state
/// `AccountNotProgramData`. Returns the upgrade authority.
#[inline(never)]
pub fn program_data_authority(acc: &AccountView) -> Result<Option<[u8; 32]>> {
    check_owner(acc, &crate::constants::BPF_LOADER_UPGRADEABLE_ID)?;
    // SAFETY: no mutable borrow of the data exists.
    let d = unsafe { acc.borrow_unchecked() };
    let Some((tag, rest)) = d.split_first_chunk::<4>() else {
        return Err(Error::INVALID_ACCOUNT_DATA);
    };
    match u32::from_le_bytes(*tag) {
        3 => match rest.get(8) {
            Some(0) => Ok(None),
            Some(1) => match rest.get(9..).and_then(|k| k.first_chunk::<32>()) {
                Some(key) => Ok(Some(*key)),
                None => Err(Error::INVALID_ACCOUNT_DATA),
            },
            _ => Err(Error::INVALID_ACCOUNT_DATA),
        },
        0..=2 => Err(err(ACCOUNT_NOT_PROGRAM_DATA)),
        _ => Err(Error::INVALID_ACCOUNT_DATA),
    }
}

/// `true` when `a == b` (one shared out-of-line comparison instead of an inlined one per use).
#[inline(never)]
pub fn keq(a: &[u8; 32], b: &[u8; 32]) -> bool {
    a == b
}

// ----- PDAs -----------------------------------------------------------------------------

/// `create_program_address(seeds, program)`; `None` when the seeds hash onto the curve.
#[cfg(target_os = "solana")]
fn create_program_address(seeds: &[Seed], program: &Address) -> Option<Address> {
    let mut out = core::mem::MaybeUninit::<Address>::uninit();
    // SAFETY: `Seed` has the `(ptr, len)` layout the syscall expects.
    let rc = unsafe {
        pinocchio::syscalls::sol_create_program_address(
            seeds.as_ptr() as *const u8,
            seeds.len() as u64,
            program as *const Address as *const u8,
            out.as_mut_ptr() as *mut u8,
        )
    };
    // SAFETY: success initializes `out`.
    (rc == 0).then(|| unsafe { out.assume_init() })
}

/// Host builds (unit tests) have no PDA syscall; no host code derives addresses.
#[cfg(not(target_os = "solana"))]
fn create_program_address(_seeds: &[Seed], _program: &Address) -> Option<Address> {
    unimplemented!("create_program_address is a syscall (SBF only)")
}

/// `find_program_address(seeds, program)`: the canonical PDA and its bump.
#[cfg(target_os = "solana")]
pub fn find_pda(seeds: &[Seed], program: &Address) -> Result<(Address, u8)> {
    let mut out = core::mem::MaybeUninit::<Address>::uninit();
    let mut bump = 0u8;
    // SAFETY: as in `create_program_address`.
    let rc = unsafe {
        pinocchio::syscalls::sol_try_find_program_address(
            seeds.as_ptr() as *const u8,
            seeds.len() as u64,
            program as *const Address as *const u8,
            out.as_mut_ptr() as *mut u8,
            &mut bump as *mut u8,
        )
    };
    if rc != 0 {
        // Anchor's `find_program_address` aborts here; there is no seed set of this program
        // for which it happens.
        return Err(err(CONSTRAINT_SEEDS));
    }
    // SAFETY: success initializes `out`.
    Ok((unsafe { out.assume_init() }, bump))
}

/// Host builds (unit tests) have no PDA syscall; no host code derives addresses.
#[cfg(not(target_os = "solana"))]
pub fn find_pda(_seeds: &[Seed], _program: &Address) -> Result<(Address, u8)> {
    unimplemented!("find_program_address is a syscall (SBF only)")
}

/// `seeds = [..], bump = <stored bump>` for up to three seeds: the address must be
/// `create_program_address(seeds ‖ [bump], ID)` (`ConstraintSeeds`), then `mut` when
/// `mutable` (`ConstraintMut`). The one seed check every handler shares: the bump is appended
/// here. More than three seeds is `InvalidArgument` (never truncated).
#[inline(never)]
pub fn check_pda_seeds(acc: &AccountView, seeds: &[&[u8]], bump: u8, mutable: bool) -> Result {
    let bump = [bump];
    let mut all: [&[u8]; 4] = [&bump; 4];
    // Slot `seeds.len()` keeps the bump.
    let Some(head) = all.get_mut(..seeds.len()) else {
        return Err(Error::INVALID_ARGUMENT);
    };
    head.copy_from_slice(seeds);
    let Some(with_bump) = all.get(..=seeds.len()) else {
        return Err(Error::INVALID_ARGUMENT);
    };
    // SAFETY: `Seed` is `#[repr(C)] { ptr, u64 len }`, the layout of `&[u8]` on SBF (and on
    // 64-bit hosts); the slices outlive the call.
    let with_bump =
        unsafe { core::slice::from_raw_parts(with_bump.as_ptr() as *const Seed, with_bump.len()) };
    match create_program_address(with_bump, &ID) {
        Some(pda) if &pda == acc.address() => {}
        _ => return Err(err(CONSTRAINT_SEEDS)),
    }
    if mutable {
        check_writable(acc)?;
    }
    Ok(())
}

/// `seeds = [..], bump` without a stored bump: the address must be the canonical PDA of
/// `seeds` under `program`, else `ConstraintSeeds`. Returns the bump.
#[inline(never)]
pub fn check_canonical_pda(acc: &AccountView, seeds: &[Seed], program: &Address) -> Result<u8> {
    let (pda, bump) = find_pda(seeds, program)?;
    if &pda != acc.address() {
        return Err(err(CONSTRAINT_SEEDS));
    }
    Ok(bump)
}

// ----- rent ------------------------------------------------------------------------------

/// `Rent::get()?.minimum_balance(space)` (solana-rent 4.x: exemption threshold 1.0 or 2.0,
/// no floating point).
#[inline(never)]
// Bound: at most 10 MiB + 128 bytes times the cluster's per-byte rate (3,480) times 2, far
// below u64::MAX (solana-rent computes the same product).
#[allow(clippy::arithmetic_side_effects)]
pub fn rent_minimum(space: usize) -> Result<u64> {
    /// `2.0f64.to_bits()`.
    const THRESHOLD_TWO: u64 = 0x4000_0000_0000_0000;
    let mut rent = [0u8; 16];
    get_sysvar(&mut rent, &RENT_ID, 0).map_err(|_| Error::UNSUPPORTED_SYSVAR)?;
    let [per_byte @ .., _, _, _, _, _, _, _, _] = rent;
    let [_, _, _, _, _, _, _, _, threshold @ ..] = rent;
    let per_byte = u64::from_le_bytes(per_byte);
    // `exemption_threshold` (f64 bits) == 2.0 doubles the rate; 1.0 (SIMD-0194) keeps it.
    let factor = if u64::from_le_bytes(threshold) == THRESHOLD_TWO {
        2
    } else {
        1
    };
    Ok((space as u64 + 128) * per_byte * factor)
}

// ----- init / close -------------------------------------------------------------------------

/// Anchor's `init` (`create_account_or_fund_allocate_assign`): creates `acc` (a PDA signing
/// with `seeds_with_bump`) with `space` bytes owned by `owner`, rent paid by `payer`.
///
/// * no lamports yet: `CreateAccount` for the rent-exempt minimum;
/// * already funded (anyone can send lamports to a PDA): `payer` may not be `acc`
///   (`TryingToInitPayerAsProgramAccount`), the missing rent is transferred, then `Allocate`
///   and `Assign`. An account that already holds data or belongs to a program fails in the
///   system program (`AccountAlreadyInUse`, custom error 0), as with Anchor.
#[inline(never)]
pub fn init_pda(
    payer: &AccountView,
    acc: &AccountView,
    space: usize,
    owner: &Address,
    seeds_with_bump: &[Seed],
) -> Result {
    let signer = [Signer::from(seeds_with_bump)];
    let rent = rent_minimum(space)?;
    let current = acc.lamports();
    if current == 0 {
        system::create_account(payer, acc, rent, space as u64, owner, &signer)?;
    } else {
        if payer.address() == acc.address() {
            return Err(err(TRYING_TO_INIT_PAYER_AS_PROGRAM_ACCOUNT));
        }
        let missing = rent.max(1).saturating_sub(current);
        if missing > 0 {
            system::transfer(payer, acc, missing)?;
        }
        system::allocate(acc, space as u64, &signer)?;
        system::assign(acc, owner, &signer)?;
    }
    Ok(())
}

/// Anchor's `close = dest`: every lamport moves to `dest`, then the account is handed back
/// to the system program with no data (owner, lamports and length zeroed), so it cannot be
/// revived later in the same transaction.
///
/// Guards (each unreachable through the handlers, which check them earlier with Anchor's
/// codes; they keep the helper sound on its own): `acc` and `dest` differ (`ConstraintClose`,
/// as Anchor's `close` constraint), `acc` is writable (`ConstraintMut`) and owned by this
/// program (`AccountOwnedByWrongProgram`).
#[inline(never)]
pub fn close(acc: &AccountView, dest: &AccountView) -> Result {
    if keq(acc.address().as_array(), dest.address().as_array()) {
        return Err(err(CONSTRAINT_CLOSE));
    }
    check_writable(acc)?;
    if !acc.owned_by(&ID) {
        return Err(err(ACCOUNT_OWNED_BY_WRONG_PROGRAM));
    }
    move_lamports(acc, dest, acc.lamports())?;
    let mut acc = acc.clone();
    // SAFETY: no borrow of the account data is outstanding (see the module docs).
    unsafe { acc.close_unchecked() };
    Ok(())
}

/// Moves `amount` lamports out of a program account into `to` (Anchor's `sub_lamports` /
/// `add_lamports`, both `ArithmeticOverflow` on wrap).
#[inline(never)]
pub fn move_lamports(from: &AccountView, to: &AccountView, amount: u64) -> Result {
    let left = from
        .lamports()
        .checked_sub(amount)
        .ok_or(Error::ARITHMETIC_OVERFLOW)?;
    let mut from = from.clone();
    from.set_lamports(left);
    let total = to
        .lamports()
        .checked_add(amount)
        .ok_or(Error::ARITHMETIC_OVERFLOW)?;
    let mut to = to.clone();
    to.set_lamports(total);
    Ok(())
}
