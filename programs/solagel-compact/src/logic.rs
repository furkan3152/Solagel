//! Pure helpers (no account access) shared by the instruction handlers.

use crate::prelude::*;

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
        // 1 + floor(sqrt(xp / divisor)) >= required is exactly this threshold.
        // The fixed skin requirements are small, so these products cannot overflow.
        let levels = u64::from(required - 1);
        xp >= levels * levels * XP_LEVEL_DIVISOR
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

/// Exact `amount * bps / 10_000`, rounded down, without wide division.
/// Splitting into quotient and remainder keeps intermediate products in u64;
/// a checked overflow is possible only when the final answer also exceeds u64.
pub fn mul_bps(amount: u64, bps: u16) -> Result<u64> {
    let rate = u64::from(bps);
    let divisor = u64::from(BPS);
    (amount / divisor)
        .checked_mul(rate)
        .and_then(|whole| whole.checked_add((amount % divisor) * rate / divisor))
        .ok_or_else(|| error!(SolagelError::MathOverflow))
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

    #[test]
    fn skin_thresholds_match_reference_levels_at_every_boundary() {
        for (offset, required) in LEVEL_SKIN_REQUIREMENTS.into_iter().enumerate() {
            let skin = LEVEL_SKIN_START + offset as u8;
            let threshold = u64::from(required - 1).pow(2) * XP_LEVEL_DIVISOR;
            for xp in [0, threshold - 1, threshold, threshold + 1, u64::MAX] {
                assert_eq!(is_skin_unlocked(skin, xp, 0), level_from_xp(xp) >= required);
            }
        }
    }

    #[test]
    fn compact_basis_points_match_wide_arithmetic_including_overflow() {
        let amounts = [
            0,
            1,
            9_999,
            10_000,
            10_001,
            u32::MAX as u64,
            u64::MAX / 10_000,
            u64::MAX / 2,
            u64::MAX - 1,
            u64::MAX,
        ];
        for amount in amounts {
            for bps in 0..=u16::MAX {
                compare(amount, bps);
            }
        }
        let mut sample = 0x6a09e667f3bcc909u64;
        for _ in 0..100_000 {
            sample ^= sample << 13;
            sample ^= sample >> 7;
            sample ^= sample << 17;
            compare(sample, (sample >> 32) as u16);
        }
    }

    fn compare(amount: u64, bps: u16) {
        let expected = u64::try_from(u128::from(amount) * u128::from(bps) / u128::from(BPS))
            .map_err(|_| error!(SolagelError::MathOverflow));
        assert_eq!(mul_bps(amount, bps), expected, "amount={amount}, bps={bps}");
    }
}
