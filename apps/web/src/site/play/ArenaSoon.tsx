import { useState } from 'react';
import { CoinCharacter, Kb, PlateLabel, RingScene, Sticker } from '../../design';
import { X_URL } from '../settings';
import { SitePage, XIcon } from '../Shell';
import { LinkButton } from '../mint/MintArt';
import { SiteWalletProvider, WalletSignIn } from '../wallet/SiteWallet';
import { useT } from '../../i18n';
import { em, T } from '../../i18n/rich';
import { GateScene } from './GateScene';

/*
 * The closed / holders-only page of `/play`: the site shell, the wallet sign-in and the mint links.
 * Loaded only when the gate stays shut (PlayGate lazy-loads it), so an open arena never downloads it.
 */

/** The friendly page for everyone the arena is not open to yet (holders mode: sign in with the wallet that holds the NFT). */
export function ArenaSoon({ holders = false, onSignedIn }: { holders?: boolean; onSignedIn?: () => void }) {
  // the guard looks over while the visitor is at the sign-in
  const [attention, setAttention] = useState(false);
  const t = useT();
  return (
    <SitePage className="pg-root">
      <PlateLabel numeral="III" title={holders ? t('pg.plateHolders') : t('pg.plate')} aside="/play" className="pg-platelabel" />
      <Kb theme="night" className="pg-night">
        <RingScene time="night" variant="full" className="pg-scene">
          <div className="pg-wrap">
            <Sticker tone="cream" lift="lg" pad="lg" round="lg" tape className="pg-card" as="section">
              <span className="kicker pg-kicker">{holders ? t('pg.kickerHolders') : t('pg.kicker')}</span>
              {holders ? (
                <h1 className="pg-h display">
                  {t('pg.hHolders1')}
                  <br />
                  <T k="pg.hHolders2" tags={{ em }} />
                </h1>
              ) : (
                <h1 className="pg-h display">
                  {t('pg.h1')}
                  <br />
                  <em>{t('pg.h2')}</em>
                </h1>
              )}
              {holders ? (
                <>
                  <p className="pg-lede">{t('pg.ledeHolders')}</p>
                  <div
                    className="pg-signin"
                    onPointerEnter={() => setAttention(true)}
                    onPointerLeave={() => setAttention(false)}
                    onFocus={() => setAttention(true)}
                    onBlur={() => setAttention(false)}
                  >
                    <SiteWalletProvider>
                      <WalletSignIn label={t('pg.signIn')} onSession={() => onSignedIn?.()} />
                    </SiteWalletProvider>
                  </div>
                  <div className="pg-actions">
                    <LinkButton href="/mint" variant="primary" size="lg" icon="arrow">
                      {t('pg.mint')}
                    </LinkButton>
                    <LinkButton href="/wl" variant="secondary" size="md">
                      {t('ld.cta.wl')}
                    </LinkButton>
                  </div>
                </>
              ) : (
                <>
                  <p className="pg-lede">{t('pg.lede')}</p>
                  <div className="pg-actions">
                    <LinkButton href="/wl" variant="primary" size="lg" icon="arrow">
                      {t('ld.cta.wl')}
                    </LinkButton>
                    <LinkButton href="/mint" variant="secondary" size="md">
                      {t('pg.mint')}
                    </LinkButton>
                  </div>
                </>
              )}
              <p className="pg-links">
                <a href="/">{t('pg.home')}</a>
                <span aria-hidden="true">·</span>
                <a href={X_URL} target="_blank" rel="noreferrer">
                  <XIcon size={14} /> {t('pg.follow')}
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
