//! Metaplex Core readers (reference `core_asset.rs`, mpl-core 0.12 layouts). Only the part
//! `set_pass_collection` needs is ported here; the asset reader comes with the Pass
//! instructions.
//!
//! `BaseCollectionV1`: key u8 (5 = CollectionV1) | update authority Pubkey | …

use {
    crate::error::Result,
    crate::{
        constants::MPL_CORE_ID,
        error::{require, BAD_COLLECTION},
    },
    pinocchio::AccountView,
};

/// `Key::CollectionV1`.
const KEY_COLLECTION_V1: u8 = 5;

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
}
