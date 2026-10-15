//! `settle_session(args: SettleArgs)` — reference `instructions/settle_session.rs`
//! (two-phase settle, ruling R24).
//!
//! Accounts: 0 server, 1 config, 2 arena, 3 vault, 4 session, 5 player, 6 player_token
//! (optional), 7 profile, 8 season, 9 treasury_vault, 10 season_vault, 11 token_mint,
//! 12 token_program, 13 pass_lock (optional). An absent optional account is the program id
//! (Anchor's encoding).
//!
//! | reference constraint                                                            | lean check                     | error |
//! |---------------------------------------------------------------------------------|--------------------------------|-------|
//! | `SettleArgs` Borsh (`u64, u64, u32, u16, u32`)                                  | `Args`                         | 102 |
//! | `server: Signer`                                                                | `check_signer`                 | 3010 |
//! | `config` / `arena` / `session` / `profile` / `season: Box<Account<..>>`         | `check_account`                | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | `vault`, `treasury_vault`, `season_vault: InterfaceAccount<TokenAccount>`       | `token::load_token_account`    | 3012 / 3007 / ProgramError |
//! | `player: UncheckedAccount`                                                      | —                              | — |
//! | `player_token: Option<InterfaceAccount<TokenAccount>>`                          | `kind::OPT` + `load_token_account` | as above when Some |
//! | `token_mint: InterfaceAccount<Mint>`                                            | `token::load_mint`             | 3012 / 3007 / ProgramError |
//! | `token_program: Interface<TokenInterface>`                                      | `token::check_token_program`   | 3008 / 3009 |
//! | `pass_lock: Option<Account<PassLock>>`                                          | `kind::OPT` + `check_account`  | as above when Some |
//! | duplicate `mut` accounts (vault, player_token, treasury_vault, season_vault)    | `stake::check_distinct`        | 2040 |
//! | `server: mut`                                                                   | `check_writable`               | 2000 |
//! | `server: constraint = server == config.server_authority @ Unauthorized`         | key compare                    | Unauthorized |
//! | `config: seeds = [CONFIG_SEED], bump = config.bump`, `mut`                      | `stake::check_session_accounts` | 2006 / 2000 |
//! | `arena: seeds = [ARENA_SEED, arena.id LE], bump = arena.bump`, `mut`            | `stake::check_arena`           | 2006 / 2000 |
//! | `vault: seeds = [VAULT_SEED, arena], bump = arena.vault_bump`, `mut`            | `stake::check_arena_vault`     | 2006 / 2000 |
//! | `session: seeds = [SESSION_SEED, arena, player], bump = session.bump`, `mut`, `has_one = player @ Unauthorized`, `has_one = arena @ Unauthorized` | `stake::check_session` | 2006 / 2000 / Unauthorized |
//! | `player: mut`                                                                   | `check_writable`               | 2000 |
//! | `player_token: mut, token::mint, token::authority = player, token::token_program` (when Some) | `stake::check_player_token` | 2000 / 2015 / 2014 / 2021 |
//! | `profile: seeds = [PROFILE_SEED, player], bump = profile.bump`, `mut`           | `stake::check_profile`         | 2006 / 2000 |
//! | `season: seeds = [SEASON_SEED, config.current_season LE], bump = season.bump`, `mut` | `stake::check_current_season` | 2006 / 2000 |
//! | `treasury_vault: seeds = [TREASURY_VAULT_SEED], bump = config.treasury_vault_bump`, `mut` | `check_pda_seeds` | 2006 / 2000 |
//! | `season_vault: seeds = [SEASON_VAULT_SEED], bump = config.season_vault_bump`, `mut` | `check_pda_seeds` | 2006 / 2000 |
//! | `token_mint: mut, address = config.token_mint`                                  | `check_writable` + `stake::check_token_addresses` | 2000 / 2012 |
//! | `token_program: address = config.token_program`                                 | `stake::check_token_addresses` | 2012 |
//! | `pass_lock: mut, close = player` (when Some)                                    | `check_writable`, key compare  | 2000 / 2011 |
//! | `require_eq!(session.id, args.session_id)`                                      | same                           | SessionMismatch |
//! | `require!(!session.finalized)` (no double settle)                               | same                           | SessionFinalized |
//! | `shared::check_pass_lock`                                                       | `stake::check_pass_lock`       | PassInUse |
//! | `require_gte!(vault.amount, payout)`                                            | same                           | InsufficientPot |
//! | `logic::split_payout(payout, session.entry_fee, session.fee_bps (R19), ..)`     | `logic::split_payout`          | MathOverflow |
//! | `token::transfer_from_pda` ×2–3 (treasury, season, player when Some), `burn_from_pda` | `stake::pay_from_vault`, `cpi::token::burn` (zero amounts skipped) | token program |
//! | `season.pool`, `arena.total_paid_out`, `config.total_games` / `total_paid_out`, `profile.total_won` `checked_add` | `stake::add` | MathOverflow |
//! | `session.sub_lamports(settle_fee)` / `server.add_lamports(settle_fee)`          | `stake::move_lamports`         | ArithmeticOverflow |
//! | `shared::record_result` (stats; season points + leaderboard with a Pass)        | `logic::apply_game` + `logic::upsert_leaderboard` | — |
//!
//! Then `SessionSettled`; paid now (`player_token` given, or nothing to pay): the session is
//! closed to the player and `open_sessions` drops; else the session is finalized with `owed`
//! and stays open. The Pass lock (when given) is closed to the player either way.

use {
    super::{stake, unix_timestamp},
    crate::error::Result,
    crate::{
        accounts::{
            check_kinds, check_pda_seeds, check_writable, close, data, data_ref, keq, kind,
            move_lamports,
        },
        borsh::{rd_bool, rd_key, rd_u16, rd_u32, rd_u64, rd_u8, wr_bool, wr_u16, wr_u64, Args},
        constants::{SEASON_VAULT_SEED, TREASURY_VAULT_SEED},
        cpi::token::burn,
        error::{
            err, require, ACCOUNT_NOT_ENOUGH_KEYS, INSUFFICIENT_POT, MATH_OVERFLOW,
            SESSION_FINALIZED, SESSION_MISMATCH, UNAUTHORIZED,
        },
        events,
        logic::{apply_game, split_payout, upsert_leaderboard},
        state::{arena, config, profile, season, session},
        token::{ACCOUNT_AMOUNT, ACCOUNT_LEN},
    },
    pinocchio::AccountView,
};

const KINDS: [u8; 14] = [
    kind::SIGNER,
    kind::CONFIG,
    kind::ARENA,
    kind::TOKEN_ACCOUNT,
    kind::SESSION,
    kind::ANY,
    kind::TOKEN_ACCOUNT | kind::OPT,
    kind::PROFILE,
    kind::SEASON,
    kind::TOKEN_ACCOUNT,
    kind::TOKEN_ACCOUNT,
    kind::MINT,
    kind::TOKEN_PROGRAM,
    kind::PASS_LOCK | kind::OPT,
];

#[inline(never)]
pub fn process(accounts: &[AccountView], args: &[u8]) -> Result {
    let mut a = Args::new(args);
    let session_id = a.u64();
    let payout = a.u64();
    let score = a.u32();
    let kills = a.u16();
    let xp = a.u32();
    a.finish()?;

    check_kinds(accounts, &KINDS)?;
    let Some(
        [server, config_acc, arena_acc, vault, session_acc, player, player_token, profile_acc, season_acc, treasury_vault, season_vault, token_mint, token_program, pass_lock],
    ) = accounts.first_chunk::<14>()
    else {
        return Err(err(ACCOUNT_NOT_ENOUGH_KEYS));
    };
    let player_token = stake::opt(player_token);
    let pass_lock = stake::opt(pass_lock);

    // ----- duplicate mutable accounts, then the remaining constraints ---------------------
    match player_token {
        Some(pt) => stake::check_distinct(&[vault, pt, treasury_vault, season_vault])?,
        None => stake::check_distinct(&[vault, treasury_vault, season_vault])?,
    }
    // SAFETY: `parse` checked each type (and so each length). The program accounts have
    // distinct types, so they are distinct accounts; the vault is a distinct token account
    // (above) and is only read.
    let c = unsafe { data::<{ config::SPACE }>(config_acc) };
    let r = unsafe { data::<{ arena::SPACE }>(arena_acc) };
    let s = unsafe { data::<{ session::SPACE }>(session_acc) };
    let p = unsafe { data::<{ profile::SPACE }>(profile_acc) };
    let sn = unsafe { data::<{ season::SPACE }>(season_acc) };
    let vault_amount = rd_u64(unsafe { data_ref::<ACCOUNT_LEN>(vault) }, ACCOUNT_AMOUNT);

    check_writable(server)?;
    require(
        keq(
            server.address().as_array(),
            &rd_key(c, config::SERVER_AUTHORITY),
        ),
        UNAUTHORIZED,
    )?;
    stake::check_session_accounts(config_acc, c, arena_acc, r, vault, session_acc, s, player)?;
    check_writable(player)?;
    if let Some(pt) = player_token {
        stake::check_player_token(pt, player, token_mint, token_program)?;
    }
    stake::check_profile(profile_acc, p, player)?;
    stake::check_current_season(season_acc, sn, c)?;
    check_pda_seeds(
        treasury_vault,
        &[TREASURY_VAULT_SEED],
        rd_u8(c, config::TREASURY_VAULT_BUMP),
        true,
    )?;
    check_pda_seeds(
        season_vault,
        &[SEASON_VAULT_SEED],
        rd_u8(c, config::SEASON_VAULT_BUMP),
        true,
    )?;
    check_writable(token_mint)?;
    stake::check_token_addresses(c, token_mint, token_program)?;
    if let Some(lock) = pass_lock {
        stake::check_close_to(lock, player)?;
    }

    // ----- handler ---------------------------------------------------------------------------
    require(rd_u64(s, session::ID) == session_id, SESSION_MISMATCH)?;
    require(!rd_bool(s, session::FINALIZED), SESSION_FINALIZED)?;
    stake::check_pass_lock(session_acc, s, pass_lock)?;
    require(vault_amount >= payout, INSUFFICIENT_POT)?;
    let now = unix_timestamp()?;

    let has_pass = rd_bool(s, session::HAS_PASS);
    // The fee fixed at join (R19), not the current config.
    let split = split_payout(
        payout,
        rd_u64(s, session::ENTRY_FEE),
        rd_u16(s, session::FEE_BPS),
        rd_u16(c, config::TREASURY_BPS),
        rd_u16(c, config::BURN_BPS),
    )?;
    // R24: paid now when there is an account to pay into, or nothing to pay.
    let pay_now = player_token.is_some() || split.player == 0;
    let owed = if pay_now { 0 } else { split.player };

    for (to, amount) in [
        (Some(treasury_vault), split.treasury),
        (Some(season_vault), split.season),
        (player_token, split.player),
    ] {
        if let Some(to) = to {
            stake::pay_from_vault(
                c,
                r,
                arena_acc,
                vault,
                token_mint,
                to,
                token_program,
                amount,
            )?;
        }
    }
    if split.burn > 0 {
        stake::with_arena_signer(r, |signer| {
            burn(
                token_program.address(),
                vault,
                token_mint,
                arena_acc,
                split.burn,
                signer,
            )
        })?;
    }

    let pool = stake::add(rd_u64(sn, season::POOL), split.season)?;
    wr_u64(sn, season::POOL, pool);

    // The settle deposit pays the server either way.
    move_lamports(session_acc, server, rd_u64(s, session::SETTLE_FEE))?;

    // What actually left the vault; the owed share counts when the player collects it.
    let left_vault = payout.checked_sub(owed).ok_or_else(|| err(MATH_OVERFLOW))?;
    if pay_now {
        let open = rd_u16(r, arena::OPEN_SESSIONS).saturating_sub(1);
        wr_u16(r, arena::OPEN_SESSIONS, open);
    }
    let paid = stake::add(rd_u64(r, arena::TOTAL_PAID_OUT), left_vault)?;
    wr_u64(r, arena::TOTAL_PAID_OUT, paid);

    let games = stake::add(rd_u64(c, config::TOTAL_GAMES), 1)?;
    wr_u64(c, config::TOTAL_GAMES, games);
    let paid = stake::add(rd_u64(c, config::TOTAL_PAID_OUT), left_vault)?;
    wr_u64(c, config::TOTAL_PAID_OUT, paid);
    let current_season = rd_u32(c, config::CURRENT_SEASON);

    let won = stake::add(rd_u64(p, profile::TOTAL_WON), split.player)?;
    wr_u64(p, profile::TOTAL_WON, won);
    // `shared::record_result`: stats always, season points and the leaderboard with a Pass.
    let score = apply_game(p, current_season, score, kills, xp, now, has_pass);
    if has_pass {
        upsert_leaderboard(sn, p, score);
    }

    events::emit(&events::session_settled(
        &rd_key(s, session::PLAYER),
        rd_u16(s, session::ARENA_ID),
        session_id,
        &events::SessionSettled {
            payout,
            fee: split.fee,
            burned: split.burn,
            has_pass,
            score,
            kills,
            owed,
        },
    ));

    if pay_now {
        // Paid: the session's rent goes back to the player.
        close(session_acc, player)?;
    } else {
        // Finalized: open until the player collects `owed` with `refund_session`.
        wr_bool(s, session::FINALIZED, true);
        wr_u64(s, session::OWED, owed);
    }
    // `close = player` on the Pass lock (Anchor closes it on exit, in both cases).
    if let Some(lock) = pass_lock {
        close(lock, player)?;
    }
    Ok(())
}
