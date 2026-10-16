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
}

#[event]
pub struct SessionSettled {
    pub player: Pubkey,
    pub arena_id: u16,
    pub session_id: u64,
    pub payout: u64,
    /// Fee on profit, paid to the fee wallet's token account.
    pub fee: u64,
    pub score: u32,
    pub kills: u16,
    /// Player share left in the vault for the player to collect (finalized without a token
    /// account); 0 when it was paid in the same transaction.
    pub owed: u64,
}

#[event]
pub struct SessionRefunded {
    pub player: Pubkey,
    pub arena_id: u16,
    pub amount: u64,
    /// The session was finalized: `amount` is its owed payout, not an entry-fee refund.
    pub finalized: bool,
}

/// `sweep_arena` moved `amount` from the arena vault to the fee wallet's token account.
#[event]
pub struct ArenaSwept {
    pub arena_id: u16,
    pub amount: u64,
}

/// `sweep_loot` burned `amount` from the arena vault.
#[event]
pub struct LootBurned {
    pub arena_id: u16,
    pub amount: u64,
}

#[event]
pub struct ArenaCreated {
    pub arena_id: u16,
    pub entry_fee: u64,
    pub max_sessions: u16,
}

/// `set_token_mint` stored the game token.
#[event]
pub struct TokenMintSet {
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub decimals: u8,
}
