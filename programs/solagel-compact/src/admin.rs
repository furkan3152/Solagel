//! Administrative instructions with the Anchor reference account order and ABI.

use crate::{
    account,
    constants::*,
    error::{anchor, SolagelError},
    prelude::*,
    state::{Arena, Config, Season},
};

#[derive(BorshDeserialize)]
pub struct InitializeArgs {
    #[borsh(deserialize_with = "crate::codec::pubkey")]
    pub server_authority: Pubkey,
    #[borsh(deserialize_with = "crate::codec::pubkey")]
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub season_share_bps: u16,
    pub skin_price: u64,
}

#[derive(BorshDeserialize, Default)]
pub struct UpdateConfigArgs {
    #[borsh(deserialize_with = "crate::codec::option_pubkey")]
    pub admin: Option<Pubkey>,
    #[borsh(deserialize_with = "crate::codec::option_pubkey")]
    pub server_authority: Option<Pubkey>,
    #[borsh(deserialize_with = "crate::codec::option_pubkey")]
    pub treasury: Option<Pubkey>,
    #[borsh(deserialize_with = "crate::codec::option")]
    pub fee_bps: Option<u16>,
    #[borsh(deserialize_with = "crate::codec::option")]
    pub season_share_bps: Option<u16>,
    #[borsh(deserialize_with = "crate::codec::option")]
    pub skin_price: Option<u64>,
    #[borsh(deserialize_with = "crate::codec::option_bool")]
    pub paused: Option<bool>,
}

#[derive(BorshDeserialize)]
struct CreateArenaArgs {
    id: u16,
    buy_in: u64,
    max_players: u16,
}

#[derive(BorshDeserialize)]
struct UpdateArenaArgs {
    #[borsh(deserialize_with = "crate::codec::option_bool")]
    enabled: Option<bool>,
    #[borsh(deserialize_with = "crate::codec::option")]
    max_players: Option<u16>,
}

fn at<'a, 'info>(
    accounts: &'a [AccountInfo<'info>],
    index: usize,
) -> Result<&'a AccountInfo<'info>> {
    accounts.get(index).ok_or_else(|| anchor(3005))
}

/// Bincode's fixed-width enum and option headers used by UpgradeableLoaderState.
fn loader_tag(data: &[u8]) -> Result<u32> {
    let tag_bytes: [u8; 4] = data
        .get(..4)
        .ok_or(ProgramError::InvalidAccountData)?
        .try_into()
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let tag = u32::from_le_bytes(tag_bytes);
    match tag {
        0 => (),
        1 | 3 => {
            let option_offset = if tag == 1 { 4 } else { 12 };
            match data.get(option_offset) {
                Some(0) => (),
                Some(1) if data.len() >= option_offset + 33 => (),
                _ => return Err(ProgramError::InvalidAccountData),
            }
        }
        2 if data.len() >= 36 => (),
        _ => return Err(ProgramError::InvalidAccountData),
    }
    Ok(tag)
}

/// Verify both the deployed program's recorded ProgramData pointer and the loader PDA,
/// then decode the loader's bincode header without pulling bincode into the SBF binary.
fn upgrade_authority(
    admin: &AccountInfo,
    program: &AccountInfo,
    program_data: &AccountInfo,
) -> Result<()> {
    if program.key != &ID {
        return Err(anchor(3008));
    }
    if !program.executable {
        return Err(anchor(3009));
    }
    require!(
        program.owner == &account::UPGRADEABLE_LOADER_ID,
        SolagelError::Unauthorized
    );
    {
        let data = program.try_borrow_data()?;
        // UpgradeableLoaderState::Program = u32(2), followed by its ProgramData pubkey.
        if loader_tag(&data)? != 2 {
            return Err(ProgramError::InvalidAccountData);
        }
        require!(
            &data[4..36] == program_data.key.as_ref(),
            SolagelError::Unauthorized
        );
    }

    if program_data.lamports() == 0 && program_data.owner == &Pubkey::default() {
        return Err(anchor(3012));
    }
    if program_data.owner != &account::UPGRADEABLE_LOADER_ID {
        return Err(anchor(3007));
    }
    let data = program_data.try_borrow_data()?;
    // UpgradeableLoaderState::ProgramData = u32(3), slot:u64, Option<Pubkey>.
    if loader_tag(&data)? != 3 {
        return Err(anchor(3013));
    }
    let expected = Pubkey::find_program_address(&[ID.as_ref()], &account::UPGRADEABLE_LOADER_ID).0;
    if program_data.key != &expected {
        return Err(anchor(2006));
    }
    require!(
        data[12] == 1 && &data[13..45] == admin.key.as_ref(),
        SolagelError::Unauthorized
    );
    Ok(())
}

pub fn initialize(accounts: &[AccountInfo], data: &[u8]) -> Result<()> {
    let args: InitializeArgs = decode(data)?;
    let admin = at(accounts, 0)?;
    let config_info = at(accounts, 1)?;
    let season_info = at(accounts, 2)?;
    let program = at(accounts, 3)?;
    let program_data = at(accounts, 4)?;
    let system = at(accounts, 5)?;
    account::signer(admin, true)?;
    account::system(system)?;
    upgrade_authority(admin, program, program_data)?;
    let config_bump = account::find_pda(config_info, &[CONFIG_SEED])?;
    let season_id = FIRST_SEASON.to_le_bytes();
    let season_bump = account::find_pda(season_info, &[SEASON_SEED, &season_id])?;
    account::create_pda(
        admin,
        config_info,
        system,
        Config::SPACE,
        &[CONFIG_SEED, &[config_bump]],
    )?;
    account::create_pda(
        admin,
        season_info,
        system,
        Season::SPACE,
        &[SEASON_SEED, &season_id, &[season_bump]],
    )?;
    // Anchor performs init constraints before entering the handler's argument checks.
    require!(args.fee_bps <= MAX_FEE_BPS, SolagelError::InvalidFee);
    require!(args.season_share_bps <= BPS, SolagelError::InvalidFee);
    let now = Clock::get()?.unix_timestamp;
    let config = Config {
        admin: *admin.key,
        server_authority: args.server_authority,
        treasury: args.treasury,
        fee_bps: args.fee_bps,
        season_share_bps: args.season_share_bps,
        skin_price: args.skin_price,
        current_season: FIRST_SEASON,
        paused: false,
        bump: config_bump,
        ..Config::default()
    };
    let season = Season {
        id: FIRST_SEASON,
        started_at: now,
        bump: season_bump,
        ..Season::default()
    };
    account::write(config_info, &config)?;
    account::write(season_info, &season)?;
    solana_msg::msg!("Solagel initialized");
    Ok(())
}

pub fn update_config(accounts: &[AccountInfo], data: &[u8]) -> Result<()> {
    let args: UpdateConfigArgs = decode(data)?;
    let admin = at(accounts, 0)?;
    let config_info = at(accounts, 1)?;
    account::signer(admin, false)?;
    let mut config = account::read::<Config>(config_info, true)?;
    account::check_pda(config_info, &[CONFIG_SEED], config.bump)?;
    require!(config.admin == *admin.key, SolagelError::Unauthorized);
    if let Some(fee_bps) = args.fee_bps {
        require!(fee_bps <= MAX_FEE_BPS, SolagelError::InvalidFee);
        config.fee_bps = fee_bps;
    }
    if let Some(season_share_bps) = args.season_share_bps {
        require!(season_share_bps <= BPS, SolagelError::InvalidFee);
        config.season_share_bps = season_share_bps;
    }
    if let Some(admin) = args.admin {
        config.admin = admin;
    }
    if let Some(server_authority) = args.server_authority {
        config.server_authority = server_authority;
    }
    if let Some(treasury) = args.treasury {
        config.treasury = treasury;
    }
    if let Some(skin_price) = args.skin_price {
        config.skin_price = skin_price;
    }
    if let Some(paused) = args.paused {
        config.paused = paused;
    }
    account::write(config_info, &config)
}

pub fn create_arena(accounts: &[AccountInfo], data: &[u8]) -> Result<()> {
    let args: CreateArenaArgs = decode(data)?;
    let admin = at(accounts, 0)?;
    let config_info = at(accounts, 1)?;
    let arena_info = at(accounts, 2)?;
    let system = at(accounts, 3)?;
    account::signer(admin, true)?;
    let config = account::read::<Config>(config_info, false)?;
    account::check_pda(config_info, &[CONFIG_SEED], config.bump)?;
    require!(config.admin == *admin.key, SolagelError::Unauthorized);
    account::system(system)?;
    let id = args.id.to_le_bytes();
    let bump = account::find_pda(arena_info, &[ARENA_SEED, &id])?;
    account::create_pda(
        admin,
        arena_info,
        system,
        Arena::SPACE,
        &[ARENA_SEED, &id, &[bump]],
    )?;
    require_gte!(args.buy_in, MIN_BUY_IN, SolagelError::BuyInTooLow);
    require!(
        (MIN_ARENA_PLAYERS..=MAX_ARENA_PLAYERS).contains(&args.max_players),
        SolagelError::InvalidMaxPlayers
    );
    account::write(
        arena_info,
        &Arena {
            id: args.id,
            buy_in: args.buy_in,
            max_players: args.max_players,
            enabled: true,
            bump,
            ..Arena::default()
        },
    )
}

pub fn update_arena(accounts: &[AccountInfo], data: &[u8]) -> Result<()> {
    let args: UpdateArenaArgs = decode(data)?;
    let admin = at(accounts, 0)?;
    let config_info = at(accounts, 1)?;
    let arena_info = at(accounts, 2)?;
    account::signer(admin, false)?;
    let config = account::read::<Config>(config_info, false)?;
    account::check_pda(config_info, &[CONFIG_SEED], config.bump)?;
    require!(config.admin == *admin.key, SolagelError::Unauthorized);
    let mut arena = account::read::<Arena>(arena_info, true)?;
    account::check_pda(
        arena_info,
        &[ARENA_SEED, &arena.id.to_le_bytes()],
        arena.bump,
    )?;
    if let Some(enabled) = args.enabled {
        arena.enabled = enabled;
    }
    if let Some(max_players) = args.max_players {
        require!(
            (MIN_ARENA_PLAYERS..=MAX_ARENA_PLAYERS).contains(&max_players),
            SolagelError::InvalidMaxPlayers
        );
        arena.max_players = max_players;
    }
    account::write(arena_info, &arena)
}
