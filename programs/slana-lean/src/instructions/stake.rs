//! Checks and money moves shared by the arena instructions (`join_arena`,
//! `join_arena_with_pass`, `settle_session`, `refund_session`, `sweep_arena`). Each helper
//! is one reference constraint (or one reference helper) with its Anchor error code.

use {
    crate::error::{Error, Result},
    crate::{
        accounts::{check_pda, check_writable, data, keq},
        borsh::{rd_bool, rd_key, rd_u16, rd_u32, rd_u8},
        constants::*,
        cpi::token::transfer_checked,
        error::{
            err, require, CONSTRAINT_ADDRESS, CONSTRAINT_DUPLICATE_MUTABLE_ACCOUNT, MATH_OVERFLOW,
            PASS_IN_USE, UNAUTHORIZED,
        },
        instructions::withdraw_treasury::check_token_account,
        state::{arena, config, pass_lock, profile, season, session},
        token::ACCOUNT_LEN,
        ID,
    },
    pinocchio::{
        cpi::{Seed, Signer},
        AccountView,
    },
};

/// `seeds = [CONFIG_SEED], bump = config.bump` (`ConstraintSeeds`), then `mut` when asked
/// (`ConstraintMut`).
#[inline(never)]
pub(crate) fn check_config(
    config_acc: &AccountView,
    c: &[u8; config::SPACE],
    mutable: bool,
) -> Result {
    let bump = [rd_u8(c, config::BUMP)];
    check_pda(config_acc, &[Seed::from(CONFIG_SEED), Seed::from(&bump)])?;
    if mutable {
        check_writable(config_acc)?;
    }
    Ok(())
}

/// `seeds = [ARENA_SEED, arena.id LE], bump = arena.bump`, then `mut` when asked.
#[inline(never)]
pub(crate) fn check_arena(
    arena_acc: &AccountView,
    a: &[u8; arena::SPACE],
    mutable: bool,
) -> Result {
    let id = rd_u16(a, arena::ID).to_le_bytes();
    let bump = [rd_u8(a, arena::BUMP)];
    check_pda(
        arena_acc,
        &[Seed::from(ARENA_SEED), Seed::from(&id), Seed::from(&bump)],
    )?;
    if mutable {
        check_writable(arena_acc)?;
    }
    Ok(())
}

/// The arena vault: `seeds = [VAULT_SEED, arena], bump = arena.vault_bump`, `mut`.
#[inline(never)]
pub(crate) fn check_arena_vault(
    vault: &AccountView,
    arena_acc: &AccountView,
    a: &[u8; arena::SPACE],
) -> Result {
    let bump = [rd_u8(a, arena::VAULT_BUMP)];
    check_pda(
        vault,
        &[
            Seed::from(VAULT_SEED),
            Seed::from(arena_acc.address().as_ref()),
            Seed::from(&bump),
        ],
    )?;
    check_writable(vault)
}

/// A config-level vault: `seeds = [seed], bump = <config bump field>`, `mut`.
#[inline(never)]
pub(crate) fn check_global_vault(vault: &AccountView, seed: &[u8], bump: u8) -> Result {
    let bump = [bump];
    check_pda(vault, &[Seed::from(seed), Seed::from(&bump)])?;
    check_writable(vault)
}

/// `seeds = [PROFILE_SEED, owner], bump = profile.bump`, `mut`.
#[inline(never)]
pub(crate) fn check_profile(
    profile_acc: &AccountView,
    p: &[u8; profile::SPACE],
    owner: &AccountView,
) -> Result {
    let bump = [rd_u8(p, profile::BUMP)];
    check_pda(
        profile_acc,
        &[
            Seed::from(PROFILE_SEED),
            Seed::from(owner.address().as_ref()),
            Seed::from(&bump),
        ],
    )?;
    check_writable(profile_acc)
}

/// `seeds = [SEASON_SEED, config.current_season LE], bump = season.bump`, `mut`.
#[inline(never)]
pub(crate) fn check_current_season(
    season_acc: &AccountView,
    s: &[u8; season::SPACE],
    c: &[u8; config::SPACE],
) -> Result {
    let id = rd_u32(c, config::CURRENT_SEASON).to_le_bytes();
    let bump = [rd_u8(s, season::BUMP)];
    check_pda(
        season_acc,
        &[Seed::from(SEASON_SEED), Seed::from(&id), Seed::from(&bump)],
    )?;
    check_writable(season_acc)
}

/// The session of settle/refund: `seeds = [SESSION_SEED, arena, player], bump =
/// session.bump` (`ConstraintSeeds`), `mut`, `has_one = player @ Unauthorized`, `has_one =
/// arena @ Unauthorized`.
#[inline(never)]
pub(crate) fn check_session(
    session_acc: &AccountView,
    s: &[u8; session::SPACE],
    arena_acc: &AccountView,
    player: &AccountView,
) -> Result {
    let bump = [rd_u8(s, session::BUMP)];
    check_pda(
        session_acc,
        &[
            Seed::from(SESSION_SEED),
            Seed::from(arena_acc.address().as_ref()),
            Seed::from(player.address().as_ref()),
            Seed::from(&bump),
        ],
    )?;
    check_writable(session_acc)?;
    require(
        keq(&rd_key(s, session::PLAYER), player.address().as_array()),
        UNAUTHORIZED,
    )?;
    require(
        keq(&rd_key(s, session::ARENA), arena_acc.address().as_array()),
        UNAUTHORIZED,
    )
}

/// The player's token account: `mut`, `token::mint = token_mint`, `token::authority =
/// player`, `token::token_program = token_program` (2000 / 2015 / 2014 / 2021).
#[inline(never)]
pub(crate) fn check_player_token(
    player_token: &AccountView,
    player: &AccountView,
    token_mint: &AccountView,
    token_program: &AccountView,
) -> Result {
    check_writable(player_token)?;
    // SAFETY: the caller's `parse` checked it is a token account (≥ 165 bytes); read only.
    let d = unsafe { data::<ACCOUNT_LEN>(player_token) };
    check_token_account(player_token, d, Some(player), token_mint, token_program)
}

/// `token_mint: address = config.token_mint`, `token_program: address =
/// config.token_program` (`ConstraintAddress`).
#[inline(never)]
pub(crate) fn check_token_addresses(
    c: &[u8; config::SPACE],
    token_mint: &AccountView,
    token_program: &AccountView,
) -> Result {
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
    )
}

/// Anchor's duplicate-mutable-account check over the mutable token accounts of an
/// instruction (`ConstraintDuplicateMutableAccount`). The other mutable accounts are program
/// accounts of distinct types (distinct discriminators), so they can never share a key with
/// each other or with a token account. Runs before any data view of these accounts is taken.
#[inline(never)]
pub(crate) fn check_distinct(accs: &[&AccountView]) -> Result {
    for (i, a) in accs.iter().enumerate() {
        for b in accs.iter().skip(i.wrapping_add(1)) {
            if keq(a.address().as_array(), b.address().as_array()) {
                return Err(err(CONSTRAINT_DUPLICATE_MUTABLE_ACCOUNT));
            }
        }
    }
    Ok(())
}

/// Reference `shared::check_pass_lock`: a Pass session must come with exactly its own lock
/// (`["pass_lock", session.pass_asset]` with the lock's stored bump, recorded for this session
/// and its player); a session without a Pass must come with none. Else `PassInUse`.
#[inline(never)]
pub(crate) fn check_pass_lock(
    session_acc: &AccountView,
    s: &[u8; session::SPACE],
    lock: Option<&AccountView>,
) -> Result {
    match (rd_bool(s, session::HAS_PASS), lock) {
        (false, None) => Ok(()),
        (true, Some(lock)) => {
            // SAFETY: the caller's `parse` checked the lock holds a `PassLock`; read only.
            let l = unsafe { data::<{ pass_lock::SPACE }>(lock) };
            let asset = rd_key(s, session::PASS_ASSET);
            let bump = [rd_u8(l, pass_lock::BUMP)];
            check_pda(
                lock,
                &[
                    Seed::from(PASS_LOCK_SEED),
                    Seed::from(&asset),
                    Seed::from(&bump),
                ],
            )
            .map_err(|_| err(PASS_IN_USE))?;
            require(
                keq(
                    &rd_key(l, pass_lock::SESSION),
                    session_acc.address().as_array(),
                ) && keq(&rd_key(l, pass_lock::PLAYER), &rd_key(s, session::PLAYER)),
                PASS_IN_USE,
            )
        }
        _ => Err(err(PASS_IN_USE)),
    }
}

/// Reference `token::transfer_from_pda` out of the arena vault: `transfer_checked` of
/// `amount` (a zero amount is a no-op) signed by the arena PDA, with `config.token_decimals`.
#[allow(clippy::too_many_arguments)]
#[inline(never)]
pub(crate) fn pay_from_vault(
    c: &[u8; config::SPACE],
    a: &[u8; arena::SPACE],
    arena_acc: &AccountView,
    vault: &AccountView,
    token_mint: &AccountView,
    to: &AccountView,
    token_program: &AccountView,
    amount: u64,
) {
    if amount == 0 {
        return;
    }
    with_arena_signer(a, |signer| {
        transfer_checked(
            token_program.address(),
            vault,
            token_mint,
            to,
            arena_acc,
            amount,
            rd_u8(c, config::TOKEN_DECIMALS),
            signer,
        )
    });
}

/// Runs `f` with the arena PDA's signer seeds `[ARENA_SEED, id LE, bump]`.
#[inline(always)]
pub(crate) fn with_arena_signer(a: &[u8; arena::SPACE], f: impl FnOnce(&[Signer])) {
    let id = rd_u16(a, arena::ID).to_le_bytes();
    let bump = [rd_u8(a, arena::BUMP)];
    let seeds = [Seed::from(ARENA_SEED), Seed::from(&id), Seed::from(&bump)];
    f(&[Signer::from(&seeds)]);
}

/// `a + b`, else `MathOverflow` (the reference's `checked_add(..).ok_or(MathOverflow)`).
#[inline(never)]
pub(crate) fn add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or_else(|| err(MATH_OVERFLOW))
}

/// An `Option<Account<..>>` / `Option<InterfaceAccount<..>>` (`None` = the program id).
#[inline(always)]
pub(crate) fn opt(acc: &AccountView) -> Option<&AccountView> {
    (acc.address() != &ID).then_some(acc)
}

/// Moves `amount` lamports out of a program account into `to` (Anchor's `sub_lamports` /
/// `add_lamports`, both `ArithmeticOverflow` on wrap).
#[inline(never)]
pub(crate) fn move_lamports(from: &AccountView, to: &AccountView, amount: u64) -> Result {
    let left = from
        .lamports()
        .checked_sub(amount)
        .ok_or(Error::ARITHMETIC_OVERFLOW)?;
    let mut from = from.clone();
    from.set_lamports(left);
    let total = to
        .lamports()
        .checked_add(amount)
        .ok_or(Error::ARITHMETIC_OVERFLOW)?;
    let mut to = to.clone();
    to.set_lamports(total);
    Ok(())
}
