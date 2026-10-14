//! Game-token helpers: mint validation and PDA-signed transfers / burns.
//!
//! Works with both SPL Token and Token-2022 through `anchor_spl::token_interface`.

use anchor_lang::prelude::*;
use anchor_spl::{
    token::spl_token,
    token_2022::spl_token_2022::{
        self,
        extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
        state::Mint as MintState,
    },
    token_interface::{self, Burn, TransferChecked},
};

use crate::error::SlanaError;

/// Token-2022 mint extensions that would let somebody tax, block, seize, freeze or hide
/// vault funds. Metadata extensions (MetadataPointer, TokenMetadata, …) stay allowed.
pub const DENIED_MINT_EXTENSIONS: [ExtensionType; 8] = [
    ExtensionType::TransferFeeConfig,
    ExtensionType::TransferHook,
    ExtensionType::PermanentDelegate,
    ExtensionType::NonTransferable,
    ExtensionType::DefaultAccountState,
    ExtensionType::ConfidentialTransferMint,
    ExtensionType::ConfidentialTransferFeeConfig,
    ExtensionType::Pausable,
];

/// Validates the game mint and returns its decimals.
///
/// * the mint must be owned by `token_program_id`, which must be SPL Token or Token-2022
///   (`MintNotAllowed`);
/// * it must have no freeze authority (`FreezeAuthorityPresent`), so vaults cannot be frozen;
/// * a Token-2022 mint must not carry any of `DENIED_MINT_EXTENSIONS` (`MintNotAllowed`).
pub fn validate_mint(mint_info: &AccountInfo, token_program_id: &Pubkey) -> Result<u8> {
    require!(
        *token_program_id == spl_token::ID || *token_program_id == spl_token_2022::ID,
        SlanaError::MintNotAllowed
    );
    require_keys_eq!(
        *mint_info.owner,
        *token_program_id,
        SlanaError::MintNotAllowed
    );

    let data = mint_info.try_borrow_data()?;
    let mint = StateWithExtensions::<MintState>::unpack(&data)
        .map_err(|_| error!(SlanaError::MintNotAllowed))?;
    require!(mint.base.is_initialized, SlanaError::MintNotAllowed);
    require!(
        mint.base.freeze_authority.is_none(),
        SlanaError::FreezeAuthorityPresent
    );
    if *token_program_id == spl_token_2022::ID {
        let extensions = mint
            .get_extension_types()
            .map_err(|_| error!(SlanaError::MintNotAllowed))?;
        require!(
            !extensions
                .iter()
                .any(|ext| DENIED_MINT_EXTENSIONS.contains(ext)),
            SlanaError::MintNotAllowed
        );
    }
    Ok(mint.base.decimals)
}

/// `transfer_checked` of `amount` tokens out of a token account whose authority is the PDA
/// signing with `signer_seeds`. A zero amount is a no-op.
#[allow(clippy::too_many_arguments)]
pub fn transfer_from_pda<'info>(
    token_program: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
    decimals: u8,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: from.clone(),
                mint: mint.clone(),
                to: to.clone(),
                authority: authority.clone(),
            },
            signer_seeds,
        ),
        amount,
        decimals,
    )
}

/// Burns `amount` tokens from a token account whose authority is the PDA signing with
/// `signer_seeds`. A zero amount is a no-op.
pub fn burn_from_pda<'info>(
    token_program: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token_interface::burn(
        CpiContext::new_with_signer(
            token_program.key(),
            Burn {
                from: from.clone(),
                mint: mint.clone(),
                authority: authority.clone(),
            },
            signer_seeds,
        ),
        amount,
    )
}
