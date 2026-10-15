//! Pure helpers (no account access) shared by the instruction handlers.

use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::SlanaError,
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

/// How a stake payout is split (all amounts in base units of the game token).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct FeeSplit {
    /// Total fee (only charged on profit): `treasury + season + burn`.
    pub fee: u64,
    /// Part of the fee that goes to the treasury vault.
    pub treasury: u64,
    /// Part of the fee that goes to the season vault (gets the rounding remainder).
    pub season: u64,
    /// Part of the fee that is burned.
    pub burn: u64,
    /// What the player receives (`payout - fee`).
    pub player: u64,
}

/// Splits `payout` for a session that was opened with `entry_fee`.
///
/// `fee = (payout - entry_fee)⁺ * fee_bps / 10_000`,
/// `treasury = fee * treasury_bps / 10_000`, `burn = fee * burn_bps / 10_000`,
/// `season = fee - treasury - burn` (the rounding remainder), `player = payout - fee`.
/// Every step is checked; shares above 100 % fail with `MathOverflow`.
pub fn split_payout(
    payout: u64,
    entry_fee: u64,
    fee_bps: u16,
    treasury_bps: u16,
    burn_bps: u16,
) -> Result<FeeSplit> {
    let profit = payout.saturating_sub(entry_fee);
    let fee = mul_bps(profit, fee_bps)?;
    let treasury = mul_bps(fee, treasury_bps)?;
    let burn = mul_bps(fee, burn_bps)?;
    let season = fee
        .checked_sub(treasury)
        .and_then(|rest| rest.checked_sub(burn))
        .ok_or(SlanaError::MathOverflow)?;
    let player = payout.checked_sub(fee).ok_or(SlanaError::MathOverflow)?;
    Ok(FeeSplit {
        fee,
        treasury,
        season,
        burn,
        player,
    })
}

/// Prize of leaderboard `rank` (0-based) for a frozen `prize_pool`.
pub fn prize_amount(prize_pool: u64, rank: usize) -> Result<u64> {
    let share = *PRIZE_SHARES_BPS.get(rank).ok_or(SlanaError::NotEligible)?;
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

/// Applies one finished game to a profile (stats, XP, season points).
///
/// Score is clamped to `MAX_SCORE_PER_GAME` and XP to `MAX_XP_PER_GAME`. Season points
/// are reset when the profile still carries points from an older season, and the score is
/// added to them only when `season_points` is set (Pass sessions). All counters saturate so
/// a settlement can never fail because of statistics.
pub fn apply_game(
    profile: &mut PlayerProfile,
    current_season: u32,
    score: u32,
    kills: u16,
    xp: u32,
    now: i64,
    season_points: bool,
) -> GameResult {
    let score = score.min(MAX_SCORE_PER_GAME);
    let xp = xp.min(MAX_XP_PER_GAME);

    profile.games_played = profile.games_played.saturating_add(1);
    profile.kills = profile.kills.saturating_add(u32::from(kills));
    profile.best_score = profile.best_score.max(score);
    profile.total_score = profile.total_score.saturating_add(u64::from(score));
    profile.xp = profile.xp.saturating_add(u64::from(xp));
    if profile.season != current_season {
        profile.season = current_season;
        profile.season_points = 0;
    }
    if season_points {
        profile.season_points = profile.season_points.saturating_add(u64::from(score));
    }
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

// ---------------------------------------------------------------------------
// Pass trait entropy
// ---------------------------------------------------------------------------

/// What the SlotHashes sysvar says about a target slot (see `find_slot_hash`).
#[derive(Debug, PartialEq, Eq)]
pub enum SlotHashLookup {
    /// The first slot with a block at or after the target, and its hash.
    Found(u64, [u8; 32]),
    /// The newest entry is still before the target.
    NotYet,
    /// The window (oldest entry) has moved past the target: the answer can no longer be read.
    Missed,
}

/// Looks up `target` in the SlotHashes sysvar account data; `None` when the data is malformed
/// or empty.
///
/// `SlotHashes::get()` has no syscall on-chain (the sysvar is ~20 KB), so the account is
/// passed in and its bincode layout is read by hand:
///
/// ```text
/// [0..8)              len: u64 LE                   number of entries (≤ 512)
/// [8 + 40 i .. +8)    entries[i].slot: u64 LE       newest entry first, strictly decreasing
/// [16 + 40 i .. +32)  entries[i].hash: [u8; 32]
/// ```
///
/// Slots without a block have no entry, so the answer is the smallest slot `≥ target`. It is
/// only trusted while the oldest entry is `≤ target` (the window still covers the target);
/// otherwise the result is `Missed`. A linear scan over at most 512 entries.
pub fn find_slot_hash(data: &[u8], target: u64) -> Option<SlotHashLookup> {
    let len = u64::from_le_bytes(data.get(0..8)?.try_into().ok()?);
    let len = usize::try_from(len).ok()?;
    if len == 0 || data.len() < len.checked_mul(40)?.checked_add(8)? {
        return None;
    }
    let slot_at = |i: usize| -> u64 {
        let o = 8 + 40 * i;
        u64::from_le_bytes(data[o..o + 8].try_into().unwrap_or_default())
    };
    if slot_at(0) < target {
        return Some(SlotHashLookup::NotYet);
    }
    if slot_at(len - 1) > target {
        return Some(SlotHashLookup::Missed);
    }
    // Newest first: the last entry with slot ≥ target is the smallest one.
    let mut best = 0;
    for i in 0..len {
        if slot_at(i) >= target {
            best = i;
        } else {
            break;
        }
    }
    let o = 8 + 40 * best;
    let hash: [u8; 32] = data[o + 8..o + 40].try_into().ok()?;
    Some(SlotHashLookup::Found(slot_at(best), hash))
}

/// Lowercase hex of 32 bytes (for the readable capture log line).
pub fn hex32(bytes: &[u8; 32]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(64);
    for b in bytes {
        out.push(char::from(DIGITS[usize::from(b >> 4)]));
        out.push(char::from(DIGITS[usize::from(b & 0x0f)]));
    }
    out
}

/// `sha256(seed || entropy)`: the seed every Pass trait is derived from after the reveal.
pub fn pass_final_seed(seed: &[u8; 32], entropy: &[u8; 32]) -> [u8; 32] {
    solana_sha256_hasher::hashv(&[seed, entropy]).to_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slot_hashes(entries: &[(u64, u8)]) -> Vec<u8> {
        let mut data = (entries.len() as u64).to_le_bytes().to_vec();
        for (slot, b) in entries {
            data.extend_from_slice(&slot.to_le_bytes());
            data.extend_from_slice(&[*b; 32]);
        }
        data
    }

    #[test]
    fn finds_the_first_slot_hash_at_or_after_the_target() {
        use SlotHashLookup::*;
        // Slot 41 was skipped (no block, no entry).
        let data = slot_hashes(&[(44, 4), (43, 3), (42, 2), (40, 0), (39, 9)]);
        assert_eq!(find_slot_hash(&data, 43), Some(Found(43, [3; 32])));
        assert_eq!(find_slot_hash(&data, 41), Some(Found(42, [2; 32])));
        assert_eq!(find_slot_hash(&data, 39), Some(Found(39, [9; 32])));
        assert_eq!(find_slot_hash(&data, 44), Some(Found(44, [4; 32])));
        assert_eq!(find_slot_hash(&data, 45), Some(NotYet));
        assert_eq!(find_slot_hash(&data, 38), Some(Missed));
        // Malformed: empty list, truncated entries.
        assert_eq!(find_slot_hash(&0u64.to_le_bytes(), 1), None);
        assert_eq!(find_slot_hash(&data[..data.len() - 1], 43), None);
        assert_eq!(find_slot_hash(&[], 1), None);
    }

    #[test]
    fn skipped_target_edges() {
        use SlotHashLookup::*;
        // The target and the slots right after it were skipped: the next block counts.
        let data = slot_hashes(&[(50, 5), (48, 8)]);
        assert_eq!(find_slot_hash(&data, 49), Some(Found(50, [5; 32])));
        // A skipped target just above the oldest entry is still covered by the window.
        let data = slot_hashes(&[(60, 6), (59, 9), (40, 4)]);
        assert_eq!(find_slot_hash(&data, 41), Some(Found(59, [9; 32])));
        // A skipped target older than every entry: the window no longer proves which block
        // came first after it, so it is a miss (re-target), never a guess.
        let data = slot_hashes(&[(60, 6), (59, 9)]);
        assert_eq!(find_slot_hash(&data, 58), Some(Missed));
        // A skipped newest slot: nothing at or after the target yet.
        assert_eq!(find_slot_hash(&data, 61), Some(NotYet));
    }

    #[test]
    fn hex32_is_lowercase_hex() {
        let mut b = [0u8; 32];
        b[0] = 0xab;
        b[31] = 0x0f;
        let h = hex32(&b);
        assert_eq!(h.len(), 64);
        assert!(h.starts_with("ab00"));
        assert!(h.ends_with("000f"));
    }

    #[test]
    fn final_seed_is_sha256_of_seed_then_entropy() {
        let mut both = [7u8; 32].to_vec();
        both.extend_from_slice(&[9u8; 32]);
        assert_eq!(
            pass_final_seed(&[7; 32], &[9; 32]),
            solana_sha256_hasher::hash(&both).to_bytes()
        );
        assert_ne!(
            pass_final_seed(&[7; 32], &[9; 32]),
            pass_final_seed(&[9; 32], &[7; 32])
        );
        // Same vector as the TypeScript `finalSeedHex` test (sha256 of 64 zero bytes).
        let zero = pass_final_seed(&[0; 32], &[0; 32]);
        let hex: String = zero.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(
            hex,
            "f5a5fd42d16a20302798ef6ed309979b43003d2320d9f0e8ea9831a92759fb4b"
        );
    }

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

    fn err_code(e: SlanaError) -> u32 {
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
            split_payout(100, 100, 500, 5_000, 2_000).unwrap(),
            FeeSplit {
                player: 100,
                ..Default::default()
            }
        );
        assert_eq!(
            split_payout(50, 100, 500, 5_000, 2_000).unwrap(),
            FeeSplit {
                player: 50,
                ..Default::default()
            }
        );
        assert_eq!(
            split_payout(0, 100, 1_000, 5_000, 2_000).unwrap(),
            FeeSplit::default()
        );
        // Profit 900 at 5 %: fee 45 = treasury 22 + burn 9 + season 14.
        assert_eq!(
            split_payout(1_000, 100, 500, 5_000, 2_000).unwrap(),
            FeeSplit {
                fee: 45,
                treasury: 22,
                season: 14,
                burn: 9,
                player: 955,
            }
        );
        // Plan example from the spec: entry 1000, payout 2000, 5 % and 2 % (Pass).
        let s = split_payout(2_000, 1_000, 500, 5_000, 2_000).unwrap();
        assert_eq!(
            (s.fee, s.treasury, s.season, s.burn, s.player),
            (50, 25, 15, 10, 1_950)
        );
        assert_eq!(
            split_payout(2_000, 1_000, 200, 5_000, 2_000).unwrap().fee,
            20
        );
        // Large values do not overflow.
        let s = split_payout(u64::MAX, 0, MAX_FEE_BPS, BPS, 0).unwrap();
        assert_eq!((s.fee, s.treasury), (u64::MAX / 10, u64::MAX / 10));
        assert_eq!(s.player, u64::MAX - u64::MAX / 10);
    }

    #[test]
    fn split_payout_remainder_goes_to_season() {
        // fee 9: treasury floor(4.5) = 4, burn floor(1.8) = 1, season gets the rest (4).
        let s = split_payout(1_199, 1_000, 500, 5_000, 2_000).unwrap();
        assert_eq!(
            (s.fee, s.treasury, s.burn, s.season, s.player),
            (9, 4, 1, 4, 1_190)
        );
        // fee 1: both floors are 0, the whole fee goes to the season.
        let s = split_payout(120, 100, 500, 5_000, 2_000).unwrap();
        assert_eq!((s.fee, s.treasury, s.burn, s.season), (1, 0, 0, 1));
        // Extreme splits.
        let s = split_payout(2_000, 1_000, 1_000, 10_000, 0).unwrap();
        assert_eq!((s.treasury, s.burn, s.season), (100, 0, 0));
        let s = split_payout(2_000, 1_000, 1_000, 0, 10_000).unwrap();
        assert_eq!((s.treasury, s.burn, s.season), (0, 100, 0));
        // A split above 100 % cannot underflow silently.
        assert_eq!(
            code(split_payout(2_000, 1_000, 1_000, 10_000, 10_000).unwrap_err()),
            err_code(SlanaError::MathOverflow)
        );
        // Conservation over a range of inputs.
        for payout in (0..5_000_000u64).step_by(7_919) {
            for entry_fee in [1u64, 999, 1_000_000, 2_500_000] {
                for (fee_bps, t, b) in [
                    (0, 5_000, 2_000),
                    (500, 5_000, 2_000),
                    (1_000, 3_333, 3_333),
                    (137, 10_000, 0),
                    (200, 0, 0),
                ] {
                    let s = split_payout(payout, entry_fee, fee_bps, t, b).unwrap();
                    assert_eq!(s.player + s.fee, payout);
                    assert_eq!(s.treasury + s.season + s.burn, s.fee);
                    assert!(s.fee <= payout.saturating_sub(entry_fee));
                    assert!(s.season >= mul_bps(s.fee, BPS - t - b).unwrap());
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
            err_code(SlanaError::NotEligible)
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
    fn apply_game_updates_profile() {
        let mut profile = PlayerProfile {
            owner: pk(1),
            season: 1,
            ..Default::default()
        };
        let r = apply_game(&mut profile, 1, 5_000, 3, 120, 42, true);
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
        let r = apply_game(&mut profile, 1, u32::MAX, u16::MAX, u32::MAX, 43, true);
        assert_eq!(r.score, MAX_SCORE_PER_GAME);
        assert_eq!(r.xp, MAX_XP_PER_GAME);
        assert_eq!(profile.best_score, MAX_SCORE_PER_GAME);
        assert_eq!(profile.xp, 120 + u64::from(MAX_XP_PER_GAME));
        assert_eq!(profile.kills, 3 + u32::from(u16::MAX));
        assert_eq!(profile.season_points, 5_000 + u64::from(MAX_SCORE_PER_GAME));

        // A lower score keeps the best score.
        apply_game(&mut profile, 1, 10, 0, 0, 44, true);
        assert_eq!(profile.best_score, MAX_SCORE_PER_GAME);

        // New season resets season points only.
        let total_before = profile.total_score;
        apply_game(&mut profile, 2, 700, 0, 0, 45, true);
        assert_eq!(profile.season, 2);
        assert_eq!(profile.season_points, 700);
        assert_eq!(profile.total_score, total_before + 700);
        assert_eq!(profile.games_played, 4);

        // Saturation instead of overflow.
        profile.xp = u64::MAX - 1;
        profile.games_played = u32::MAX;
        apply_game(&mut profile, 2, 0, 0, 10, 46, true);
        assert_eq!(profile.xp, u64::MAX);
        assert_eq!(profile.games_played, u32::MAX);
    }

    #[test]
    fn apply_game_adds_season_points_only_when_asked() {
        let mut profile = PlayerProfile {
            owner: pk(1),
            season: 1,
            season_points: 300,
            ..Default::default()
        };
        // Without season points: stats and XP still count.
        let r = apply_game(&mut profile, 1, 5_000, 2, 100, 10, false);
        assert_eq!(r.score, 5_000);
        assert_eq!(profile.season_points, 300);
        assert_eq!(profile.games_played, 1);
        assert_eq!(profile.total_score, 5_000);
        assert_eq!(profile.best_score, 5_000);
        assert_eq!(profile.xp, 100);
        assert_eq!(profile.kills, 2);
        assert_eq!(profile.last_played, 10);

        // With season points.
        apply_game(&mut profile, 1, 700, 0, 0, 11, true);
        assert_eq!(profile.season_points, 1_000);

        // A new season still resets stale points even when no points are added.
        apply_game(&mut profile, 2, 900, 0, 0, 12, false);
        assert_eq!((profile.season, profile.season_points), (2, 0));
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
        let result = apply_game(&mut profile, 3, 250, 1, 10, 7, true);
        let e = leader_entry(&profile, result.score);
        assert_eq!(e.player, pk(9));
        assert_eq!(e.points, 1_250);
        assert_eq!(e.best_score, 250);
        assert_eq!(&e.name[..3], b"bob");
        assert_eq!((e.name_len, e.skin), (3, 4));
    }
}
