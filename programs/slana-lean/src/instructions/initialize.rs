//! `initialize(args: InitializeArgs)` (reference: `instructions/initialize.rs`).
//!
//! Accounts: 0 admin, 1 config, 2 season, 3 token_mint, 4 token_program, 5 treasury_vault,
//! 6 season_vault, 7 program, 8 program_data, 9 system_program.
//!
//! | reference constraint                                              | lean check                                   | error |
//! |-------------------------------------------------------------------|----------------------------------------------|-------|
//! | `InitializeArgs` Borsh                                            | `Args`                                       | 102 |
//! | `admin: Signer`                                                   | `check_signer`                               | 3010 |
//! | `token_mint: InterfaceAccount<Mint>`                              | `token::load_mint`                           | 3012 / 3007 / ProgramError |
//! | `token_program: Interface<TokenInterface>`                        | `token::check_token_program`                 | 3008 / 3009 |
//! | `program: Program<Slana>`                                         | `check_program(ID)`                          | 3008 / 3009 |
//! | `program_data: Account<ProgramData>`                              | `check_owner(loader)` + `program_data_authority` | 3012 / 3007 / InvalidAccountData / 3013 |
//! | `system_program: Program<System>`                                 | `check_program(system)`                      | 3008 / 3009 |
//! | `config: init, payer = admin, space, seeds = [CONFIG_SEED], bump` | `find_pda` + key compare, `init_pda`         | 2006 / system program |
//! | `season: init, …, seeds = [SEASON_SEED, 1u32 LE], bump`           | `find_pda` + key compare, `init_pda`         | 2006 / system program |
//! | `treasury_vault: init, seeds = [TREASURY_VAULT_SEED], bump, token::mint, token::authority = config, token::token_program` | `init_token_vault` | 2006 / system / token program |
//! | `season_vault: init, seeds = [SEASON_VAULT_SEED], …` (same)        | `init_token_vault`                           | 2006 / system / token program |
//! | `admin: mut`                                                      | `check_writable`                             | 2000 |
//! | `token_mint: mint::token_program = token_program`                 | owner compare                                | 2022 |
//! | `program: programdata_address()? == Some(program_data)`           | `programdata_address` compare                | Unauthorized |
//! | `program_data: seeds = [ID], bump, seeds::program = loader`       | `check_canonical_pda(.., loader)`            | 2006 |
//! | `program_data: upgrade_authority_address == Some(admin)`          | authority compare                            | Unauthorized |
//! | `shared::check_fees / check_split / check_settle_fee`             | same                                         | InvalidFee / BadSplit |
//! | `token::validate_mint`                                            | `token::validate_mint`                       | MintNotAllowed / FreezeAuthorityPresent |
//!
//! The reference's `msg!("Slana initialized")` is not ported (logging is not part of the
//! contract).

use {
    super::{check_fees, check_settle_fee, check_split, unix_timestamp},
    crate::error::{Error, Result},
    crate::{
        accounts::{
            check_canonical_pda, check_writable, data, find_pda, init_pda, keq, kind, parse,
            program_data_authority,
        },
        borsh::{wr_bytes, wr_i64, wr_u16, wr_u32, wr_u64, wr_u8, Args},
        constants::*,
        cpi::token::initialize_account3,
        error::{err, require, CONSTRAINT_MINT_TOKEN_PROGRAM, CONSTRAINT_SEEDS, UNAUTHORIZED},
        state::{config, season},
        token::{token_account_space, validate_mint},
        ID,
    },
    pinocchio::{cpi::Seed, AccountView, Address},
};

#[inline(never)]
pub fn process(accounts: &[AccountView], data_in: &[u8]) -> Result {
    // ----- InitializeArgs ---------------------------------------------------------------
    let mut args = Args::new(data_in);
    let server_authority = args.key();
    let fee_bps = args.u16();
    let pass_fee_bps = args.u16();
    let treasury_bps = args.u16();
    let season_bps = args.u16();
    let burn_bps = args.u16();
    let settle_fee_lamports = args.u64();
    args.finish()?;

    // ----- account types, in declaration order -------------------------------------------
    let [admin, config_acc, season_acc, token_mint, token_program, treasury_vault, season_vault, program, program_data, _system_program] =
        parse(
            accounts,
            &[
                kind::SIGNER,
                kind::ANY,
                kind::ANY,
                kind::MINT,
                kind::TOKEN_PROGRAM,
                kind::ANY,
                kind::ANY,
                kind::SELF_PROGRAM,
                kind::PROGRAM_DATA,
                kind::SYSTEM_PROGRAM,
            ],
        )?;

    // ----- init accounts, in declaration order -------------------------------------------
    let config_bump = init_program_pda(admin, config_acc, config::SPACE, &[CONFIG_SEED])?;
    let first_season = FIRST_SEASON.to_le_bytes();
    let season_bump = init_program_pda(
        admin,
        season_acc,
        season::SPACE,
        &[SEASON_SEED, &first_season],
    )?;
    let treasury_vault_bump = init_token_vault(
        admin,
        treasury_vault,
        TREASURY_VAULT_SEED,
        token_mint,
        token_program,
        config_acc.address(),
    )?;
    let season_vault_bump = init_token_vault(
        admin,
        season_vault,
        SEASON_VAULT_SEED,
        token_mint,
        token_program,
        config_acc.address(),
    )?;

    // ----- remaining constraints -----------------------------------------------------------
    check_writable(admin)?;
    require(
        token_mint.owner() == token_program.address(),
        CONSTRAINT_MINT_TOKEN_PROGRAM,
    )?;
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
    check_fees(fee_bps, pass_fee_bps)?;
    check_split(treasury_bps, season_bps, burn_bps)?;
    check_settle_fee(settle_fee_lamports)?;
    let decimals = validate_mint(token_mint, token_program.address())?;
    let now = unix_timestamp()?;

    // SAFETY: `init_pda` allocated `config::SPACE` zeroed bytes; nothing else references them.
    let c = unsafe { data::<{ config::SPACE }>(config_acc) };
    wr_bytes(c, 0, &config::DISCRIMINATOR);
    wr_bytes(c, config::ADMIN, admin.address().as_ref());
    wr_bytes(c, config::SERVER_AUTHORITY, &server_authority);
    wr_bytes(c, config::TOKEN_MINT, token_mint.address().as_ref());
    wr_bytes(c, config::TOKEN_PROGRAM, token_program.address().as_ref());
    wr_u8(c, config::TOKEN_DECIMALS, decimals);
    wr_u16(c, config::FEE_BPS, fee_bps);
    wr_u16(c, config::PASS_FEE_BPS, pass_fee_bps);
    wr_u16(c, config::TREASURY_BPS, treasury_bps);
    wr_u16(c, config::SEASON_BPS, season_bps);
    wr_u16(c, config::BURN_BPS, burn_bps);
    wr_u64(c, config::SETTLE_FEE_LAMPORTS, settle_fee_lamports);
    wr_u32(c, config::CURRENT_SEASON, FIRST_SEASON);
    // paused = false and pass_collection = default: already zero.
    wr_u32(c, config::PASS_SUPPLY, DEFAULT_PASS_SUPPLY);
    wr_u8(c, config::PASS_PER_WALLET, DEFAULT_PASS_PER_WALLET);
    wr_u8(c, config::BUMP, config_bump);
    wr_u8(c, config::TREASURY_VAULT_BUMP, treasury_vault_bump);
    wr_u8(c, config::SEASON_VAULT_BUMP, season_vault_bump);

    // SAFETY: as above, `season::SPACE` bytes.
    let s = unsafe { data::<{ season::SPACE }>(season_acc) };
    wr_bytes(s, 0, &season::DISCRIMINATOR);
    wr_u32(s, season::ID, FIRST_SEASON);
    wr_i64(s, season::STARTED_AT, now);
    wr_u8(s, season::BUMP, season_bump);
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

/// `init, payer, seeds = [seed], bump, token::mint = mint, token::authority = authority,
/// token::token_program = token_program`: the PDA is created with the size the mint requires,
/// owned by the token program, then `InitializeAccount3`. Returns the bump.
#[inline(never)]
pub(crate) fn init_token_vault(
    payer: &AccountView,
    vault: &AccountView,
    seed: &[u8],
    mint: &AccountView,
    token_program: &AccountView,
    authority: &Address,
) -> Result<u8> {
    init_seeded_token_vault(payer, vault, &[seed], mint, token_program, authority)
}

/// [`init_token_vault`] with several seeds.
#[inline(never)]
pub(crate) fn init_seeded_token_vault(
    payer: &AccountView,
    vault: &AccountView,
    seeds: &[&[u8]],
    mint: &AccountView,
    token_program: &AccountView,
    authority: &Address,
) -> Result<u8> {
    let space = token_account_space(mint)?;
    let bump = init_pda_with(payer, vault, space, token_program.address(), seeds)?;
    initialize_account3(token_program.address(), vault, mint, authority)?;
    Ok(bump)
}

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
