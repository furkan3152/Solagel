//! `withdraw_treasury(amount)` — reference `instructions/withdraw_treasury.rs`.
//!
//! Accounts: 0 admin, 1 config, 2 treasury_vault, 3 destination, 4 token_mint,
//! 5 token_program.
//!
//! | reference constraint                                                | lean check                     | error |
//! |---------------------------------------------------------------------|--------------------------------|-------|
//! | `amount: u64` Borsh                                                 | `Args`                         | 102 |
//! | `admin: Signer`                                                     | `check_signer`                 | 3010 |
//! | `config: Account<Config>`                                           | `load`                         | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | `treasury_vault: InterfaceAccount<TokenAccount>`                    | `token::load_token_account`    | 3012 / 3007 / ProgramError |
//! | `destination: InterfaceAccount<TokenAccount>`                       | `token::load_token_account`    | 3012 / 3007 / ProgramError |
//! | `token_mint: InterfaceAccount<Mint>`                                | `token::load_mint`             | 3012 / 3007 / ProgramError |
//! | `token_program: Interface<TokenInterface>`                          | `token::check_token_program`   | 3008 / 3009 |
//! | duplicate `mut` accounts (treasury_vault, destination)              | key compare                    | 2040 |
//! | `config: seeds = [CONFIG_SEED], bump = config.bump`                 | `check_admin_config`           | 2006 |
//! | `config: has_one = admin @ Unauthorized`                            | `check_admin_config`           | Unauthorized |
//! | `treasury_vault: seeds = [TREASURY_VAULT_SEED], bump = config.treasury_vault_bump` | `check_pda`     | 2006 |
//! | `treasury_vault: mut`                                               | `check_writable`               | 2000 |
//! | `treasury_vault: token::authority = config`                         | `check_token_account`          | 2015 |
//! | `treasury_vault: token::mint = token_mint`                          | `check_token_account`          | 2014 |
//! | `treasury_vault: token::token_program = token_program`              | `check_token_account`          | 2021 |
//! | `destination: mut`                                                  | `check_writable`               | 2000 |
//! | `destination: token::mint = token_mint`                             | `check_token_account`          | 2014 |
//! | `destination: token::token_program = token_program`                 | `check_token_account`          | 2021 |
//! | `token_mint: address = config.token_mint`                           | key compare                    | 2012 |
//! | `token_program: address = config.token_program`                     | key compare                    | 2012 |
//! | `require_gt!(amount, 0, InvalidAmount)`                             | same                           | InvalidAmount |
//! | `require_gte!(vault.amount, amount, InsufficientPot)`               | same                           | InsufficientPot |
//!
//! Then `transfer_checked` signed by the config PDA, with `config.token_decimals`, and
//! `TreasuryWithdrawn`.

use {
    super::check_admin_config,
    crate::error::Result,
    crate::{
        accounts::{check_pda, check_writable, data, keq, kind, parse},
        borsh::{rd_key, rd_u64, rd_u8},
        constants::TREASURY_VAULT_SEED,
        cpi::token::transfer_checked,
        error::{
            err, require, CONSTRAINT_ADDRESS, CONSTRAINT_DUPLICATE_MUTABLE_ACCOUNT,
            CONSTRAINT_TOKEN_MINT, CONSTRAINT_TOKEN_OWNER, CONSTRAINT_TOKEN_TOKEN_PROGRAM,
            INSUFFICIENT_POT, INVALID_AMOUNT,
        },
        events,
        state::config,
        token::{ACCOUNT_AMOUNT, ACCOUNT_LEN, ACCOUNT_MINT, ACCOUNT_OWNER},
    },
    pinocchio::{
        cpi::{Seed, Signer},
        AccountView,
    },
};

#[inline(never)]
pub fn process(accounts: &[AccountView], args: &[u8]) -> Result {
    let mut a = crate::borsh::Args::new(args);
    let amount = a.u64();
    a.finish()?;

    let [admin, config_acc, treasury_vault, destination, token_mint, token_program] = parse(
        accounts,
        &[
            kind::SIGNER,
            kind::CONFIG,
            kind::TOKEN_ACCOUNT,
            kind::TOKEN_ACCOUNT,
            kind::MINT,
            kind::TOKEN_PROGRAM,
        ],
    )?;
    // SAFETY: `parse` checked the types (and so the lengths); config is only read here.
    let c = unsafe { data::<{ config::SPACE }>(config_acc) };
    let vault = unsafe { data::<{ ACCOUNT_LEN }>(treasury_vault) };
    let dest = unsafe { data::<{ ACCOUNT_LEN }>(destination) };

    if keq(
        treasury_vault.address().as_array(),
        destination.address().as_array(),
    ) {
        return Err(err(CONSTRAINT_DUPLICATE_MUTABLE_ACCOUNT));
    }

    check_admin_config(config_acc, c, admin, false)?;
    let vault_bump = [rd_u8(c, config::TREASURY_VAULT_BUMP)];
    check_pda(
        treasury_vault,
        &[Seed::from(TREASURY_VAULT_SEED), Seed::from(&vault_bump)],
    )?;
    check_writable(treasury_vault)?;
    check_token_account(
        treasury_vault,
        vault,
        Some(config_acc),
        token_mint,
        token_program,
    )?;
    check_writable(destination)?;
    check_token_account(destination, dest, None, token_mint, token_program)?;
    require(
        keq(
            &rd_key(c, config::TOKEN_MINT),
            token_mint.address().as_array(),
        ),
        CONSTRAINT_ADDRESS,
    )?;
    require(
        keq(
            &rd_key(c, config::TOKEN_PROGRAM),
            token_program.address().as_array(),
        ),
        CONSTRAINT_ADDRESS,
    )?;

    require(amount > 0, INVALID_AMOUNT)?;
    require(rd_u64(vault, ACCOUNT_AMOUNT) >= amount, INSUFFICIENT_POT)?;

    let config_bump = [rd_u8(c, config::BUMP)];
    let seeds = [
        Seed::from(crate::constants::CONFIG_SEED),
        Seed::from(&config_bump),
    ];
    transfer_checked(
        token_program.address(),
        treasury_vault,
        token_mint,
        destination,
        config_acc,
        amount,
        rd_u8(c, config::TOKEN_DECIMALS),
        &[Signer::from(&seeds)],
    );

    events::emit(&events::treasury_withdrawn(
        destination.address().as_array(),
        amount,
    ));
    Ok(())
}

/// `token::authority = authority` (when given, `ConstraintTokenOwner`), `token::mint = mint`
/// (`ConstraintTokenMint`), `token::token_program = token_program`
/// (`ConstraintTokenTokenProgram`), in Anchor's order.
#[inline(never)]
pub(crate) fn check_token_account(
    acc: &AccountView,
    data: &[u8; ACCOUNT_LEN],
    authority: Option<&AccountView>,
    mint: &AccountView,
    token_program: &AccountView,
) -> Result {
    if let Some(authority) = authority {
        require(
            keq(&rd_key(data, ACCOUNT_OWNER), authority.address().as_array()),
            CONSTRAINT_TOKEN_OWNER,
        )?;
    }
    require(
        keq(&rd_key(data, ACCOUNT_MINT), mint.address().as_array()),
        CONSTRAINT_TOKEN_MINT,
    )?;
    require(
        keq(acc.owner().as_array(), token_program.address().as_array()),
        CONSTRAINT_TOKEN_TOKEN_PROGRAM,
    )
}
