//! `join_arena(max_fee_bps, max_entry_fee, max_settle_fee)` — reference
//! `instructions/join_arena.rs`.
//!
//! Accounts: 0 player, 1 config, 2 profile, 3 arena, 4 vault, 5 session, 6 player_token,
//! 7 token_mint, 8 token_program, 9 system_program.
//!
//! | reference constraint                                                         | lean check                     | error |
//! |------------------------------------------------------------------------------|--------------------------------|-------|
//! | args Borsh (`u16, u64, u64`)                                                 | `Args`                         | 102 |
//! | `player: Signer`                                                             | `check_signer`                 | 3010 |
//! | `config` / `profile` / `arena: Box<Account<..>>`                             | `check_account`                | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | `vault`, `player_token: InterfaceAccount<TokenAccount>`                      | `token::load_token_account`    | 3012 / 3007 / ProgramError |
//! | `token_mint: InterfaceAccount<Mint>`                                         | `token::load_mint`             | 3012 / 3007 / ProgramError |
//! | `token_program: Interface<TokenInterface>`                                   | `token::check_token_program`   | 3008 / 3009 |
//! | `system_program: Program<System>`                                            | `check_program(system)`        | 3008 / 3009 |
//! | `session: init, payer = player, space = 118, seeds = [SESSION_SEED, arena, player], bump` | `init_program_pda` | 2006 / system program ("already in use") |
//! | duplicate `mut` accounts (vault, player_token; the rest are distinct types)  | `stake::check_distinct2`       | 2040 |
//! | `player: mut`                                                                | `check_writable`               | 2000 |
//! | `config: seeds = [CONFIG_SEED], bump = config.bump`, `mut`                   | `stake::check_config`          | 2006 / 2000 |
//! | `config: constraint = config.token_mint != default @ TokenNotSet`            | `stake::check_token_set`       | TokenNotSet |
//! | `profile: seeds = [PROFILE_SEED, player], bump = profile.bump`, `mut`        | `stake::check_profile`         | 2006 / 2000 |
//! | `arena: seeds = [ARENA_SEED, arena.id LE], bump = arena.bump`, `mut`         | `stake::check_arena`           | 2006 / 2000 |
//! | `vault: seeds = [VAULT_SEED, arena], bump = arena.vault_bump`, `mut`         | `stake::check_arena_vault`     | 2006 / 2000 |
//! | `player_token: mut, token::mint, token::authority = player, token::token_program` | `stake::check_player_token` | 2000 / 2015 / 2014 / 2021 |
//! | `token_mint: address = config.token_mint`                                    | `stake::check_token_addresses` | 2012 |
//! | `token_program: address = config.token_program`                              | `stake::check_token_addresses` | 2012 |
//! | `!config.paused`                                                             | same                           | Paused |
//! | fee snapshot (R19): `config.fee_bps ≤ max_fee_bps`                           | same                           | FeeAboveLimit |
//! | M3: `arena.entry_fee ≤ max_entry_fee`                                        | same                           | EntryFeeAboveLimit |
//! | M3: `config.settle_fee_lamports ≤ max_settle_fee`                            | same                           | SettleFeeAboveLimit |
//! | `arena.enabled`                                                              | same                           | ArenaDisabled |
//! | `arena.open_sessions < arena.max_sessions`                                   | same                           | ArenaFull |
//! | `transfer_checked(player_token → vault, entry_fee, token_mint.decimals)`     | `cpi::token::transfer_checked` | token program |
//! | `transfer_from_wallet(player → session, settle_fee)` (skipped when 0)        | `cpi::system::transfer`        | system program |
//! | `total_sessions`, `total_staked`, profile `total_staked`, arena `open_sessions` / `total_deposited` `checked_add` | `stake::add` / `checked_add` | MathOverflow |
//! | `profile.stake_games.saturating_add(1)`                                      | same                           | — |
//!
//! Writes the session and emits `ArenaJoined`.

use {
    super::{initialize::init_program_pda, stake, unix_timestamp},
    crate::error::Result,
    crate::{
        accounts::{check_writable, data, data_ref, kind, parse},
        borsh::{
            rd_bool, rd_u16, rd_u32, rd_u64, wr_bytes, wr_i64, wr_u16, wr_u32, wr_u64, wr_u8, Args,
        },
        constants::SESSION_SEED,
        cpi::{system, token::transfer_checked},
        error::{
            err, require, ARENA_DISABLED, ARENA_FULL, ENTRY_FEE_ABOVE_LIMIT, FEE_ABOVE_LIMIT,
            MATH_OVERFLOW, PAUSED, SETTLE_FEE_ABOVE_LIMIT,
        },
        events,
        state::{arena, config, profile, session},
        token::{MINT_DECIMALS, MINT_LEN},
    },
    pinocchio::AccountView,
};

#[inline(never)]
pub fn process(accounts: &[AccountView], args: &[u8]) -> Result {
    let mut a = Args::new(args);
    let max_fee_bps = a.u16();
    let max_entry_fee = a.u64();
    let max_settle_fee = a.u64();
    a.finish()?;

    // ----- account types, in declaration order -------------------------------------------
    let [player, config_acc, profile_acc, arena_acc, vault, session_acc, player_token, token_mint, token_program, _system_program] =
        parse(
            accounts,
            &[
                kind::SIGNER,
                kind::CONFIG,
                kind::PROFILE,
                kind::ARENA,
                kind::TOKEN_ACCOUNT,
                kind::ANY,
                kind::TOKEN_ACCOUNT,
                kind::MINT,
                kind::TOKEN_PROGRAM,
                kind::SYSTEM_PROGRAM,
            ],
        )?;

    // ----- init accounts -------------------------------------------------------------------
    let session_bump = init_program_pda(
        player,
        session_acc,
        session::SPACE,
        &[
            SESSION_SEED,
            arena_acc.address().as_ref(),
            player.address().as_ref(),
        ],
    )?;

    // ----- duplicate mutable accounts, then the remaining constraints ---------------------
    stake::check_distinct2(vault, player_token)?;
    check_writable(player)?;
    // SAFETY: `parse` checked each type (and so each length); the accounts are distinct
    // (distinct program-account types; the vault and the player's token account differ, see
    // above; the session was just created).
    let c = unsafe { data::<{ config::SPACE }>(config_acc) };
    let p = unsafe { data::<{ profile::SPACE }>(profile_acc) };
    let r = unsafe { data::<{ arena::SPACE }>(arena_acc) };
    stake::check_config(config_acc, c, true)?;
    stake::check_token_set(c)?;
    stake::check_profile(profile_acc, p, player)?;
    stake::check_arena(arena_acc, r, true)?;
    stake::check_arena_vault(vault, arena_acc, r)?;
    stake::check_player_token(player_token, player, token_mint, token_program)?;
    stake::check_token_addresses(c, token_mint, token_program)?;

    // ----- handler ---------------------------------------------------------------------------
    require(!rd_bool(c, config::PAUSED), PAUSED)?;
    let fee_bps = rd_u16(c, config::FEE_BPS);
    require(fee_bps <= max_fee_bps, FEE_ABOVE_LIMIT)?;
    let entry_fee = rd_u64(r, arena::ENTRY_FEE);
    require(entry_fee <= max_entry_fee, ENTRY_FEE_ABOVE_LIMIT)?;
    let settle_fee = rd_u64(c, config::SETTLE_FEE_LAMPORTS);
    require(settle_fee <= max_settle_fee, SETTLE_FEE_ABOVE_LIMIT)?;
    require(rd_bool(r, arena::ENABLED), ARENA_DISABLED)?;
    let open = rd_u16(r, arena::OPEN_SESSIONS);
    require(open < rd_u16(r, arena::MAX_SESSIONS), ARENA_FULL)?;

    // SAFETY: `parse` checked the mint (≥ 82 bytes); read only.
    let decimals = unsafe { data_ref::<MINT_LEN>(token_mint) }[MINT_DECIMALS];
    transfer_checked(
        token_program.address(),
        player_token,
        token_mint,
        vault,
        player,
        entry_fee,
        decimals,
        &[],
    )?;
    if settle_fee > 0 {
        system::transfer(player, session_acc, settle_fee)?;
    }

    let now = unix_timestamp()?;
    let session_id = rd_u64(c, config::TOTAL_SESSIONS);
    wr_u64(c, config::TOTAL_SESSIONS, stake::add(session_id, 1)?);
    let staked = stake::add(rd_u64(c, config::TOTAL_STAKED), entry_fee)?;
    wr_u64(c, config::TOTAL_STAKED, staked);

    let games = rd_u32(p, profile::STAKE_GAMES).saturating_add(1);
    wr_u32(p, profile::STAKE_GAMES, games);
    let staked = stake::add(rd_u64(p, profile::TOTAL_STAKED), entry_fee)?;
    wr_u64(p, profile::TOTAL_STAKED, staked);

    let open = open.checked_add(1).ok_or_else(|| err(MATH_OVERFLOW))?;
    wr_u16(r, arena::OPEN_SESSIONS, open);
    let deposited = stake::add(rd_u64(r, arena::TOTAL_DEPOSITED), entry_fee)?;
    wr_u64(r, arena::TOTAL_DEPOSITED, deposited);
    let arena_id = rd_u16(r, arena::ID);

    // SAFETY: just created with `session::SPACE` bytes; no other view of it.
    let s = unsafe { data::<{ session::SPACE }>(session_acc) };
    wr_bytes(s, 0, &session::DISCRIMINATOR);
    wr_u64(s, session::ID, session_id);
    wr_bytes(s, session::PLAYER, player.address().as_ref());
    wr_bytes(s, session::ARENA, arena_acc.address().as_ref());
    wr_u16(s, session::ARENA_ID, arena_id);
    wr_u64(s, session::ENTRY_FEE, entry_fee);
    wr_i64(s, session::OPENED_AT, now);
    wr_u64(s, session::SETTLE_FEE, settle_fee);
    // The fee on profit is fixed now (R19); `settle_session` uses this snapshot.
    wr_u16(s, session::FEE_BPS, fee_bps);
    wr_u8(s, session::BUMP, session_bump);
    // finalized = false, owed = 0: already zero.

    events::emit(&events::arena_joined(
        player.address().as_array(),
        arena_id,
        session_id,
        entry_fee,
    ));
    Ok(())
}
