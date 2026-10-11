//! Season lifecycle and arena sweeping, preserving the reference instruction ABI.

use crate::{
    account,
    constants::*,
    error::{anchor, SolagelError},
    events::{self, ArenaSwept, RewardClaimed, SeasonEnded, SeasonFunded, SeasonRolledOver},
    logic,
    prelude::*,
    shared,
    state::{Arena, Config, Season},
};

fn at<'a, 'info>(
    accounts: &'a [AccountInfo<'info>],
    index: usize,
) -> Result<&'a AccountInfo<'info>> {
    accounts.get(index).ok_or_else(|| anchor(3005))
}

pub fn fund_season(accounts: &[AccountInfo], data: &[u8]) -> Result<()> {
    let amount: u64 = decode(data)?;
    let funder = at(accounts, 0)?;
    let config_info = at(accounts, 1)?;
    let season_info = at(accounts, 2)?;
    let system = at(accounts, 3)?;
    account::signer(funder, true)?;
    let config = account::read::<Config>(config_info, false)?;
    account::check_pda(config_info, &[CONFIG_SEED], config.bump)?;
    let season = account::read::<Season>(season_info, true)?;
    account::check_pda(
        season_info,
        &[SEASON_SEED, &config.current_season.to_le_bytes()],
        season.bump,
    )?;
    account::system(system)?;
    require!(amount > 0, SolagelError::InvalidAmount);
    require!(!season.finalized, SolagelError::SeasonFinalized);
    shared::transfer_from_wallet(funder, season_info, amount)?;
    events::emit(&SeasonFunded {
        season_id: season.id,
        funder: *funder.key,
        amount,
    })
}

pub fn end_season(accounts: &[AccountInfo], _data: &[u8]) -> Result<()> {
    let admin = at(accounts, 0)?;
    let config_info = at(accounts, 1)?;
    let season_info = at(accounts, 2)?;
    let next_info = at(accounts, 3)?;
    let system = at(accounts, 4)?;
    account::signer(admin, true)?;
    let mut config = account::read::<Config>(config_info, true)?;
    account::check_pda(config_info, &[CONFIG_SEED], config.bump)?;
    require!(config.admin == *admin.key, SolagelError::Unauthorized);
    let mut season = Box::new(account::read::<Season>(season_info, true)?);
    account::check_pda(
        season_info,
        &[SEASON_SEED, &config.current_season.to_le_bytes()],
        season.bump,
    )?;
    account::system(system)?;
    let next_id = config
        .current_season
        .checked_add(1)
        .ok_or(SolagelError::MathOverflow)?;
    let next_id_bytes = next_id.to_le_bytes();
    let next_bump = account::find_pda(next_info, &[SEASON_SEED, &next_id_bytes])?;
    account::create_pda(
        admin,
        next_info,
        system,
        Season::SPACE,
        &[SEASON_SEED, &next_id_bytes, &[next_bump]],
    )?;
    require!(!season.finalized, SolagelError::SeasonFinalized);
    let now = Clock::get()?.unix_timestamp;
    let prize_pool = shared::available_lamports(season_info)?;

    season.finalized = true;
    season.ended_at = now;
    season.prize_pool = prize_pool;
    let ended_id = season.id;
    config.current_season = next_id;
    account::write(season_info, &*season)?;
    account::write(config_info, &config)?;
    // Reuse the heap allocation instead of keeping two leaderboard arrays on the SBF stack.
    *season = Season {
        id: next_id,
        started_at: now,
        bump: next_bump,
        ..Season::default()
    };
    account::write(next_info, &*season)?;
    events::emit(&SeasonEnded {
        season_id: ended_id,
        prize_pool,
    })
}

pub fn claim_season_reward(accounts: &[AccountInfo], data: &[u8]) -> Result<()> {
    let season_id: u32 = decode(data)?;
    let claimer = at(accounts, 0)?;
    let season_info = at(accounts, 1)?;
    account::signer(claimer, true)?;
    let mut season = account::read::<Season>(season_info, true)?;
    account::check_pda(
        season_info,
        &[SEASON_SEED, &season_id.to_le_bytes()],
        season.bump,
    )?;
    require!(season.finalized, SolagelError::SeasonNotFinalized);
    let now = Clock::get()?.unix_timestamp;
    let closes_at = season
        .ended_at
        .checked_add(CLAIM_WINDOW_SECS)
        .ok_or(SolagelError::MathOverflow)?;
    require_gte!(closes_at, now, SolagelError::ClaimWindowClosed);
    let rank = logic::prize_rank(&season.entries, season.count, claimer.key)
        .ok_or(SolagelError::NotEligible)?;
    let bit = 1u16 << rank;
    require!(season.claimed_mask & bit == 0, SolagelError::AlreadyClaimed);
    let amount = logic::prize_amount(season.prize_pool, rank)?;
    shared::transfer_from_program_account(season_info, claimer, amount)?;
    season.claimed_mask |= bit;
    account::write(season_info, &season)?;
    events::emit(&RewardClaimed {
        season_id,
        player: *claimer.key,
        rank: rank as u8,
        amount,
    })
}

struct RolloverSeason {
    id: u32,
    bump: u8,
    finalized: bool,
    ended_at: i64,
}

// Decode the entire account with the usual guards, but keep each leaderboard's
// deserialization temporary in this frame instead of the rollover caller's frame.
#[inline(never)]
fn read_rollover_season(info: &AccountInfo) -> Result<RolloverSeason> {
    let season = account::read::<Season>(info, true)?;
    Ok(RolloverSeason {
        id: season.id,
        bump: season.bump,
        finalized: season.finalized,
        ended_at: season.ended_at,
    })
}

pub fn rollover_season(accounts: &[AccountInfo], data: &[u8]) -> Result<()> {
    let season_id: u32 = decode(data)?;
    let admin = at(accounts, 0)?;
    let config_info = at(accounts, 1)?;
    let old_info = at(accounts, 2)?;
    let current_info = at(accounts, 3)?;
    account::signer(admin, false)?;
    let config = account::read::<Config>(config_info, false)?;
    account::check_pda(config_info, &[CONFIG_SEED], config.bump)?;
    require!(config.admin == *admin.key, SolagelError::Unauthorized);
    let old = read_rollover_season(old_info)?;
    account::check_pda(old_info, &[SEASON_SEED, &season_id.to_le_bytes()], old.bump)?;
    // The reference explicitly allows an alias here to report InvalidSeason for this case.
    require!(
        season_id != config.current_season,
        SolagelError::InvalidSeason
    );
    let current = read_rollover_season(current_info)?;
    account::check_pda(
        current_info,
        &[SEASON_SEED, &config.current_season.to_le_bytes()],
        current.bump,
    )?;
    require!(old.finalized, SolagelError::SeasonNotFinalized);
    let now = Clock::get()?.unix_timestamp;
    let closes_at = old
        .ended_at
        .checked_add(CLAIM_WINDOW_SECS)
        .ok_or(SolagelError::MathOverflow)?;
    require!(now > closes_at, SolagelError::ClaimWindowOpen);
    let amount = shared::available_lamports(old_info)?;
    shared::transfer_from_program_account(old_info, current_info, amount)?;
    events::emit(&SeasonRolledOver {
        from: season_id,
        to: current.id,
        amount,
    })
}

pub fn sweep_arena(accounts: &[AccountInfo], _data: &[u8]) -> Result<()> {
    let admin = at(accounts, 0)?;
    let config_info = at(accounts, 1)?;
    let arena_info = at(accounts, 2)?;
    let treasury = at(accounts, 3)?;
    account::signer(admin, false)?;
    let config = account::read::<Config>(config_info, false)?;
    account::check_pda(config_info, &[CONFIG_SEED], config.bump)?;
    require!(config.admin == *admin.key, SolagelError::Unauthorized);
    let arena = account::read::<Arena>(arena_info, true)?;
    account::check_pda(
        arena_info,
        &[ARENA_SEED, &arena.id.to_le_bytes()],
        arena.bump,
    )?;
    account::writable(treasury)?;
    require!(treasury.key == &config.treasury, SolagelError::Unauthorized);
    require!(arena.open_sessions == 0, SolagelError::ArenaHasOpenSessions);
    let amount = shared::available_lamports(arena_info)?;
    // The unchecked treasury may alias another account, including the signer.
    shared::transfer_from_program_account(arena_info, treasury, amount)?;
    events::emit(&ArenaSwept {
        arena_id: arena.id,
        amount,
    })
}
