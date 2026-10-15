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
pub struct ArenaJoined {
    pub player: Pubkey,
    pub arena_id: u16,
    pub session_id: u64,
    pub entry_fee: u64,
    pub has_pass: bool,
}

#[event]
pub struct SessionSettled {
    pub player: Pubkey,
    pub arena_id: u16,
    pub session_id: u64,
    pub payout: u64,
    pub fee: u64,
    /// Part of `fee` that was burned.
    pub burned: u64,
    pub has_pass: bool,
    pub score: u32,
    pub kills: u16,
}

#[event]
pub struct SessionRefunded {
    pub player: Pubkey,
    pub arena_id: u16,
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
    pub season_id: u32,
    pub amount: u64,
}

#[event]
pub struct ArenaCreated {
    pub arena_id: u16,
    pub entry_fee: u64,
    pub max_sessions: u16,
    pub requires_pass: bool,
}

#[event]
pub struct TreasuryWithdrawn {
    pub destination: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PassCollectionSet {
    pub collection: Pubkey,
}

#[event]
pub struct PassMinted {
    pub minter: Pubkey,
    pub asset: Pubkey,
    /// 1-based Pass number (`Slana Pass #<number>`).
    pub number: u32,
}

/// The Pass mint ended for good (closed by the admin or sold out). The trait entropy will be
/// the hash of the first slot at or after `entropy_target_slot` (`capture_pass_entropy`).
#[event]
pub struct PassMintEnded {
    pub minted: u32,
    pub entropy_target_slot: u64,
}

/// `capture_pass_entropy` stored the trait entropy.
#[event]
pub struct PassEntropyCaptured {
    /// Slot whose hash is the entropy (the first slot with a block at or after the target).
    pub slot: u64,
    pub entropy: [u8; 32],
}

/// The target slot left the SlotHashes window before anyone captured it: a new future target.
#[event]
pub struct PassEntropyRetargeted {
    pub missed_target_slot: u64,
    pub entropy_target_slot: u64,
}

#[event]
pub struct PassRevealed {
    /// The admin's committed seed (`sha256(seed) == pass_seed_hash`).
    pub seed: [u8; 32],
    pub entropy: [u8; 32],
    /// `sha256(seed || entropy)`: the seed every Pass trait is derived from.
    pub final_seed: [u8; 32],
}
