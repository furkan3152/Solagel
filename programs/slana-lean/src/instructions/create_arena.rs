//! `create_arena(id, entry_fee, max_sessions)` (reference: `instructions/create_arena.rs`).
//!
//! Accounts: 0 admin, 1 config, 2 arena, 3 vault, 4 token_mint, 5 token_program,
//! 6 system_program.
//!
//! | reference constraint                                              | lean check                     | error |
//! |-------------------------------------------------------------------|--------------------------------|-------|
//! | args Borsh (`u16, u64, u16`; `#[instruction(id: u16)]`)            | `Args`                         | 102 |
//! | `admin: Signer`                                                   | `check_signer`                 | 3010 |
//! | `config: Account<Config>`                                         | `load`                         | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | `token_mint: InterfaceAccount<Mint>`                              | `token::load_mint`             | 3012 / 3007 / ProgramError |
//! | `token_program: Interface<TokenInterface>`                        | `token::check_token_program`   | 3008 / 3009 |
//! | `system_program: Program<System>`                                 | `check_program(system)`        | 3008 / 3009 |
//! | `arena: init, payer = admin, space, seeds = [ARENA_SEED, id LE], bump` | `init_program_pda`        | 2006 / system program |
//! | `vault: init, payer = admin, seeds = [VAULT_SEED, arena], bump, token::mint = token_mint, token::authority = arena, token::token_program` | `init_seeded_token_vault` | 2006 / system / token program |
//! | `admin: mut`                                                      | `check_writable`               | 2000 |
//! | `config: seeds = [CONFIG_SEED], bump = config.bump`               | `check_admin_config`           | 2006 |
//! | `config: has_one = admin @ Unauthorized`                          | `check_admin_config`           | Unauthorized |
//! | `config: constraint = config.token_mint != default @ TokenNotSet`  | `stake::check_token_set`       | TokenNotSet |
//! | `token_mint: address = config.token_mint`                         | key compare                    | 2012 |
//! | `token_program: address = config.token_program`                   | key compare                    | 2012 |
//! | `shared::check_entry_fee / check_max_sessions`                    | same                           | EntryFeeZero / InvalidMaxSessions |
//!
//! Emits `ArenaCreated`.

use {
    super::{
        check_admin_config, check_entry_fee, check_max_sessions,
        initialize::{init_pda_with, init_program_pda},
        stake,
    },
    crate::error::Result,
    crate::{
        accounts::{check_writable, data, kind, parse},
        borsh::{wr_bool, wr_bytes, wr_u16, wr_u64, wr_u8, Args},
        constants::{ARENA_SEED, VAULT_SEED},
        cpi::token::initialize_account3,
        events,
        state::{arena, config},
        token::token_account_space,
    },
    pinocchio::{AccountView, Address},
};

#[inline(never)]
pub fn process(accounts: &[AccountView], args: &[u8]) -> Result {
    let mut a = Args::new(args);
    let id = a.u16();
    let entry_fee = a.u64();
    let max_sessions = a.u16();
    a.finish()?;

    let [admin, config_acc, arena_acc, vault, token_mint, token_program, _system_program] = parse(
        accounts,
        &[
            kind::SIGNER,
            kind::CONFIG,
            kind::ANY,
            kind::ANY,
            kind::MINT,
            kind::TOKEN_PROGRAM,
            kind::SYSTEM_PROGRAM,
        ],
    )?;
    // SAFETY: `parse` checked the account holds a `Config`; it is only read.
    let c = unsafe { data::<{ config::SPACE }>(config_acc) };

    let id_seed = id.to_le_bytes();
    let arena_bump = init_program_pda(admin, arena_acc, arena::SPACE, &[ARENA_SEED, &id_seed])?;
    let vault_bump = init_token_vault(
        admin,
        vault,
        &[VAULT_SEED, arena_acc.address().as_ref()],
        token_mint,
        token_program,
        arena_acc.address(),
    )?;

    check_writable(admin)?;
    check_admin_config(config_acc, c, admin, false)?;
    stake::check_token_set(c)?;
    stake::check_token_addresses(c, token_mint, token_program)?;

    check_entry_fee(entry_fee)?;
    check_max_sessions(max_sessions)?;

    // SAFETY: `init_pda` allocated `arena::SPACE` zeroed bytes; nothing else references them.
    let r = unsafe { data::<{ arena::SPACE }>(arena_acc) };
    wr_bytes(r, 0, &arena::DISCRIMINATOR);
    wr_u16(r, arena::ID, id);
    wr_u64(r, arena::ENTRY_FEE, entry_fee);
    wr_u16(r, arena::MAX_SESSIONS, max_sessions);
    // open_sessions, total_deposited, total_paid_out: already zero.
    wr_bool(r, arena::ENABLED, true);
    wr_bytes(r, arena::VAULT, vault.address().as_ref());
    wr_u8(r, arena::VAULT_BUMP, vault_bump);
    wr_u8(r, arena::BUMP, arena_bump);

    events::emit(&events::arena_created(id, entry_fee, max_sessions));
    Ok(())
}

/// `init, payer, seeds = seeds, bump, token::mint = mint, token::authority = authority,
/// token::token_program = token_program`: the PDA is created with the size the mint requires,
/// owned by the token program, then `InitializeAccount3`. Returns the bump.
#[inline(never)]
fn init_token_vault(
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
