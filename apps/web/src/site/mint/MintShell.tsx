import type { ReactNode } from 'react';
import { Button, Kb, PlateLabel, Seigaiha, Skeleton } from '../../design';
import { SitePage } from '../Shell';
import { EmblemPanel, MintSky, MintTrack } from './MintArt';
import { MintHeadline } from './MintHeadline';
import './mint.css';

/**
 * The parts of `/mint` that need no wallet code and no data: the night plate, and the page's
 * stand-in while the mint state (or the page's own code) is on its way. This module is small on
 * purpose: the site entry renders it while the heavy mint chunk (wallets, viem) downloads.
 */

/** The night plate every state of the page sits on. */
export function NightPlate({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <>
      <PlateLabel numeral="II" title="The mint, after dark" aside="/mint" className="mt-platelabel" />
      <Kb theme="night" className={`mt-night${className ? ` ${className}` : ''}`}>
        <MintSky />
        {children}
        <div className="mt-band" aria-hidden="true">
          <Seigaiha rows={3} r={40} tone="night" />
        </div>
      </Kb>
    </>
  );
}

/** The mint card's layout with stand-in values (no `data-view`: nothing on it is live yet). */
export function MintSkeleton() {
  return (
    <NightPlate>
      <div className="mt-wrap mt-page" data-loading="">
        <div className="mt-copy">
          <span className="kicker mt-kicker">Sealed emblems · on Elysium</span>
          <MintHeadline story="plain" price={null} />
          <MintTrack at="mint" />
          <p className="mt-limits num mt-skel-text">Allowlist ? per wallet · Public ? per wallet</p>
        </div>
        <div className="mt-card kb-island" aria-busy="true">
          <EmblemPanel no="NO. ????" mood="sleepy" ribbon="Opening the mint…" phase="Loading" />
          <div className="mt-card__right">
            <Skeleton rows={4} label="Loading the mint" className="mt-skel" />
            <Button variant="primary" size="lg" block disabled loading>
              Reading the mint…
            </Button>
          </div>
        </div>
      </div>
    </NightPlate>
  );
}

/** `/mint` before its code has arrived: the site frame and the skeleton card. */
export function MintPageSkeleton() {
  return (
    <SitePage className="mt-root" cta={false}>
      <MintSkeleton />
    </SitePage>
  );
}
