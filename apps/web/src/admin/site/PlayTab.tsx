import { useEffect, useState } from 'react';
import { Chip } from '../../design';
import { errText, type TabProps } from './common';

/** Play: opens the arena for the signed-in admin (the session is shared with /play). */
export function PlayTab({ api }: TabProps) {
  const [pub, setPub] = useState<{ gamePublic: boolean; env: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.settings().then(
      (r) => setPub({ gamePublic: r.settings.gamePublic, env: r.gamePublicEnv }),
      (e) => setErr(errText(e)),
    );
  }, [api]);
  const open = pub && (pub.gamePublic || pub.env);
  return (
    <section className="ad-card" aria-labelledby="ad-play-h">
      <div className="ad-card__bar">
        <h2 className="ad-card__title" id="ad-play-h">
          Play
        </h2>
        {pub && <Chip tone={open ? 'teal' : 'mustard'}>{open ? 'Game public' : 'Admin only'}</Chip>}
      </div>
      <p className="ad-card__lede">
        {open
          ? 'The game is open to everyone. You play as this admin wallet.'
          : 'The game is closed to the public. Your admin session lets you in to test: the server checks the same wallet on every room entry.'}
      </p>
      <div className="ad-actions">
        <a className="kb-btn kb-btn--pink kb-btn--md ad-playbtn" href="/play">
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
