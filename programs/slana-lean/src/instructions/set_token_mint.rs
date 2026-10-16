//! `set_token_mint()` — reference `instructions/set_token_mint.rs`.
//!
//! Accounts: 0 admin, 1 config, 2 token_mint, 3 token_program.
//!
//! | reference constraint                                                   | lean check                     | error |
//! |------------------------------------------------------------------------|--------------------------------|-------|
//! | `admin: Signer`                                                        | `check_signer`                 | 3010 |
//! | `config: Account<Config>`                                              | `check_account`                | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | `token_mint: InterfaceAccount<Mint>`                                   | `token::load_mint`             | 3012 / 3007 / ProgramError |
//! | `token_program: Interface<TokenInterface>`                             | `token::check_token_program`   | 3008 / 3009 |
//! | `config: seeds = [CONFIG_SEED], bump = config.bump`, `mut`             | `check_admin_config`           | 2006 / 2000 |
//! | `config: has_one = admin @ Unauthorized`                               | `check_admin_config`           | Unauthorized |
//! | `config: constraint = config.token_mint == default @ TokenAlreadySet`  | key compare                    | TokenAlreadySet |
//! | `token_mint: mint::token_program = token_program`                      | owner compare                  | 2022 |
//! | `token::validate_mint`                                                 | `token::validate_mint`         | MintNotAllowed / FreezeAuthorityPresent |
//!
//! Stores mint, token program and decimals, and emits `TokenMintSet`.

use {
    super::check_admin_config,
    crate::error::Result,
    crate::{
        accounts::{data, kind, parse},
        borsh::{rd_key, wr_bytes, wr_u8},
        error::{require, CONSTRAINT_MINT_TOKEN_PROGRAM, TOKEN_ALREADY_SET},
        events,
        state::config,
        token::validate_mint,
    },
    pinocchio::AccountView,
};

#[inline(never)]
pub fn process(accounts: &[AccountView], _args: &[u8]) -> Result {
    let [admin, config_acc, token_mint, token_program] = parse(
        accounts,
        &[kind::SIGNER, kind::CONFIG, kind::MINT, kind::TOKEN_PROGRAM],
    )?;
    // SAFETY: `parse` checked the account holds a `Config` (`config::SPACE` bytes); the mint
    // and the token program are other accounts (distinct owners), only read.
    let c = unsafe { data::<{ config::SPACE }>(config_acc) };

    check_admin_config(config_acc, c, admin, true)?;
    require(rd_key(c, config::TOKEN_MINT) == [0; 32], TOKEN_ALREADY_SET)?;
    require(
        token_mint.owner() == token_program.address(),
        CONSTRAINT_MINT_TOKEN_PROGRAM,
    )?;

    let decimals = validate_mint(token_mint, token_program.address())?;
    wr_bytes(c, config::TOKEN_MINT, token_mint.address().as_ref());
    wr_bytes(c, config::TOKEN_PROGRAM, token_program.address().as_ref());
    wr_u8(c, config::TOKEN_DECIMALS, decimals);

    events::emit(&events::token_mint_set(
        token_mint.address().as_array(),
        token_program.address().as_array(),
        decimals,
    ));
    Ok(())
}
