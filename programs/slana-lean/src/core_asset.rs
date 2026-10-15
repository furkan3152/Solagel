//! Metaplex Core readers (reference `core_asset.rs`, mpl-core 0.12 layouts):
//!
//! * `BaseAssetV1`: key u8 (1 = AssetV1) | owner Pubkey | update authority enum (0 None,
//!   1 Address(Pubkey), 2 Collection(Pubkey)) | …
//! * `BaseCollectionV1`: key u8 (5 = CollectionV1) | update authority Pubkey | …

use {
    crate::error::Result,
    crate::{
        constants::MPL_CORE_ID,
        error::{err, require, BAD_COLLECTION, PASS_WRONG_COLLECTION},
    },
    pinocchio::AccountView,
};

/// `Key::CollectionV1`.
const KEY_COLLECTION_V1: u8 = 5;
/// `Key::AssetV1`.
const KEY_ASSET_V1: u8 = 1;
/// `UpdateAuthority::Collection`.
const UPDATE_AUTHORITY_COLLECTION: u8 = 2;

/// Reference `read_core_asset`: the asset's owner and its collection (`None` unless the
/// update authority is a collection). Anything that is not an `AssetV1` owned by the Core
/// program (another owner, another key, fewer than 34 bytes, or a collection authority
/// truncated before 66 bytes) is `PassWrongCollection`.
#[inline(never)]
pub fn read_core_asset(info: &AccountView) -> Result<([u8; 32], Option<[u8; 32]>)> {
    require(info.owned_by(&MPL_CORE_ID), PASS_WRONG_COLLECTION)?;
    // SAFETY: no mutable borrow of the data exists.
    parse_core_asset(unsafe { info.borrow_unchecked() })
}

fn parse_core_asset(data: &[u8]) -> Result<([u8; 32], Option<[u8; 32]>)> {
    let Some((&KEY_ASSET_V1, rest)) = data.split_first() else {
        return Err(err(PASS_WRONG_COLLECTION));
    };
    let Some((owner, rest)) = rest.split_first_chunk::<32>() else {
        return Err(err(PASS_WRONG_COLLECTION));
    };
    match rest.split_first() {
        Some((&UPDATE_AUTHORITY_COLLECTION, rest)) => match rest.first_chunk::<32>() {
            Some(collection) => Ok((*owner, Some(*collection))),
            None => Err(err(PASS_WRONG_COLLECTION)),
        },
        Some(_) => Ok((*owner, None)),
        None => Err(err(PASS_WRONG_COLLECTION)),
    }
}

/// Reference `read_core_collection`: the update authority of a Core collection; anything
/// else (another owner, another key, fewer than 33 bytes) is `BadCollection`.
#[inline(never)]
pub fn read_core_collection(info: &AccountView) -> Result<[u8; 32]> {
    require(info.owned_by(&MPL_CORE_ID), BAD_COLLECTION)?;
    // SAFETY: no mutable borrow of the data exists.
    let data = unsafe { info.borrow_unchecked() };
    parse_core_collection(data)
}

fn parse_core_collection(data: &[u8]) -> Result<[u8; 32]> {
    match data.split_first() {
        Some((&KEY_COLLECTION_V1, rest)) => match rest.first_chunk::<32>() {
            Some(authority) => Ok(*authority),
            None => Err(crate::error::err(BAD_COLLECTION)),
        },
        _ => Err(crate::error::err(BAD_COLLECTION)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_collections_like_the_reference() {
        let authority = [3u8; 32];
        let mut data = vec![KEY_COLLECTION_V1];
        data.extend_from_slice(&authority);
        data.extend_from_slice(&[0; 16]);
        assert_eq!(parse_core_collection(&data), Ok(authority));
        assert_eq!(parse_core_collection(&data[..33]), Ok(authority));

        let bad = Err(crate::error::err(BAD_COLLECTION));
        assert_eq!(parse_core_collection(&data[..32]), bad);
        assert_eq!(parse_core_collection(&[]), bad);
        data[0] = 1; // AssetV1
        assert_eq!(parse_core_collection(&data), bad);
    }

    /// Same inputs through the reference parser (with the Core program as owner).
    #[test]
    fn parses_assets_like_the_reference() {
        use anchor_lang::prelude::Pubkey;
        let (owner, collection) = ([1u8; 32], [2u8; 32]);
        let asset = |kind: u8, authority: Option<&[u8; 32]>| {
            let mut d = vec![KEY_ASSET_V1];
            d.extend_from_slice(&owner);
            d.push(kind);
            if let Some(a) = authority {
                d.extend_from_slice(a);
            }
            d.extend_from_slice(&[1, 0, 0, 0, b'P', 1, 0, 0, 0, b'u', 0]);
            d
        };
        let good = asset(2, Some(&collection));
        let mut cases = vec![
            good.clone(),
            asset(1, Some(&collection)),
            asset(0, None),
            good[..33].to_vec(),
            good[..34].to_vec(),
            good[..50].to_vec(),
            good[..65].to_vec(),
            good[..66].to_vec(),
            vec![],
        ];
        let mut wrong_key = good.clone();
        wrong_key[0] = KEY_COLLECTION_V1;
        cases.push(wrong_key);
        let core = slana::constants::MPL_CORE_ID;
        for mut data in cases {
            let lean = parse_core_asset(&data);
            let (key, mut lamports) = (Pubkey::new_unique(), 1u64);
            let info = anchor_lang::prelude::AccountInfo::new(
                &key,
                false,
                false,
                &mut lamports,
                &mut data,
                &core,
                false,
            );
            match slana::core_asset::read_core_asset(&info) {
                Ok(a) => assert_eq!(
                    lean,
                    Ok((
                        a.owner.to_bytes(),
                        a.collection.map(|c: Pubkey| c.to_bytes())
                    ))
                ),
                Err(_) => assert_eq!(lean, Err(err(PASS_WRONG_COLLECTION))),
            }
        }
    }
}
