//! Pure helpers (no account access) shared by the instruction handlers.

use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::SolagelError,
    state::{LeaderEntry, PlayerProfile},
};

// ---------------------------------------------------------------------------
// Levels & skins
// ---------------------------------------------------------------------------

/// Player level for `xp`: `1 + isqrt(xp / XP_LEVEL_DIVISOR)` (integer math only).
pub fn level_from_xp(xp: u64) -> u32 {
    let level = (xp / XP_LEVEL_DIVISOR).isqrt().saturating_add(1);
    u32::try_from(level).unwrap_or(u32::MAX)
}

/// Bit of `PlayerProfile::premium_skins` that marks ownership of `skin`, `None` for non-premium ids.
pub fn premium_skin_bit(skin: u8) -> Option<u32> {
    if (PREMIUM_SKIN_START..SKIN_COUNT).contains(&skin) {
        Some(1u32 << (skin - PREMIUM_SKIN_START))
    } else {
        None
    }
}

/// Whether a player with `xp` and `premium_skins` may equip `skin` (false for invalid ids).
pub fn is_skin_unlocked(skin: u8, xp: u64, premium_skins: u32) -> bool {
    if skin < FREE_SKINS {
        true
    } else if skin < PREMIUM_SKIN_START {
        let required = LEVEL_SKIN_REQUIREMENTS[usize::from(skin - LEVEL_SKIN_START)];
        level_from_xp(xp) >= required
    } else {
        premium_skin_bit(skin).is_some_and(|bit| premium_skins & bit != 0)
    }
}

/// `InvalidSkin` for ids ≥ `SKIN_COUNT`, `SkinLocked` when the skin is not unlocked.
pub fn check_skin(skin: u8, xp: u64, premium_skins: u32) -> Result<()> {
    require!(skin < SKIN_COUNT, SolagelError::InvalidSkin);
    require!(
        is_skin_unlocked(skin, xp, premium_skins),
        SolagelError::SkinLocked
    );
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
        SolagelError::InvalidName
    );
    require!(
        !name.chars().any(char::is_control),
        SolagelError::InvalidName
    );
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
        .ok_or(SolagelError::MathOverflow)?
        / u128::from(BPS);
    u64::try_from(value).map_err(|_| error!(SolagelError::MathOverflow))
}

/// How a stake payout is split.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Settlement {
    /// Total fee (only charged on profit).
    pub fee: u64,
    /// Part of the fee that goes to the season prize pool.
    pub season_cut: u64,
    /// Part of the fee that goes to the treasury.
    pub treasury_cut: u64,
    /// What the player receives (`payout - fee`).
    pub player_amount: u64,
}

/// Splits `payout` for a session that was opened with `buy_in`.
///
/// `fee = (payout - buy_in)⁺ * fee_bps / 10_000`,
/// `season_cut = fee * season_share_bps / 10_000`, `treasury_cut = fee - season_cut`,
/// `player_amount = payout - fee`.
pub fn compute_settlement(
    payout: u64,
    buy_in: u64,
    fee_bps: u16,
    season_share_bps: u16,
) -> Result<Settlement> {
    let profit = payout.saturating_sub(buy_in);
    let fee = mul_bps(profit, fee_bps)?;
    let season_cut = mul_bps(fee, season_share_bps)?;
    let treasury_cut = fee
        .checked_sub(season_cut)
        .ok_or(SolagelError::MathOverflow)?;
    let player_amount = payout.checked_sub(fee).ok_or(SolagelError::MathOverflow)?;
    Ok(Settlement {
        fee,
        season_cut,
        treasury_cut,
        player_amount,
    })
}

/// Prize of leaderboard `rank` (0-based) for a frozen `prize_pool`.
pub fn prize_amount(prize_pool: u64, rank: usize) -> Result<u64> {
    let share = *PRIZE_SHARES_BPS
        .get(rank)
        .ok_or(SolagelError::NotEligible)?;
    mul_bps(prize_pool, share)
}

/// Prize rank (0-based) of `player` among the first `min(count, PRIZE_RANKS)` entries.
pub fn prize_rank(entries: &[LeaderEntry], count: u8, player: &Pubkey) -> Option<usize> {
    let ranked = usize::from(count)
        .min(usize::from(PRIZE_RANKS))
        .min(entries.len());
    entries[..ranked].iter().position(|e| e.player == *player)
}

// ---------------------------------------------------------------------------
// Games & leaderboard
// ---------------------------------------------------------------------------

/// Values of a game after clamping.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct GameResult {
    pub score: u32,
    pub kills: u16,
    pub xp: u32,
}

/// Season points use captured SOL profit, never gameplay mass or cosmetic XP.
pub fn season_points_from_profit(payout: u64, buy_in: u64) -> u64 {
    payout.saturating_sub(buy_in) / LAMPORTS_PER_SEASON_POINT
}

/// Applies one paid game with independently computed financial season points.
///
/// Score is clamped to `MAX_SCORE_PER_GAME` and XP to `MAX_XP_PER_GAME`. Season points
/// are reset when the profile still carries points from an older season. All counters
/// saturate so a settlement can never fail because of statistics.
pub fn apply_game(
    profile: &mut PlayerProfile,
    current_season: u32,
    game: GameResult,
    earned_points: u64,
    now: i64,
) -> GameResult {
    let result = apply_practice_game(profile, game.score, game.kills, game.xp, now);
    if profile.season != current_season {
        profile.season = current_season;
        profile.season_points = 0;
    }
    profile.season_points = profile.season_points.saturating_add(earned_points);
    result
}

/// Applies lifetime stats and cosmetic progression only. Practice cannot earn season
/// points or change existing paid-play points, including after a season rollover.
pub fn apply_practice_game(
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

/// Leaderboard row for `profile` after a game that scored `game_score`.
pub fn leader_entry(profile: &PlayerProfile, game_score: u32) -> LeaderEntry {
    LeaderEntry {
        player: profile.owner,
        points: profile.season_points,
        best_score: game_score,
        name: profile.name,
        name_len: profile.name_len,
        skin: profile.skin,
    }
}

/// Inserts or updates `candidate` in a leaderboard sorted by points (descending).
///
/// * player already listed → points/name/skin updated, `best_score` = max(old, candidate)
/// * otherwise, free slot → appended
/// * otherwise, more points than the last entry → replaces the last entry
/// * otherwise → no-op
///
/// The touched entry then bubbles up while it has strictly more points than the entry
/// above it (points only grow within a season, so moving up is enough).
/// Returns the final index of the entry, or `None` when it did not make the board.
pub fn upsert_leaderboard(
    entries: &mut [LeaderEntry],
    count: &mut u8,
    candidate: LeaderEntry,
) -> Option<usize> {
    let used = usize::from(*count).min(entries.len());

    let mut idx = if let Some(i) = entries[..used]
        .iter()
        .position(|e| e.player == candidate.player)
    {
        let entry = &mut entries[i];
        entry.points = candidate.points;
        entry.best_score = entry.best_score.max(candidate.best_score);
        entry.name = candidate.name;
        entry.name_len = candidate.name_len;
        entry.skin = candidate.skin;
        i
    } else if used < entries.len() {
        entries[used] = candidate;
        // used + 1 <= entries.len() which callers keep <= u8::MAX.
        *count = u8::try_from(used + 1).unwrap_or(u8::MAX);
        used
    } else if used > 0 && candidate.points > entries[used - 1].points {
        entries[used - 1] = candidate;
        used - 1
    } else {
        return None;
    };

    while idx > 0 && entries[idx].points > entries[idx - 1].points {
        entries.swap(idx, idx - 1);
        idx -= 1;
    }
    Some(idx)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pk(n: u8) -> Pubkey {
        Pubkey::new_from_array([n; 32])
    }

    fn entry(n: u8, points: u64) -> LeaderEntry {
        LeaderEntry {
            player: pk(n),
            points,
            best_score: u32::try_from(points).unwrap_or(u32::MAX),
            ..Default::default()
        }
    }

    fn code(err: anchor_lang::error::Error) -> u32 {
        match err {
            anchor_lang::error::Error::AnchorError(e) => e.error_code_number,
            other => panic!("unexpected error {other:?}"),
        }
    }

    fn err_code(e: SolagelError) -> u32 {
        e.into()
    }

    fn assert_sorted(entries: &[LeaderEntry]) {
        assert!(
            entries.windows(2).all(|w| w[0].points >= w[1].points),
            "leaderboard not sorted: {:?}",
            entries.iter().map(|e| e.points).collect::<Vec<_>>()
        );
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
    fn skins_unlock_by_tier() {
        // Free skins are always unlocked.
        for skin in 0..FREE_SKINS {
            assert!(is_skin_unlocked(skin, 0, 0));
            assert!(check_skin(skin, 0, 0).is_ok());
        }
        // Level skins: skin 8 needs level 2 (50 xp) ... skin 15 needs level 20 (18 050 xp).
        assert!(!is_skin_unlocked(8, 49, 0));
        assert!(is_skin_unlocked(8, 50, 0));
        assert!(!is_skin_unlocked(10, 799, 0));
        assert!(is_skin_unlocked(10, 800, 0));
        assert!(!is_skin_unlocked(11, 800, 0));
        assert!(!is_skin_unlocked(15, 18_049, 0));
        assert!(is_skin_unlocked(15, 18_050, 0));
        assert_eq!(
            code(check_skin(10, 0, 0).unwrap_err()),
            err_code(SolagelError::SkinLocked)
        );
        // Premium skins need their bit; xp does not help.
        assert!(!is_skin_unlocked(16, u64::MAX, 0));
        assert!(is_skin_unlocked(16, 0, 1));
        assert!(is_skin_unlocked(17, 0, 1 << 1));
        assert!(!is_skin_unlocked(17, 0, 1));
        assert!(is_skin_unlocked(23, 0, 1 << 7));
        assert_eq!(
            code(check_skin(20, 0, 0).unwrap_err()),
            err_code(SolagelError::SkinLocked)
        );
        // Invalid ids.
        assert!(!is_skin_unlocked(24, u64::MAX, u32::MAX));
        assert_eq!(
            code(check_skin(24, u64::MAX, u32::MAX).unwrap_err()),
            err_code(SolagelError::InvalidSkin)
        );
        assert_eq!(
            code(check_skin(255, 0, 0).unwrap_err()),
            err_code(SolagelError::InvalidSkin)
        );
        assert_eq!(premium_skin_bit(15), None);
        assert_eq!(premium_skin_bit(16), Some(1));
        assert_eq!(premium_skin_bit(23), Some(1 << 7));
        assert_eq!(premium_skin_bit(24), None);
    }

    #[test]
    fn names_are_validated() {
        let invalid = err_code(SolagelError::InvalidName);
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

        let name = "Çağrı🚀";
        let (bytes, len) = validate_name(name).unwrap();
        assert_eq!(usize::from(len), name.len());
        assert_eq!(&bytes[..usize::from(len)], name.as_bytes());
        assert!(bytes[usize::from(len)..].iter().all(|b| *b == 0));
    }

    #[test]
    fn settlement_split() {
        // Spec example: 0.1 SOL buy-in, 0.15 SOL payout, 5 % fee, half of it to the season.
        let s = compute_settlement(150_000_000, 100_000_000, 500, 5_000).unwrap();
        assert_eq!(
            s,
            Settlement {
                fee: 2_500_000,
                season_cut: 1_250_000,
                treasury_cut: 1_250_000,
                player_amount: 147_500_000,
            }
        );
        // No profit, no fee.
        let s = compute_settlement(50_000_000, 100_000_000, 500, 5_000).unwrap();
        assert_eq!(s.fee, 0);
        assert_eq!(s.player_amount, 50_000_000);
        let s = compute_settlement(100_000_000, 100_000_000, 1_000, 5_000).unwrap();
        assert_eq!(s.fee, 0);
        assert_eq!(
            compute_settlement(0, 100, 500, 5_000).unwrap(),
            Settlement::default()
        );
        // Rounding is always down, and nothing is lost.
        let s = compute_settlement(1_199, 1_000, 500, 5_000).unwrap();
        assert_eq!((s.fee, s.season_cut, s.treasury_cut), (9, 4, 5));
        assert_eq!(s.player_amount, 1_190);
        // Season share extremes.
        let s = compute_settlement(2_000, 1_000, 1_000, 10_000).unwrap();
        assert_eq!((s.fee, s.season_cut, s.treasury_cut), (100, 100, 0));
        let s = compute_settlement(2_000, 1_000, 1_000, 0).unwrap();
        assert_eq!((s.fee, s.season_cut, s.treasury_cut), (100, 0, 100));
        // Large values do not overflow.
        let s = compute_settlement(u64::MAX, 0, MAX_FEE_BPS, BPS).unwrap();
        assert_eq!(s.fee, u64::MAX / 10);
        // Conservation over a range of inputs.
        for payout in (0..5_000_000u64).step_by(7_919) {
            for buy_in in [0u64, 1, 999_999, 1_000_000, 2_500_000] {
                for (fee_bps, share) in [(0, 0), (500, 5_000), (1_000, 3_333), (137, 10_000)] {
                    let s = compute_settlement(payout, buy_in, fee_bps, share).unwrap();
                    assert_eq!(s.player_amount + s.season_cut + s.treasury_cut, payout);
                    assert_eq!(s.season_cut + s.treasury_cut, s.fee);
                    assert!(s.fee <= payout.saturating_sub(buy_in));
                }
            }
        }
    }

    #[test]
    fn prizes() {
        assert_eq!(prize_amount(1_000_000, 0).unwrap(), 300_000);
        assert_eq!(prize_amount(1_000_000, 1).unwrap(), 200_000);
        assert_eq!(prize_amount(1_000_000, 9).unwrap(), 20_000);
        assert_eq!(
            code(prize_amount(1_000_000, 10).unwrap_err()),
            err_code(SolagelError::NotEligible)
        );
        let pool = 987_654_321u64;
        let total: u64 = (0..usize::from(PRIZE_RANKS))
            .map(|r| prize_amount(pool, r).unwrap())
            .sum();
        assert!(total <= pool && pool - total < u64::from(PRIZE_RANKS));

        let entries: Vec<LeaderEntry> = (0..20)
            .map(|i| entry(i + 1, 1_000 - u64::from(i)))
            .collect();
        assert_eq!(prize_rank(&entries, 20, &pk(1)), Some(0));
        assert_eq!(prize_rank(&entries, 20, &pk(10)), Some(9));
        assert_eq!(prize_rank(&entries, 20, &pk(11)), None); // rank 11 gets nothing
        assert_eq!(prize_rank(&entries, 3, &pk(4)), None); // beyond count
        assert_eq!(prize_rank(&entries, 3, &pk(3)), Some(2));
        assert_eq!(prize_rank(&entries, 20, &pk(99)), None);
    }

    #[test]
    fn season_points_count_only_captured_profit() {
        assert_eq!(season_points_from_profit(0, 1_000_000), 0);
        assert_eq!(season_points_from_profit(1_000_000, 1_000_000), 0);
        assert_eq!(season_points_from_profit(1_000_999, 1_000_000), 0);
        assert_eq!(season_points_from_profit(1_001_000, 1_000_000), 1);
        assert_eq!(season_points_from_profit(150_000_000, 100_000_000), 50_000);
        assert_eq!(season_points_from_profit(u64::MAX, 0), u64::MAX / 1_000);
    }

    #[test]
    fn apply_game_updates_profile() {
        let mut profile = PlayerProfile {
            owner: pk(1),
            season: 1,
            ..Default::default()
        };
        let r = apply_game(
            &mut profile,
            1,
            GameResult {
                score: 5_000,
                kills: 3,
                xp: 120,
            },
            5_000,
            42,
        );
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
        assert_eq!(profile.season_points, 5_000);
        assert_eq!(profile.last_played, 42);

        // Clamping.
        let r = apply_game(
            &mut profile,
            1,
            GameResult {
                score: u32::MAX,
                kills: u16::MAX,
                xp: u32::MAX,
            },
            123,
            43,
        );
        assert_eq!(r.score, MAX_SCORE_PER_GAME);
        assert_eq!(r.xp, MAX_XP_PER_GAME);
        assert_eq!(profile.best_score, MAX_SCORE_PER_GAME);
        assert_eq!(profile.xp, 120 + u64::from(MAX_XP_PER_GAME));
        assert_eq!(profile.kills, 3 + u32::from(u16::MAX));
        assert_eq!(profile.season_points, 5_000 + 123);

        // A lower score keeps the best score.
        apply_game(
            &mut profile,
            1,
            GameResult {
                score: 10,
                kills: 0,
                xp: 0,
            },
            0,
            44,
        );
        assert_eq!(profile.best_score, MAX_SCORE_PER_GAME);

        // New season resets season points only.
        let total_before = profile.total_score;
        apply_game(
            &mut profile,
            2,
            GameResult {
                score: 700,
                kills: 0,
                xp: 0,
            },
            800,
            45,
        );
        assert_eq!(profile.season, 2);
        assert_eq!(profile.season_points, 800);
        assert_eq!(profile.total_score, total_before + 700);
        assert_eq!(profile.games_played, 4);

        // Saturation instead of overflow.
        profile.xp = u64::MAX - 1;
        profile.games_played = u32::MAX;
        apply_game(
            &mut profile,
            2,
            GameResult {
                score: 0,
                kills: 0,
                xp: 10,
            },
            u64::MAX,
            46,
        );
        assert_eq!(profile.xp, u64::MAX);
        assert_eq!(profile.games_played, u32::MAX);
        assert_eq!(profile.season_points, u64::MAX);
    }

    #[test]
    fn practice_updates_lifetime_stats_without_changing_paid_points() {
        let mut profile = PlayerProfile {
            owner: pk(1),
            season: 7,
            season_points: 123,
            ..Default::default()
        };
        let result = apply_practice_game(&mut profile, u32::MAX, 4, u32::MAX, 42);
        assert_eq!(result.score, MAX_SCORE_PER_GAME);
        assert_eq!(result.xp, MAX_XP_PER_GAME);
        assert_eq!(profile.games_played, 1);
        assert_eq!(profile.kills, 4);
        assert_eq!(profile.best_score, MAX_SCORE_PER_GAME);
        assert_eq!(profile.total_score, u64::from(MAX_SCORE_PER_GAME));
        assert_eq!(profile.xp, u64::from(MAX_XP_PER_GAME));
        assert_eq!((profile.season, profile.season_points), (7, 123));
        assert_eq!(profile.last_played, 42);
        assert_eq!(
            (profile.stake_games, profile.total_staked, profile.total_won),
            (0, 0, 0)
        );
    }

    #[test]
    fn leaderboard_keeps_top_20_sorted() {
        let mut entries = [LeaderEntry::default(); LEADERBOARD_LEN];
        let mut count = 0u8;
        // 25 players with distinct points in a scrambled order (17 is coprime with 25).
        for i in 0..25u64 {
            let p = (i * 17) % 25; // permutation of 0..25
            let player = u8::try_from(p).unwrap() + 1;
            upsert_leaderboard(&mut entries, &mut count, entry(player, (p + 1) * 100));
        }
        assert_eq!(count, LEADERBOARD_SIZE);
        assert_sorted(&entries);
        // Points 2_500 down to 600 are present, the lowest five (100..=500) are not.
        let points: Vec<u64> = entries.iter().map(|e| e.points).collect();
        let expected: Vec<u64> = (6..=25u64).rev().map(|p| p * 100).collect();
        assert_eq!(points, expected);
        for p in 1..=5u8 {
            assert!(entries.iter().all(|e| e.player != pk(p)));
        }

        // A candidate that does not beat the last entry is ignored (ties included).
        assert_eq!(
            upsert_leaderboard(&mut entries, &mut count, entry(77, 600)),
            None
        );
        assert_eq!(
            upsert_leaderboard(&mut entries, &mut count, entry(78, 1)),
            None
        );
        assert!(entries
            .iter()
            .all(|e| e.player != pk(77) && e.player != pk(78)));

        // A newcomer that beats the last entry replaces it and bubbles up.
        assert_eq!(
            upsert_leaderboard(&mut entries, &mut count, entry(79, 1_550)),
            Some(10)
        );
        assert_eq!(count, LEADERBOARD_SIZE);
        assert_sorted(&entries);
        assert!(entries.iter().all(|e| e.points != 600)); // old last place dropped
        assert_eq!(entries[10].player, pk(79));

        // An existing low-rank player with a big game moves to the top.
        let last = entries[19];
        let mut boosted = last;
        boosted.points = 10_000;
        boosted.best_score = 1; // lower than the stored best score
        assert_eq!(
            upsert_leaderboard(&mut entries, &mut count, boosted),
            Some(0)
        );
        assert_eq!(entries[0].player, last.player);
        assert_eq!(entries[0].points, 10_000);
        assert_eq!(entries[0].best_score, last.best_score); // max(old, new)
        assert_eq!(count, LEADERBOARD_SIZE);
        assert_sorted(&entries);
        // Every player appears at most once.
        for i in 0..entries.len() {
            for j in (i + 1)..entries.len() {
                assert_ne!(entries[i].player, entries[j].player);
            }
        }
    }

    #[test]
    fn leaderboard_updates_and_ties() {
        let mut entries = [LeaderEntry::default(); LEADERBOARD_LEN];
        let mut count = 0u8;
        assert_eq!(
            upsert_leaderboard(&mut entries, &mut count, entry(1, 100)),
            Some(0)
        );
        assert_eq!(
            upsert_leaderboard(&mut entries, &mut count, entry(2, 100)),
            Some(1)
        ); // tie keeps order
        assert_eq!(
            upsert_leaderboard(&mut entries, &mut count, entry(3, 50)),
            Some(2)
        );
        assert_eq!(count, 3);

        // Update keeps name/skin fresh and best score maximal.
        let mut update = entry(3, 150);
        update.best_score = 40;
        update.name[0] = b'z';
        update.name_len = 1;
        update.skin = 9;
        assert_eq!(
            upsert_leaderboard(&mut entries, &mut count, update),
            Some(0)
        );
        assert_eq!(count, 3);
        assert_eq!(entries[0].player, pk(3));
        assert_eq!(entries[0].best_score, 50);
        assert_eq!(
            (entries[0].name[0], entries[0].name_len, entries[0].skin),
            (b'z', 1, 9)
        );
        assert_eq!(entries[1].player, pk(1));
        assert_eq!(entries[2].player, pk(2));

        // Equal points do not overtake.
        assert_eq!(
            upsert_leaderboard(&mut entries, &mut count, entry(2, 100)),
            Some(2)
        );
        assert_eq!(
            upsert_leaderboard(&mut entries, &mut count, entry(2, 101)),
            Some(1)
        );
        assert_sorted(&entries[..usize::from(count)]);
    }

    #[test]
    fn apply_game_feeds_leaderboard_entry() {
        let mut profile = PlayerProfile {
            owner: pk(9),
            season: 3,
            season_points: 1_000,
            skin: 4,
            name_len: 3,
            ..Default::default()
        };
        profile.name[..3].copy_from_slice(b"bob");
        let result = apply_game(
            &mut profile,
            3,
            GameResult {
                score: 250,
                kills: 1,
                xp: 10,
            },
            500,
            7,
        );
        let e = leader_entry(&profile, result.score);
        assert_eq!(e.player, pk(9));
        assert_eq!(e.points, 1_500);
        assert_eq!(e.best_score, 250);
        assert_eq!(&e.name[..3], b"bob");
        assert_eq!((e.name_len, e.skin), (3, 4));
    }
}
