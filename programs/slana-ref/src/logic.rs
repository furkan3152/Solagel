//! Pure helpers (no account access) shared by the instruction handlers.

use anchor_lang::prelude::*;

use crate::{constants::*, error::SlanaError, state::PlayerProfile};

// ---------------------------------------------------------------------------
// Levels & skins
// ---------------------------------------------------------------------------

/// Player level for `xp`: `1 + isqrt(xp / XP_LEVEL_DIVISOR)` (integer math only).
pub fn level_from_xp(xp: u64) -> u32 {
    let level = (xp / XP_LEVEL_DIVISOR).isqrt().saturating_add(1);
    u32::try_from(level).unwrap_or(u32::MAX)
}

/// `InvalidSkin` unless `skin` is one of the basic skins (`0..BASIC_SKINS`).
pub fn check_skin(skin: u8) -> Result<()> {
    require!(skin < BASIC_SKINS, SlanaError::InvalidSkin);
    Ok(())
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/// Validates a player name (1..=16 bytes, no control characters) and returns it as a
/// zero-padded byte array plus its length.
pub fn validate_name(name: &str) -> Result<([u8; NAME_BYTES], u8)> {
    let bytes = name.as_bytes();
    require!(
        !bytes.is_empty() && bytes.len() <= NAME_BYTES,
        SlanaError::InvalidName
    );
    require!(!name.chars().any(char::is_control), SlanaError::InvalidName);
    let mut out = [0u8; NAME_BYTES];
    out[..bytes.len()].copy_from_slice(bytes);
    // Cannot truncate: bytes.len() <= 16.
    Ok((out, bytes.len() as u8))
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/// `amount * bps / 10_000`, rounded down, computed in u128.
pub fn mul_bps(amount: u64, bps: u16) -> Result<u64> {
    let value = u128::from(amount)
        .checked_mul(u128::from(bps))
        .ok_or(SlanaError::MathOverflow)?
        / u128::from(BPS);
    u64::try_from(value).map_err(|_| error!(SlanaError::MathOverflow))
}

/// How a stake payout is split (both amounts in base units of the game token).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct FeeSplit {
    /// Fee on profit, paid to the fee wallet.
    pub fee: u64,
    /// What the player receives (`payout - fee`).
    pub player: u64,
}

/// Splits `payout` for a session that was opened with `entry_fee`:
/// `fee = (payout - entry_fee)⁺ * fee_bps / 10_000` (rounded down), `player = payout - fee`.
/// Every step is checked (`MathOverflow`).
pub fn split_payout(payout: u64, entry_fee: u64, fee_bps: u16) -> Result<FeeSplit> {
    let profit = payout.saturating_sub(entry_fee);
    let fee = mul_bps(profit, fee_bps)?;
    let player = payout.checked_sub(fee).ok_or(SlanaError::MathOverflow)?;
    Ok(FeeSplit { fee, player })
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

/// Values of a game after clamping.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct GameResult {
    pub score: u32,
    pub kills: u16,
    pub xp: u32,
}

/// Applies one finished game to a profile (stats and XP).
///
/// Score is clamped to `MAX_SCORE_PER_GAME` and XP to `MAX_XP_PER_GAME`. All counters
/// saturate so a settlement can never fail because of statistics.
pub fn apply_game(
    profile: &mut PlayerProfile,
    score: u32,
    kills: u16,
    xp: u32,
    now: i64,
) -> GameResult {
    let score = score.min(MAX_SCORE_PER_GAME);
    let xp = xp.min(MAX_XP_PER_GAME);

    profile.games_played = profile.games_played.saturating_add(1);
    profile.kills = profile.kills.saturating_add(u32::from(kills));
    profile.best_score = profile.best_score.max(score);
    profile.total_score = profile.total_score.saturating_add(u64::from(score));
    profile.xp = profile.xp.saturating_add(u64::from(xp));
    profile.last_played = now;

    GameResult { score, kills, xp }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pk(n: u8) -> Pubkey {
        Pubkey::new_from_array([n; 32])
    }

    fn code(err: anchor_lang::error::Error) -> u32 {
        match err {
            anchor_lang::error::Error::AnchorError(e) => e.error_code_number,
            other => panic!("unexpected error {other:?}"),
        }
    }

    fn err_code(e: SlanaError) -> u32 {
        e.into()
    }

    #[test]
    fn level_from_xp_matches_formula() {
        assert_eq!(level_from_xp(0), 1);
        assert_eq!(level_from_xp(49), 1);
        assert_eq!(level_from_xp(50), 2);
        assert_eq!(level_from_xp(199), 2);
        assert_eq!(level_from_xp(200), 3);
        assert_eq!(level_from_xp(799), 4);
        assert_eq!(level_from_xp(800), 5);
        assert_eq!(level_from_xp(1_000), 5);
        assert_eq!(level_from_xp(18_049), 19);
        assert_eq!(level_from_xp(18_050), 20);
        // No panic / overflow at the top of the range.
        assert_eq!(
            level_from_xp(u64::MAX),
            u32::try_from((u64::MAX / 50).isqrt() + 1).unwrap()
        );
        // Brute-force cross check against the definition of the integer square root.
        for xp in 0..200_000u64 {
            let q = xp / XP_LEVEL_DIVISOR;
            let root = u64::from(level_from_xp(xp)) - 1;
            assert!(root * root <= q && (root + 1) * (root + 1) > q, "xp {xp}");
        }
    }

    #[test]
    fn only_basic_skins_are_valid() {
        for skin in 0..BASIC_SKINS {
            assert!(check_skin(skin).is_ok());
        }
        for skin in [BASIC_SKINS, 16, 23, 24, u8::MAX] {
            assert_eq!(
                code(check_skin(skin).unwrap_err()),
                err_code(SlanaError::InvalidSkin)
            );
        }
    }

    #[test]
    fn names_are_validated() {
        let invalid = err_code(SlanaError::InvalidName);
        assert_eq!(code(validate_name("").unwrap_err()), invalid);
        assert_eq!(
            code(validate_name("abcdefghijklmnopq").unwrap_err()),
            invalid
        ); // 17 bytes
        assert_eq!(code(validate_name("bad\nname").unwrap_err()), invalid);
        assert_eq!(code(validate_name("tab\t").unwrap_err()), invalid);
        assert_eq!(code(validate_name("\u{7f}").unwrap_err()), invalid);
        assert_eq!(code(validate_name("\u{0}").unwrap_err()), invalid);
        assert_eq!(code(validate_name("ééééééééé").unwrap_err()), invalid); // 18 bytes

        let (bytes, len) = validate_name("abcdefghijklmnop").unwrap(); // 16 bytes
        assert_eq!(len, 16);
        assert_eq!(&bytes, b"abcdefghijklmnop");

        let name = "Renée🚀";
        let (bytes, len) = validate_name(name).unwrap();
        assert_eq!(usize::from(len), name.len());
        assert_eq!(&bytes[..usize::from(len)], name.as_bytes());
        assert!(bytes[usize::from(len)..].iter().all(|b| *b == 0));
    }

    #[test]
    fn split_payout_on_profit_only() {
        // No profit, no fee.
        assert_eq!(
            split_payout(100, 100, 500).unwrap(),
            FeeSplit {
                fee: 0,
                player: 100
            }
        );
        assert_eq!(
            split_payout(50, 100, 500).unwrap(),
            FeeSplit { fee: 0, player: 50 }
        );
        assert_eq!(split_payout(0, 100, 1_000).unwrap(), FeeSplit::default());
        // Profit 900 at 5 %: fee 45; the player receives 955.
        assert_eq!(
            split_payout(1_000, 100, 500).unwrap(),
            FeeSplit {
                fee: 45,
                player: 955
            }
        );
        // Entry 1000, payout 2000 at 5 %: fee 50.
        assert_eq!(
            split_payout(2_000, 1_000, 500).unwrap(),
            FeeSplit {
                fee: 50,
                player: 1_950
            }
        );
        // Rounded down: profit 199 at 5 % = 9.95 → 9.
        assert_eq!(split_payout(1_199, 1_000, 500).unwrap().fee, 9);
        assert_eq!(split_payout(119, 100, 500).unwrap().fee, 0);
        // A zero rate never charges.
        assert_eq!(split_payout(5_000, 1, 0).unwrap().fee, 0);
        // Large values do not overflow.
        let s = split_payout(u64::MAX, 0, MAX_FEE_BPS).unwrap();
        assert_eq!(s.fee, u64::MAX / 10);
        assert_eq!(s.player, u64::MAX - u64::MAX / 10);
        // A rate above 100 % cannot underflow silently.
        assert_eq!(
            code(split_payout(10_000, 0, BPS + 1).unwrap_err()),
            err_code(SlanaError::MathOverflow)
        );
        // Conservation over a range of inputs.
        for payout in (0..5_000_000u64).step_by(7_919) {
            for entry_fee in [1u64, 999, 1_000_000, 2_500_000] {
                for fee_bps in [0, 137, 200, 500, 1_000] {
                    let s = split_payout(payout, entry_fee, fee_bps).unwrap();
                    assert_eq!(s.player + s.fee, payout);
                    assert!(s.fee <= payout.saturating_sub(entry_fee));
                    assert_eq!(
                        s.fee,
                        mul_bps(payout.saturating_sub(entry_fee), fee_bps).unwrap()
                    );
                }
            }
        }
    }

    #[test]
    fn apply_game_updates_profile() {
        let mut profile = PlayerProfile {
            owner: pk(1),
            ..Default::default()
        };
        let r = apply_game(&mut profile, 5_000, 3, 120, 42);
        assert_eq!(
            r,
            GameResult {
                score: 5_000,
                kills: 3,
                xp: 120
            }
        );
        assert_eq!(profile.games_played, 1);
        assert_eq!(profile.kills, 3);
        assert_eq!(profile.best_score, 5_000);
        assert_eq!(profile.total_score, 5_000);
        assert_eq!(profile.xp, 120);
        assert_eq!(profile.last_played, 42);

        // Clamping.
        let r = apply_game(&mut profile, u32::MAX, u16::MAX, u32::MAX, 43);
        assert_eq!(r.score, MAX_SCORE_PER_GAME);
        assert_eq!(r.xp, MAX_XP_PER_GAME);
        assert_eq!(profile.best_score, MAX_SCORE_PER_GAME);
        assert_eq!(profile.xp, 120 + u64::from(MAX_XP_PER_GAME));
        assert_eq!(profile.kills, 3 + u32::from(u16::MAX));

        // A lower score keeps the best score.
        let total_before = profile.total_score;
        apply_game(&mut profile, 10, 0, 0, 44);
        assert_eq!(profile.best_score, MAX_SCORE_PER_GAME);
        assert_eq!(profile.total_score, total_before + 10);
        assert_eq!(profile.games_played, 3);

        // Saturation instead of overflow.
        profile.xp = u64::MAX - 1;
        profile.games_played = u32::MAX;
        apply_game(&mut profile, 0, 0, 10, 46);
        assert_eq!(profile.xp, u64::MAX);
        assert_eq!(profile.games_played, u32::MAX);
    }
}
