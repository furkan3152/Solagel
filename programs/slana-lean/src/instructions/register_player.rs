//! `register_player(name: String, skin: u8)` — reference `instructions/register_player.rs`.
//!
//! Accounts: 0 owner, 1 config, 2 profile, 3 system_program.
//!
//! | reference constraint                                                    | lean check                     | error |
//! |-------------------------------------------------------------------------|--------------------------------|-------|
//! | args Borsh (`String`, `u8`)                                             | `Args`                         | 102 |
//! | `owner: Signer`                                                         | `check_signer`                 | 3010 |
//! | `config: Account<Config>`                                               | `check_account`                | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | `system_program: Program<System>`                                       | `check_program(system)`        | 3008 / 3009 |
//! | `profile: init, payer = owner, space, seeds = [PROFILE_SEED, owner], bump` | `init_program_pda`          | 2006 / system program ("already in use") |
//! | `owner: mut`                                                            | `check_writable`               | 2000 |
//! | `config: seeds = [CONFIG_SEED], bump = config.bump`                     | `stake::check_config`          | 2006 |
//! | `config: mut`                                                           | `stake::check_config`          | 2000 |
//! | `logic::validate_name` / `logic::check_skin`                            | same                           | InvalidName / InvalidSkin |
//! | `config.total_players.checked_add(1)`                                   | `stake::add`                   | MathOverflow |
//!
//! Duplicate-mutable check: only `config` is a candidate (`profile` is pure `init`).
//! Writes the profile (owner, name, skin, `season = config.current_season`, `created_at`,
//! bump; everything else zero) and emits `PlayerRegistered`.

use {
    super::{initialize::init_program_pda, stake, unix_timestamp},
    crate::error::Result,
    crate::{
        accounts::{check_writable, data, kind, parse},
        borsh::{rd_u32, rd_u64, wr_bytes, wr_i64, wr_u32, wr_u64, wr_u8, Args},
        constants::PROFILE_SEED,
        events,
        logic::{check_skin, validate_name, write_name},
        state::{config, profile},
    },
    pinocchio::AccountView,
};

#[inline(never)]
pub fn process(accounts: &[AccountView], args: &[u8]) -> Result {
    let mut a = Args::new(args);
    let name = a.string();
    let skin = a.u8();
    a.finish()?;

    let [owner, config_acc, profile_acc, _system_program] = parse(
        accounts,
        &[kind::SIGNER, kind::CONFIG, kind::ANY, kind::SYSTEM_PROGRAM],
    )?;
    let bump = init_program_pda(
        owner,
        profile_acc,
        profile::SPACE,
        &[PROFILE_SEED, owner.address().as_ref()],
    )?;

    check_writable(owner)?;
    // SAFETY: `parse` checked the config; the profile was just allocated with
    // `profile::SPACE` bytes. Distinct accounts (distinct types).
    let c = unsafe { data::<{ config::SPACE }>(config_acc) };
    stake::check_config(config_acc, c, true)?;

    let name_len = validate_name(name)?;
    check_skin(skin)?;
    let now = unix_timestamp()?;
    let players = stake::add(rd_u64(c, config::TOTAL_PLAYERS), 1)?;
    wr_u64(c, config::TOTAL_PLAYERS, players);

    // SAFETY: as above.
    let p = unsafe { data::<{ profile::SPACE }>(profile_acc) };
    wr_bytes(p, 0, &profile::DISCRIMINATOR);
    wr_bytes(p, profile::OWNER, owner.address().as_ref());
    write_name(p, profile::NAME, name, name_len);
    wr_u8(p, profile::SKIN, skin);
    wr_u32(p, profile::SEASON, rd_u32(c, config::CURRENT_SEASON));
    wr_i64(p, profile::CREATED_AT, now);
    wr_u8(p, profile::BUMP, bump);

    let event = events::player_registered(owner.address().as_array(), name);
    // Bound: `name` is at most 16 bytes (validated above), so the end is at most 60.
    #[allow(clippy::arithmetic_side_effects)]
    let end = 44 + usize::from(name_len);
    events::emit(event.get(..end).unwrap_or(&event));
    Ok(())
}
