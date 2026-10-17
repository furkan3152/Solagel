import { useEffect, useState } from 'react';
import { StampSpinner, Stamp } from '../../design';
import { auth, site } from '../api';
import { readStoredSession, type SiteSession } from '../session';
import { X_URL } from '../settings';
import { SitePage, XIcon } from '../Shell';

export type PlayAccess = { allowed: true; reason: 'public' | 'admin'; session: SiteSession | null } | { allowed: false; reason: 'closed'; session: null };

/**
 * Who may open `/play`: everyone while the game is public (`gamePublic`, or `GAME_PUBLIC=1` on the
 * server), else only a signed-in admin wallet (the session from `/admin`, checked with
 * `/api/auth/me`). The server enforces the same rule on the WebSocket; this only spares visitors
 * the game download and a refused join.
 */
export async function playAccess(): Promise<PlayAccess> {
  const stored = readStoredSession();
  try {
    const settings = await site.settings();
    if (settings.gamePublic) return { allowed: true, reason: 'public', session: stored };
  } catch {
    /* the server is down: only an admin session can be checked, and that needs the server too */
  }
  if (stored) {
    try {
      const me = await auth.me(stored.token);
      if (me.admin) return { allowed: true, reason: 'admin', session: { ...stored, admin: true } };
    } catch {
      /* expired or unreachable */
    }
  }
  return { allowed: false, reason: 'closed', session: null };
}

/** The friendly page for everyone the arena is not open to yet. */
export function ArenaSoon() {
  return (
    <SitePage>
      <div className="st-gate">
        <div className="st-gate__card">
          <Stamp text="Soon" sub="arena" tone="pink" round size="lg" rotate={-10} />
          <h1 className="st-gate__title">
            The arena <span>opens soon.</span>
          </h1>
          <p>The coins are still warming up. Join the WL and follow @slanaio to hear the first bell.</p>
          <div className="st-row" style={{ justifyContent: 'center' }}>
            <a className="st-linkbtn st-linkbtn--pink" href="/">
              Back to slana.io
            </a>
            <a className="st-linkbtn" href={X_URL} target="_blank" rel="noreferrer">
              <XIcon /> Follow @slanaio
            </a>
          </div>
        </div>
      </div>
    </SitePage>
  );
}

/** `/play`: checks access, then hands over to the game (`onAllowed`) or shows "The arena opens soon". */
export function PlayGate({ onAllowed, check = playAccess }: { onAllowed: (session: SiteSession | null) => void; check?: () => Promise<PlayAccess> }) {
  const [state, setState] = useState<'checking' | 'closed' | 'open'>('checking');
  useEffect(() => {
    let live = true;
    void check().then((r) => {
      if (!live) return;
      if (r.allowed) {
        setState('open');
        onAllowed(r.session);
      } else setState('closed');
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (state === 'closed') return <ArenaSoon />;
  return (
    <div className="kb paper st-gate" data-theme="paper" style={{ minHeight: '100vh' }}>
      <StampSpinner label={state === 'open' ? 'Opening the arena' : 'Checking'} />
    </div>
  );
}
