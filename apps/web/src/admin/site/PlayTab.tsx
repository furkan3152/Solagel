import type { GameAccess } from '@elymum/shared';
import { useEffect, useState } from 'react';
import { Chip, CoinCharacter } from '../../design';
import { errText, type TabProps } from './common';
import { GAME_ACCESS_LABEL } from './SettingsTab';

/** Play: opens the arena for the signed-in admin (the session is shared with /play). */
export function PlayTab({ api }: TabProps) {
  const [access, setAccess] = useState<GameAccess | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.settings().then(
      (r) => setAccess(r.gameAccessEnv ?? r.settings.gameAccess),
      (e) => setErr(errText(e)),
    );
  }, [api]);
  return (
    <section className="ad-card ad-play" aria-labelledby="ad-play-h">
      <CoinCharacter paint="sun" mood="chomp" size={120} feet bob className="ad-play__coin" />
      <div className="ad-card__bar">
        <h2 className="ad-card__title" id="ad-play-h">
          The floor, before the crowd
        </h2>
        {access && <Chip tone={access === 'public' ? 'teal' : 'mustard'}>{GAME_ACCESS_LABEL[access].label}</Chip>}
      </div>
      <p className="ad-card__lede">
        {access === 'public'
          ? 'The game is open to everyone. You play as this admin wallet.'
          : access === 'holders'
            ? 'The game is open to Elymum NFT holders. Your admin session lets you in either way.'
            : 'The game is closed to the public. Your admin session lets you in to test: the server checks the same wallet on every room entry.'}
      </p>
      <div className="ad-actions">
        <a className="kb-btn kb-btn--primary kb-btn--md ad-playbtn" href="/play">
          <span className="kb-btn__label">
            <span className="kb-btn__text">Open the arena</span>
          </span>
        </a>
        <a className="ad-note" href="/play" target="_blank" rel="noreferrer">
          Open in a new tab
        </a>
      </div>
      {err && <p className="ad-bad">{err}</p>}
    </section>
  );
}
