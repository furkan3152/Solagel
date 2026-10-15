//! Hand-encoded Metaplex Core `CreateV2` instruction (no `mpl-core` crate dependency).
//!
//! Layout of mpl-core 0.12:
//! * data: discriminator `20` | `data_state: u8` (0 = AccountState) | `name: String` |
//!   `uri: String` | `plugins: Option<Vec<..>>` | `external_plugin_adapters: Option<Vec<..>>`
//!   (Borsh; strings are a little-endian `u32` length followed by the bytes, `None` is `0`);
//! * accounts: asset (w, s) | collection (w) | authority (s) | payer (w, s) | owner |
//!   update_authority | system_program | log_wrapper. An absent optional account is
//!   replaced by the Core program id; `update_authority` must be absent when a collection is
//!   given (the asset's update authority becomes the collection).

use anchor_lang::{
    prelude::*,
    solana_program::instruction::{AccountMeta, Instruction},
};

use crate::constants::MPL_CORE_ID;

/// `CreateV2` instruction discriminator.
pub const CREATE_V2: u8 = 20;
/// `DataState::AccountState`.
const DATA_STATE_ACCOUNT: u8 = 0;
/// Borsh `Option::None`.
const NONE: u8 = 0;

fn push_borsh_bytes(out: &mut Vec<u8>, bytes: &[u8]) {
    // Callers pass short names / URIs (≤ a few hundred bytes).
    out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(bytes);
}

/// Instruction data of `CreateV2` with no plugins.
pub fn create_v2_data(name: &[u8], uri: &[u8]) -> Vec<u8> {
    let mut data = Vec::with_capacity(2 + 4 + name.len() + 4 + uri.len() + 2);
    data.push(CREATE_V2);
    data.push(DATA_STATE_ACCOUNT);
    push_borsh_bytes(&mut data, name);
    push_borsh_bytes(&mut data, uri);
    data.push(NONE); // plugins
    data.push(NONE); // external_plugin_adapters
    data
}

/// `CreateV2` of `asset` into `collection`, signed by the collection's update `authority`,
/// paid by `payer` and owned by `owner`.
pub fn create_v2_in_collection(
    asset: &Pubkey,
    collection: &Pubkey,
    authority: &Pubkey,
    payer: &Pubkey,
    owner: &Pubkey,
    name: &[u8],
    uri: &[u8],
) -> Instruction {
    Instruction {
        program_id: MPL_CORE_ID,
        accounts: vec![
            AccountMeta::new(*asset, true),
            AccountMeta::new(*collection, false),
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new(*payer, true),
            AccountMeta::new_readonly(*owner, false),
            AccountMeta::new_readonly(MPL_CORE_ID, false), // update_authority: none
            AccountMeta::new_readonly(anchor_lang::system_program::ID, false),
            AccountMeta::new_readonly(MPL_CORE_ID, false), // log_wrapper: none
        ],
        data: create_v2_data(name, uri),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_v2_data_matches_golden_vector() {
        let data = create_v2_data(b"Slana Pass #1", b"https://x/1.json");
        #[rustfmt::skip]
        let expected: Vec<u8> = [
            &[20u8, 0][..],
            &[13, 0, 0, 0], b"Slana Pass #1",
            &[16, 0, 0, 0], b"https://x/1.json",
            &[0, 0],
        ]
        .concat();
        assert_eq!(data, expected);
        assert_eq!(
            hex(&data),
            "14000d000000536c616e612050617373202331\
             1000000068747470733a2f2f782f312e6a736f6e0000"
        );
    }

    #[test]
    fn create_v2_accounts_follow_core_order() {
        let (asset, collection, authority, payer) = (
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
        );
        let ix =
            create_v2_in_collection(&asset, &collection, &authority, &payer, &payer, b"n", b"u");
        assert_eq!(ix.program_id, MPL_CORE_ID);
        let metas: Vec<(Pubkey, bool, bool)> = ix
            .accounts
            .iter()
            .map(|m| (m.pubkey, m.is_writable, m.is_signer))
            .collect();
        assert_eq!(
            metas,
            vec![
                (asset, true, true),
                (collection, true, false),
                (authority, false, true),
                (payer, true, true),
                (payer, false, false),
                (MPL_CORE_ID, false, false),
                (anchor_lang::system_program::ID, false, false),
                (MPL_CORE_ID, false, false),
            ]
        );
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }
}
