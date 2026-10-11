use crate::prelude::*;

#[derive(BorshSerialize)]
pub struct PlayerRegistered {
    pub owner: Pubkey,
    pub name: String,
}

#[derive(BorshSerialize)]
pub struct ProfileUpdated {
    pub owner: Pubkey,
    pub skin: u8,
}

#[derive(BorshSerialize)]
pub struct SkinPurchased {
    pub owner: Pubkey,
    pub skin: u8,
    pub price: u64,
}

#[derive(BorshSerialize)]
pub struct ArenaJoined {
    pub player: Pubkey,
    pub arena_id: u16,
    pub session_id: u64,
    pub buy_in: u64,
}

#[derive(BorshSerialize)]
pub struct SessionSettled {
    pub player: Pubkey,
    pub arena_id: u16,
    pub session_id: u64,
    pub payout: u64,
    pub fee: u64,
    pub score: u32,
    pub kills: u16,
}

#[derive(BorshSerialize)]
pub struct GameRecorded {
    pub player: Pubkey,
    pub score: u32,
    pub kills: u16,
    pub xp: u32,
}

#[derive(BorshSerialize)]
pub struct SessionRefunded {
    pub player: Pubkey,
    pub arena_id: u16,
    pub amount: u64,
}

#[derive(BorshSerialize)]
pub struct SeasonFunded {
    pub season_id: u32,
    pub funder: Pubkey,
    pub amount: u64,
}

#[derive(BorshSerialize)]
pub struct SeasonEnded {
    pub season_id: u32,
    pub prize_pool: u64,
}

#[derive(BorshSerialize)]
pub struct RewardClaimed {
    pub season_id: u32,
    pub player: Pubkey,
    pub rank: u8,
    pub amount: u64,
}

#[derive(BorshSerialize)]
pub struct SeasonRolledOver {
    pub from: u32,
    pub to: u32,
    pub amount: u64,
}

#[derive(BorshSerialize)]
pub struct ArenaSwept {
    pub arena_id: u16,
    pub amount: u64,
}

pub trait Event: BorshSerialize {
    const DISCRIMINATOR: [u8; 8];
}

/// Emit the same single base64 data field as Anchor `emit!`.
pub fn emit<T: Event>(event: &T) -> Result<()> {
    let mut data = Vec::with_capacity(128);
    data.extend_from_slice(&T::DISCRIMINATOR);
    event
        .serialize(&mut data)
        .map_err(|_| ProgramError::Custom(3004))?;
    let fields: [&[u8]; 1] = [&data];
    #[cfg(target_os = "solana")]
    // SAFETY: the live slice descriptors and their data remain valid for this synchronous syscall.
    unsafe {
        solana_msg::syscalls::sol_log_data(fields.as_ptr().cast(), fields.len() as u64);
    }
    #[cfg(not(target_os = "solana"))]
    solana_sysvar::program_stubs::sol_log_data(&fields);
    Ok(())
}

impl Event for ArenaJoined {
    const DISCRIMINATOR: [u8; 8] = [195, 38, 154, 241, 247, 142, 31, 5];
}

impl Event for ArenaSwept {
    const DISCRIMINATOR: [u8; 8] = [132, 32, 57, 60, 149, 87, 201, 80];
}

impl Event for GameRecorded {
    const DISCRIMINATOR: [u8; 8] = [148, 119, 18, 172, 198, 62, 150, 145];
}

impl Event for PlayerRegistered {
    const DISCRIMINATOR: [u8; 8] = [175, 78, 252, 170, 75, 230, 36, 251];
}

impl Event for ProfileUpdated {
    const DISCRIMINATOR: [u8; 8] = [186, 248, 62, 98, 112, 98, 161, 252];
}

impl Event for RewardClaimed {
    const DISCRIMINATOR: [u8; 8] = [49, 28, 87, 84, 158, 48, 229, 175];
}

impl Event for SeasonEnded {
    const DISCRIMINATOR: [u8; 8] = [231, 210, 35, 6, 231, 92, 111, 69];
}

impl Event for SeasonFunded {
    const DISCRIMINATOR: [u8; 8] = [86, 2, 211, 175, 10, 250, 20, 35];
}

impl Event for SeasonRolledOver {
    const DISCRIMINATOR: [u8; 8] = [70, 173, 38, 206, 53, 30, 122, 83];
}

impl Event for SessionRefunded {
    const DISCRIMINATOR: [u8; 8] = [176, 138, 119, 46, 99, 172, 75, 152];
}

impl Event for SessionSettled {
    const DISCRIMINATOR: [u8; 8] = [127, 161, 59, 136, 23, 168, 191, 149];
}

impl Event for SkinPurchased {
    const DISCRIMINATOR: [u8; 8] = [120, 227, 216, 6, 255, 113, 22, 85];
}
