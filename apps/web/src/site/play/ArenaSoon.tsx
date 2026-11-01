import { useState } from 'react';
import { CoinCharacter, Kb, PlateLabel, RingScene, Sticker } from '../../design';
import { X_URL } from '../settings';
import { SitePage, XIcon } from '../Shell';
import { LinkButton } from '../mint/MintArt';
import { SiteWalletProvider, WalletSignIn } from '../wallet/SiteWallet';
import { GateScene } from './GateScene';

/*
 * The closed / holders-only page of `/play`: the site shell, the wallet sign-in and the mint links.
 * Loaded only when the gate stays shut (PlayGate lazy-loads it), so an open arena never downloads it.
 */

/** The friendly page for everyone the arena is not open to yet (holders mode: sign in with the wallet that holds the NFT). */
export function ArenaSoon({ holders = false, onSignedIn }: { holders?: boolean; onSignedIn?: () => void }) {
  // the guard looks over while the visitor is at the sign-in
  const [attention, setAttention] = useState(false);
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
                  <div
                    className="pg-signin"
                    onPointerEnter={() => setAttention(true)}
                    onPointerLeave={() => setAttention(false)}
                    onFocus={() => setAttention(true)}
                    onBlur={() => setAttention(false)}
                  >
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
                  <p className="pg-lede">The coins are asleep and the food is still cooking. Get on the WL, mint an emblem, and listen for the first bell on @elymumio.</p>
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
                  <XIcon size={14} /> Follow @elymumio
                </a>
              </p>
            </Sticker>
            <div className={`pg-cast${holders ? ' pg-cast--holders' : ''}`} aria-hidden="true">
              <GateScene mode={holders ? 'holders' : 'closed'} attention={attention} />
              <CoinCharacter paint="teal" mood="sleepy" size={72} feet ground phase={1.3} className="pg-coin pg-coin--b" />
              <CoinCharacter paint="cream" mood={holders ? 'open' : 'sleepy'} size={56} feet ground phase={2.1} className="pg-coin pg-coin--c" />
            </div>
          </div>
        </RingScene>
      </Kb>
    </SitePage>
  );
}
