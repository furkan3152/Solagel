use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::SlanaError,
    events::GameRecorded,
    instructions::shared,
    state::{Config, PlayerProfile, Season},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RecordArgs {
    pub score: u32,
    pub kills: u16,
    pub xp: u32,
}

/// Records a free-play game (no money involved).
#[derive(Accounts)]
pub struct RecordGame<'info> {
    #[account(
        constraint = server.key() == config.server_authority @ SlanaError::Unauthorized
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
        .ok_or(SlanaError::MathOverflow)?;
    let current_season = config.current_season;

    let result = shared::record_result(
        &mut accounts.profile,
        &mut accounts.season,
        current_season,
        args.score,
        args.kills,
        args.xp,
        now,
    );

    emit!(GameRecorded {
        player: accounts.profile.owner,
        score: result.score,
        kills: result.kills,
        xp: result.xp,
    });
    Ok(())
}
