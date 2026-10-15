use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::SlanaError,
    events::{PassEntropyCaptured, PassEntropyRetargeted},
    logic::{self, SlotHashLookup},
    state::Config,
};

/// Permissionless: stores the Pass trait entropy once the mint has ended and the target slot
/// has passed. The entropy is the hash of the first slot with a block at or after
/// `pass_entropy_target_slot`, read from the SlotHashes sysvar, so the caller cannot choose
/// it. If the target already left the SlotHashes window (~512 slots) uncaptured, the target
/// moves to `slot + ENTROPY_DELAY_SLOTS` instead: delaying capture only leads to another
/// unknown future slot. Idempotent once captured. The server calls it automatically.
#[derive(Accounts)]
pub struct CapturePassEntropy<'info> {
    /// Anyone; only pays the transaction fee.
    pub signer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: the SlotHashes sysvar (address checked), parsed by `logic::find_slot_hash`.
    #[account(address = SLOT_HASHES_ID @ SlanaError::BadSlotHashes)]
    pub slot_hashes: UncheckedAccount<'info>,
}

pub fn handle_capture_pass_entropy(ctx: Context<CapturePassEntropy>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(config.pass_mint_ended, SlanaError::MintStillOpen);
    if config.pass_entropy_captured {
        return Ok(());
    }
    let slot = Clock::get()?.slot;
    let target = config.pass_entropy_target_slot;
    require!(slot > target, SlanaError::EntropyNotReady);

    let lookup = {
        let data = ctx.accounts.slot_hashes.try_borrow_data()?;
        logic::find_slot_hash(&data, target).ok_or(SlanaError::BadSlotHashes)?
    };
    match lookup {
        SlotHashLookup::Found(found_slot, hash) => {
            config.pass_entropy = hash;
            config.pass_entropy_slot = found_slot;
            config.pass_entropy_captured = true;
            emit!(PassEntropyCaptured {
                slot: found_slot,
                entropy: hash,
            });
        }
        SlotHashLookup::NotYet => return err!(SlanaError::EntropyNotReady),
        SlotHashLookup::Missed => {
            let next = slot
                .checked_add(ENTROPY_DELAY_SLOTS)
                .ok_or(SlanaError::MathOverflow)?;
            msg!("Pass entropy target {} missed; new target {}", target, next);
            config.pass_entropy_target_slot = next;
            emit!(PassEntropyRetargeted {
                missed_target_slot: target,
                entropy_target_slot: next,
            });
        }
    }
    Ok(())
}
