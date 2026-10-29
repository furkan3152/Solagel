import type { GameAccess } from '@elymum/shared';
import { useEffect, useState } from 'react';
import { CoinCharacter, Kb, PlateLabel, RingScene, StampSpinner, Sticker } from '../../design';
import { auth, site } from '../api';
import { readStoredSession, type SiteSession } from '../session';
import { X_URL } from '../settings';
import { SitePage, XIcon } from '../Shell';
import { LinkButton } from '../mint/MintArt';
import { SiteWalletProvider, WalletSignIn } from '../wallet/SiteWallet';
import './play.css';

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
  return (
    <SitePage className="pg-root">
      <PlateLabel numeral="III" title={holders ? 'The ring, members only' : 'The ring, after hours'} aside="/play" className="pg-platelabel" />
      <Kb theme="night" className="pg-night">
        <RingScene time="night" variant="full" className="pg-scene">
          <div className="pg-wrap">
            <Sticker tone="cream" lift="lg" pad="lg" round="lg" tape className="pg-card" as="section">
              <span className="kicker pg-kicker">{holders ? 'Arena · holders only' : 'Arena · closed'}</span>
              {holders ? (
                <h1 className="pg-h display">
                  Holders only.
                  <br />
                  <em>Mint</em> to play.
                </h1>
              ) : (
                <h1 className="pg-h display">
                  The ring is closed.
                  <br />
                  <em>For now.</em>
                </h1>
              )}
              {holders ? (
                <>
                  <p className="pg-lede">Sign in with the wallet that holds your Elymum emblem and the gate swings open. No emblem yet? One dollar in HYPE.</p>
                  <div className="pg-signin">
                    <SiteWalletProvider>
                      <WalletSignIn label="Sign in to play" onSession={() => onSignedIn?.()} />
                    </SiteWalletProvider>
                  </div>
                  <div className="pg-actions">
                    <LinkButton href="/mint" variant="primary" size="lg" icon="arrow">
                      Go to the mint
                    </LinkButton>
                    <LinkButton href="/wl" variant="secondary" size="md">
                      Join the WL
                    </LinkButton>
                  </div>
                </>
              ) : (
                <>
                  <p className="pg-lede">The coins are asleep and the food is still cooking. Get on the WL, mint an emblem, and listen for the first bell on @elymum.</p>
                  <div className="pg-actions">
                    <LinkButton href="/wl" variant="primary" size="lg" icon="arrow">
                      Join the WL
                    </LinkButton>
                    <LinkButton href="/mint" variant="secondary" size="md">
                      Go to the mint
                    </LinkButton>
                  </div>
                </>
              )}
              <p className="pg-links">
                <a href="/">Back home</a>
                <span aria-hidden="true">·</span>
                <a href={X_URL} target="_blank" rel="noreferrer">
                  <XIcon size={14} /> Follow @elymum
                </a>
              </p>
            </Sticker>
            <div className="pg-cast" aria-hidden="true">
              <span className="pg-post">
                <span className="pg-sign mono">{holders ? 'Holders only' : 'Closed'}</span>
              </span>
              <CoinCharacter paint={holders ? 'sun' : 'cyan'} mood={holders ? 'smug' : 'sleepy'} size={170} feet ground className="pg-coin pg-coin--big" />
              <CoinCharacter paint="teal" mood="sleepy" size={84} feet ground phase={1.3} className="pg-coin pg-coin--b" />
              <CoinCharacter paint="cream" mood={holders ? 'open' : 'sleepy'} size={64} feet ground phase={2.1} className="pg-coin pg-coin--c" />
            </div>
          </div>
        </RingScene>
      </Kb>
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
    <Kb theme="night" className="pg-wait">
      <StampSpinner label={state === 'open' ? 'Opening the arena' : 'Checking'} />
      <span className="mono pg-wait__label">{state === 'open' ? 'Opening the ring…' : 'Checking the gate…'}</span>
    </Kb>
  );
}
