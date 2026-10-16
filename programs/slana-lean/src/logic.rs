//! Pure game and money rules of the reference (`programs/slana-ref/src/logic.rs`), working on
//! the account bytes in place (the layouts of `state.rs`).
//!
//! Ported: `check_skin`, `validate_name`, `mul_bps`, `split_payout` and `apply_game`. The
//! unit tests run the reference functions and these side by side.

use {
    crate::error::Result,
    crate::{
        borsh::{rd_u32, rd_u64, wr_bytes, wr_i64, wr_u32, wr_u64, wr_u8},
        constants::{BASIC_SKINS, BPS, MAX_SCORE_PER_GAME, MAX_XP_PER_GAME, NAME_BYTES},
        error::{err, require, INVALID_NAME, INVALID_SKIN, MATH_OVERFLOW},
        state::profile,
    },
};

// ----- skins & names ----------------------------------------------------------------------

/// `InvalidSkin` unless `skin < BASIC_SKINS`.
pub fn check_skin(skin: u8) -> Result {
    require(skin < BASIC_SKINS, INVALID_SKIN)
}

/// `str::chars().any(char::is_control)` for valid UTF-8: the C0 controls and DEL are single
/// bytes, the C1 controls (U+0080..=U+009F) are `C2 80..=C2 9F`.
pub fn has_control_char(utf8: &[u8]) -> bool {
    let mut prev = 0u8;
    for &b in utf8 {
        if b < 0x20 || b == 0x7f || (prev == 0xc2 && b >= 0x80 && b <= 0x9f) {
            return true;
        }
        prev = b;
    }
    false
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
/// `q·bps + r·bps/10⁴` in u64. `q·bps` is built from 32-bit halves of `q`
/// (`hi·bps·2³² + lo·bps`), so no 128-bit runtime helper (`__multi3`) is linked: it can only
/// overflow when the exact result does, which is exactly when the reference fails.
#[inline(never)]
pub fn mul_bps(amount: u64, bps: u16) -> Result<u64> {
    let bps = u64::from(bps);
    let base = u64::from(BPS);
    // Bound: `base` is a non-zero constant; `r < 10⁴` and `bps < 2¹⁶`, so `r·bps < 2³⁰`.
    // `q < 2⁵¹`, so `hi = q >> 32 < 2¹⁹` and `hi·bps < 2³⁵`; `lo < 2³²`, so `lo·bps < 2⁴⁸`.
    #[allow(clippy::arithmetic_side_effects)]
    let (q, rest) = (amount / base, (amount % base) * bps / base);
    #[allow(clippy::arithmetic_side_effects)]
    let (high, low) = ((q >> 32) * bps, (q & 0xffff_ffff) * bps);
    // `high·2³²` fits in u64 only below 2³²; otherwise `q·bps ≥ 2⁶⁴` overflows.
    if high >> 32 != 0 {
        return Err(err(MATH_OVERFLOW));
    }
    (high << 32)
        .checked_add(low)
        .and_then(|whole| whole.checked_add(rest))
        .ok_or_else(|| err(MATH_OVERFLOW))
}

/// How a stake payout is split (base units of the game token).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct FeeSplit {
    pub fee: u64,
    pub player: u64,
}

/// Reference `split_payout`: `fee = (payout − entry_fee)⁺ · fee_bps / 10⁴` (rounded down),
/// the player `payout − fee`; every step checked (`MathOverflow`).
#[inline(never)]
pub fn split_payout(payout: u64, entry_fee: u64, fee_bps: u16) -> Result<FeeSplit> {
    let fee = mul_bps(payout.saturating_sub(entry_fee), fee_bps)?;
    let player = payout.checked_sub(fee).ok_or_else(|| err(MATH_OVERFLOW))?;
    Ok(FeeSplit { fee, player })
}

// ----- games --------------------------------------------------------------------------------

/// Reference `apply_game` on a profile: clamps score and XP and updates the stats
/// (saturating). Returns the clamped score.
#[inline(never)]
pub fn apply_game(p: &mut [u8; profile::SPACE], score: u32, kills: u16, xp: u32, now: i64) -> u32 {
    let score = score.min(MAX_SCORE_PER_GAME);
    let xp = xp.min(MAX_XP_PER_GAME);
    let games = rd_u32(p, profile::GAMES_PLAYED).saturating_add(1);
    let all_kills = rd_u32(p, profile::KILLS).saturating_add(u32::from(kills));
    let best = rd_u32(p, profile::BEST_SCORE).max(score);
    let total = rd_u64(p, profile::TOTAL_SCORE).saturating_add(u64::from(score));
    let all_xp = rd_u64(p, profile::XP).saturating_add(u64::from(xp));
    wr_u32(p, profile::GAMES_PLAYED, games);
    wr_u32(p, profile::KILLS, all_kills);
    wr_u32(p, profile::BEST_SCORE, best);
    wr_u64(p, profile::TOTAL_SCORE, total);
    wr_u64(p, profile::XP, all_xp);
    wr_i64(p, profile::LAST_PLAYED, now);
    score
}

#[cfg(test)]
mod tests {
    //! Differential tests: the reference `logic` functions and these run on the same inputs;
    //! the account bytes must stay identical (the reference structs are serialized with
    //! their own Borsh). Edge cases of the reference unit tests are included.

    use {
        super::*,
        crate::error::Error,
        anchor_lang::{prelude::Pubkey, AccountSerialize},
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
            "Renée🚀",
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
        // Exact overflow thresholds for bps > 10⁴. The result first exceeds u64 at
        // `t = ceil(2⁶⁴·10⁴ / bps)`. Check `floor(2⁶⁴·10⁴ / bps) ± 1` and both sides of `t`
        // against the reference.
        for bps in [
            10_001u16,
            10_007,
            12_345,
            20_000,
            30_000,
            50_000,
            65_534,
            u16::MAX,
        ] {
            let scaled = (1u128 << 64) * 10_000;
            let floor = scaled / u128::from(bps);
            let first_overflow = scaled.div_ceil(u128::from(bps));
            for amount in [
                floor - 1,
                floor,
                floor + 1,
                first_overflow - 1,
                first_overflow,
            ] {
                let amount = u64::try_from(amount).unwrap();
                same(mul_bps(amount, bps), r::mul_bps(amount, bps));
            }
            let below = u64::try_from(first_overflow - 1).unwrap();
            let at = u64::try_from(first_overflow).unwrap();
            assert!(mul_bps(below, bps).is_ok(), "bps {bps}: {below} must fit");
            assert_eq!(mul_bps(at, bps), Err(err(MATH_OVERFLOW)), "bps {bps}: {at}");
        }
        // An overflow is MathOverflow, as in the reference.
        assert_eq!(mul_bps(u64::MAX, 10_001), Err(err(MATH_OVERFLOW)));
        assert_ne!(mul_bps(u64::MAX, 10_001), Err(Error::ARITHMETIC_OVERFLOW));
    }

    #[test]
    fn split_payout_matches() {
        let lean = |a, b, c| split_payout(a, b, c).map(|s| (s.fee, s.player));
        let reference = |a, b, c| r::split_payout(a, b, c).map(|s| (s.fee, s.player));
        // The reference's own cases.
        for (p, e, f) in [
            (100, 100, 500),
            (50, 100, 500),
            (0, 100, 1_000),
            (1_000, 100, 500),
            (2_000, 1_000, 500),
            (1_199, 1_000, 500),
            (u64::MAX, 0, 1_000),
            (2_000, 0, 10_001),
            (u64::MAX, 0, u16::MAX),
        ] {
            same(lean(p, e, f), reference(p, e, f));
        }
        assert_eq!(lean(1_000, 100, 500), Ok((45, 955)));
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
            let f = rng.below(12_000) as u16;
            same(lean(payout, entry, f), reference(payout, entry, f));
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
            let result = r::apply_game(&mut reference, score, kills, xp, now);
            let ours = apply_game(&mut lean, score, kills, xp, now);
            assert_eq!(ours, result.score);
            assert_eq!(lean.to_vec(), ser(&reference));
        }
    }

    #[test]
    fn control_chars_match_char_is_control() {
        // Every code point of the first planes, alone and inside a text.
        for cp in (0u32..0x3000)
            .chain(0xfff0..0x10000)
            .chain(0x1_0000..0x1_0100)
        {
            let Some(ch) = char::from_u32(cp) else {
                continue;
            };
            let text = format!("a{ch}/");
            assert_eq!(
                has_control_char(text.as_bytes()),
                text.chars().any(char::is_control),
                "U+{cp:04X}"
            );
        }
        // A continuation byte 0x80..0x9f after a lead byte other than C2 is no control.
        assert!(!has_control_char("ŀ".as_bytes())); // C5 80
    }
}
