//! `refund_session()` — reference `instructions/refund_session.rs`.
//!
//! Accounts: 0 player, 1 config, 2 arena, 3 vault, 4 session, 5 player_token, 6 token_mint,
//! 7 token_program.
//!
//! | reference constraint                                                           | lean check                     | error |
//! |--------------------------------------------------------------------------------|--------------------------------|-------|
//! | `player: Signer`                                                               | `check_signer`                 | 3010 |
//! | `config` / `arena` / `session: Box<Account<..>>`                               | `check_account`                | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | `vault`, `player_token: InterfaceAccount<TokenAccount>`                        | `token::load_token_account`    | 3012 / 3007 / ProgramError |
//! | `token_mint: InterfaceAccount<Mint>`                                           | `token::load_mint`             | 3012 / 3007 / ProgramError |
//! | `token_program: Interface<TokenInterface>`                                     | `token::check_token_program`   | 3008 / 3009 |
//! | duplicate `mut` accounts (vault, player_token)                                 | `stake::check_distinct2`       | 2040 |
//! | `player: mut`                                                                  | `check_writable`               | 2000 |
//! | `config: seeds = [CONFIG_SEED], bump = config.bump`, `mut`                     | `stake::check_config`          | 2006 / 2000 |
//! | `arena: seeds = [ARENA_SEED, arena.id LE], bump = arena.bump`, `mut`           | `stake::check_arena`           | 2006 / 2000 |
//! | `vault: seeds = [VAULT_SEED, arena], bump = arena.vault_bump`, `mut`           | `stake::check_arena_vault`     | 2006 / 2000 |
//! | `session: seeds = [SESSION_SEED, arena, player], bump = session.bump`, `mut`, `has_one = player`, `has_one = arena` (@ Unauthorized) | `stake::check_session` | 2006 / 2000 / Unauthorized |
//! | `session: close = player`                                                      | `stake::check_close_to` | 2011 |
//! | `player_token: mut, token::mint, token::authority = player, token::token_program` | `stake::check_player_token` | 2000 / 2015 / 2014 / 2021 |
//! | `token_mint: address = config.token_mint`                                      | `stake::check_token_addresses` | 2012 |
//! | `token_program: address = config.token_program`                                | `stake::check_token_addresses` | 2012 |
//! | finalized: refund `min(owed, vault.amount)`, at once                           | same                           | — |
//! | not finalized: `opened_at.checked_add(SESSION_REFUND_TIMEOUT_SECS)`            | `checked_add`                  | MathOverflow |
//! | not finalized: `require_gte!(now, refundable_at)`                              | same                           | RefundTooEarly |
//! | not finalized: refund `min(entry_fee, vault.amount)`                           | same                           | — |
//! | `token::transfer_from_pda(vault → player_token, refund)` (0 = no-op)           | `stake::pay_from_vault`        | token program |
//! | `arena.open_sessions.saturating_sub(1)`; `arena.total_paid_out` (and `config.total_paid_out` when finalized) `checked_add` | `stake::add` | MathOverflow |
//!
//! Emits `SessionRefunded`; the session closes to the player.

use {
    super::{stake, unix_timestamp},
    crate::error::Result,
    crate::{
        accounts::{check_writable, close, data, data_ref, kind, parse},
        borsh::{rd_bool, rd_i64, rd_u16, rd_u64, wr_u16, wr_u64},
        constants::SESSION_REFUND_TIMEOUT_SECS,
        error::{err, require, MATH_OVERFLOW, REFUND_TOO_EARLY},
        events,
        state::{arena, config, session},
        token::{ACCOUNT_AMOUNT, ACCOUNT_LEN},
    },
    pinocchio::AccountView,
};

#[inline(never)]
pub fn process(accounts: &[AccountView], _args: &[u8]) -> Result {
    let [player, config_acc, arena_acc, vault, session_acc, player_token, token_mint, token_program] =
        parse(
            accounts,
            &[
                kind::SIGNER,
                kind::CONFIG,
                kind::ARENA,
                kind::TOKEN_ACCOUNT,
                kind::SESSION,
                kind::TOKEN_ACCOUNT,
                kind::MINT,
                kind::TOKEN_PROGRAM,
            ],
        )?;

    stake::check_distinct2(vault, player_token)?;
    // SAFETY: `parse` checked each type (and so each length); distinct program-account types,
    // and the vault (read only) differs from the player's token account (above).
    let c = unsafe { data::<{ config::SPACE }>(config_acc) };
    let r = unsafe { data::<{ arena::SPACE }>(arena_acc) };
    let s = unsafe { data::<{ session::SPACE }>(session_acc) };
    let vault_amount = rd_u64(unsafe { data_ref::<ACCOUNT_LEN>(vault) }, ACCOUNT_AMOUNT);

    check_writable(player)?;
    stake::check_session_accounts(config_acc, c, arena_acc, r, vault, session_acc, s, player)?;
    stake::check_close_to(session_acc, player)?;
    stake::check_player_token(player_token, player, token_mint, token_program)?;
    stake::check_token_addresses(c, token_mint, token_program)?;

    // ----- handler ---------------------------------------------------------------------------
    let finalized = rd_bool(s, session::FINALIZED);
    let refund = if finalized {
        rd_u64(s, session::OWED).min(vault_amount)
    } else {
        let now = unix_timestamp()?;
        let refundable_at = rd_i64(s, session::OPENED_AT)
            .checked_add(SESSION_REFUND_TIMEOUT_SECS)
            .ok_or_else(|| err(MATH_OVERFLOW))?;
        require(now >= refundable_at, REFUND_TOO_EARLY)?;
        rd_u64(s, session::ENTRY_FEE).min(vault_amount)
    };

    stake::pay_from_vault(
        c,
        r,
        arena_acc,
        vault,
        token_mint,
        player_token,
        token_program,
        refund,
    )?;

    let open = rd_u16(r, arena::OPEN_SESSIONS).saturating_sub(1);
    wr_u16(r, arena::OPEN_SESSIONS, open);
    let paid = stake::add(rd_u64(r, arena::TOTAL_PAID_OUT), refund)?;
    wr_u64(r, arena::TOTAL_PAID_OUT, paid);
    if finalized {
        // Settlement left the owed share out of the global total.
        let paid = stake::add(rd_u64(c, config::TOTAL_PAID_OUT), refund)?;
        wr_u64(c, config::TOTAL_PAID_OUT, paid);
    }

    events::emit(&events::session_refunded(
        player.address().as_array(),
        rd_u16(r, arena::ID),
        refund,
        finalized,
    ));

    // `close = player` on the session (Anchor closes it on exit).
    close(session_acc, player)
}
