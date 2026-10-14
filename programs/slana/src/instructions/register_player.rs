use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::SlanaError,
    events::PlayerRegistered,
    logic,
    state::{Config, PlayerProfile},
};

#[derive(Accounts)]
pub struct RegisterPlayer<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = owner,
        space = 8 + PlayerProfile::INIT_SPACE,
        seeds = [PROFILE_SEED, owner.key().as_ref()],
        bump
    )]
    pub profile: Account<'info, PlayerProfile>,
    pub system_program: Program<'info, System>,
}

pub fn handle_register_player(ctx: Context<RegisterPlayer>, name: String, skin: u8) -> Result<()> {
    let (name_bytes, name_len) = logic::validate_name(&name)?;
    // A fresh profile has no XP and no premium skins: only free skins pass.
    logic::check_skin(skin, 0, 0)?;
    let now = Clock::get()?.unix_timestamp;

    let config = &mut ctx.accounts.config;
    config.total_players = config
        .total_players
        .checked_add(1)
        .ok_or(SlanaError::MathOverflow)?;

    let owner = ctx.accounts.owner.key();
    let profile = &mut ctx.accounts.profile;
    profile.owner = owner;
    profile.name = name_bytes;
    profile.name_len = name_len;
    profile.skin = skin;
    profile.season = config.current_season;
    profile.created_at = now;
    profile.bump = ctx.bumps.profile;

    emit!(PlayerRegistered { owner, name });
    Ok(())
}
