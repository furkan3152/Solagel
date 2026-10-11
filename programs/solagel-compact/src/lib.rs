//! Compact native implementation of the existing Solagel Anchor ABI.
//! The reference program remains the source of compatibility tests.

pub mod account;
pub mod admin;
pub mod codec;
pub mod constants;
pub mod error;
pub mod events;
pub mod game;
pub mod logic;
pub mod prelude;
pub mod season;
pub mod shared;
pub mod state;

include!(concat!(env!("OUT_DIR"), "/program_id.rs"));

use prelude::*;

#[cfg(not(feature = "no-entrypoint"))]
solana_program_entrypoint::entrypoint!(process_instruction);

/// Solana's panic runtime calls this hook before aborting the instruction. Use a
/// static diagnostic and the non-returning panic syscall instead of formatting
/// PanicInfo. All unexpected panics still fail and roll back the transaction.
#[cfg(all(
    feature = "custom-panic",
    target_os = "solana",
    not(feature = "no-entrypoint")
))]
#[no_mangle]
fn custom_panic(_info: &core::panic::PanicInfo<'_>) {
    const MESSAGE: &[u8] = b"Solagel panic";
    // SAFETY: MESSAGE has static lifetime; the runtime aborts this invocation.
    unsafe {
        solana_program_entrypoint::__panic(MESSAGE.as_ptr(), MESSAGE.len() as u64, 0, 0);
    }
}

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> Result<()> {
    require!(*program_id == ID, ProgramError::Custom(4100));
    let discriminator: [u8; 8] = instruction_data
        .get(..8)
        .ok_or(ProgramError::Custom(101))?
        .try_into()
        .map_err(|_| ProgramError::Custom(101))?;
    let data = &instruction_data[8..];
    let handler: fn(&[AccountInfo], &[u8]) -> Result<()> = match discriminator {
        [225, 216, 111, 21, 69, 235, 96, 66] => game::activate_session,
        [160, 172, 148, 145, 46, 58, 70, 228] => game::buy_skin,
        [129, 96, 145, 129, 154, 203, 29, 150] => season::claim_season_reward,
        [174, 236, 45, 61, 197, 215, 149, 169] => admin::create_arena,
        [167, 166, 166, 109, 166, 71, 15, 68] => season::end_season,
        [251, 186, 193, 242, 15, 144, 254, 67] => season::fund_season,
        [175, 175, 109, 31, 13, 152, 155, 237] => admin::initialize,
        [135, 217, 203, 200, 93, 181, 131, 47] => game::join_arena,
        [247, 120, 117, 224, 181, 219, 180, 52] => game::record_game,
        [168, 87, 185, 45, 250, 170, 10, 85] => game::refund_session,
        [242, 146, 194, 234, 234, 145, 228, 42] => game::register_player,
        [100, 231, 139, 192, 118, 134, 116, 197] => season::rollover_season,
        [156, 20, 180, 117, 117, 85, 225, 128] => game::settle_session,
        [124, 38, 247, 190, 34, 58, 64, 7] => season::sweep_arena,
        [179, 14, 84, 80, 59, 23, 182, 226] => admin::update_arena,
        [29, 158, 252, 191, 10, 83, 219, 99] => admin::update_config,
        [98, 67, 99, 206, 86, 115, 175, 1] => game::update_profile,
        _ => return Err(ProgramError::Custom(101)),
    };
    // Handlers decode arguments before checking accounts, as Anchor does.
    handler(accounts, data)
}
