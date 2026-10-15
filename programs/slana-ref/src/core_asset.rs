//! Minimal, dependency-free readers for Metaplex Core accounts (Slana Pass).
//!
//! Only the fixed-offset prefix of each account is read (layout of mpl-core 0.12):
//! * `BaseAssetV1`: key `u8` (1 = AssetV1) | owner `Pubkey` | update authority enum
//!   (0 None, 1 Address(Pubkey), 2 Collection(Pubkey)) | name | uri | seq | plugins…
//! * `BaseCollectionV1`: key `u8` (5 = CollectionV1) | update authority `Pubkey` | …

use anchor_lang::prelude::*;

use crate::{constants::MPL_CORE_ID, error::SlanaError};

/// `Key::AssetV1`.
const KEY_ASSET_V1: u8 = 1;
/// `Key::CollectionV1`.
const KEY_COLLECTION_V1: u8 = 5;
/// `UpdateAuthority::Collection`.
const UPDATE_AUTHORITY_COLLECTION: u8 = 2;

/// The parts of a Core asset the program cares about.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CoreAsset {
    pub owner: Pubkey,
    /// The collection the asset belongs to (`None` unless its update authority is a collection).
    pub collection: Option<Pubkey>,
}

/// Reads a Core asset. Anything that is not an `AssetV1` owned by the Core program is
/// `PassWrongCollection` (it cannot be a Slana Pass).
pub fn read_core_asset(info: &AccountInfo) -> Result<CoreAsset> {
    let data = info.try_borrow_data()?;
    parse_core_asset(info.owner, &data)
}

/// Reads a Core collection and returns its update authority (`BadCollection` otherwise).
pub fn read_core_collection(info: &AccountInfo) -> Result<Pubkey> {
    let data = info.try_borrow_data()?;
    parse_core_collection(info.owner, &data)
}

pub(crate) fn parse_core_asset(owner_program: &Pubkey, data: &[u8]) -> Result<CoreAsset> {
    require_keys_eq!(*owner_program, MPL_CORE_ID, SlanaError::PassWrongCollection);
    require!(
        data.len() >= 34 && data[0] == KEY_ASSET_V1,
        SlanaError::PassWrongCollection
    );
    let owner = read_pubkey(&data[1..33]);
    let collection = if data[33] == UPDATE_AUTHORITY_COLLECTION {
        require!(data.len() >= 66, SlanaError::PassWrongCollection);
        Some(read_pubkey(&data[34..66]))
    } else {
        None
    };
    Ok(CoreAsset { owner, collection })
}

pub(crate) fn parse_core_collection(owner_program: &Pubkey, data: &[u8]) -> Result<Pubkey> {
    require_keys_eq!(*owner_program, MPL_CORE_ID, SlanaError::BadCollection);
    require!(
        data.len() >= 33 && data[0] == KEY_COLLECTION_V1,
        SlanaError::BadCollection
    );
    Ok(read_pubkey(&data[1..33]))
}

fn read_pubkey(bytes: &[u8]) -> Pubkey {
    let mut key = [0u8; 32];
    key.copy_from_slice(bytes);
    Pubkey::new_from_array(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code<T: std::fmt::Debug>(res: Result<T>) -> u32 {
        match res.unwrap_err() {
            anchor_lang::error::Error::AnchorError(e) => e.error_code_number,
            other => panic!("unexpected error {other:?}"),
        }
    }

    fn asset_bytes(owner: &Pubkey, authority_kind: u8, authority: Option<&Pubkey>) -> Vec<u8> {
        let mut data = vec![KEY_ASSET_V1];
        data.extend_from_slice(owner.as_ref());
        data.push(authority_kind);
        if let Some(a) = authority {
            data.extend_from_slice(a.as_ref());
        }
        // name "P", uri "u", seq None
        data.extend_from_slice(&[1, 0, 0, 0, b'P', 1, 0, 0, 0, b'u', 0]);
        data
    }

    #[test]
    fn parses_assets() {
        let (owner, collection) = (Pubkey::new_unique(), Pubkey::new_unique());
        let data = asset_bytes(&owner, 2, Some(&collection));
        assert_eq!(
            parse_core_asset(&MPL_CORE_ID, &data).unwrap(),
            CoreAsset {
                owner,
                collection: Some(collection)
            }
        );
        // Address / None update authorities: no collection.
        let data = asset_bytes(&owner, 1, Some(&collection));
        assert_eq!(
            parse_core_asset(&MPL_CORE_ID, &data).unwrap().collection,
            None
        );
        let data = asset_bytes(&owner, 0, None);
        assert_eq!(
            parse_core_asset(&MPL_CORE_ID, &data).unwrap().collection,
            None
        );
    }

    #[test]
    fn rejects_non_assets() {
        let (owner, collection) = (Pubkey::new_unique(), Pubkey::new_unique());
        let good = asset_bytes(&owner, 2, Some(&collection));
        let wrong: u32 = SlanaError::PassWrongCollection.into();
        // Wrong owner program.
        assert_eq!(code(parse_core_asset(&crate::ID, &good)), wrong);
        // Wrong key (a collection).
        let mut bad = good.clone();
        bad[0] = KEY_COLLECTION_V1;
        assert_eq!(code(parse_core_asset(&MPL_CORE_ID, &bad)), wrong);
        // Truncated.
        assert_eq!(code(parse_core_asset(&MPL_CORE_ID, &good[..33])), wrong);
        assert_eq!(code(parse_core_asset(&MPL_CORE_ID, &good[..50])), wrong);
        assert_eq!(code(parse_core_asset(&MPL_CORE_ID, &[])), wrong);
    }

    #[test]
    fn parses_collections() {
        let authority = Pubkey::new_unique();
        let mut data = vec![KEY_COLLECTION_V1];
        data.extend_from_slice(authority.as_ref());
        data.extend_from_slice(&[0; 16]);
        assert_eq!(
            parse_core_collection(&MPL_CORE_ID, &data).unwrap(),
            authority
        );

        let bad: u32 = SlanaError::BadCollection.into();
        assert_eq!(code(parse_core_collection(&crate::ID, &data)), bad);
        data[0] = KEY_ASSET_V1;
        assert_eq!(code(parse_core_collection(&MPL_CORE_ID, &data)), bad);
        assert_eq!(code(parse_core_collection(&MPL_CORE_ID, &[5; 10])), bad);
    }
}
