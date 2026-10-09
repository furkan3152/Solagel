use anchor_lang::prelude::*;

use crate::{
    constants::*, error::SolagelError, events::ProfileUpdated, logic, state::PlayerProfile,
};

#[derive(Accounts)]
pub struct UpdateProfile<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [PROFILE_SEED, owner.key().as_ref()],
        bump = profile.bump,
        has_one = owner @ SolagelError::Unauthorized
    )]
    pub profile: Account<'info, PlayerProfile>,
}

pub fn handle_update_profile(
    ctx: Context<UpdateProfile>,
    name: Option<String>,
    skin: Option<u8>,
) -> Result<()> {
    let profile = &mut ctx.accounts.profile;

    if let Some(name) = name {
        let (name_bytes, name_len) = logic::validate_name(&name)?;
        profile.name = name_bytes;
        profile.name_len = name_len;
    }
    if let Some(skin) = skin {
        logic::check_skin(skin, profile.xp, profile.premium_skins)?;
        profile.skin = skin;
    }

    emit!(ProfileUpdated {
        owner: profile.owner,
        skin: profile.skin,
    });
    Ok(())
}
