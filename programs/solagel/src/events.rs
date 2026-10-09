use anchor_lang::prelude::*;

#[event]
pub struct PlayerRegistered {
    pub owner: Pubkey,
    pub name: String,
}

#[event]
pub struct ProfileUpdated {
    pub owner: Pubkey,
    pub skin: u8,
}

#[event]
pub struct SkinPurchased {
    pub owner: Pubkey,
    pub skin: u8,
    pub price: u64,
}

#[event]
pub struct ArenaJoined {
    pub player: Pubkey,
    pub arena_id: u16,
    pub session_id: u64,
    pub buy_in: u64,
}

#[event]
pub struct SessionSettled {
    pub player: Pubkey,
    pub arena_id: u16,
    pub session_id: u64,
    pub payout: u64,
    pub fee: u64,
    pub score: u32,
    pub kills: u16,
}

#[event]
pub struct GameRecorded {
    pub player: Pubkey,
    pub score: u32,
    pub kills: u16,
    pub xp: u32,
}

#[event]
pub struct SessionRefunded {
    pub player: Pubkey,
    pub arena_id: u16,
    pub amount: u64,
}

#[event]
pub struct SeasonFunded {
    pub season_id: u32,
    pub funder: Pubkey,
    pub amount: u64,
}

#[event]
pub struct SeasonEnded {
    pub season_id: u32,
    pub prize_pool: u64,
}

#[event]
pub struct RewardClaimed {
    pub season_id: u32,
    pub player: Pubkey,
    pub rank: u8,
    pub amount: u64,
}

#[event]
pub struct SeasonRolledOver {
    pub from: u32,
    pub to: u32,
    pub amount: u64,
}

#[event]
pub struct ArenaSwept {
    pub arena_id: u16,
    pub amount: u64,
}
