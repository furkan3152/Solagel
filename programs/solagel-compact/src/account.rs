//! Checked native equivalents of the Anchor account constraints used by Solagel.
use crate::{
    error::{anchor, SolagelError},
    prelude::*,
};
use solana_cpi::{invoke, invoke_signed};

/// These four stable System Program instructions have fixed bincode layouts:
/// a little-endian u32 enum tag followed by fixed-width fields. Encoding them
/// directly avoids linking generic serde/bincode into the deployed program.
/// Host tests below compare bytes, metas and program IDs with Solana's SDK.
mod instruction {
    use super::{Pubkey, SYSTEM_ID};
    use solana_instruction::{AccountMeta, Instruction};

    pub fn create_account(
        from: &Pubkey,
        to: &Pubkey,
        lamports: u64,
        space: u64,
        owner: &Pubkey,
    ) -> Instruction {
        let mut data = Vec::with_capacity(52);
        data.extend_from_slice(&0u32.to_le_bytes());
        data.extend_from_slice(&lamports.to_le_bytes());
        data.extend_from_slice(&space.to_le_bytes());
        data.extend_from_slice(owner.as_ref());
        Instruction {
            program_id: SYSTEM_ID,
            accounts: vec![AccountMeta::new(*from, true), AccountMeta::new(*to, true)],
            data,
        }
    }

    pub fn assign(address: &Pubkey, owner: &Pubkey) -> Instruction {
        let mut data = Vec::with_capacity(36);
        data.extend_from_slice(&1u32.to_le_bytes());
        data.extend_from_slice(owner.as_ref());
        Instruction {
            program_id: SYSTEM_ID,
            accounts: vec![AccountMeta::new(*address, true)],
            data,
        }
    }

    pub fn transfer(from: &Pubkey, to: &Pubkey, lamports: u64) -> Instruction {
        let mut data = Vec::with_capacity(12);
        data.extend_from_slice(&2u32.to_le_bytes());
        data.extend_from_slice(&lamports.to_le_bytes());
        Instruction {
            program_id: SYSTEM_ID,
            accounts: vec![AccountMeta::new(*from, true), AccountMeta::new(*to, false)],
            data,
        }
    }

    pub fn allocate(address: &Pubkey, space: u64) -> Instruction {
        let mut data = Vec::with_capacity(12);
        data.extend_from_slice(&8u32.to_le_bytes());
        data.extend_from_slice(&space.to_le_bytes());
        Instruction {
            program_id: SYSTEM_ID,
            accounts: vec![AccountMeta::new(*address, true)],
            data,
        }
    }
}

pub const SYSTEM_ID: Pubkey = Pubkey::new_from_array([0; 32]);
pub const UPGRADEABLE_LOADER_ID: Pubkey =
    solana_pubkey::pubkey!("BPFLoaderUpgradeab1e11111111111111111111111");

pub trait AccountState: BorshSerialize + BorshDeserialize {
    const DISCRIMINATOR: [u8; 8];
    /// Includes the eight-byte Anchor discriminator.
    const SPACE: usize;
}

pub fn writable(info: &AccountInfo) -> Result<()> {
    require!(info.is_writable, anchor(2000));
    Ok(())
}

pub fn signer(info: &AccountInfo, must_write: bool) -> Result<()> {
    require!(info.is_signer, anchor(3010));
    if must_write {
        writable(info)?;
    }
    Ok(())
}

pub fn system(info: &AccountInfo) -> Result<()> {
    require!(*info.key == SYSTEM_ID, anchor(3008));
    require!(info.executable, anchor(3009));
    Ok(())
}

/// Keep the identical owner/discriminator checks shared across the five account
/// decoders. Returning the checked borrow avoids a second borrow or unchecked
/// access; validation order and Anchor error numbers remain unchanged.
#[inline(never)]
fn checked_data<'a, 'info>(
    info: &'a AccountInfo<'info>,
    discriminator: &[u8; 8],
) -> Result<std::cell::Ref<'a, &'a mut [u8]>> {
    if *info.owner == SYSTEM_ID && info.try_lamports()? == 0 {
        return Err(anchor(3012));
    }
    require!(*info.owner == ID, anchor(3007));
    let data = info.try_borrow_data()?;
    require!(data.len() >= 8, anchor(3001));
    require!(data[..8] == *discriminator, anchor(3002));
    Ok(data)
}

pub fn read<T: AccountState>(info: &AccountInfo, must_write: bool) -> Result<T> {
    let data = checked_data(info, &T::DISCRIMINATOR)?;
    let value = T::deserialize(&mut &data[8..]).map_err(|_| anchor(3003))?;
    if must_write {
        writable(info)?;
    }
    Ok(value)
}

pub fn write<T: AccountState>(info: &AccountInfo, value: &T) -> Result<()> {
    writable(info)?;
    require!(*info.owner == ID, anchor(3007));
    let mut data = info.try_borrow_mut_data()?;
    require!(data.len() >= T::SPACE, anchor(3004));
    data[..8].copy_from_slice(&T::DISCRIMINATOR);
    // Anchor permits account extensions; leave trailing bytes untouched.
    value
        .serialize(&mut &mut data[8..])
        .map_err(|_| anchor(3004))
}

pub fn check_pda(info: &AccountInfo, seeds: &[&[u8]], bump: u8) -> Result<()> {
    let bump_bytes = [bump];
    let mut complete = Vec::with_capacity(seeds.len() + 1);
    complete.extend_from_slice(seeds);
    complete.push(&bump_bytes);
    let address = Pubkey::create_program_address(&complete, &ID).map_err(|_| anchor(2006))?;
    require!(address == *info.key, anchor(2006));
    Ok(())
}

/// New accounts always use the canonical bump, matching Anchor `init, seeds, bump`.
pub fn find_pda(info: &AccountInfo, seeds: &[&[u8]]) -> Result<u8> {
    let (address, bump) = Pubkey::try_find_program_address(seeds, &ID).ok_or(anchor(2006))?;
    require!(address == *info.key, anchor(2006));
    Ok(bump)
}

pub fn create_pda<'info>(
    payer: &AccountInfo<'info>,
    account: &AccountInfo<'info>,
    system_account: &AccountInfo<'info>,
    space: usize,
    seeds_with_bump: &[&[u8]],
) -> Result<()> {
    signer(payer, true)?;
    writable(account)?;
    system(system_account)?;
    let (bump, seeds) = seeds_with_bump.split_last().ok_or(anchor(2006))?;
    require!(bump.len() == 1, anchor(2006));
    require!(find_pda(account, seeds)? == bump[0], anchor(2006));
    // Never overwrite a program-owned account, even if its discriminator was corrupted.
    if *account.owner != SYSTEM_ID || !account.data_is_empty() {
        solana_msg::sol_log("account already in use");
        return Err(ProgramError::Custom(0));
    }
    require!(payer.key != account.key, anchor(4101));
    let minimum = Rent::get()?.minimum_balance(space).max(1);
    let balance = account.try_lamports()?;
    let signers = &[seeds_with_bump];
    if balance == 0 {
        invoke_signed(
            &instruction::create_account(payer.key, account.key, minimum, space as u64, &ID),
            &[payer.clone(), account.clone()],
            signers,
        )?;
    } else {
        // An unsolicited transfer must not permanently deny creation of a canonical PDA.
        transfer_from_wallet(payer, account, minimum.saturating_sub(balance))?;
        invoke_signed(
            &instruction::allocate(account.key, space as u64),
            core::slice::from_ref(account),
            signers,
        )?;
        invoke_signed(
            &instruction::assign(account.key, &ID),
            core::slice::from_ref(account),
            signers,
        )?;
    }
    Ok(())
}

pub fn transfer_from_wallet<'info>(
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    signer(from, true)?;
    writable(to)?;
    invoke(
        &instruction::transfer(from.key, to.key, amount),
        &[from.clone(), to.clone()],
    )
}

pub fn rent_exempt_minimum(info: &AccountInfo) -> Result<u64> {
    Ok(Rent::get()?.minimum_balance(info.data_len()))
}

pub fn available_lamports(info: &AccountInfo) -> Result<u64> {
    Ok(info
        .try_lamports()?
        .saturating_sub(rent_exempt_minimum(info)?))
}

pub fn debit_program_account(info: &AccountInfo, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    writable(info)?;
    require!(*info.owner == ID, anchor(3007));
    let remaining = info
        .try_lamports()?
        .checked_sub(amount)
        .ok_or(SolagelError::InsufficientPot)?;
    require!(
        remaining >= rent_exempt_minimum(info)?,
        SolagelError::InsufficientPot
    );
    **info.try_borrow_mut_lamports()? = remaining;
    Ok(())
}

pub fn credit_account(info: &AccountInfo, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    writable(info)?;
    let total = info
        .try_lamports()?
        .checked_add(amount)
        .ok_or(SolagelError::MathOverflow)?;
    **info.try_borrow_mut_lamports()? = total;
    Ok(())
}

pub fn close(account: &AccountInfo, to: &AccountInfo) -> Result<()> {
    writable(account)?;
    writable(to)?;
    require!(*account.owner == ID, anchor(3007));
    require!(account.key != to.key, anchor(2011));
    // Separate borrows preserve permitted treasury/player/session aliases during settlement.
    credit_account(to, account.try_lamports()?)?;
    **account.try_borrow_mut_lamports()? = 0;
    account.assign(&SYSTEM_ID);
    account.resize(0)?;
    Ok(())
}

/// Reject only the typed mutable account pairs enforced by Anchor. Unchecked receivers
/// may intentionally alias a typed account; handlers must serialize each typed state once.
pub fn distinct(first: &AccountInfo, second: &AccountInfo) -> Result<()> {
    require!(first.key != second.key, anchor(2040));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_system_interface::instruction as sdk;

    #[test]
    fn fixed_system_instructions_match_official_sdk() {
        let from = Pubkey::new_from_array([17; 32]);
        let to = Pubkey::new_from_array([229; 32]);
        let owner = ID;
        for amount in [0, 1, 1_000_000_000, u64::MAX] {
            assert_eq!(
                instruction::transfer(&from, &to, amount),
                sdk::transfer(&from, &to, amount)
            );
            for space in [0, 139, 1281, u64::MAX] {
                assert_eq!(
                    instruction::create_account(&from, &to, amount, space, &owner),
                    sdk::create_account(&from, &to, amount, space, &owner)
                );
                assert_eq!(instruction::allocate(&to, space), sdk::allocate(&to, space));
            }
        }
        assert_eq!(instruction::assign(&to, &owner), sdk::assign(&to, &owner));
    }
}
