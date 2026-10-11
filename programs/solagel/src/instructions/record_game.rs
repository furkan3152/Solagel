use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::SolagelError,
    events::GameRecorded,
    logic,
    state::{Config, PlayerProfile, Season},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RecordArgs {
    pub score: u32,
    pub kills: u16,
    pub xp: u32,
}

/// Records practice stats and cosmetic XP only. Free play never enters the prize board.
#[derive(Accounts)]
pub struct RecordGame<'info> {
    #[account(
        constraint = server.key() == config.server_authority @ SolagelError::Unauthorized
    )]
    pub server: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [PROFILE_SEED, profile.owner.as_ref()],
        bump = profile.bump
    )]
    pub profile: Box<Account<'info, PlayerProfile>>,
    #[account(
        mut,
        seeds = [SEASON_SEED, config.current_season.to_le_bytes().as_ref()],
        bump = season.bump
    )]
    pub season: Box<Account<'info, Season>>,
}

pub fn handle_record_game(ctx: Context<RecordGame>, args: RecordArgs) -> Result<()> {
    let accounts = &mut *ctx.accounts;
    let now = Clock::get()?.unix_timestamp;

    let config = &mut accounts.config;
    config.total_games = config
        .total_games
        .checked_add(1)
        .ok_or(SolagelError::MathOverflow)?;
    let result =
        logic::apply_practice_game(&mut accounts.profile, args.score, args.kills, args.xp, now);

    emit!(GameRecorded {
        player: accounts.profile.owner,
        score: result.score,
        kills: result.kills,
        xp: result.xp,
    });
    Ok(())
}
