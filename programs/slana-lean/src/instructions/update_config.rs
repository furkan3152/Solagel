//! `update_config(args: UpdateConfigArgs)` (reference: `instructions/update_config.rs`).
//!
//! Accounts: 0 admin, 1 config.
//!
//! | reference constraint                                    | lean check                     | error |
//! |---------------------------------------------------------|--------------------------------|-------|
//! | `UpdateConfigArgs` Borsh (13 `Option`s, `String` UTF-8) | `Args`                         | 102 |
//! | `admin: Signer`                                         | `check_signer`                 | 3010 |
//! | `config: Account<Config>`                               | `load`                         | 3012 / 3007 / 3001 / 3002 / 3003 |
//! | `config: seeds = [CONFIG_SEED], bump = config.bump`     | `check_admin_config` (`check_pda`) | 2006 |
//! | `config: mut`                                           | `check_admin_config` (`check_writable`) | 2000 |
//! | `config: has_one = admin @ Unauthorized`                | `check_admin_config`           | Unauthorized |
//!
//! The handler applies the fields in the reference's order with the same checks.

use {
    super::{check_admin_config, check_fees, check_settle_fee, check_split},
    crate::error::Result,
    crate::{
        accounts::{data, kind, parse},
        borsh::{
            rd_bool, rd_u16, rd_u32, wr_bool, wr_bytes, wr_i64, wr_u16, wr_u32, wr_u64, wr_u8, Args,
        },
        constants::*,
        error::{
            require, ALREADY_REVEALED, BAD_BASE_URI, INVALID_AMOUNT, INVALID_AUTHORITY, MINT_ENDED,
            SUPPLY_LOCKED, USE_CLOSE_MINT,
        },
        state::config::{self, *},
    },
    pinocchio::AccountView,
};

#[inline(never)]
pub fn process(accounts: &[AccountView], args: &[u8]) -> Result {
    // ----- UpdateConfigArgs (decoded completely before any account is touched) ------------
    let mut a = Args::new(args);
    let admin_arg = if a.some() { Some(a.key()) } else { None };
    let server_authority = if a.some() { Some(a.key()) } else { None };
    let fee_bps = if a.some() { Some(a.u16()) } else { None };
    let pass_fee_bps = if a.some() { Some(a.u16()) } else { None };
    let split = if a.some() {
        Some([a.u16(), a.u16(), a.u16()])
    } else {
        None
    };
    let settle_fee_lamports = if a.some() { Some(a.u64()) } else { None };
    let paused = if a.some() { Some(a.bool()) } else { None };
    let pass_base_uri = if a.some() { Some(a.string()) } else { None };
    let pass_supply = if a.some() { Some(a.u32()) } else { None };
    let pass_per_wallet = if a.some() { Some(a.u8()) } else { None };
    let pass_min_tokens = if a.some() { Some(a.u64()) } else { None };
    let pass_mint_open = if a.some() { Some(a.bool()) } else { None };
    let pass_mint_start_ts = if a.some() { Some(a.i64()) } else { None };
    a.finish()?;

    // ----- accounts --------------------------------------------------------------------------
    let [admin, config_acc] = parse(accounts, &[kind::SIGNER, kind::CONFIG])?;
    // SAFETY: `parse` checked the account holds a `Config` (`config::SPACE` bytes).
    let c = unsafe { data::<{ config::SPACE }>(config_acc) };
    check_admin_config(config_acc, c, admin, true)?;

    // ----- handler ---------------------------------------------------------------------------
    if fee_bps.is_some() || pass_fee_bps.is_some() {
        let fee = fee_bps.unwrap_or(rd_u16(c, FEE_BPS));
        let pass_fee = pass_fee_bps.unwrap_or(rd_u16(c, PASS_FEE_BPS));
        check_fees(fee, pass_fee)?;
        wr_u16(c, FEE_BPS, fee);
        wr_u16(c, PASS_FEE_BPS, pass_fee);
    }
    if let Some([treasury_bps, season_bps, burn_bps]) = split {
        check_split(treasury_bps, season_bps, burn_bps)?;
        wr_u16(c, TREASURY_BPS, treasury_bps);
        wr_u16(c, SEASON_BPS, season_bps);
        wr_u16(c, BURN_BPS, burn_bps);
    }
    if let Some(lamports) = settle_fee_lamports {
        check_settle_fee(lamports)?;
        wr_u64(c, SETTLE_FEE_LAMPORTS, lamports);
    }
    if let Some(key) = admin_arg {
        require(key != [0; 32], INVALID_AUTHORITY)?;
        wr_bytes(c, ADMIN, &key);
    }
    if let Some(key) = server_authority {
        require(key != [0; 32], INVALID_AUTHORITY)?;
        wr_bytes(c, SERVER_AUTHORITY, &key);
    }
    if let Some(paused) = paused {
        wr_bool(c, PAUSED, paused);
    }
    if let Some(uri) = pass_base_uri {
        // Frozen once a Pass is minted (metadata URIs derive from it).
        require(rd_u32(c, PASS_MINTED) == 0, BAD_BASE_URI)?;
        require(uri.len() <= BASE_URI_BYTES, BAD_BASE_URI)?;
        require(!has_control_char(uri), BAD_BASE_URI)?;
        // `mint_pass` appends `<n>.json`.
        require(uri.last() == Some(&b'/'), BAD_BASE_URI)?;
        wr_bytes(c, PASS_BASE_URI, &[0u8; BASE_URI_BYTES]);
        wr_bytes(c, PASS_BASE_URI, uri);
        wr_u8(c, PASS_BASE_URI_LEN, uri.len() as u8);
    }
    if let Some(supply) = pass_supply {
        require(
            !rd_bool(c, PASS_MINT_OPENED) && rd_u32(c, PASS_MINTED) == 0,
            SUPPLY_LOCKED,
        )?;
        require(supply >= 1 && supply <= MAX_PASS_SUPPLY, INVALID_AMOUNT)?;
        wr_u32(c, PASS_SUPPLY, supply);
    }
    if let Some(per_wallet) = pass_per_wallet {
        require(
            per_wallet >= 1 && per_wallet <= MAX_PASS_PER_WALLET,
            INVALID_AMOUNT,
        )?;
        wr_u8(c, PASS_PER_WALLET, per_wallet);
    }
    if let Some(min_tokens) = pass_min_tokens {
        wr_u64(c, PASS_MIN_TOKENS, min_tokens);
    }
    if let Some(open) = pass_mint_open {
        if open {
            // The seed is public from `reveal_pass` on, so the mint must stay closed.
            require(
                !rd_bool(c, PASS_REVEALED) && !rd_bool(c, PASS_SEED_REVEALED),
                ALREADY_REVEALED,
            )?;
            // An ended mint never reopens.
            require(!rd_bool(c, PASS_MINT_ENDED), MINT_ENDED)?;
            wr_bool(c, PASS_MINT_OPENED, true);
        } else if rd_bool(c, PASS_MINT_OPEN) {
            // A started mint ends for good, only through `close_pass_mint`.
            require(rd_u32(c, PASS_MINTED) == 0, USE_CLOSE_MINT)?;
        }
        wr_bool(c, PASS_MINT_OPEN, open);
    }
    if let Some(ts) = pass_mint_start_ts {
        wr_i64(c, PASS_MINT_START_TS, ts);
    }
    Ok(())
}

/// `str::chars().any(char::is_control)` for valid UTF-8: the C0 controls and DEL are single
/// bytes, the C1 controls (U+0080..=U+009F) are `C2 80..=C2 9F`.
pub(crate) fn has_control_char(utf8: &[u8]) -> bool {
    let mut prev = 0u8;
    for &b in utf8 {
        if b < 0x20 || b == 0x7f || (prev == 0xc2 && b >= 0x80 && b <= 0x9f) {
            return true;
        }
        prev = b;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::has_control_char;

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
