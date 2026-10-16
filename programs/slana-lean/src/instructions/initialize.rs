//! `initialize(args: InitializeArgs)` — reference `instructions/initialize.rs`.
//!
//! Accounts: 0 admin, 1 config, 2 program, 3 program_data, 4 system_program.
//!
//! | reference constraint                                              | lean check                                   | error |
//! |-------------------------------------------------------------------|----------------------------------------------|-------|
//! | `InitializeArgs` Borsh (`u16, u64, Pubkey, Pubkey`)               | `Args`                                       | 102 |
//! | `admin: Signer`                                                   | `check_signer`                               | 3010 |
//! | `program: Program<Slana>`                                         | `check_program(ID)`                          | 3008 / 3009 |
//! | `program_data: Account<ProgramData>`                              | `check_owner(loader)` + `program_data_authority` | 3012 / 3007 / InvalidAccountData / 3013 |
//! | `system_program: Program<System>`                                 | `check_program(system)`                      | 3008 / 3009 |
//! | `config: init, payer = admin, space, seeds = [CONFIG_SEED], bump` | `find_pda` + key compare, `init_pda`         | 2006 / system program |
//! | `admin: mut`                                                      | `check_writable`                             | 2000 |
//! | `program: programdata_address()? == Some(program_data)`           | `programdata_address` compare                | Unauthorized |
//! | `program_data: seeds = [ID], bump, seeds::program = loader`       | `check_canonical_pda(.., loader)`            | 2006 |
//! | `program_data: upgrade_authority_address == Some(admin)`          | authority compare                            | Unauthorized |
//! | `shared::check_fee / check_settle_fee`                            | same                                         | InvalidFee |
//! | `shared::check_authority(server_authority / fee_wallet)`          | same                                         | InvalidAuthority |
//!
//! The config starts without a token (`token_mint` / `token_program` zero, decimals 0). The
//! reference's `msg!("Slana initialized")` is not ported (logging is not part of the contract).

use {
    super::{check_authority, check_fee, check_settle_fee},
    crate::error::{Error, Result},
    crate::{
        accounts::{
            check_canonical_pda, check_writable, data, find_pda, init_pda, keq, kind, parse,
            program_data_authority,
        },
        borsh::{wr_bytes, wr_u16, wr_u64, wr_u8, Args},
        constants::*,
        error::{err, require, CONSTRAINT_SEEDS, UNAUTHORIZED},
        state::config,
        ID,
    },
    pinocchio::{cpi::Seed, AccountView, Address},
};

#[inline(never)]
pub fn process(accounts: &[AccountView], data_in: &[u8]) -> Result {
    // ----- InitializeArgs ---------------------------------------------------------------
    let mut args = Args::new(data_in);
    let fee_bps = args.u16();
    let settle_fee_lamports = args.u64();
    let server_authority = args.key();
    let fee_wallet = args.key();
    args.finish()?;

    // ----- account types, in declaration order -------------------------------------------
    let [admin, config_acc, program, program_data, _system_program] = parse(
        accounts,
        &[
            kind::SIGNER,
            kind::ANY,
            kind::SELF_PROGRAM,
            kind::PROGRAM_DATA,
            kind::SYSTEM_PROGRAM,
        ],
    )?;

    // ----- init accounts -------------------------------------------------------------------
    let config_bump = init_program_pda(admin, config_acc, config::SPACE, &[CONFIG_SEED])?;

    // ----- remaining constraints -----------------------------------------------------------
    check_writable(admin)?;
    require(
        matches!(programdata_address(program), Some(key) if keq(&key, program_data.address().as_array())),
        UNAUTHORIZED,
    )?;
    check_canonical_pda(
        program_data,
        &[Seed::from(ID.as_ref())],
        &BPF_LOADER_UPGRADEABLE_ID,
    )?;
    let upgrade_authority = program_data_authority(program_data)?;
    require(
        matches!(upgrade_authority, Some(key) if keq(&key, admin.address().as_array())),
        UNAUTHORIZED,
    )?;

    // ----- handler -------------------------------------------------------------------------
    check_fee(fee_bps)?;
    check_settle_fee(settle_fee_lamports)?;
    check_authority(&server_authority)?;
    check_authority(&fee_wallet)?;

    // SAFETY: `init_pda` allocated `config::SPACE` zeroed bytes; nothing else references them.
    let c = unsafe { data::<{ config::SPACE }>(config_acc) };
    wr_bytes(c, 0, &config::DISCRIMINATOR);
    wr_bytes(c, config::ADMIN, admin.address().as_ref());
    wr_bytes(c, config::SERVER_AUTHORITY, &server_authority);
    wr_bytes(c, config::FEE_WALLET, &fee_wallet);
    // token_mint, token_program, token_decimals and paused: already zero.
    wr_u16(c, config::FEE_BPS, fee_bps);
    wr_u64(c, config::SETTLE_FEE_LAMPORTS, settle_fee_lamports);
    wr_u8(c, config::BUMP, config_bump);
    Ok(())
}

/// `init, payer, space, seeds = seeds, bump` for an account of this program: the address must
/// be the canonical PDA (`ConstraintSeeds`). Returns the bump.
#[inline(never)]
pub(crate) fn init_program_pda(
    payer: &AccountView,
    acc: &AccountView,
    space: usize,
    seeds: &[&[u8]],
) -> Result<u8> {
    init_pda_with(payer, acc, space, &ID, seeds)
}

/// `init` of an account owned by `owner` at the canonical PDA of `seeds` (at most
/// [`MAX_INIT_SEEDS`] seeds; more is an `InvalidArgument` programming error, never a silent
/// truncation).
#[inline(never)]
pub(crate) fn init_pda_with(
    payer: &AccountView,
    acc: &AccountView,
    space: usize,
    owner: &Address,
    seeds: &[&[u8]],
) -> Result<u8> {
    let n = seeds.len();
    if n > MAX_INIT_SEEDS {
        return Err(Error::INVALID_ARGUMENT);
    }
    let empty: &[u8] = &[];
    let mut with_bump = [
        Seed::from(empty),
        Seed::from(empty),
        Seed::from(empty),
        Seed::from(empty),
    ];
    for (slot, seed) in with_bump.iter_mut().zip(seeds) {
        *slot = Seed::from(*seed);
    }
    let (pda, bump) = find_pda(with_bump.get(..n).unwrap_or(&[]), &ID)?;
    if &pda != acc.address() {
        return Err(err(CONSTRAINT_SEEDS));
    }
    let bump_seed = [bump];
    // `n <= MAX_INIT_SEEDS`, so slot `n` exists and `n + 1` cannot wrap.
    if let Some(slot) = with_bump.get_mut(n) {
        *slot = Seed::from(&bump_seed);
    }
    init_pda(payer, acc, space, owner, with_bump.get(..=n).unwrap_or(&[]))?;
    Ok(bump)
}

/// Most seeds (without the bump) of any `init` in the program (`with_bump` above holds
/// `MAX_INIT_SEEDS + 1` slots).
const MAX_INIT_SEEDS: usize = 3;

/// `Program::programdata_address()`: for a loader-v3 program account (`Program` state = tag 2
/// then the ProgramData address), that address; `None` for any other owner.
fn programdata_address(program: &AccountView) -> Option<[u8; 32]> {
    if !program.owned_by(&BPF_LOADER_UPGRADEABLE_ID) {
        return None;
    }
    // SAFETY: no mutable borrow of the data exists.
    let d = unsafe { program.borrow_unchecked() };
    match d.split_first_chunk::<4>() {
        Some(([2, 0, 0, 0], rest)) => rest.first_chunk::<32>().copied(),
        _ => None,
    }
}
