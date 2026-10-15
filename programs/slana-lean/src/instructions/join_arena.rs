//! `join_arena(max_fee_bps, max_entry_fee, max_settle_fee)` and
//! `join_arena_with_pass(..same..)` — reference `instructions/join_arena.rs`. One handler;
//! `with_pass` selects the account list and the Pass gate.
//!
//! Accounts: 0 player, 1 config, 2 profile, 3 arena, 4 vault, 5 session, 6 player_token,
//! 7 token_mint, 8 token_program, then `join_arena`: 9 system_program;
//! `join_arena_with_pass`: 9 pass_asset, 10 pass_lock, 11 system_program.
//!
//! | reference constraint                                                         | lean check                     | error |
//! |------------------------------------------------------------------------------|--------------------------------|-------|
//! | args Borsh (`u16, u64, u64`)                                                 | `Args`                         | 102 |
//! | `player: Signer`                                                             | `check_signer`                 | 3010 |
//! | `config` / `profile` / `arena: Box<Account<..>>`                             | `check_account`                | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | `vault`, `player_token: InterfaceAccount<TokenAccount>`                      | `token::load_token_account`    | 3012 / 3007 / ProgramError |
//! | `token_mint: InterfaceAccount<Mint>`                                         | `token::load_mint`             | 3012 / 3007 / ProgramError |
//! | `token_program: Interface<TokenInterface>`                                   | `token::check_token_program`   | 3008 / 3009 |
//! | `pass_asset: UncheckedAccount` (with pass)                                   | —                              | — |
//! | `system_program: Program<System>`                                            | `check_program(system)`        | 3008 / 3009 |
//! | `session: init, payer = player, space = 151, seeds = [SESSION_SEED, arena, player], bump` | `init_program_pda` | 2006 / system program ("already in use") |
//! | `pass_lock: init, payer = player, space, seeds = [PASS_LOCK_SEED, pass_asset], bump` (with pass) | `init_program_pda` | 2006 / system program ("already in use" = PassInUse) |
//! | duplicate `mut` accounts (vault, player_token; the rest are distinct types)  | `stake::check_distinct`        | 2040 |
//! | `player: mut`                                                                | `check_writable`               | 2000 |
//! | `config: seeds = [CONFIG_SEED], bump = config.bump`, `mut`                   | `stake::check_config`          | 2006 / 2000 |
//! | `profile: seeds = [PROFILE_SEED, player], bump = profile.bump`, `mut`        | `stake::check_profile`         | 2006 / 2000 |
//! | `arena: seeds = [ARENA_SEED, arena.id LE], bump = arena.bump`, `mut`         | `stake::check_arena`           | 2006 / 2000 |
//! | `vault: seeds = [VAULT_SEED, arena], bump = arena.vault_bump`, `mut`         | `stake::check_arena_vault`     | 2006 / 2000 |
//! | `player_token: mut, token::mint, token::authority = player, token::token_program` | `stake::check_player_token` | 2000 / 2015 / 2014 / 2021 |
//! | `token_mint: address = config.token_mint`                                    | `stake::check_token_addresses` | 2012 |
//! | `token_program: address = config.token_program`                              | `stake::check_token_addresses` | 2012 |
//! | join: `require!(!arena.requires_pass)`                                       | same                           | PassRequired |
//! | with pass: `core_asset::read_core_asset(pass_asset)`                         | `core_asset::read_core_asset`  | PassWrongCollection |
//! | with pass: `asset.owner == player`                                           | key compare                    | PassNotOwned |
//! | with pass: `collection != default && asset.collection == Some(collection)`   | key compare                    | PassWrongCollection |
//! | `open_session`: `!config.paused`                                             | same                           | Paused |
//! | fee snapshot (R19): `fee_bps ≤ max_fee_bps` (`pass_fee_bps` with a Pass)     | same                           | FeeAboveLimit |
//! | M3: `arena.entry_fee ≤ max_entry_fee`                                        | same                           | EntryFeeAboveLimit |
//! | M3: `config.settle_fee_lamports ≤ max_settle_fee`                            | same                           | SettleFeeAboveLimit |
//! | `arena.enabled`                                                              | same                           | ArenaDisabled |
//! | `arena.open_sessions < arena.max_sessions`                                   | same                           | ArenaFull |
//! | `transfer_checked(player_token → vault, entry_fee, token_mint.decimals)`     | `cpi::token::transfer_checked` | token program |
//! | `transfer_from_wallet(player → session, settle_fee)` (skipped when 0)        | `cpi::system::transfer`        | system program |
//! | `total_sessions`, `total_staked`, profile `total_staked`, arena `open_sessions` / `total_deposited` `checked_add` | `stake::add` / `checked_add` | MathOverflow |
//! | `profile.stake_games.saturating_add(1)`                                      | same                           | — |
//!
//! Writes the session (and the Pass lock) and emits `ArenaJoined`.

use {
    super::{initialize::init_program_pda, stake, unix_timestamp},
    crate::error::Result,
    crate::{
        accounts::{check_kinds, check_writable, data, keq, kind},
        borsh::{
            rd_bool, rd_key, rd_u16, rd_u32, rd_u64, wr_bool, wr_bytes, wr_i64, wr_u16, wr_u32,
            wr_u64, wr_u8, Args,
        },
        constants::{PASS_LOCK_SEED, SESSION_SEED},
        core_asset::read_core_asset,
        cpi::{system, token::transfer_checked},
        error::{
            err, require, ACCOUNT_NOT_ENOUGH_KEYS, ARENA_DISABLED, ARENA_FULL,
            ENTRY_FEE_ABOVE_LIMIT, FEE_ABOVE_LIMIT, MATH_OVERFLOW, PASS_NOT_OWNED, PASS_REQUIRED,
            PASS_WRONG_COLLECTION, PAUSED, SETTLE_FEE_ABOVE_LIMIT,
        },
        events,
        state::{arena, config, pass_lock, profile, session},
        token::{MINT_DECIMALS, MINT_LEN},
    },
    pinocchio::AccountView,
};

/// `join_arena` account kinds.
const KINDS: [u8; 10] = [
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
];

/// `join_arena_with_pass` account kinds.
const PASS_KINDS: [u8; 12] = [
    kind::SIGNER,
    kind::CONFIG,
    kind::PROFILE,
    kind::ARENA,
    kind::TOKEN_ACCOUNT,
    kind::ANY,
    kind::TOKEN_ACCOUNT,
    kind::MINT,
    kind::TOKEN_PROGRAM,
    kind::ANY,
    kind::ANY,
    kind::SYSTEM_PROGRAM,
];

#[inline(never)]
pub fn process(accounts: &[AccountView], args: &[u8], with_pass: bool) -> Result {
    let mut a = Args::new(args);
    let max_fee_bps = a.u16();
    let max_entry_fee = a.u64();
    let max_settle_fee = a.u64();
    a.finish()?;

    // ----- account types, in declaration order -------------------------------------------
    check_kinds(accounts, if with_pass { &PASS_KINDS } else { &KINDS })?;
    // `check_kinds` checked that every listed account exists.
    let Some(
        [player, config_acc, profile_acc, arena_acc, vault, session_acc, player_token, token_mint, token_program],
    ) = accounts.first_chunk::<9>()
    else {
        return Err(err(ACCOUNT_NOT_ENOUGH_KEYS));
    };
    let pass = match (with_pass, accounts.get(9..11)) {
        (false, _) => None,
        (true, Some([asset, lock])) => Some((asset, lock)),
        (true, _) => return Err(err(ACCOUNT_NOT_ENOUGH_KEYS)),
    };

    // ----- init accounts, in declaration order -------------------------------------------
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
    let lock_bump = match pass {
        Some((asset, lock)) => Some(init_program_pda(
            player,
            lock,
            pass_lock::SPACE,
            &[PASS_LOCK_SEED, asset.address().as_ref()],
        )?),
        None => None,
    };

    // ----- duplicate mutable accounts, then the remaining constraints ---------------------
    stake::check_distinct(&[vault, player_token])?;
    check_writable(player)?;
    // SAFETY: `parse` checked each type (and so each length); the accounts are distinct
    // (distinct program-account types; the vault and the player's token account differ, see
    // above; the session was just created).
    let c = unsafe { data::<{ config::SPACE }>(config_acc) };
    let p = unsafe { data::<{ profile::SPACE }>(profile_acc) };
    let r = unsafe { data::<{ arena::SPACE }>(arena_acc) };
    stake::check_config(config_acc, c, true)?;
    stake::check_profile(profile_acc, p, player)?;
    stake::check_arena(arena_acc, r, true)?;
    stake::check_arena_vault(vault, arena_acc, r)?;
    stake::check_player_token(player_token, player, token_mint, token_program)?;
    stake::check_token_addresses(c, token_mint, token_program)?;

    // ----- handler ---------------------------------------------------------------------------
    let pass_asset = match (pass, lock_bump) {
        (Some((asset, lock)), Some(bump)) => {
            let (owner, collection) = read_core_asset(asset)?;
            require(keq(&owner, player.address().as_array()), PASS_NOT_OWNED)?;
            let expected = rd_key(c, config::PASS_COLLECTION);
            require(
                expected != [0u8; 32] && collection == Some(expected),
                PASS_WRONG_COLLECTION,
            )?;
            // SAFETY: just created with `pass_lock::SPACE` bytes; no other view of it.
            let l = unsafe { data::<{ pass_lock::SPACE }>(lock) };
            wr_bytes(l, 0, &pass_lock::DISCRIMINATOR);
            wr_bytes(l, pass_lock::SESSION, session_acc.address().as_ref());
            wr_bytes(l, pass_lock::PLAYER, player.address().as_ref());
            wr_u8(l, pass_lock::BUMP, bump);
            Some(asset.address())
        }
        _ => {
            require(!rd_bool(r, arena::REQUIRES_PASS), PASS_REQUIRED)?;
            None
        }
    };
    let has_pass = pass_asset.is_some();

    // `open_session`.
    require(!rd_bool(c, config::PAUSED), PAUSED)?;
    let fee_bps = rd_u16(
        c,
        if has_pass {
            config::PASS_FEE_BPS
        } else {
            config::FEE_BPS
        },
    );
    require(fee_bps <= max_fee_bps, FEE_ABOVE_LIMIT)?;
    let entry_fee = rd_u64(r, arena::ENTRY_FEE);
    require(entry_fee <= max_entry_fee, ENTRY_FEE_ABOVE_LIMIT)?;
    let settle_fee = rd_u64(c, config::SETTLE_FEE_LAMPORTS);
    require(settle_fee <= max_settle_fee, SETTLE_FEE_ABOVE_LIMIT)?;
    require(rd_bool(r, arena::ENABLED), ARENA_DISABLED)?;
    let open = rd_u16(r, arena::OPEN_SESSIONS);
    require(open < rd_u16(r, arena::MAX_SESSIONS), ARENA_FULL)?;

    // SAFETY: `parse` checked the mint (≥ 82 bytes); read only.
    let decimals = unsafe { data::<MINT_LEN>(token_mint) }[MINT_DECIMALS];
    transfer_checked(
        token_program.address(),
        player_token,
        token_mint,
        vault,
        player,
        entry_fee,
        decimals,
        &[],
    );
    if settle_fee > 0 {
        system::transfer(player, session_acc, settle_fee);
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
    wr_bool(s, session::HAS_PASS, has_pass);
    if let Some(asset) = pass_asset {
        wr_bytes(s, session::PASS_ASSET, asset.as_ref());
    }
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
        has_pass,
    ));
    Ok(())
}
