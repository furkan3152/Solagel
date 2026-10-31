import type { CSSProperties } from 'react';
import { CoinCharacter, Kb } from '../design';

/** Seeds in the row (the coin eats them left to right). */
const SEEDS = 8;
const LINES = ['Setting the table', 'Peeling the pears', 'Counting the seeds', 'Polishing the coins'];

/**
 * Waiting for a page: a little coin munches its way along a row of seeds, which sprout back
 * behind it (site.css `.st-load`). The same picture is drawn in plain HTML in index.html for the
 * moment before any script runs, so the hand-off is seamless. It shows after a short delay so a
 * fast load never flashes it. Reduced motion: a still coin by a full row, and the label.
 */
export function SeedMuncher({ label }: { label?: string }) {
  const line = label ?? LINES[Math.floor(Date.now() / 1000) % LINES.length];
  return (
    <div className="st-load" role="status" aria-live="polite">
      <div className="st-load__row" aria-hidden="true">
        {Array.from({ length: SEEDS }, (_, i) => (
          <span key={i} className="st-load__seed" style={{ ['--i' as string]: i } as CSSProperties} />
        ))}
        <span className="st-load__coin">
          <CoinCharacter paint="sun" mood="chomp" size={64} look={[4, 1]} feet ground />
        </span>
      </div>
      <p className="st-load__label mono">
        {line}
        <span className="st-load__dots" aria-hidden="true">
          <i>.</i>
          <i>.</i>
          <i>.</i>
        </span>
      </p>
    </div>
  );
}

/** The site's page-loading screen (Suspense fallback between pages). */
export function SiteLoader() {
  return (
    <Kb theme="paper" className="st-root st-loadpage">
      <SeedMuncher />
    </Kb>
  );
}
