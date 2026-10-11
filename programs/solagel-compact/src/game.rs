//! Player and gameplay instructions with the existing Solagel instruction ABI.

use crate::{
    account,
    constants::*,
    error::{anchor, SolagelError},
    events::{
        self, ArenaJoined, GameRecorded, PlayerRegistered, ProfileUpdated, SessionRefunded,
        SessionSettled,
    },
    logic,
    prelude::*,
    shared,
    state::{Arena, Config, PlayerProfile, Season, Session},
};

/// Decode a Borsh string directly from instruction bytes. Its u32 length and
/// UTF-8 are checked before account validation; trailing bytes remain available
/// to the next argument. No untrusted length is used for an allocation.
fn name_arg<'a>(data: &mut &'a [u8]) -> Result<&'a str> {
    let length = u32::deserialize(data).map_err(|_| anchor(102))? as usize;
    let bytes = data.get(..length).ok_or_else(|| anchor(102))?;
    let name = core::str::from_utf8(bytes).map_err(|_| anchor(102))?;
    *data = &data[length..];
    Ok(name)
}

fn at<'a, 'info>(
    accounts: &'a [AccountInfo<'info>],
    index: usize,
) -> Result<&'a AccountInfo<'info>> {
    accounts.get(index).ok_or_else(|| anchor(3005))
}

fn args<T: BorshDeserialize>(mut data: &[u8]) -> Result<T> {
    T::deserialize(&mut data).map_err(|_| anchor(102))
}

fn config(info: &AccountInfo, writable: bool) -> Result<Config> {
    let value: Config = account::read(info, writable)?;
    account::check_pda(info, &[CONFIG_SEED], value.bump)?;
    Ok(value)
}

fn arena(info: &AccountInfo, writable: bool) -> Result<Arena> {
    let value: Arena = account::read(info, writable)?;
    account::check_pda(info, &[ARENA_SEED, &value.id.to_le_bytes()], value.bump)?;
    Ok(value)
}

fn player_profile(info: &AccountInfo, owner: &Pubkey) -> Result<PlayerProfile> {
    let value: PlayerProfile = account::read(info, true)?;
    account::check_pda(info, &[PROFILE_SEED, owner.as_ref()], value.bump)?;
    Ok(value)
}

fn season(info: &AccountInfo, current_season: u32) -> Result<Season> {
    let value: Season = account::read(info, true)?;
    account::check_pda(
        info,
        &[SEASON_SEED, &current_season.to_le_bytes()],
        value.bump,
    )?;
    Ok(value)
}

fn owned_session(info: &AccountInfo, arena: &Pubkey, player: &Pubkey) -> Result<Session> {
    let value: Session = account::read(info, true)?;
    account::check_pda(
        info,
        &[SESSION_SEED, arena.as_ref(), player.as_ref()],
        value.bump,
    )?;
    require!(value.player == *player, SolagelError::Unauthorized);
    require!(value.arena == *arena, SolagelError::Unauthorized);
    // Anchor's close constraint rejects a destination equal to the account being closed.
    if info.key == player {
        return Err(anchor(2011));
    }
    Ok(value)
}

pub fn register_player(accounts: &[AccountInfo], mut data: &[u8]) -> Result<()> {
    let name = name_arg(&mut data)?;
    let skin = u8::deserialize(&mut data).map_err(|_| anchor(102))?;
    let owner = at(accounts, 0)?;
    let config_info = at(accounts, 1)?;
    let profile_info = at(accounts, 2)?;
    let system = at(accounts, 3)?;
    account::signer(owner, true)?;
    let mut config = config(config_info, true)?;
    account::system(system)?;
    let bump = account::find_pda(profile_info, &[PROFILE_SEED, owner.key.as_ref()])?;
    account::create_pda(
        owner,
        profile_info,
        system,
        PlayerProfile::SPACE,
        &[PROFILE_SEED, owner.key.as_ref(), &[bump]],
    )?;

    let (name_bytes, name_len) = logic::validate_name(name)?;
    logic::check_skin(skin, 0, 0)?;
    let now = Clock::get()?.unix_timestamp;
    config.total_players = config
        .total_players
        .checked_add(1)
        .ok_or(SolagelError::MathOverflow)?;
    let profile = PlayerProfile {
        owner: *owner.key,
        name: name_bytes,
        name_len,
        skin,
        season: config.current_season,
        created_at: now,
        bump,
        ..PlayerProfile::default()
    };
    account::write(config_info, &config)?;
    account::write(profile_info, &profile)?;
    events::emit(&PlayerRegistered {
        owner: *owner.key,
        name: name.to_owned(),
    })
}

pub fn update_profile(accounts: &[AccountInfo], mut data: &[u8]) -> Result<()> {
    let name = match u8::deserialize(&mut data).map_err(|_| anchor(102))? {
        0 => None,
        1 => Some(name_arg(&mut data)?),
        _ => return Err(anchor(102)),
    };
    let skin: Option<u8> = crate::codec::option(&mut data).map_err(|_| anchor(102))?;
    let owner = at(accounts, 0)?;
    let profile_info = at(accounts, 1)?;
    account::signer(owner, false)?;
    let mut profile = player_profile(profile_info, owner.key)?;
    require!(profile.owner == *owner.key, SolagelError::Unauthorized);
    if let Some(name) = name {
        let (bytes, len) = logic::validate_name(name)?;
        profile.name = bytes;
        profile.name_len = len;
    }
    if let Some(skin) = skin {
        logic::check_skin(skin, profile.xp, profile.premium_skins)?;
        profile.skin = skin;
    }
    account::write(profile_info, &profile)?;
    events::emit(&ProfileUpdated {
        owner: profile.owner,
        skin: profile.skin,
    })
}

pub fn buy_skin(accounts: &[AccountInfo], data: &[u8]) -> Result<()> {
    let _: u8 = args(data)?;
    let owner = at(accounts, 0)?;
    let config_info = at(accounts, 1)?;
    let profile_info = at(accounts, 2)?;
    let treasury = at(accounts, 3)?;
    let system = at(accounts, 4)?;
    account::signer(owner, true)?;
    let config = config(config_info, false)?;
    let profile = player_profile(profile_info, owner.key)?;
    require!(profile.owner == *owner.key, SolagelError::Unauthorized);
    account::writable(treasury)?;
    require!(*treasury.key == config.treasury, SolagelError::Unauthorized);
    account::system(system)?;
    Err(SolagelError::FeatureUnavailable.into())
}

pub fn join_arena(accounts: &[AccountInfo], _data: &[u8]) -> Result<()> {
    let player = at(accounts, 0)?;
    let config_info = at(accounts, 1)?;
    let profile_info = at(accounts, 2)?;
    let arena_info = at(accounts, 3)?;
    let session_info = at(accounts, 4)?;
    let system = at(accounts, 5)?;
    account::signer(player, true)?;
    let mut config = config(config_info, true)?;
    let mut profile = player_profile(profile_info, player.key)?;
    let mut arena = arena(arena_info, true)?;
    account::system(system)?;
    let bump = account::find_pda(
        session_info,
        &[SESSION_SEED, arena_info.key.as_ref(), player.key.as_ref()],
    )?;
    account::create_pda(
        player,
        session_info,
        system,
        Session::SPACE,
        &[
            SESSION_SEED,
            arena_info.key.as_ref(),
            player.key.as_ref(),
            &[bump],
        ],
    )?;

    require!(!config.paused, SolagelError::Paused);
    require!(arena.enabled, SolagelError::ArenaDisabled);
    require!(
        arena.open_sessions < arena.max_players,
        SolagelError::ArenaFull
    );
    let buy_in = arena.buy_in;
    shared::transfer_from_wallet(player, arena_info, buy_in)?;
    let now = Clock::get()?.unix_timestamp;
    let session_id = config.total_sessions;
    config.total_sessions = session_id
        .checked_add(1)
        .ok_or(SolagelError::MathOverflow)?;
    config.total_staked = config
        .total_staked
        .checked_add(buy_in)
        .ok_or(SolagelError::MathOverflow)?;
    profile.stake_games = profile.stake_games.saturating_add(1);
    profile.total_staked = profile
        .total_staked
        .checked_add(buy_in)
        .ok_or(SolagelError::MathOverflow)?;
    arena.open_sessions = arena
        .open_sessions
        .checked_add(1)
        .ok_or(SolagelError::MathOverflow)?;
    arena.total_deposited = arena
        .total_deposited
        .checked_add(buy_in)
        .ok_or(SolagelError::MathOverflow)?;
    let session = Session {
        player: *player.key,
        arena: *arena_info.key,
        arena_id: arena.id,
        buy_in,
        opened_at: now,
        id: session_id,
        activated: false,
        bump,
    };
    account::write(config_info, &config)?;
    account::write(profile_info, &profile)?;
    account::write(arena_info, &arena)?;
    account::write(session_info, &session)?;
    events::emit(&ArenaJoined {
        player: *player.key,
        arena_id: arena.id,
        session_id,
        buy_in,
    })
}

pub fn activate_session(accounts: &[AccountInfo], data: &[u8]) -> Result<()> {
    let session_id: u64 = args(data)?;
    let server = at(accounts, 0)?;
    let config_info = at(accounts, 1)?;
    let arena_info = at(accounts, 2)?;
    let session_info = at(accounts, 3)?;
    account::signer(server, false)?;
    let config = config(config_info, false)?;
    require!(
        *server.key == config.server_authority,
        SolagelError::Unauthorized
    );
    let arena = arena(arena_info, false)?;
    let mut session: Session = account::read(session_info, true)?;
    account::check_pda(
        session_info,
        &[
            SESSION_SEED,
            arena_info.key.as_ref(),
            session.player.as_ref(),
        ],
        session.bump,
    )?;
    require!(session.arena == *arena_info.key, SolagelError::Unauthorized);

    require!(!config.paused, SolagelError::Paused);
    require!(arena.enabled, SolagelError::ArenaDisabled);
    require!(session.id == session_id, SolagelError::SessionMismatch);
    require!(!session.activated, SolagelError::SessionAlreadyActivated);
    let refundable_at = session
        .opened_at
        .checked_add(SESSION_REFUND_TIMEOUT_SECS)
        .ok_or(SolagelError::MathOverflow)?;
    require!(
        Clock::get()?.unix_timestamp < refundable_at,
        SolagelError::SessionActivationExpired
    );
    session.activated = true;
    account::write(session_info, &session)
}

pub fn settle_session(accounts: &[AccountInfo], data: &[u8]) -> Result<()> {
    let (session_id, payout, score, kills, xp): (u64, u64, u32, u16, u32) = args(data)?;
    let server = at(accounts, 0)?;
    let config_info = at(accounts, 1)?;
    let arena_info = at(accounts, 2)?;
    let session_info = at(accounts, 3)?;
    let player = at(accounts, 4)?;
    let profile_info = at(accounts, 5)?;
    let season_info = at(accounts, 6)?;
    let treasury = at(accounts, 7)?;
    account::signer(server, false)?;
    let mut config = config(config_info, true)?;
    require!(
        *server.key == config.server_authority,
        SolagelError::Unauthorized
    );
    let mut arena = arena(arena_info, true)?;
    let session = owned_session(session_info, arena_info.key, player.key)?;
    account::writable(player)?;
    let mut profile = player_profile(profile_info, player.key)?;
    let mut season = season(season_info, config.current_season)?;
    account::writable(treasury)?;
    require!(*treasury.key == config.treasury, SolagelError::Unauthorized);

    require!(session.id == session_id, SolagelError::SessionMismatch);
    let now = Clock::get()?.unix_timestamp;
    require_gte!(
        shared::available_lamports(arena_info)?,
        payout,
        SolagelError::InsufficientPot
    );
    let split = logic::compute_settlement(
        payout,
        session.buy_in,
        config.fee_bps,
        config.season_share_bps,
    )?;
    let (season_cut, treasury_cut) = if split.treasury_cut > 0
        && treasury.lamports().saturating_add(split.treasury_cut)
            < shared::rent_exempt_minimum(treasury)?
    {
        (split.fee, 0)
    } else {
        (split.season_cut, split.treasury_cut)
    };
    shared::debit_program_account(arena_info, payout)?;
    shared::credit_account(player, split.player_amount)?;
    shared::credit_account(treasury, treasury_cut)?;
    shared::credit_account(season_info, season_cut)?;

    arena.open_sessions = arena.open_sessions.saturating_sub(1);
    arena.total_paid_out = arena
        .total_paid_out
        .checked_add(payout)
        .ok_or(SolagelError::MathOverflow)?;
    config.total_games = config
        .total_games
        .checked_add(1)
        .ok_or(SolagelError::MathOverflow)?;
    config.total_paid_out = config
        .total_paid_out
        .checked_add(payout)
        .ok_or(SolagelError::MathOverflow)?;
    profile.total_won = profile
        .total_won
        .checked_add(split.player_amount)
        .ok_or(SolagelError::MathOverflow)?;
    let result = shared::record_result(
        &mut profile,
        &mut season,
        config.current_season,
        logic::GameResult { score, kills, xp },
        logic::season_points_from_profit(payout, session.buy_in),
        now,
    );
    account::write(config_info, &config)?;
    account::write(arena_info, &arena)?;
    account::write(profile_info, &profile)?;
    account::write(season_info, &season)?;
    events::emit(&SessionSettled {
        player: session.player,
        arena_id: session.arena_id,
        session_id: session.id,
        payout,
        fee: split.fee,
        score: result.score,
        kills: result.kills,
    })?;
    account::close(session_info, player)
}

pub fn record_game(accounts: &[AccountInfo], data: &[u8]) -> Result<()> {
    let (score, kills, xp): (u32, u16, u32) = args(data)?;
    let server = at(accounts, 0)?;
    let config_info = at(accounts, 1)?;
    let profile_info = at(accounts, 2)?;
    let season_info = at(accounts, 3)?;
    account::signer(server, false)?;
    let mut config = config(config_info, true)?;
    require!(
        *server.key == config.server_authority,
        SolagelError::Unauthorized
    );
    let mut profile: PlayerProfile = account::read(profile_info, true)?;
    account::check_pda(
        profile_info,
        &[PROFILE_SEED, profile.owner.as_ref()],
        profile.bump,
    )?;
    let _season = season(season_info, config.current_season)?;
    let now = Clock::get()?.unix_timestamp;
    config.total_games = config
        .total_games
        .checked_add(1)
        .ok_or(SolagelError::MathOverflow)?;
    let result = logic::apply_practice_game(&mut profile, score, kills, xp, now);
    account::write(config_info, &config)?;
    account::write(profile_info, &profile)?;
    events::emit(&GameRecorded {
        player: profile.owner,
        score: result.score,
        kills: result.kills,
        xp: result.xp,
    })
}

pub fn refund_session(accounts: &[AccountInfo], _data: &[u8]) -> Result<()> {
    let player = at(accounts, 0)?;
    let arena_info = at(accounts, 1)?;
    let session_info = at(accounts, 2)?;
    account::signer(player, true)?;
    let mut arena = arena(arena_info, true)?;
    let session = owned_session(session_info, arena_info.key, player.key)?;
    let now = Clock::get()?.unix_timestamp;
    require!(!session.activated, SolagelError::SessionNotRefundable);
    let refundable_at = session
        .opened_at
        .checked_add(SESSION_REFUND_TIMEOUT_SECS)
        .ok_or(SolagelError::MathOverflow)?;
    require_gte!(now, refundable_at, SolagelError::RefundTooEarly);
    let refund = session.buy_in.min(shared::available_lamports(arena_info)?);
    shared::transfer_from_program_account(arena_info, player, refund)?;
    arena.open_sessions = arena.open_sessions.saturating_sub(1);
    arena.total_paid_out = arena
        .total_paid_out
        .checked_add(refund)
        .ok_or(SolagelError::MathOverflow)?;
    account::write(arena_info, &arena)?;
    events::emit(&SessionRefunded {
        player: *player.key,
        arena_id: arena.id,
        amount: refund,
    })?;
    account::close(session_info, player)
}
