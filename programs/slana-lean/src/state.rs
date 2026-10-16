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
    pub const FEE_WALLET: usize = SERVER_AUTHORITY + 32;
    pub const TOKEN_MINT: usize = FEE_WALLET + 32;
    pub const TOKEN_PROGRAM: usize = TOKEN_MINT + 32;
    pub const TOKEN_DECIMALS: usize = TOKEN_PROGRAM + 32;
    pub const FEE_BPS: usize = TOKEN_DECIMALS + 1;
    pub const SETTLE_FEE_LAMPORTS: usize = FEE_BPS + 2;
    pub const PAUSED: usize = SETTLE_FEE_LAMPORTS + 8;
    pub const BUMP: usize = PAUSED + 1;
    pub const TOTAL_PLAYERS: usize = BUMP + 1;
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
    pub const STAKE_GAMES: usize = TOTAL_SCORE + 8;
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
    pub const MAX_SESSIONS: usize = ENTRY_FEE + 8;
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
    pub const SETTLE_FEE: usize = OPENED_AT + 8;
    pub const FEE_BPS: usize = SETTLE_FEE + 8;
    pub const BUMP: usize = FEE_BPS + 2;
    pub const FINALIZED: usize = BUMP + 1;
    pub const OWED: usize = FINALIZED + 1;
    pub const SPACE: usize = OWED + 8;
}

#[cfg(test)]
mod tests {
    //! Golden layout tests against the reference's own Borsh serialization: every field gets
    //! a distinct value, the reference serializes the struct, and
    //! * the lean readers read each value back at the lean offset (reference → lean), and
    //! * the lean writers, starting from zeroed `SPACE` bytes, rebuild exactly the reference
    //!   bytes, which the reference then deserializes into the same struct (lean → reference).
    //!
    //! The Config and Arena accounts are also created and decoded through the real programs in
    //! `programs/slana-ref/tests/layout.rs`.

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

    #[test]
    fn config_layout() {
        use config::*;
        assert_eq!(DISCRIMINATOR, r::Config::DISCRIMINATOR);
        assert_eq!(SPACE, 8 + r::Config::INIT_SPACE);
        let c = r::Config {
            admin: key(1),
            server_authority: key(2),
            fee_wallet: key(3),
            token_mint: key(4),
            token_program: key(5),
            token_decimals: 6,
            fee_bps: 0x0107,
            settle_fee_lamports: 0x0102_0304_0506_0708,
            paused: true,
            bump: 9,
            total_players: 0x0102_0304_0506_070a,
            total_games: 0x0102_0304_0506_070b,
            total_sessions: 0x0102_0304_0506_070c,
            total_staked: 0x0102_0304_0506_070d,
            total_paid_out: 0x0102_0304_0506_070e,
        };
        let bytes = ser(&c);
        assert_eq!(bytes.len(), SPACE);
        let d = &bytes[..];

        // reference → lean
        assert_eq!(rd_key(d, ADMIN), c.admin.to_bytes());
        assert_eq!(rd_key(d, SERVER_AUTHORITY), c.server_authority.to_bytes());
        assert_eq!(rd_key(d, FEE_WALLET), c.fee_wallet.to_bytes());
        assert_eq!(rd_key(d, TOKEN_MINT), c.token_mint.to_bytes());
        assert_eq!(rd_key(d, TOKEN_PROGRAM), c.token_program.to_bytes());
        assert_eq!(rd_u8(d, TOKEN_DECIMALS), c.token_decimals);
        assert_eq!(rd_u16(d, FEE_BPS), c.fee_bps);
        assert_eq!(rd_u64(d, SETTLE_FEE_LAMPORTS), c.settle_fee_lamports);
        assert_eq!(rd_bool(d, PAUSED), c.paused);
        assert_eq!(rd_u8(d, BUMP), c.bump);
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
        wr_bytes(o, FEE_WALLET, c.fee_wallet.as_ref());
        wr_bytes(o, TOKEN_MINT, c.token_mint.as_ref());
        wr_bytes(o, TOKEN_PROGRAM, c.token_program.as_ref());
        wr_u8(o, TOKEN_DECIMALS, c.token_decimals);
        wr_u16(o, FEE_BPS, c.fee_bps);
        wr_u64(o, SETTLE_FEE_LAMPORTS, c.settle_fee_lamports);
        wr_bool(o, PAUSED, c.paused);
        wr_u8(o, BUMP, c.bump);
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
        assert_eq!(SPACE, 118);
        let s = r::Session {
            id: 0x0102_0304_0506_0701,
            player: key(2),
            arena: key(3),
            arena_id: 0x0104,
            entry_fee: 0x0102_0304_0506_0705,
            opened_at: -0x0102_0304_0506_0706,
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
        wr_u64(o, SETTLE_FEE, s.settle_fee);
        wr_u16(o, FEE_BPS, s.fee_bps);
        wr_u8(o, BUMP, s.bump);
        wr_bool(o, FINALIZED, s.finalized);
        wr_u64(o, OWED, s.owed);
        assert_eq!(w, bytes);
        let back: r::Session = de(&w);
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
        ];
        for (i, a) in all.iter().enumerate() {
            for b in &all[i + 1..] {
                assert_ne!(a, b);
            }
        }
    }
}
