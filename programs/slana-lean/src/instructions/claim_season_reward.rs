//! `claim_season_reward(season_id: u32)` — reference `instructions/claim_season_reward.rs`:
//! the top `PRIZE_RANKS` players of a finalized season claim their share of the prize pool,
//! paid in game tokens from the season vault into their own token account.
//!
//! Accounts: 0 claimer, 1 config, 2 season, 3 season_vault, 4 claimer_token, 5 token_mint,
//! 6 token_program.
//!
//! | reference constraint                                                      | lean check                     | error |
//! |---------------------------------------------------------------------------|--------------------------------|-------|
//! | `season_id: u32` Borsh                                                    | `Args`                         | 102 |
//! | `claimer: Signer`                                                         | `check_signer`                 | 3010 |
//! | `config` / `season: Box<Account<..>>`                                     | `check_account`                | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | `season_vault`, `claimer_token: InterfaceAccount<TokenAccount>`           | `token::load_token_account`    | 3012 / 3007 / ProgramError |
//! | `token_mint: InterfaceAccount<Mint>`                                      | `token::load_mint`             | 3012 / 3007 / ProgramError |
//! | `token_program: Interface<TokenInterface>`                                | `token::check_token_program`   | 3008 / 3009 |
//! | duplicate `mut` accounts (season_vault, claimer_token; the season is a program account) | `stake::check_distinct2` | 2040 |
//! | `config: seeds = [CONFIG_SEED], bump = config.bump`                       | `stake::check_config`          | 2006 |
//! | `season: seeds = [SEASON_SEED, season_id LE], bump = season.bump`, `mut`  | `check_pda_seeds`              | 2006 / 2000 |
//! | `season_vault: seeds = [SEASON_VAULT_SEED], bump = config.season_vault_bump`, `mut` | `check_pda_seeds`    | 2006 / 2000 |
//! | `claimer_token: mut, token::mint = token_mint, token::authority = claimer, token::token_program = token_program` | `stake::check_player_token` | 2000 / 2015 / 2014 / 2021 |
//! | `token_mint: address = config.token_mint`                                 | `stake::check_token_addresses` | 2012 |
//! | `token_program: address = config.token_program`                           | `stake::check_token_addresses` | 2012 |
//! | `require!(season.finalized)`                                              | same                           | SeasonNotFinalized |
//! | `ended_at.checked_add(CLAIM_WINDOW_SECS)`                                 | `checked_add`                  | MathOverflow |
//! | `require_gte!(closes_at, now)`                                            | same                           | ClaimWindowClosed |
//! | `logic::prize_rank(..).ok_or(NotEligible)`                                | `logic::prize_rank`            | NotEligible |
//! | `require!(claimed_mask & (1 << rank) == 0)`                               | same                           | AlreadyClaimed |
//! | `logic::prize_amount(prize_pool, rank)`                                   | `logic::prize_amount`          | NotEligible / MathOverflow |
//! | `season.pool.checked_sub(amount)`                                         | `checked_sub`                  | InsufficientPot |
//! | `token::transfer_from_pda` (zero amount: no-op), signed by the config PDA | `cpi::token::transfer_checked` | token program |
//!
//! Then `RewardClaimed`.

use {
    super::{stake, unix_timestamp},
    crate::error::Result,
    crate::{
        accounts::{check_pda_seeds, data, kind, parse},
        borsh::{rd_bool, rd_i64, rd_u16, rd_u64, rd_u8, wr_u16, wr_u64, Args},
        constants::{CLAIM_WINDOW_SECS, CONFIG_SEED, SEASON_SEED, SEASON_VAULT_SEED},
        cpi::token::transfer_checked,
        error::{
            err, require, ALREADY_CLAIMED, CLAIM_WINDOW_CLOSED, INSUFFICIENT_POT, MATH_OVERFLOW,
            NOT_ELIGIBLE, SEASON_NOT_FINALIZED,
        },
        events,
        logic::{prize_amount, prize_rank},
        state::{config, season},
    },
    pinocchio::{
        cpi::{Seed, Signer},
        AccountView,
    },
};

#[inline(never)]
pub fn process(accounts: &[AccountView], args: &[u8]) -> Result {
    let mut a = Args::new(args);
    let season_id = a.u32();
    a.finish()?;

    // ----- account types, in declaration order -------------------------------------------
    let [claimer, config_acc, season_acc, season_vault, claimer_token, token_mint, token_program] =
        parse(
            accounts,
            &[
                kind::SIGNER,
                kind::CONFIG,
                kind::SEASON,
                kind::TOKEN_ACCOUNT,
                kind::TOKEN_ACCOUNT,
                kind::MINT,
                kind::TOKEN_PROGRAM,
            ],
        )?;

    // ----- duplicate mutable accounts, then the remaining constraints ---------------------
    stake::check_distinct2(season_vault, claimer_token)?;
    // SAFETY: `parse` checked both types (and so the lengths); a config and a season are
    // distinct accounts (distinct discriminators).
    let c = unsafe { data::<{ config::SPACE }>(config_acc) };
    let s = unsafe { data::<{ season::SPACE }>(season_acc) };
    stake::check_config(config_acc, c, false)?;
    let id = season_id.to_le_bytes();
    check_pda_seeds(
        season_acc,
        &[SEASON_SEED, &id],
        rd_u8(s, season::BUMP),
        true,
    )?;
    check_pda_seeds(
        season_vault,
        &[SEASON_VAULT_SEED],
        rd_u8(c, config::SEASON_VAULT_BUMP),
        true,
    )?;
    stake::check_player_token(claimer_token, claimer, token_mint, token_program)?;
    stake::check_token_addresses(c, token_mint, token_program)?;

    // ----- handler ---------------------------------------------------------------------------
    require(rd_bool(s, season::FINALIZED), SEASON_NOT_FINALIZED)?;
    let now = unix_timestamp()?;
    let closes_at = rd_i64(s, season::ENDED_AT)
        .checked_add(CLAIM_WINDOW_SECS)
        .ok_or_else(|| err(MATH_OVERFLOW))?;
    require(closes_at >= now, CLAIM_WINDOW_CLOSED)?;

    let player = claimer.address().as_array();
    let rank = prize_rank(s, player).ok_or_else(|| err(NOT_ELIGIBLE))?;
    // `rank < PRIZE_RANKS ≤ 16`, so the bit fits the u16 mask (never a silent zero bit).
    let bit = 1u16
        .checked_shl(rank as u32)
        .ok_or_else(|| err(NOT_ELIGIBLE))?;
    let mask = rd_u16(s, season::CLAIMED_MASK);
    require(mask & bit == 0, ALREADY_CLAIMED)?;
    let amount = prize_amount(rd_u64(s, season::PRIZE_POOL), rank)?;

    // Prizes sum to at most `prize_pool` (= `pool` at `end_season`), so this cannot fail
    // unless the accounting is broken.
    let pool = rd_u64(s, season::POOL)
        .checked_sub(amount)
        .ok_or_else(|| err(INSUFFICIENT_POT))?;
    wr_u64(s, season::POOL, pool);
    wr_u16(s, season::CLAIMED_MASK, mask | bit);

    if amount > 0 {
        let bump = [rd_u8(c, config::BUMP)];
        let seeds = [Seed::from(CONFIG_SEED), Seed::from(&bump)];
        transfer_checked(
            token_program.address(),
            season_vault,
            token_mint,
            claimer_token,
            config_acc,
            amount,
            rd_u8(c, config::TOKEN_DECIMALS),
            &[Signer::from(&seeds)],
        )?;
    }

    events::emit(&events::reward_claimed(
        season_id, player, // rank < PRIZE_RANKS (10).
        rank as u8, amount,
    ));
    Ok(())
}
