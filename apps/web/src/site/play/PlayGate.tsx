import type { GameAccess } from '@elymum/shared';
import { useEffect, useState } from 'react';
import { StampSpinner, Stamp } from '../../design';
import { auth, site } from '../api';
import { readStoredSession, type SiteSession } from '../session';
import { X_URL } from '../settings';
import { SitePage, XIcon } from '../Shell';
import { SiteWalletProvider, WalletSignIn } from '../wallet/SiteWallet';

export type PlayAccess =
  | { allowed: true; reason: 'public' | 'admin' | 'holder'; session: SiteSession | null }
  /** `holders`: the game is open to NFT holders and this visitor is not a signed-in holder (yet). */
  | { allowed: false; reason: 'closed' | 'holders'; session: null };

/**
 * Who may open `/play` (`gameAccess`, the server's `GAME_ACCESS` overrides it): everyone when
 * `public`; when `holders`, a signed-in wallet holding an Elymum NFT (`/api/auth/me` says
 * `canPlay`) or an admin; when `admins`, only a signed-in admin wallet. The server enforces the
 * same rule on the WebSocket; this only spares visitors the game download and a refused join.
 */
export async function playAccess(): Promise<PlayAccess> {
  const stored = readStoredSession();
  let access: GameAccess = 'admins';
  try {
    const settings = await site.settings();
    access = settings.gameAccess;
    if (access === 'public') return { allowed: true, reason: 'public', session: stored };
  } catch {
    /* the server is down: only a session can be checked, and that needs the server too */
  }
  if (stored) {
    try {
      const me = await auth.me(stored.token);
      if (me.admin) return { allowed: true, reason: 'admin', session: { ...stored, admin: true } };
      if (access === 'holders' && (me.canPlay === true || me.holder === true)) return { allowed: true, reason: 'holder', session: stored };
    } catch {
      /* expired or unreachable */
    }
  }
  return { allowed: false, reason: access === 'holders' ? 'holders' : 'closed', session: null };
}

/** The friendly page for everyone the arena is not open to yet (holders mode: sign in with the wallet that holds the NFT). */
export function ArenaSoon({ holders = false, onSignedIn }: { holders?: boolean; onSignedIn?: () => void }) {
  if (holders) {
    return (
      <SitePage>
        <div className="st-gate">
          <div className="st-gate__card">
            <Stamp text="Holders" sub="arena" tone="teal" round size="lg" rotate={-10} />
            <h1 className="st-gate__title">
              The arena is open <span>to holders.</span>
            </h1>
            <p>Sign in with the wallet that holds your Elymum NFT. No NFT yet? It mints at $1 in HYPE.</p>
            <SiteWalletProvider>
              <WalletSignIn label="Sign in to play" onSession={() => onSignedIn?.()} />
            </SiteWalletProvider>
            <div className="st-row" style={{ justifyContent: 'center' }}>
              <a className="st-linkbtn st-linkbtn--pink" href="/mint">
                Go to the mint
              </a>
              <a className="st-linkbtn" href="/">
                Back home
              </a>
            </div>
          </div>
        </div>
      </SitePage>
    );
  }
  return (
    <SitePage>
      <div className="st-gate">
        <div className="st-gate__card">
          <Stamp text="Soon" sub="arena" tone="pink" round size="lg" rotate={-10} />
          <h1 className="st-gate__title">
            The arena <span>opens soon.</span>
          </h1>
          <p>The coins are still warming up. Join the WL and follow @elymum to hear the first bell.</p>
          <div className="st-row" style={{ justifyContent: 'center' }}>
            <a className="st-linkbtn st-linkbtn--pink" href="/">
              Back home
            </a>
            <a className="st-linkbtn" href={X_URL} target="_blank" rel="noreferrer">
              <XIcon /> Follow @elymum
            </a>
          </div>
        </div>
      </div>
    </SitePage>
  );
}

/** `/play`: checks access, then hands over to the game (`onAllowed`) or shows "The arena opens soon". */
export function PlayGate({ onAllowed, check = playAccess }: { onAllowed: (session: SiteSession | null) => void; check?: () => Promise<PlayAccess> }) {
  const [state, setState] = useState<'checking' | 'closed' | 'holders' | 'open'>('checking');
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    void check().then((r) => {
      if (!live) return;
      if (r.allowed) {
        setState('open');
        onAllowed(r.session);
      } else setState(r.reason === 'holders' ? 'holders' : 'closed');
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);
  if (state === 'closed') return <ArenaSoon />;
  if (state === 'holders') return <ArenaSoon holders onSignedIn={() => setRound((n) => n + 1)} />;
  return (
    <div className="kb paper st-gate" data-theme="paper" style={{ minHeight: '100vh' }}>
      <StampSpinner label={state === 'open' ? 'Opening the arena' : 'Checking'} />
    </div>
  );
}
