//! Metaplex Core `CreateV2` (reference `core_cpi.rs`, mpl-core 0.12 layout, hand-encoded):
//!
//! * data: discriminator `20` | `data_state: u8` (0 = AccountState) | `name: String` |
//!   `uri: String` | `plugins: Option<Vec<..>>` = None | `external_plugin_adapters` = None;
//! * accounts: asset (w, s) | collection (w) | authority (s) | payer (w, s) | owner |
//!   update_authority (absent = the Core program id) | system_program | log_wrapper (absent).
//!
//! The Pass name is `Slana Pass #<number>` and the URI `<base_uri><number>.json`, exactly the
//! reference's `format!` output. The unit tests compare data and metas with the reference.

use {
    crate::{
        constants::{MPL_CORE_ID, SYSTEM_PROGRAM_ID},
        cpi::invoke,
        logic::{dec, Cursor},
    },
    pinocchio::{cpi::Signer, instruction::InstructionAccount, AccountView, Address},
};

/// `CreateV2` instruction discriminator.
pub const CREATE_V2: u8 = 20;
/// `DataState::AccountState`.
const DATA_STATE_ACCOUNT: u8 = 0;
/// Borsh `Option::None`.
const NONE: u8 = 0;
/// Longest `CreateV2` data: 2 + (4 + 22) name + (4 + 96 + 10 + 5) URI + 2 = 145 bytes.
const DATA_MAX: usize = 160;

/// Instruction data of `CreateV2` with no plugins for Pass `number` under `base_uri`.
#[inline(never)]
pub fn create_v2_data(number: u32, base_uri: &[u8]) -> Cursor<DATA_MAX> {
    let mut digits = [0u8; 20];
    let n = dec(u64::from(number), &mut digits);
    // Bound: `n` ≤ 10 digits, `base_uri` ≤ 96 bytes (`update_config` caps it).
    #[allow(clippy::arithmetic_side_effects)]
    let (name_len, uri_len) = (
        12 + n.len() as u32,
        base_uri.len() as u32 + n.len() as u32 + 5,
    );
    let mut data = Cursor::new();
    data.push(&[CREATE_V2, DATA_STATE_ACCOUNT])
        .push(&name_len.to_le_bytes())
        .push(b"Slana Pass #")
        .push(n)
        .push(&uri_len.to_le_bytes())
        .push(base_uri)
        .push(n)
        .push(b".json")
        .push(&[NONE, NONE]);
    data
}

/// Reference `create_v2_in_collection` account metas.
pub fn create_v2_metas<'a>(
    asset: &'a Address,
    collection: &'a Address,
    authority: &'a Address,
    payer: &'a Address,
    owner: &'a Address,
) -> [InstructionAccount<'a>; 8] {
    [
        InstructionAccount::writable_signer(asset),
        InstructionAccount::writable(collection),
        InstructionAccount::readonly_signer(authority),
        InstructionAccount::writable_signer(payer),
        InstructionAccount::readonly(owner),
        InstructionAccount::readonly(&MPL_CORE_ID), // update_authority: none
        InstructionAccount::readonly(&SYSTEM_PROGRAM_ID),
        InstructionAccount::readonly(&MPL_CORE_ID), // log_wrapper: none
    ]
}

/// `CreateV2` of Pass `number` (`asset` into `collection`), signed by the collection's update
/// `authority` (`signers`), paid by and owned by `minter`. The account infos are the
/// reference's: asset, collection, authority, minter, the Core program, the system program.
#[allow(clippy::too_many_arguments)]
#[inline(never)]
pub fn create_v2(
    asset: &AccountView,
    collection: &AccountView,
    authority: &AccountView,
    minter: &AccountView,
    core_program: &AccountView,
    system_program: &AccountView,
    number: u32,
    base_uri: &[u8],
    signers: &[Signer],
) {
    let data = create_v2_data(number, base_uri);
    invoke(
        &MPL_CORE_ID,
        &create_v2_metas(
            asset.address(),
            collection.address(),
            authority.address(),
            minter.address(),
            minter.address(),
        ),
        &[
            asset,
            collection,
            authority,
            minter,
            core_program,
            system_program,
        ],
        data.bytes(),
        signers,
    );
}

#[cfg(test)]
mod tests {
    use {super::*, anchor_lang::prelude::Pubkey, slana::core_cpi as r};

    /// The reference's golden vector, then the same data as the reference's `format!` for
    /// edge numbers and URI lengths.
    #[test]
    fn create_v2_data_matches_the_reference() {
        assert_eq!(
            create_v2_data(1, b"https://x/").bytes(),
            &r::create_v2_data(b"Slana Pass #1", b"https://x/1.json")[..]
        );
        let long = [b'u'; 96];
        for base in [&b"h"[..], b"https://slana.example/pass/", &long[..]] {
            for n in [0u32, 1, 9, 10, 99, 3_333, 10_000, 4_294_967_295] {
                let name = format!("Slana Pass #{n}");
                let mut uri = base.to_vec();
                uri.extend_from_slice(format!("{n}.json").as_bytes());
                assert_eq!(
                    create_v2_data(n, base).bytes(),
                    &r::create_v2_data(name.as_bytes(), &uri)[..]
                );
            }
        }
    }

    #[test]
    fn create_v2_metas_follow_the_reference() {
        let k = |n: u8| Address::new_from_array([n; 32]);
        let (asset, collection, authority, payer) = (k(1), k(2), k(3), k(4));
        let lean = create_v2_metas(&asset, &collection, &authority, &payer, &payer);
        let p = |a: &Address| Pubkey::new_from_array(a.to_bytes());
        let reference = r::create_v2_in_collection(
            &p(&asset),
            &p(&collection),
            &p(&authority),
            &p(&payer),
            &p(&payer),
            b"n",
            b"u",
        );
        assert_eq!(reference.program_id, p(&MPL_CORE_ID));
        let lean: Vec<_> = lean
            .iter()
            .map(|m| (p(m.address), m.is_writable, m.is_signer))
            .collect();
        let reference: Vec<_> = reference
            .accounts
            .iter()
            .map(|m| (m.pubkey, m.is_writable, m.is_signer))
            .collect();
        assert_eq!(lean, reference);
    }
}
