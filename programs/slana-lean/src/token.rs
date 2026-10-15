//! Token accounts and mints of SPL Token / Token-2022, read in place.
//!
//! * [`load_mint`] / [`load_token_account`] mirror Anchor's `InterfaceAccount<'info, Mint>` /
//!   `InterfaceAccount<'info, TokenAccount>`: the owner check of [`accounts::check_owner`]
//!   against both token programs, then `StateWithExtensions::<S>::unpack` (base state and
//!   account-type byte), failing with the same `ProgramError`s.
//! * [`validate_mint`] ports `token::validate_mint` of the reference (the R7 deny-list).
//! * [`token_account_space`] is the size Anchor's `init, token::mint = ..` allocates.
//!
//! Layouts (both programs): `Mint` = mint_authority COption<Pubkey> (36) | supply u64 |
//! decimals u8 | is_initialized bool | freeze_authority COption<Pubkey> (36) = 82 bytes;
//! `Account` = mint | owner | amount u64 | delegate COption<Pubkey> | state u8 |
//! is_native COption<u64> (12) | delegated_amount u64 | close_authority COption<Pubkey> =
//! 165 bytes. Token-2022 extensions: zero padding up to 165, the account-type byte at 165
//! (1 = mint, 2 = account), then TLV entries (type u16, length u16, value).

use {
    crate::error::{Error, Result},
    crate::{
        accounts,
        constants::{TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID},
        error::{
            err, require, ACCOUNT_OWNED_BY_WRONG_PROGRAM, FREEZE_AUTHORITY_PRESENT,
            INVALID_PROGRAM_ID, MINT_NOT_ALLOWED,
        },
    },
    pinocchio::{AccountView, Address},
};

pub const MINT_LEN: usize = 82;
pub const ACCOUNT_LEN: usize = 165;
const MULTISIG_LEN: usize = 355;

pub const MINT_DECIMALS: usize = 44;
const MINT_IS_INITIALIZED: usize = 45;
const MINT_FREEZE_AUTHORITY: usize = 46;

pub const ACCOUNT_MINT: usize = 0;
pub const ACCOUNT_OWNER: usize = 32;
pub const ACCOUNT_AMOUNT: usize = 64;
const ACCOUNT_STATE: usize = 108;

const ACCOUNT_TYPE_MINT: u8 = 1;
const ACCOUNT_TYPE_ACCOUNT: u8 = 2;

/// Highest `ExtensionType` the reference's spl-token-2022 knows (`PausableAccount`).
const MAX_EXTENSION_TYPE: u16 = 27;

/// Mint extensions the reference refuses (`token::DENIED_MINT_EXTENSIONS`), as a bit set over
/// `ExtensionType` numbers: TransferFeeConfig (1), MintCloseAuthority (3),
/// ConfidentialTransferMint (4), DefaultAccountState (6), NonTransferable (9),
/// PermanentDelegate (12), TransferHook (14), ConfidentialTransferFeeConfig (16),
/// ConfidentialMintBurn (24), Pausable (26).
pub const DENIED_MINT_EXTENSIONS: u32 = (1 << 1)
    | (1 << 3)
    | (1 << 4)
    | (1 << 6)
    | (1 << 9)
    | (1 << 12)
    | (1 << 14)
    | (1 << 16)
    | (1 << 24)
    | (1 << 26);

#[inline(always)]
fn is_token_program(id: &Address) -> bool {
    id == &TOKEN_PROGRAM_ID || id == &TOKEN_2022_PROGRAM_ID
}

/// `Interface<'info, TokenInterface>`: SPL Token or Token-2022 (`InvalidProgramId`), and
/// executable (`InvalidProgramExecutable`).
#[inline(never)]
pub fn check_token_program(acc: &AccountView) -> Result {
    require(is_token_program(acc.address()), INVALID_PROGRAM_ID)?;
    accounts::check_executable(acc)
}

/// spl-token `COption` tag: `[0,0,0,0]` None, `[1,0,0,0]` Some.
#[inline(always)]
// Bound: `off` is a constant offset below 165.
#[allow(clippy::arithmetic_side_effects)]
fn coption_ok(d: &[u8], off: usize) -> bool {
    matches!(d.get(off..off + 4), Some([0 | 1, 0, 0, 0]))
}

/// `StateWithExtensions::<S>::unpack` for a base state of `base_len` bytes:
/// * length below `base_len` or equal to a multisig → `InvalidAccountData`;
/// * `base_ok` (the `Pack::unpack_from_slice` validity) false → `InvalidAccountData`,
///   `initialized` false → `UninitializedAccount`;
/// * with extensions: zero padding up to 165, then the account type `account_type`
///   → else `InvalidAccountData`.
fn unpack_state(
    d: &[u8],
    base_len: usize,
    base_ok: bool,
    initialized: bool,
    account_type: u8,
) -> Result {
    if d.len() == MULTISIG_LEN || d.len() < base_len {
        return Err(Error::INVALID_ACCOUNT_DATA);
    }
    if !base_ok {
        return Err(Error::INVALID_ACCOUNT_DATA);
    }
    if !initialized {
        return Err(Error::UNINITIALIZED_ACCOUNT);
    }
    if d.len() > base_len {
        let padding = d.get(base_len..ACCOUNT_LEN);
        let ok = matches!(padding, Some(p) if p.iter().all(|b| *b == 0))
            && d.get(ACCOUNT_LEN) == Some(&account_type);
        if !ok {
            return Err(Error::INVALID_ACCOUNT_DATA);
        }
    }
    Ok(())
}

/// `InterfaceAccount<'info, Mint>`: owner (empty system account `AccountNotInitialized`,
/// another program `AccountOwnedByWrongProgram`), then the mint unpack.
#[inline(never)]
pub fn load_mint(acc: &AccountView) -> Result<&[u8; MINT_LEN]> {
    check_token_owner(acc)?;
    // SAFETY: no mutable borrow of the data exists.
    let d = unsafe { acc.borrow_unchecked() };
    let initialized = d.get(MINT_IS_INITIALIZED).copied();
    let base_ok = coption_ok(d, 0)
        && matches!(initialized, Some(0 | 1))
        && coption_ok(d, MINT_FREEZE_AUTHORITY);
    unpack_state(
        d,
        MINT_LEN,
        base_ok,
        initialized == Some(1),
        ACCOUNT_TYPE_MINT,
    )?;
    // SAFETY: `unpack_state` checked `len >= MINT_LEN`.
    Ok(unsafe { accounts::data(acc) })
}

/// `InterfaceAccount<'info, TokenAccount>`: owner as [`load_mint`], then the account unpack.
#[inline(never)]
pub fn load_token_account(acc: &AccountView) -> Result<&[u8; ACCOUNT_LEN]> {
    check_token_owner(acc)?;
    // SAFETY: no mutable borrow of the data exists.
    let d = unsafe { acc.borrow_unchecked() };
    let state = d.get(ACCOUNT_STATE).copied();
    let base_ok = coption_ok(d, 72)
        && matches!(state, Some(0..=2))
        && coption_ok(d, 109)
        && coption_ok(d, 129);
    unpack_state(
        d,
        ACCOUNT_LEN,
        base_ok,
        state != Some(0),
        ACCOUNT_TYPE_ACCOUNT,
    )?;
    // SAFETY: `unpack_state` checked `len >= ACCOUNT_LEN`.
    Ok(unsafe { accounts::data(acc) })
}

/// Owner of an `InterfaceAccount` of the token interface (`Owners::check_owner`).
fn check_token_owner(acc: &AccountView) -> Result {
    if !is_token_program(acc.owner()) {
        // `check_owner` reports the empty system account first, like `try_from`.
        accounts::check_owner(acc, &TOKEN_PROGRAM_ID)?;
        return Err(err(ACCOUNT_OWNED_BY_WRONG_PROGRAM));
    }
    Ok(())
}

/// The extension types of a mint's TLV data as a bit set (bit `t` = `ExtensionType` `t`),
/// walking it like spl-token-2022's `get_tlv_data_info`; `Err` where that fails (an unknown
/// type, a truncated header or a value past the end).
// Bound: `at` never exceeds `tlv.len()` (account data, at most 10 MiB) and a TLV header adds
// at most 4 + u16::MAX, so no sum can wrap.
#[allow(clippy::arithmetic_side_effects)]
fn mint_extensions(d: &[u8]) -> core::result::Result<u32, ()> {
    let tlv = d.get(ACCOUNT_LEN + 1..).unwrap_or(&[]);
    let mut mask = 0u32;
    let mut at = 0usize;
    while at < tlv.len() {
        // Fewer than two bytes left: no further type, the end.
        let Some(&[t0, t1]) = tlv.get(at..at + 2) else {
            break;
        };
        let ty = u16::from_le_bytes([t0, t1]);
        if ty == 0 {
            break;
        }
        if ty > MAX_EXTENSION_TYPE {
            return Err(());
        }
        let Some(&[l0, l1]) = tlv.get(at + 2..at + 4) else {
            return Err(());
        };
        let end = at + 4 + usize::from(u16::from_le_bytes([l0, l1]));
        if end > tlv.len() {
            return Err(());
        }
        mask |= 1 << ty;
        at = end;
    }
    Ok(mask)
}

/// Reference `token::validate_mint`: returns the mint's decimals.
/// * the token program must be SPL Token or Token-2022, and own the mint (`MintNotAllowed`);
/// * the mint must unpack and be initialized (`MintNotAllowed`);
/// * no freeze authority (`FreezeAuthorityPresent`);
/// * a Token-2022 mint's extensions must parse and avoid [`DENIED_MINT_EXTENSIONS`]
///   (`MintNotAllowed`).
#[inline(never)]
pub fn validate_mint(mint: &AccountView, token_program: &Address) -> Result<u8> {
    require(is_token_program(token_program), MINT_NOT_ALLOWED)?;
    require(mint.owner() == token_program, MINT_NOT_ALLOWED)?;
    let d = load_mint(mint).map_err(|_| err(MINT_NOT_ALLOWED))?;
    require(d[MINT_FREEZE_AUTHORITY] == 0, FREEZE_AUTHORITY_PRESENT)?;
    if token_program == &TOKEN_2022_PROGRAM_ID {
        // SAFETY: no mutable borrow of the data exists.
        let all = unsafe { mint.borrow_unchecked() };
        let mask = mint_extensions(all).map_err(|_| err(MINT_NOT_ALLOWED))?;
        require(mask & DENIED_MINT_EXTENSIONS == 0, MINT_NOT_ALLOWED)?;
    }
    Ok(d[MINT_DECIMALS])
}

/// Size of a token account Anchor's `init, token::mint = mint` allocates: 165 for an SPL
/// Token mint; for a Token-2022 mint `try_calculate_account_len::<Account>` of the account
/// extensions the mint requires (`get_required_init_account_extensions`):
/// TransferFeeConfig → TransferFeeAmount (8 bytes), NonTransferable →
/// NonTransferableAccount + ImmutableOwner (0 + 0), TransferHook → TransferHookAccount (1),
/// Pausable → PausableAccount (0); each TLV entry adds a 4-byte header, and any extension adds
/// the account-type byte. (No combination reaches the multisig length.)
#[inline(never)]
pub fn token_account_space(mint: &AccountView) -> Result<usize> {
    if mint.owner() != &TOKEN_2022_PROGRAM_ID {
        return Ok(ACCOUNT_LEN);
    }
    load_mint(mint)?;
    // SAFETY: no mutable borrow of the data exists.
    let mask = mint_extensions(unsafe { mint.borrow_unchecked() })
        .map_err(|_| Error::INVALID_ACCOUNT_DATA)?;
    Ok(account_space_for(mask))
}

/// `try_calculate_account_len::<Account>(get_required_init_account_extensions(mint))` for a
/// mint with the extension set `mask`.
// Bound: a sum of at most five small constants (< 200).
#[allow(clippy::arithmetic_side_effects)]
fn account_space_for(mask: u32) -> usize {
    let mut extra = 0;
    if mask & (1 << 1) != 0 {
        extra += 4 + 8;
    }
    if mask & (1 << 9) != 0 {
        extra += 4 + 4;
    }
    if mask & (1 << 14) != 0 {
        extra += 4 + 1;
    }
    if mask & (1 << 26) != 0 {
        extra += 4;
    }
    if extra == 0 {
        ACCOUNT_LEN
    } else {
        ACCOUNT_LEN + 1 + extra
    }
}

#[cfg(test)]
mod tests {
    use {
        super::*,
        anchor_spl::token_2022::spl_token_2022::{
            extension::ExtensionType,
            state::{Account, Mint},
        },
    };

    #[test]
    fn deny_list_matches_the_reference() {
        let mut mask = 0u32;
        for ext in slana::token::DENIED_MINT_EXTENSIONS {
            mask |= 1 << u16::from(ext);
        }
        assert_eq!(mask, DENIED_MINT_EXTENSIONS);
        assert_eq!(
            u16::from(ExtensionType::PausableAccount),
            MAX_EXTENSION_TYPE
        );
        assert!(ExtensionType::try_from(MAX_EXTENSION_TYPE + 1).is_err());
    }

    fn tlv(entries: &[(u16, &[u8])]) -> Vec<u8> {
        let mut d = vec![0u8; ACCOUNT_LEN];
        d.push(ACCOUNT_TYPE_MINT);
        for (ty, value) in entries {
            d.extend_from_slice(&ty.to_le_bytes());
            d.extend_from_slice(&(value.len() as u16).to_le_bytes());
            d.extend_from_slice(value);
        }
        d
    }

    #[test]
    fn walks_tlv_like_token_2022() {
        assert_eq!(mint_extensions(&[0u8; MINT_LEN]), Ok(0));
        assert_eq!(
            mint_extensions(&tlv(&[(18, &[1; 64]), (3, &[2; 32])])),
            Ok((1 << 18) | (1 << 3))
        );
        // Trailing zero type / single trailing byte end the walk.
        let mut d = tlv(&[(18, &[1; 64])]);
        d.extend_from_slice(&[0, 0, 9, 9]);
        assert_eq!(mint_extensions(&d), Ok(1 << 18));
        let mut d = tlv(&[(18, &[1; 64])]);
        d.push(5);
        assert_eq!(mint_extensions(&d), Ok(1 << 18));
        // Malformed: unknown type, missing length, value past the end.
        assert!(mint_extensions(&tlv(&[(28, &[])])).is_err());
        let mut d = tlv(&[]);
        d.extend_from_slice(&[18, 0, 4]);
        assert!(mint_extensions(&d).is_err());
        let mut d = tlv(&[]);
        d.extend_from_slice(&[18, 0, 4, 0, 1]);
        assert!(mint_extensions(&d).is_err());
    }

    /// The space formula equals spl-token-2022's own computation for every mint extension.
    #[test]
    fn account_space_matches_token_2022() {
        for ty in 1..=MAX_EXTENSION_TYPE {
            let ext = ExtensionType::try_from(ty).unwrap();
            if ext.get_account_type()
                != anchor_spl::token_2022::spl_token_2022::extension::AccountType::Mint
            {
                continue;
            }
            let required = ExtensionType::get_required_init_account_extensions(&[ext]);
            let expected = ExtensionType::try_calculate_account_len::<Account>(&required).unwrap();
            let ours = account_space_for(1u32 << ty);
            assert_eq!(ours, expected, "{ext:?}");
        }
        assert_eq!(
            ExtensionType::try_calculate_account_len::<Mint>(&[]).unwrap(),
            MINT_LEN
        );
        assert_eq!(
            ExtensionType::try_calculate_account_len::<Account>(&[]).unwrap(),
            ACCOUNT_LEN
        );
    }
}
