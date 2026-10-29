import type { ReactNode } from 'react';
import { Cloud, PlateLabel, SceneProp } from '../../design';

/**
 * A plate of the book for the site's form pages (WL, collab): the plate caption, the shore
 * curving up behind the page (two sand terraces, a cloud, a house and two trees), and the page.
 */
export function StoryPlate({ numeral, title, aside, children, className }: { numeral: string; title: ReactNode; aside: string; children: ReactNode; className?: string }) {
  return (
    <div className={`wl-plate${className ? ` ${className}` : ''}`}>
      <PlateLabel numeral={numeral} title={title} aside={aside} className="wl-plate__label" />
      <div className="wl-plate__scene" aria-hidden="true">
        <svg className="wl-plate__hills" viewBox="0 0 1440 300" preserveAspectRatio="none">
          <path d="M-40 190 Q720 380 1480 70 V320 H-40Z" fill="var(--sand)" />
          <path d="M-40 250 Q720 420 1480 150 V320 H-40Z" fill="var(--sand-2)" />
        </svg>
        <Cloud className="wl-plate__cloud" shape={1} width={150} />
        <span className="wl-plate__props">
          <SceneProp kind="house" size={40} />
          <SceneProp kind="tree" size={34} />
          <SceneProp kind="tree" size={44} />
        </span>
      </div>
      <div className="st-page wl-page">{children}</div>
    </div>
  );
}
