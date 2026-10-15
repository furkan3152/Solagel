//! Account layouts: the exact Borsh encoding of the reference `#[account]` structs
//! (`programs/slana-ref/src/state.rs`): 8-byte Anchor discriminator, then every field in
//! declaration order, little endian, `bool` as one byte, arrays inline. No struct of the
//! reference holds an `Option`, `String` or `Vec`, so every field sits at a fixed offset.
//!
//! Each module gives `DISCRIMINATOR`, the field offsets and `SPACE` (= `8 + INIT_SPACE` of the
//! reference, the size the reference allocates). Fields are read and written in place with
//! `crate::borsh::{rd_*, wr_*}` on the array `accounts::load` returns.
//!
//! The unit tests check every offset against the reference's own serialization.

/// `Config`, PDA `["config"]`.
pub mod config {
    pub const DISCRIMINATOR: [u8; 8] = [155, 12, 170, 224, 30, 250, 204, 130];
    pub const ADMIN: usize = 8;
    pub const SERVER_AUTHORITY: usize = ADMIN + 32;
    pub const TOKEN_MINT: usize = SERVER_AUTHORITY + 32;
    pub const TOKEN_PROGRAM: usize = TOKEN_MINT + 32;
    pub const TOKEN_DECIMALS: usize = TOKEN_PROGRAM + 32;
    pub const FEE_BPS: usize = TOKEN_DECIMALS + 1;
    pub const PASS_FEE_BPS: usize = FEE_BPS + 2;
    pub const TREASURY_BPS: usize = PASS_FEE_BPS + 2;
    pub const SEASON_BPS: usize = TREASURY_BPS + 2;
    pub const BURN_BPS: usize = SEASON_BPS + 2;
    pub const SETTLE_FEE_LAMPORTS: usize = BURN_BPS + 2;
    pub const CURRENT_SEASON: usize = SETTLE_FEE_LAMPORTS + 8;
    pub const PAUSED: usize = CURRENT_SEASON + 4;
    pub const PASS_COLLECTION: usize = PAUSED + 1;
    pub const PASS_BASE_URI: usize = PASS_COLLECTION + 32;
    pub const PASS_BASE_URI_LEN: usize = PASS_BASE_URI + crate::constants::BASE_URI_BYTES;
    pub const PASS_SUPPLY: usize = PASS_BASE_URI_LEN + 1;
    pub const PASS_MINTED: usize = PASS_SUPPLY + 4;
    pub const PASS_PER_WALLET: usize = PASS_MINTED + 4;
    pub const PASS_MIN_TOKENS: usize = PASS_PER_WALLET + 1;
    pub const PASS_MINT_OPEN: usize = PASS_MIN_TOKENS + 8;
    pub const PASS_MINT_START_TS: usize = PASS_MINT_OPEN + 1;
    pub const PASS_MINT_OPENED: usize = PASS_MINT_START_TS + 8;
    pub const PASS_MINT_ENDED: usize = PASS_MINT_OPENED + 1;
    pub const PASS_SEED_HASH: usize = PASS_MINT_ENDED + 1;
    pub const PASS_SEED: usize = PASS_SEED_HASH + 32;
    pub const PASS_REVEALED: usize = PASS_SEED + 32;
    pub const PASS_SEED_REVEALED: usize = PASS_REVEALED + 1;
    pub const PASS_ENTROPY_TARGET_SLOT: usize = PASS_SEED_REVEALED + 1;
    pub const PASS_ENTROPY_CAPTURED: usize = PASS_ENTROPY_TARGET_SLOT + 8;
    pub const PASS_ENTROPY: usize = PASS_ENTROPY_CAPTURED + 1;
    pub const PASS_ENTROPY_SLOT: usize = PASS_ENTROPY + 32;
    pub const PASS_FINAL_SEED: usize = PASS_ENTROPY_SLOT + 8;
    pub const BUMP: usize = PASS_FINAL_SEED + 32;
    pub const TREASURY_VAULT_BUMP: usize = BUMP + 1;
    pub const SEASON_VAULT_BUMP: usize = TREASURY_VAULT_BUMP + 1;
    pub const TOTAL_PLAYERS: usize = SEASON_VAULT_BUMP + 1;
    pub const TOTAL_GAMES: usize = TOTAL_PLAYERS + 8;
    pub const TOTAL_SESSIONS: usize = TOTAL_GAMES + 8;
    pub const TOTAL_STAKED: usize = TOTAL_SESSIONS + 8;
    pub const TOTAL_PAID_OUT: usize = TOTAL_STAKED + 8;
    pub const SPACE: usize = TOTAL_PAID_OUT + 8;
}

/// `PlayerProfile`, PDA `["profile", owner]`.
pub mod profile {
    pub const DISCRIMINATOR: [u8; 8] = [82, 226, 99, 87, 164, 130, 181, 80];
    pub const OWNER: usize = 8;
    pub const NAME: usize = OWNER + 32;
    pub const NAME_LEN: usize = NAME + crate::constants::NAME_BYTES;
    pub const SKIN: usize = NAME_LEN + 1;
    pub const XP: usize = SKIN + 1;
    pub const GAMES_PLAYED: usize = XP + 8;
    pub const KILLS: usize = GAMES_PLAYED + 4;
    pub const BEST_SCORE: usize = KILLS + 4;
    pub const TOTAL_SCORE: usize = BEST_SCORE + 4;
    pub const SEASON: usize = TOTAL_SCORE + 8;
    pub const SEASON_POINTS: usize = SEASON + 4;
    pub const STAKE_GAMES: usize = SEASON_POINTS + 8;
    pub const TOTAL_STAKED: usize = STAKE_GAMES + 4;
    pub const TOTAL_WON: usize = TOTAL_STAKED + 8;
    pub const CREATED_AT: usize = TOTAL_WON + 8;
    pub const LAST_PLAYED: usize = CREATED_AT + 8;
    pub const BUMP: usize = LAST_PLAYED + 8;
    pub const SPACE: usize = BUMP + 1;
}

/// `Arena`, PDA `["arena", id.to_le_bytes()]`.
pub mod arena {
    pub const DISCRIMINATOR: [u8; 8] = [243, 215, 44, 44, 231, 211, 232, 168];
    pub const ID: usize = 8;
    pub const ENTRY_FEE: usize = ID + 2;
    pub const REQUIRES_PASS: usize = ENTRY_FEE + 8;
    pub const MAX_SESSIONS: usize = REQUIRES_PASS + 1;
    pub const OPEN_SESSIONS: usize = MAX_SESSIONS + 2;
    pub const ENABLED: usize = OPEN_SESSIONS + 2;
    pub const VAULT: usize = ENABLED + 1;
    pub const VAULT_BUMP: usize = VAULT + 32;
    pub const TOTAL_DEPOSITED: usize = VAULT_BUMP + 1;
    pub const TOTAL_PAID_OUT: usize = TOTAL_DEPOSITED + 8;
    pub const BUMP: usize = TOTAL_PAID_OUT + 8;
    pub const SPACE: usize = BUMP + 1;
}

/// `Session`, PDA `["session", arena, player]`.
pub mod session {
    pub const DISCRIMINATOR: [u8; 8] = [243, 81, 72, 115, 214, 188, 72, 144];
    pub const ID: usize = 8;
    pub const PLAYER: usize = ID + 8;
    pub const ARENA: usize = PLAYER + 32;
    pub const ARENA_ID: usize = ARENA + 32;
    pub const ENTRY_FEE: usize = ARENA_ID + 2;
    pub const OPENED_AT: usize = ENTRY_FEE + 8;
    pub const HAS_PASS: usize = OPENED_AT + 8;
    pub const PASS_ASSET: usize = HAS_PASS + 1;
    pub const SETTLE_FEE: usize = PASS_ASSET + 32;
    pub const FEE_BPS: usize = SETTLE_FEE + 8;
    pub const BUMP: usize = FEE_BPS + 2;
    pub const FINALIZED: usize = BUMP + 1;
    pub const OWED: usize = FINALIZED + 1;
    pub const SPACE: usize = OWED + 8;
}

/// `PassLock`, PDA `["pass_lock", asset]`.
pub mod pass_lock {
    pub const DISCRIMINATOR: [u8; 8] = [111, 167, 37, 191, 114, 227, 253, 159];
    pub const SESSION: usize = 8;
    pub const PLAYER: usize = SESSION + 32;
    pub const BUMP: usize = PLAYER + 32;
    pub const SPACE: usize = BUMP + 1;
}

/// `LeaderEntry` (not an account): one row of `Season::entries`, offsets relative to the row.
pub mod leader_entry {
    pub const PLAYER: usize = 0;
    pub const POINTS: usize = PLAYER + 32;
    pub const BEST_SCORE: usize = POINTS + 8;
    pub const NAME: usize = BEST_SCORE + 4;
    pub const NAME_LEN: usize = NAME + crate::constants::NAME_BYTES;
    pub const SKIN: usize = NAME_LEN + 1;
    pub const LEN: usize = SKIN + 1;
}

/// `Season`, PDA `["season", id.to_le_bytes()]`.
pub mod season {
    pub const DISCRIMINATOR: [u8; 8] = [76, 67, 93, 156, 180, 157, 248, 47];
    pub const ID: usize = 8;
    pub const STARTED_AT: usize = ID + 4;
    pub const ENDED_AT: usize = STARTED_AT + 8;
    pub const FINALIZED: usize = ENDED_AT + 8;
    pub const PRIZE_POOL: usize = FINALIZED + 1;
    pub const POOL: usize = PRIZE_POOL + 8;
    pub const CLAIMED_MASK: usize = POOL + 8;
    pub const COUNT: usize = CLAIMED_MASK + 2;
    pub const BUMP: usize = COUNT + 1;
    /// `entries[i]` starts at `ENTRIES + i * leader_entry::LEN`.
    pub const ENTRIES: usize = BUMP + 1;
    pub const SPACE: usize = ENTRIES + crate::constants::LEADERBOARD_LEN * super::leader_entry::LEN;
}

/// `MintCounter`, PDA `["pass_minted", minter]`.
pub mod mint_counter {
    pub const DISCRIMINATOR: [u8; 8] = [29, 59, 15, 69, 46, 22, 227, 173];
    pub const COUNT: usize = 8;
    pub const BUMP: usize = COUNT + 1;
    pub const SPACE: usize = BUMP + 1;
}

#[cfg(test)]
mod tests {
    //! Golden layout tests against the reference's own Borsh serialization: every field gets
    //! a distinct value, the reference serializes the struct, and
    //! * the lean readers read each value back at the lean offset (reference → lean), and
    //! * the lean writers, starting from zeroed `SPACE` bytes, rebuild exactly the reference
    //!   bytes, which the reference then deserializes into the same struct (lean → reference).
    //!
    //! The Config, Season and Arena accounts are also created and decoded through the real
    //! programs in `programs/slana-ref/tests/layout.rs`.

    use {
        super::*,
        crate::borsh::*,
        anchor_lang::{
            prelude::Pubkey, AccountDeserialize, AccountSerialize, Discriminator, Space,
        },
        slana::state as r,
    };

    fn key(n: u8) -> Pubkey {
        Pubkey::new_from_array([n; 32])
    }

    fn ser<T: AccountSerialize>(value: &T) -> Vec<u8> {
        let mut out = Vec::new();
        value.try_serialize(&mut out).unwrap();
        out
    }

    fn de<T: AccountDeserialize>(bytes: &[u8]) -> T {
        T::try_deserialize(&mut &bytes[..]).unwrap()
    }

    fn sample_config() -> r::Config {
        let mut uri = [0u8; 96];
        uri.iter_mut()
            .enumerate()
            .for_each(|(i, b)| *b = i as u8 + 1);
        r::Config {
            admin: key(1),
            server_authority: key(2),
            token_mint: key(3),
            token_program: key(4),
            token_decimals: 5,
            fee_bps: 0x0106,
            pass_fee_bps: 0x0107,
            treasury_bps: 0x0108,
            season_bps: 0x0109,
            burn_bps: 0x010a,
            settle_fee_lamports: 0x0102_0304_0506_070b,
            current_season: 0x0102_030c,
            paused: true,
            pass_collection: key(13),
            pass_base_uri: uri,
            pass_base_uri_len: 14,
            pass_supply: 0x0102_030f,
            pass_minted: 0x0102_0310,
            pass_per_wallet: 17,
            pass_min_tokens: 0x0102_0304_0506_0712,
            pass_mint_open: true,
            pass_mint_start_ts: -0x0102_0304_0506_0713,
            pass_mint_opened: true,
            pass_mint_ended: true,
            pass_seed_hash: [20; 32],
            pass_seed: [21; 32],
            pass_revealed: true,
            pass_seed_revealed: true,
            pass_entropy_target_slot: 0x0102_0304_0506_0716,
            pass_entropy_captured: true,
            pass_entropy: [23; 32],
            pass_entropy_slot: 0x0102_0304_0506_0718,
            pass_final_seed: [25; 32],
            bump: 26,
            treasury_vault_bump: 27,
            season_vault_bump: 28,
            total_players: 0x0102_0304_0506_071d,
            total_games: 0x0102_0304_0506_071e,
            total_sessions: 0x0102_0304_0506_071f,
            total_staked: 0x0102_0304_0506_0720,
            total_paid_out: 0x0102_0304_0506_0721,
        }
    }

    #[test]
    fn config_layout() {
        use config::*;
        assert_eq!(DISCRIMINATOR, r::Config::DISCRIMINATOR);
        assert_eq!(SPACE, 8 + r::Config::INIT_SPACE);
        let c = sample_config();
        let bytes = ser(&c);
        assert_eq!(bytes.len(), SPACE);
        let d = &bytes[..];

        // reference → lean
        assert_eq!(rd_key(d, ADMIN), c.admin.to_bytes());
        assert_eq!(rd_key(d, SERVER_AUTHORITY), c.server_authority.to_bytes());
        assert_eq!(rd_key(d, TOKEN_MINT), c.token_mint.to_bytes());
        assert_eq!(rd_key(d, TOKEN_PROGRAM), c.token_program.to_bytes());
        assert_eq!(rd_u8(d, TOKEN_DECIMALS), c.token_decimals);
        assert_eq!(rd_u16(d, FEE_BPS), c.fee_bps);
        assert_eq!(rd_u16(d, PASS_FEE_BPS), c.pass_fee_bps);
        assert_eq!(rd_u16(d, TREASURY_BPS), c.treasury_bps);
        assert_eq!(rd_u16(d, SEASON_BPS), c.season_bps);
        assert_eq!(rd_u16(d, BURN_BPS), c.burn_bps);
        assert_eq!(rd_u64(d, SETTLE_FEE_LAMPORTS), c.settle_fee_lamports);
        assert_eq!(rd_u32(d, CURRENT_SEASON), c.current_season);
        assert_eq!(rd_bool(d, PAUSED), c.paused);
        assert_eq!(rd_key(d, PASS_COLLECTION), c.pass_collection.to_bytes());
        assert_eq!(&d[PASS_BASE_URI..PASS_BASE_URI + 96], &c.pass_base_uri);
        assert_eq!(rd_u8(d, PASS_BASE_URI_LEN), c.pass_base_uri_len);
        assert_eq!(rd_u32(d, PASS_SUPPLY), c.pass_supply);
        assert_eq!(rd_u32(d, PASS_MINTED), c.pass_minted);
        assert_eq!(rd_u8(d, PASS_PER_WALLET), c.pass_per_wallet);
        assert_eq!(rd_u64(d, PASS_MIN_TOKENS), c.pass_min_tokens);
        assert_eq!(rd_bool(d, PASS_MINT_OPEN), c.pass_mint_open);
        assert_eq!(rd_i64(d, PASS_MINT_START_TS), c.pass_mint_start_ts);
        assert_eq!(rd_bool(d, PASS_MINT_OPENED), c.pass_mint_opened);
        assert_eq!(rd_bool(d, PASS_MINT_ENDED), c.pass_mint_ended);
        assert_eq!(rd_key(d, PASS_SEED_HASH), c.pass_seed_hash);
        assert_eq!(rd_key(d, PASS_SEED), c.pass_seed);
        assert_eq!(rd_bool(d, PASS_REVEALED), c.pass_revealed);
        assert_eq!(rd_bool(d, PASS_SEED_REVEALED), c.pass_seed_revealed);
        assert_eq!(
            rd_u64(d, PASS_ENTROPY_TARGET_SLOT),
            c.pass_entropy_target_slot
        );
        assert_eq!(rd_bool(d, PASS_ENTROPY_CAPTURED), c.pass_entropy_captured);
        assert_eq!(rd_key(d, PASS_ENTROPY), c.pass_entropy);
        assert_eq!(rd_u64(d, PASS_ENTROPY_SLOT), c.pass_entropy_slot);
        assert_eq!(rd_key(d, PASS_FINAL_SEED), c.pass_final_seed);
        assert_eq!(rd_u8(d, BUMP), c.bump);
        assert_eq!(rd_u8(d, TREASURY_VAULT_BUMP), c.treasury_vault_bump);
        assert_eq!(rd_u8(d, SEASON_VAULT_BUMP), c.season_vault_bump);
        assert_eq!(rd_u64(d, TOTAL_PLAYERS), c.total_players);
        assert_eq!(rd_u64(d, TOTAL_GAMES), c.total_games);
        assert_eq!(rd_u64(d, TOTAL_SESSIONS), c.total_sessions);
        assert_eq!(rd_u64(d, TOTAL_STAKED), c.total_staked);
        assert_eq!(rd_u64(d, TOTAL_PAID_OUT), c.total_paid_out);

        // lean → reference
        let mut w = vec![0u8; SPACE];
        let o = &mut w[..];
        wr_bytes(o, 0, &DISCRIMINATOR);
        wr_bytes(o, ADMIN, c.admin.as_ref());
        wr_bytes(o, SERVER_AUTHORITY, c.server_authority.as_ref());
        wr_bytes(o, TOKEN_MINT, c.token_mint.as_ref());
        wr_bytes(o, TOKEN_PROGRAM, c.token_program.as_ref());
        wr_u8(o, TOKEN_DECIMALS, c.token_decimals);
        wr_u16(o, FEE_BPS, c.fee_bps);
        wr_u16(o, PASS_FEE_BPS, c.pass_fee_bps);
        wr_u16(o, TREASURY_BPS, c.treasury_bps);
        wr_u16(o, SEASON_BPS, c.season_bps);
        wr_u16(o, BURN_BPS, c.burn_bps);
        wr_u64(o, SETTLE_FEE_LAMPORTS, c.settle_fee_lamports);
        wr_u32(o, CURRENT_SEASON, c.current_season);
        wr_bool(o, PAUSED, c.paused);
        wr_bytes(o, PASS_COLLECTION, c.pass_collection.as_ref());
        wr_bytes(o, PASS_BASE_URI, &c.pass_base_uri);
        wr_u8(o, PASS_BASE_URI_LEN, c.pass_base_uri_len);
        wr_u32(o, PASS_SUPPLY, c.pass_supply);
        wr_u32(o, PASS_MINTED, c.pass_minted);
        wr_u8(o, PASS_PER_WALLET, c.pass_per_wallet);
        wr_u64(o, PASS_MIN_TOKENS, c.pass_min_tokens);
        wr_bool(o, PASS_MINT_OPEN, c.pass_mint_open);
        wr_i64(o, PASS_MINT_START_TS, c.pass_mint_start_ts);
        wr_bool(o, PASS_MINT_OPENED, c.pass_mint_opened);
        wr_bool(o, PASS_MINT_ENDED, c.pass_mint_ended);
        wr_bytes(o, PASS_SEED_HASH, &c.pass_seed_hash);
        wr_bytes(o, PASS_SEED, &c.pass_seed);
        wr_bool(o, PASS_REVEALED, c.pass_revealed);
        wr_bool(o, PASS_SEED_REVEALED, c.pass_seed_revealed);
        wr_u64(o, PASS_ENTROPY_TARGET_SLOT, c.pass_entropy_target_slot);
        wr_bool(o, PASS_ENTROPY_CAPTURED, c.pass_entropy_captured);
        wr_bytes(o, PASS_ENTROPY, &c.pass_entropy);
        wr_u64(o, PASS_ENTROPY_SLOT, c.pass_entropy_slot);
        wr_bytes(o, PASS_FINAL_SEED, &c.pass_final_seed);
        wr_u8(o, BUMP, c.bump);
        wr_u8(o, TREASURY_VAULT_BUMP, c.treasury_vault_bump);
        wr_u8(o, SEASON_VAULT_BUMP, c.season_vault_bump);
        wr_u64(o, TOTAL_PLAYERS, c.total_players);
        wr_u64(o, TOTAL_GAMES, c.total_games);
        wr_u64(o, TOTAL_SESSIONS, c.total_sessions);
        wr_u64(o, TOTAL_STAKED, c.total_staked);
        wr_u64(o, TOTAL_PAID_OUT, c.total_paid_out);
        assert_eq!(w, bytes);
        let back: r::Config = de(&w);
        assert_eq!(ser(&back), bytes);
    }

    #[test]
    fn profile_layout() {
        use profile::*;
        assert_eq!(DISCRIMINATOR, r::PlayerProfile::DISCRIMINATOR);
        assert_eq!(SPACE, 8 + r::PlayerProfile::INIT_SPACE);
        let p = r::PlayerProfile {
            owner: key(1),
            name: [2; 16],
            name_len: 3,
            skin: 4,
            xp: 0x0102_0304_0506_0705,
            games_played: 0x0102_0306,
            kills: 0x0102_0307,
            best_score: 0x0102_0308,
            total_score: 0x0102_0304_0506_0709,
            season: 0x0102_030a,
            season_points: 0x0102_0304_0506_070b,
            stake_games: 0x0102_030c,
            total_staked: 0x0102_0304_0506_070d,
            total_won: 0x0102_0304_0506_070e,
            created_at: -0x0102_0304_0506_070f,
            last_played: 0x0102_0304_0506_0710,
            bump: 17,
        };
        let bytes = ser(&p);
        assert_eq!(bytes.len(), SPACE);
        let d = &bytes[..];
        assert_eq!(rd_key(d, OWNER), p.owner.to_bytes());
        assert_eq!(&d[NAME..NAME + 16], &p.name);
        assert_eq!(rd_u8(d, NAME_LEN), p.name_len);
        assert_eq!(rd_u8(d, SKIN), p.skin);
        assert_eq!(rd_u64(d, XP), p.xp);
        assert_eq!(rd_u32(d, GAMES_PLAYED), p.games_played);
        assert_eq!(rd_u32(d, KILLS), p.kills);
        assert_eq!(rd_u32(d, BEST_SCORE), p.best_score);
        assert_eq!(rd_u64(d, TOTAL_SCORE), p.total_score);
        assert_eq!(rd_u32(d, SEASON), p.season);
        assert_eq!(rd_u64(d, SEASON_POINTS), p.season_points);
        assert_eq!(rd_u32(d, STAKE_GAMES), p.stake_games);
        assert_eq!(rd_u64(d, TOTAL_STAKED), p.total_staked);
        assert_eq!(rd_u64(d, TOTAL_WON), p.total_won);
        assert_eq!(rd_i64(d, CREATED_AT), p.created_at);
        assert_eq!(rd_i64(d, LAST_PLAYED), p.last_played);
        assert_eq!(rd_u8(d, BUMP), p.bump);

        let mut w = vec![0u8; SPACE];
        let o = &mut w[..];
        wr_bytes(o, 0, &DISCRIMINATOR);
        wr_bytes(o, OWNER, p.owner.as_ref());
        wr_bytes(o, NAME, &p.name);
        wr_u8(o, NAME_LEN, p.name_len);
        wr_u8(o, SKIN, p.skin);
        wr_u64(o, XP, p.xp);
        wr_u32(o, GAMES_PLAYED, p.games_played);
        wr_u32(o, KILLS, p.kills);
        wr_u32(o, BEST_SCORE, p.best_score);
        wr_u64(o, TOTAL_SCORE, p.total_score);
        wr_u32(o, SEASON, p.season);
        wr_u64(o, SEASON_POINTS, p.season_points);
        wr_u32(o, STAKE_GAMES, p.stake_games);
        wr_u64(o, TOTAL_STAKED, p.total_staked);
        wr_u64(o, TOTAL_WON, p.total_won);
        wr_i64(o, CREATED_AT, p.created_at);
        wr_i64(o, LAST_PLAYED, p.last_played);
        wr_u8(o, BUMP, p.bump);
        assert_eq!(w, bytes);
        let back: r::PlayerProfile = de(&w);
        assert_eq!(ser(&back), bytes);
    }

    #[test]
    fn arena_layout() {
        use arena::*;
        assert_eq!(DISCRIMINATOR, r::Arena::DISCRIMINATOR);
        assert_eq!(SPACE, 8 + r::Arena::INIT_SPACE);
        let a = r::Arena {
            id: 0x0101,
            entry_fee: 0x0102_0304_0506_0702,
            requires_pass: true,
            max_sessions: 0x0103,
            open_sessions: 0x0104,
            enabled: true,
            vault: key(5),
            vault_bump: 6,
            total_deposited: 0x0102_0304_0506_0707,
            total_paid_out: 0x0102_0304_0506_0708,
            bump: 9,
        };
        let bytes = ser(&a);
        assert_eq!(bytes.len(), SPACE);
        let d = &bytes[..];
        assert_eq!(rd_u16(d, ID), a.id);
        assert_eq!(rd_u64(d, ENTRY_FEE), a.entry_fee);
        assert_eq!(rd_bool(d, REQUIRES_PASS), a.requires_pass);
        assert_eq!(rd_u16(d, MAX_SESSIONS), a.max_sessions);
        assert_eq!(rd_u16(d, OPEN_SESSIONS), a.open_sessions);
        assert_eq!(rd_bool(d, ENABLED), a.enabled);
        assert_eq!(rd_key(d, VAULT), a.vault.to_bytes());
        assert_eq!(rd_u8(d, VAULT_BUMP), a.vault_bump);
        assert_eq!(rd_u64(d, TOTAL_DEPOSITED), a.total_deposited);
        assert_eq!(rd_u64(d, TOTAL_PAID_OUT), a.total_paid_out);
        assert_eq!(rd_u8(d, BUMP), a.bump);

        let mut w = vec![0u8; SPACE];
        let o = &mut w[..];
        wr_bytes(o, 0, &DISCRIMINATOR);
        wr_u16(o, ID, a.id);
        wr_u64(o, ENTRY_FEE, a.entry_fee);
        wr_bool(o, REQUIRES_PASS, a.requires_pass);
        wr_u16(o, MAX_SESSIONS, a.max_sessions);
        wr_u16(o, OPEN_SESSIONS, a.open_sessions);
        wr_bool(o, ENABLED, a.enabled);
        wr_bytes(o, VAULT, a.vault.as_ref());
        wr_u8(o, VAULT_BUMP, a.vault_bump);
        wr_u64(o, TOTAL_DEPOSITED, a.total_deposited);
        wr_u64(o, TOTAL_PAID_OUT, a.total_paid_out);
        wr_u8(o, BUMP, a.bump);
        assert_eq!(w, bytes);
        let back: r::Arena = de(&w);
        assert_eq!(ser(&back), bytes);
    }

    #[test]
    fn session_layout() {
        use session::*;
        assert_eq!(DISCRIMINATOR, r::Session::DISCRIMINATOR);
        assert_eq!(SPACE, 8 + r::Session::INIT_SPACE);
        let s = r::Session {
            id: 0x0102_0304_0506_0701,
            player: key(2),
            arena: key(3),
            arena_id: 0x0104,
            entry_fee: 0x0102_0304_0506_0705,
            opened_at: -0x0102_0304_0506_0706,
            has_pass: true,
            pass_asset: key(8),
            settle_fee: 0x0102_0304_0506_0709,
            fee_bps: 0x010a,
            bump: 11,
            finalized: true,
            owed: 0x0102_0304_0506_070d,
        };
        let bytes = ser(&s);
        assert_eq!(bytes.len(), SPACE);
        let d = &bytes[..];
        assert_eq!(rd_u64(d, ID), s.id);
        assert_eq!(rd_key(d, PLAYER), s.player.to_bytes());
        assert_eq!(rd_key(d, ARENA), s.arena.to_bytes());
        assert_eq!(rd_u16(d, ARENA_ID), s.arena_id);
        assert_eq!(rd_u64(d, ENTRY_FEE), s.entry_fee);
        assert_eq!(rd_i64(d, OPENED_AT), s.opened_at);
        assert_eq!(rd_bool(d, HAS_PASS), s.has_pass);
        assert_eq!(rd_key(d, PASS_ASSET), s.pass_asset.to_bytes());
        assert_eq!(rd_u64(d, SETTLE_FEE), s.settle_fee);
        assert_eq!(rd_u16(d, FEE_BPS), s.fee_bps);
        assert_eq!(rd_u8(d, BUMP), s.bump);
        assert_eq!(rd_bool(d, FINALIZED), s.finalized);
        assert_eq!(rd_u64(d, OWED), s.owed);

        let mut w = vec![0u8; SPACE];
        let o = &mut w[..];
        wr_bytes(o, 0, &DISCRIMINATOR);
        wr_u64(o, ID, s.id);
        wr_bytes(o, PLAYER, s.player.as_ref());
        wr_bytes(o, ARENA, s.arena.as_ref());
        wr_u16(o, ARENA_ID, s.arena_id);
        wr_u64(o, ENTRY_FEE, s.entry_fee);
        wr_i64(o, OPENED_AT, s.opened_at);
        wr_bool(o, HAS_PASS, s.has_pass);
        wr_bytes(o, PASS_ASSET, s.pass_asset.as_ref());
        wr_u64(o, SETTLE_FEE, s.settle_fee);
        wr_u16(o, FEE_BPS, s.fee_bps);
        wr_u8(o, BUMP, s.bump);
        wr_bool(o, FINALIZED, s.finalized);
        wr_u64(o, OWED, s.owed);
        assert_eq!(w, bytes);
        let back: r::Session = de(&w);
        assert_eq!(ser(&back), bytes);
    }

    #[test]
    fn pass_lock_layout() {
        use pass_lock::*;
        assert_eq!(DISCRIMINATOR, r::PassLock::DISCRIMINATOR);
        assert_eq!(SPACE, 8 + r::PassLock::INIT_SPACE);
        let l = r::PassLock {
            session: key(1),
            player: key(2),
            bump: 3,
        };
        let bytes = ser(&l);
        assert_eq!(bytes.len(), SPACE);
        let d = &bytes[..];
        assert_eq!(rd_key(d, SESSION), l.session.to_bytes());
        assert_eq!(rd_key(d, PLAYER), l.player.to_bytes());
        assert_eq!(rd_u8(d, BUMP), l.bump);

        let mut w = vec![0u8; SPACE];
        let o = &mut w[..];
        wr_bytes(o, 0, &DISCRIMINATOR);
        wr_bytes(o, SESSION, l.session.as_ref());
        wr_bytes(o, PLAYER, l.player.as_ref());
        wr_u8(o, BUMP, l.bump);
        assert_eq!(w, bytes);
        let back: r::PassLock = de(&w);
        assert_eq!(ser(&back), bytes);
    }

    #[test]
    fn season_layout() {
        use season::*;
        assert_eq!(DISCRIMINATOR, r::Season::DISCRIMINATOR);
        assert_eq!(SPACE, 8 + r::Season::INIT_SPACE);
        assert_eq!(leader_entry::LEN, r::LeaderEntry::INIT_SPACE);
        let mut entries = [r::LeaderEntry::default(); 20];
        for (i, e) in entries.iter_mut().enumerate() {
            let n = i as u8;
            *e = r::LeaderEntry {
                player: key(100 + n),
                points: 0x0102_0304_0506_0000 + u64::from(n),
                best_score: 0x0102_0300 + u32::from(n),
                name: [n; 16],
                name_len: n % 17,
                skin: 200 + n,
            };
        }
        let s = r::Season {
            id: 0x0102_0301,
            started_at: -0x0102_0304_0506_0702,
            ended_at: 0x0102_0304_0506_0703,
            finalized: true,
            prize_pool: 0x0102_0304_0506_0705,
            pool: 0x0102_0304_0506_0706,
            claimed_mask: 0x0107,
            count: 8,
            bump: 9,
            entries,
        };
        let bytes = ser(&s);
        assert_eq!(bytes.len(), SPACE);
        let d = &bytes[..];
        assert_eq!(rd_u32(d, ID), s.id);
        assert_eq!(rd_i64(d, STARTED_AT), s.started_at);
        assert_eq!(rd_i64(d, ENDED_AT), s.ended_at);
        assert_eq!(rd_bool(d, FINALIZED), s.finalized);
        assert_eq!(rd_u64(d, PRIZE_POOL), s.prize_pool);
        assert_eq!(rd_u64(d, POOL), s.pool);
        assert_eq!(rd_u16(d, CLAIMED_MASK), s.claimed_mask);
        assert_eq!(rd_u8(d, COUNT), s.count);
        assert_eq!(rd_u8(d, BUMP), s.bump);
        for (i, e) in s.entries.iter().enumerate() {
            let at = ENTRIES + i * leader_entry::LEN;
            assert_eq!(rd_key(d, at + leader_entry::PLAYER), e.player.to_bytes());
            assert_eq!(rd_u64(d, at + leader_entry::POINTS), e.points);
            assert_eq!(rd_u32(d, at + leader_entry::BEST_SCORE), e.best_score);
            assert_eq!(
                &d[at + leader_entry::NAME..at + leader_entry::NAME + 16],
                &e.name
            );
            assert_eq!(rd_u8(d, at + leader_entry::NAME_LEN), e.name_len);
            assert_eq!(rd_u8(d, at + leader_entry::SKIN), e.skin);
        }

        let mut w = vec![0u8; SPACE];
        let o = &mut w[..];
        wr_bytes(o, 0, &DISCRIMINATOR);
        wr_u32(o, ID, s.id);
        wr_i64(o, STARTED_AT, s.started_at);
        wr_i64(o, ENDED_AT, s.ended_at);
        wr_bool(o, FINALIZED, s.finalized);
        wr_u64(o, PRIZE_POOL, s.prize_pool);
        wr_u64(o, POOL, s.pool);
        wr_u16(o, CLAIMED_MASK, s.claimed_mask);
        wr_u8(o, COUNT, s.count);
        wr_u8(o, BUMP, s.bump);
        for (i, e) in s.entries.iter().enumerate() {
            let at = ENTRIES + i * leader_entry::LEN;
            wr_bytes(o, at + leader_entry::PLAYER, e.player.as_ref());
            wr_u64(o, at + leader_entry::POINTS, e.points);
            wr_u32(o, at + leader_entry::BEST_SCORE, e.best_score);
            wr_bytes(o, at + leader_entry::NAME, &e.name);
            wr_u8(o, at + leader_entry::NAME_LEN, e.name_len);
            wr_u8(o, at + leader_entry::SKIN, e.skin);
        }
        assert_eq!(w, bytes);
        let back: r::Season = de(&w);
        assert_eq!(ser(&back), bytes);
    }

    #[test]
    fn mint_counter_layout() {
        use mint_counter::*;
        assert_eq!(DISCRIMINATOR, r::MintCounter::DISCRIMINATOR);
        assert_eq!(SPACE, 8 + r::MintCounter::INIT_SPACE);
        let m = r::MintCounter { count: 1, bump: 2 };
        let bytes = ser(&m);
        assert_eq!(bytes.len(), SPACE);
        assert_eq!(rd_u8(&bytes, COUNT), m.count);
        assert_eq!(rd_u8(&bytes, BUMP), m.bump);
        let mut w = vec![0u8; SPACE];
        wr_bytes(&mut w, 0, &DISCRIMINATOR);
        wr_u8(&mut w, COUNT, m.count);
        wr_u8(&mut w, BUMP, m.bump);
        assert_eq!(w, bytes);
        let back: r::MintCounter = de(&w);
        assert_eq!(ser(&back), bytes);
    }

    /// The reference rejects a wrong discriminator; the lean `load` relies on the same bytes.
    #[test]
    fn discriminators_are_distinct() {
        let all = [
            config::DISCRIMINATOR,
            profile::DISCRIMINATOR,
            arena::DISCRIMINATOR,
            session::DISCRIMINATOR,
            pass_lock::DISCRIMINATOR,
            season::DISCRIMINATOR,
            mint_counter::DISCRIMINATOR,
        ];
        for (i, a) in all.iter().enumerate() {
            for b in &all[i + 1..] {
                assert_ne!(a, b);
            }
        }
    }
}
