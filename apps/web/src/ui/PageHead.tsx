import type { ReactNode } from 'react';

/**
 * A section front: mono kicker, a display headline, an optional deck and a
 * slot on the right (counters, edition line), over a thick rule.
 */
export function PageHead({ kicker, title, deck, aside, id }: { kicker: string; title: ReactNode; deck?: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <header className="pg-head">
      <div className="pg-head__text">
        <span className="pg-head__kicker mono">{kicker}</span>
        <h2 className="pg-head__title" id={id}>
          {title}
        </h2>
        {deck && <p className="pg-head__deck">{deck}</p>}
      </div>
      {aside && <div className="pg-head__aside">{aside}</div>}
    </header>
  );
}
