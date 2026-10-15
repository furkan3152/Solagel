//! Pure game and money rules of the reference (`programs/slana-ref/src/logic.rs`), working on
//! the account bytes in place (the layouts of `state.rs`).
//!
//! Ported: `check_skin`, `validate_name`, `mul_bps`, `split_payout`, `apply_game`,
//! `leader_entry` + `upsert_leaderboard` (as [`upsert_leaderboard`]). The season-claim helpers
//! (`prize_amount`, `prize_rank`) and the entropy helpers come with their instructions. The
//! unit tests run the reference functions and these side by side.

use {
    crate::error::Result,
    crate::{
        borsh::{rd_arr, rd_key, rd_u32, rd_u64, rd_u8, wr_bytes, wr_i64, wr_u32, wr_u64, wr_u8},
        constants::{
            BASIC_SKINS, BPS, LEADERBOARD_LEN, MAX_SCORE_PER_GAME, MAX_XP_PER_GAME, NAME_BYTES,
        },
        error::{err, require, INVALID_NAME, INVALID_SKIN, MATH_OVERFLOW},
        instructions::update_config::has_control_char,
        state::{leader_entry as le, profile, season},
    },
};

// ----- skins & names ----------------------------------------------------------------------

/// `InvalidSkin` unless `skin < BASIC_SKINS`.
pub fn check_skin(skin: u8) -> Result {
    require(skin < BASIC_SKINS, INVALID_SKIN)
}

/// Reference `validate_name` for a name already decoded as UTF-8: 1..=16 bytes and no
/// control character, else `InvalidName`. Returns the length (the caller stores the bytes
/// zero padded).
pub fn validate_name(name: &[u8]) -> Result<u8> {
    require(
        !name.is_empty() && name.len() <= NAME_BYTES && !has_control_char(name),
        INVALID_NAME,
    )?;
    Ok(name.len() as u8)
}

/// Writes `name` (validated, ≤ 16 bytes) zero padded into the 16 bytes at `off`, and its
/// length at `off + 16` (the `name`/`name_len` pair of a profile).
pub fn write_name(d: &mut [u8], off: usize, name: &[u8], len: u8) {
    wr_bytes(d, off, &[0u8; NAME_BYTES]);
    wr_bytes(d, off, name);
    #[allow(clippy::arithmetic_side_effects)] // Bound: `off` is a constant field offset.
    wr_u8(d, off + NAME_BYTES, len);
}

// ----- money --------------------------------------------------------------------------------

/// `amount * bps / 10_000`, rounded down; `MathOverflow` when the result exceeds u64.
///
/// The reference computes it in u128; here `amount = q·10⁴ + r` gives the same value as
/// `q·bps + r·bps/10⁴` in u64 (no 128-bit runtime helpers). `q·bps` and the sum can only
/// overflow when the exact result does, which is exactly when the reference fails.
#[inline(never)]
pub fn mul_bps(amount: u64, bps: u16) -> Result<u64> {
    let bps = u64::from(bps);
    let base = u64::from(BPS);
    // Bound: `base` is a non-zero constant; `r < 10⁴` and `bps < 2¹⁶`, so `r·bps < 2³⁰`.
    #[allow(clippy::arithmetic_side_effects)]
    let (q, rest) = (amount / base, (amount % base) * bps / base);
    q.checked_mul(bps)
        .and_then(|v| v.checked_add(rest))
        .ok_or_else(|| err(MATH_OVERFLOW))
}

/// How a stake payout is split (base units of the game token).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct FeeSplit {
    pub fee: u64,
    pub treasury: u64,
    pub season: u64,
    pub burn: u64,
    pub player: u64,
}

/// Reference `split_payout`: `fee = (payout − entry_fee)⁺ · fee_bps`, treasury and burn are
/// their shares of the fee, the season gets the remainder, the player `payout − fee`; every
/// step checked (`MathOverflow`).
#[inline(never)]
pub fn split_payout(
    payout: u64,
    entry_fee: u64,
    fee_bps: u16,
    treasury_bps: u16,
    burn_bps: u16,
) -> Result<FeeSplit> {
    let fee = mul_bps(payout.saturating_sub(entry_fee), fee_bps)?;
    let treasury = mul_bps(fee, treasury_bps)?;
    let burn = mul_bps(fee, burn_bps)?;
    let season = fee
        .checked_sub(treasury)
        .and_then(|rest| rest.checked_sub(burn))
        .ok_or_else(|| err(MATH_OVERFLOW))?;
    let player = payout.checked_sub(fee).ok_or_else(|| err(MATH_OVERFLOW))?;
    Ok(FeeSplit {
        fee,
        treasury,
        season,
        burn,
        player,
    })
}

// ----- games & leaderboard ------------------------------------------------------------------

/// Reference `apply_game` on a profile: clamps score and XP, updates the stats (saturating),
/// resets stale season points and adds the score to them when `season_points`. Returns the
/// clamped score.
#[inline(never)]
pub fn apply_game(
    p: &mut [u8; profile::SPACE],
    current_season: u32,
    score: u32,
    kills: u16,
    xp: u32,
    now: i64,
    season_points: bool,
) -> u32 {
    let score = score.min(MAX_SCORE_PER_GAME);
    let xp = xp.min(MAX_XP_PER_GAME);
    let games = rd_u32(p, profile::GAMES_PLAYED).saturating_add(1);
    let all_kills = rd_u32(p, profile::KILLS).saturating_add(u32::from(kills));
    let best = rd_u32(p, profile::BEST_SCORE).max(score);
    let total = rd_u64(p, profile::TOTAL_SCORE).saturating_add(u64::from(score));
    let all_xp = rd_u64(p, profile::XP).saturating_add(u64::from(xp));
    let mut points = rd_u64(p, profile::SEASON_POINTS);
    if rd_u32(p, profile::SEASON) != current_season {
        points = 0;
    }
    if season_points {
        points = points.saturating_add(u64::from(score));
    }
    wr_u32(p, profile::GAMES_PLAYED, games);
    wr_u32(p, profile::KILLS, all_kills);
    wr_u32(p, profile::BEST_SCORE, best);
    wr_u64(p, profile::TOTAL_SCORE, total);
    wr_u64(p, profile::XP, all_xp);
    wr_u32(p, profile::SEASON, current_season);
    wr_u64(p, profile::SEASON_POINTS, points);
    wr_i64(p, profile::LAST_PLAYED, now);
    score
}

/// One leaderboard row (`LeaderEntry`, 62 bytes).
type Row = [u8; le::LEN];

/// The 20 rows of a season, in place.
fn rows(s: &mut [u8; season::SPACE]) -> &mut [Row; LEADERBOARD_LEN] {
    const _: () = assert!(season::ENTRIES + LEADERBOARD_LEN * le::LEN == season::SPACE);
    // SAFETY: the rows are exactly the last `20 · 62` bytes of the array (checked above),
    // `u8` arrays have alignment 1, and the borrow of `s` covers them.
    unsafe { &mut *(s.as_mut_ptr().wrapping_add(season::ENTRIES) as *mut [Row; LEADERBOARD_LEN]) }
}

/// Reference `leader_entry(profile, game_score)` followed by `upsert_leaderboard` on the
/// season's `entries`/`count`:
/// * the player is listed → points, name and skin updated, `best_score` = max(old, new);
/// * else a free row → appended (`count + 1`);
/// * else more points than the last row → replaces it;
/// * else nothing.
///
/// The touched row then bubbles up while it has strictly more points than the row above.
/// Returns its final index, `None` when the player did not make the board.
#[inline(never)]
// Bound: `used ≤ 20` and `idx < 20` throughout; `idx - 1` only runs with `idx > 0`.
#[allow(clippy::arithmetic_side_effects)]
pub fn upsert_leaderboard(
    s: &mut [u8; season::SPACE],
    p: &[u8; profile::SPACE],
    game_score: u32,
) -> Option<usize> {
    let player = rd_key(p, profile::OWNER);
    let points = rd_u64(p, profile::SEASON_POINTS);
    // `name`, `name_len` and `skin` are adjacent in both layouts.
    let name: [u8; 18] = rd_arr(p, profile::NAME);
    let count = rd_u8(s, season::COUNT);
    let used = usize::from(count).min(LEADERBOARD_LEN);

    let entries = rows(s);
    let found = entries
        .iter()
        .take(used)
        .position(|e| rd_key(e, le::PLAYER) == player);
    let mut idx = match found {
        Some(i) => {
            let e = entries.get_mut(i)?;
            wr_u64(e, le::POINTS, points);
            let best = rd_u32(e, le::BEST_SCORE).max(game_score);
            wr_u32(e, le::BEST_SCORE, best);
            wr_bytes(e, le::NAME, &name);
            i
        }
        None => {
            let slot = if used < LEADERBOARD_LEN {
                used
            } else if used > 0 && points > rd_u64(entries.get(used - 1)?, le::POINTS) {
                used - 1
            } else {
                return None;
            };
            let e = entries.get_mut(slot)?;
            wr_bytes(e, le::PLAYER, &player);
            wr_u64(e, le::POINTS, points);
            wr_u32(e, le::BEST_SCORE, game_score);
            wr_bytes(e, le::NAME, &name);
            if slot == used {
                wr_u8(s, season::COUNT, (used + 1) as u8);
            }
            slot
        }
    };

    let entries = rows(s);
    while idx > 0 {
        let Some([above, row]) = entries.get_mut(idx - 1..=idx) else {
            break;
        };
        if rd_u64(row, le::POINTS) <= rd_u64(above, le::POINTS) {
            break;
        }
        core::mem::swap(above, row);
        idx -= 1;
    }
    Some(idx)
}

#[cfg(test)]
mod tests {
    //! Differential tests: the reference `logic` functions and these run on the same inputs;
    //! the account bytes must stay identical (the reference structs are serialized with
    //! their own Borsh). Edge cases of the reference unit tests are included.

    use {
        super::*,
        crate::error::Error,
        anchor_lang::{prelude::Pubkey, AccountDeserialize, AccountSerialize},
        slana::{error::SlanaError, logic as r, state as rs},
    };

    /// xorshift64*, deterministic.
    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 >> 12;
            self.0 ^= self.0 << 25;
            self.0 ^= self.0 >> 27;
            self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
        }
        fn below(&mut self, n: u64) -> u64 {
            self.next() % n
        }
    }

    fn code_of(e: anchor_lang::error::Error) -> u32 {
        match e {
            anchor_lang::error::Error::AnchorError(e) => e.error_code_number,
            other => panic!("unexpected {other:?}"),
        }
    }

    fn same<T: PartialEq + std::fmt::Debug>(lean: Result<T>, reference: anchor_lang::Result<T>) {
        match (lean, reference) {
            (Ok(a), Ok(b)) => assert_eq!(a, b),
            (Err(a), Err(b)) => assert_eq!(a, err(code_of(b))),
            (a, b) => panic!("lean {a:?} vs reference {b:?}"),
        }
    }

    fn ser<T: AccountSerialize>(v: &T) -> Vec<u8> {
        let mut out = Vec::new();
        v.try_serialize(&mut out).unwrap();
        out
    }

    #[test]
    fn skins_and_names_match() {
        for skin in 0..=u8::MAX {
            same(check_skin(skin), r::check_skin(skin));
        }
        for name in [
            "",
            "a",
            "abcdefghijklmnop",
            "abcdefghijklmnopq",
            "ééééééééé",
            "bad\nname",
            "tab\t",
            "\u{7f}",
            "\u{0}",
            "\u{85}x",
            "Çağrı🚀",
            "x\u{1b}[31m",
            "Alice 2",
        ] {
            same(
                validate_name(name.as_bytes()),
                r::validate_name(name).map(|(_, len)| len),
            );
            if let Ok((bytes, len)) = r::validate_name(name) {
                let mut d = [0xffu8; 17];
                write_name(&mut d, 0, name.as_bytes(), len);
                assert_eq!(&d[..16], &bytes);
                assert_eq!(d[16], len);
            }
        }
        assert_eq!(
            validate_name(b""),
            Err(err(u32::from(SlanaError::InvalidName)))
        );
    }

    #[test]
    fn mul_bps_matches_u128() {
        let mut rng = Rng(0x1234_5678_9abc_def1);
        let edges = [
            0,
            1,
            9_999,
            10_000,
            10_001,
            u64::MAX / 10_000,
            u64::MAX - 1,
            u64::MAX,
        ];
        for amount in edges {
            for bps in [0u16, 1, 500, 9_999, 10_000, 10_001, u16::MAX] {
                same(mul_bps(amount, bps), r::mul_bps(amount, bps));
            }
        }
        for _ in 0..200_000 {
            let amount = match rng.below(3) {
                0 => rng.below(1 << 40),
                1 => u64::MAX - rng.below(1 << 40),
                _ => rng.next(),
            };
            let bps = rng.next() as u16;
            same(mul_bps(amount, bps), r::mul_bps(amount, bps));
        }
        // An overflow is MathOverflow, as in the reference.
        assert_eq!(mul_bps(u64::MAX, 10_001), Err(err(MATH_OVERFLOW)));
        assert_ne!(mul_bps(u64::MAX, 10_001), Err(Error::ARITHMETIC_OVERFLOW));
    }

    #[test]
    fn split_payout_matches() {
        let lean = |a, b, c, d, e| {
            split_payout(a, b, c, d, e).map(|s| (s.fee, s.treasury, s.season, s.burn, s.player))
        };
        let reference = |a, b, c, d, e| {
            r::split_payout(a, b, c, d, e).map(|s| (s.fee, s.treasury, s.season, s.burn, s.player))
        };
        // The reference's own cases.
        for (p, e, f, t, b) in [
            (100, 100, 500, 5_000, 2_000),
            (50, 100, 500, 5_000, 2_000),
            (0, 100, 1_000, 5_000, 2_000),
            (1_000, 100, 500, 5_000, 2_000),
            (2_000, 1_000, 500, 5_000, 2_000),
            (2_000, 1_000, 200, 5_000, 2_000),
            (u64::MAX, 0, 1_000, 10_000, 0),
            (1_199, 1_000, 500, 5_000, 2_000),
            (120, 100, 500, 5_000, 2_000),
            (2_000, 1_000, 1_000, 10_000, 0),
            (2_000, 1_000, 1_000, 0, 10_000),
            (2_000, 1_000, 1_000, 10_000, 10_000),
            (u64::MAX, 0, u16::MAX, u16::MAX, u16::MAX),
        ] {
            same(lean(p, e, f, t, b), reference(p, e, f, t, b));
        }
        assert_eq!(
            lean(1_000, 100, 500, 5_000, 2_000),
            Ok((45, 22, 14, 9, 955))
        );
        let mut rng = Rng(42);
        for _ in 0..100_000 {
            let payout = if rng.below(2) == 0 {
                rng.below(10_000_000)
            } else {
                rng.next()
            };
            let entry = if rng.below(2) == 0 {
                rng.below(10_000_000)
            } else {
                rng.next()
            };
            let (f, t, b) = (
                rng.below(12_000) as u16,
                rng.below(12_000) as u16,
                rng.below(12_000) as u16,
            );
            same(
                lean(payout, entry, f, t, b),
                reference(payout, entry, f, t, b),
            );
        }
    }

    fn random_profile(rng: &mut Rng, owner: u8) -> rs::PlayerProfile {
        let mut name = [0u8; NAME_BYTES];
        let len = 1 + rng.below(16) as usize;
        for b in &mut name[..len] {
            *b = b'a' + rng.below(26) as u8;
        }
        rs::PlayerProfile {
            owner: Pubkey::new_from_array([owner; 32]),
            name,
            name_len: len as u8,
            skin: rng.below(8) as u8,
            xp: if rng.below(8) == 0 {
                u64::MAX - rng.below(5_000)
            } else {
                rng.below(1 << 20)
            },
            games_played: if rng.below(8) == 0 {
                u32::MAX
            } else {
                rng.below(1_000) as u32
            },
            kills: if rng.below(8) == 0 {
                u32::MAX - 3
            } else {
                rng.below(1_000) as u32
            },
            best_score: rng.below(2_000_000) as u32,
            total_score: if rng.below(8) == 0 {
                u64::MAX - 7
            } else {
                rng.below(1 << 30)
            },
            season: 1 + rng.below(3) as u32,
            season_points: rng.below(10_000),
            stake_games: rng.below(100) as u32,
            total_staked: rng.next(),
            total_won: rng.next(),
            created_at: rng.next() as i64,
            last_played: rng.next() as i64,
            bump: rng.next() as u8,
        }
    }

    #[test]
    fn apply_game_matches() {
        let mut rng = Rng(7);
        for _ in 0..20_000 {
            let mut reference = random_profile(&mut rng, 9);
            let mut lean: [u8; profile::SPACE] = ser(&reference).try_into().unwrap();
            let current = 1 + rng.below(3) as u32;
            let score = match rng.below(3) {
                0 => u32::MAX,
                1 => rng.below(2_000_000) as u32,
                _ => rng.next() as u32,
            };
            let kills = rng.next() as u16;
            let xp = if rng.below(2) == 0 {
                rng.next() as u32
            } else {
                rng.below(3_000) as u32
            };
            let now = rng.next() as i64;
            let points = rng.below(2) == 0;
            let result = r::apply_game(&mut reference, current, score, kills, xp, now, points);
            let ours = apply_game(&mut lean, current, score, kills, xp, now, points);
            assert_eq!(ours, result.score);
            assert_eq!(lean.to_vec(), ser(&reference));
        }
    }

    fn empty_season() -> rs::Season {
        rs::Season {
            id: 3,
            started_at: 1,
            ended_at: 2,
            finalized: false,
            prize_pool: 4,
            pool: 5,
            claimed_mask: 6,
            count: 0,
            bump: 7,
            entries: [rs::LeaderEntry::default(); LEADERBOARD_LEN],
        }
    }

    /// Plays random games of up to 30 players into one season, the reference and lean side by
    /// side; the season bytes and the returned index must match after every game.
    #[test]
    fn leaderboard_upsert_matches() {
        let mut rng = Rng(99);
        for round in 0..60 {
            let mut season = empty_season();
            if round % 7 == 6 {
                // A count above the array (never written by the program) is clamped alike.
                season.count = 25;
            }
            let mut lean: [u8; season::SPACE] = ser(&season).try_into().unwrap();
            let players = 1 + rng.below(30) as u8;
            let mut profiles: Vec<rs::PlayerProfile> = (0..players)
                .map(|i| random_profile(&mut rng, i + 1))
                .collect();
            for _ in 0..400 {
                let p = &mut profiles[rng.below(u64::from(players)) as usize];
                p.season = 3;
                if rng.below(4) == 0 {
                    p.name_len = 1 + rng.below(16) as u8;
                    p.skin = rng.below(8) as u8;
                }
                let score = match rng.below(4) {
                    0 => 0,
                    1 => rng.below(100) as u32,
                    _ => rng.below(5_000) as u32,
                };
                let result = r::apply_game(p, 3, score, 0, 0, 0, true);
                let candidate = r::leader_entry(p, result.score);
                let expected =
                    r::upsert_leaderboard(&mut season.entries, &mut season.count, candidate);
                let p_bytes: [u8; profile::SPACE] = ser(&*p).try_into().unwrap();
                let got = upsert_leaderboard(&mut lean, &p_bytes, result.score);
                assert_eq!(got, expected);
                assert_eq!(lean.to_vec(), ser(&season));
            }
            let back = rs::Season::try_deserialize(&mut &lean[..]).unwrap();
            assert_eq!(back.count, season.count);
        }
    }
}
