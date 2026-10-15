use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::SlanaError,
    events::{PassEntropyCaptured, PassEntropyRetargeted, PassRevealed},
    logic::{self, SlotHashLookup},
    state::Config,
};

/// Permissionless (any signer: the game server, the web "Complete the reveal" button, the
/// admin CLI): completes the reveal once the seed is public (`reveal_pass`) and the target
/// slot has passed. Stores as `pass_entropy` the hash of the first slot with a block at or
/// after `pass_entropy_target_slot`, read by the program itself from the address-checked
/// SlotHashes sysvar, then `pass_final_seed = sha256(pass_seed || pass_entropy)`, and marks
/// the Pass as revealed. If the target already left the SlotHashes window (~512 slots)
/// uncaptured, the target moves to `slot + ENTROPY_DELAY_SLOTS` instead. Idempotent once
/// captured.
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
    if config.pass_revealed {
        return Ok(());
    }
    require!(config.pass_seed_revealed, SlanaError::SeedNotRevealed);
    let slot = Clock::get()?.slot;
    let target = config.pass_entropy_target_slot;
    require!(slot > target, SlanaError::EntropyNotReady);

    let lookup = {
        let data = ctx.accounts.slot_hashes.try_borrow_data()?;
        logic::find_slot_hash(&data, target).ok_or(SlanaError::BadSlotHashes)?
    };
    match lookup {
        SlotHashLookup::Found(found_slot, hash) => {
            let final_seed = logic::pass_final_seed(&config.pass_seed, &hash);
            config.pass_entropy = hash;
            config.pass_entropy_slot = found_slot;
            config.pass_entropy_captured = true;
            config.pass_final_seed = final_seed;
            config.pass_revealed = true;
            msg!(
                "Pass entropy: slot {} hash {}",
                found_slot,
                logic::hex32(&hash)
            );
            emit!(PassEntropyCaptured {
                slot: found_slot,
                entropy: hash,
            });
            emit!(PassRevealed {
                seed: config.pass_seed,
                entropy: hash,
                final_seed,
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
