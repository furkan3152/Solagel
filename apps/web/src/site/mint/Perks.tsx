import { Icon, Laurel, type IconName } from '../../design';
import type { EmblemPerk } from './logic';

const GLYPH: Partial<Record<EmblemPerk['id'], IconName>> = { access: 'key', fee: 'check', wl: 'check', faucet: 'check' };

/** "What the emblem does": a compact list of the holder perks (mint page, under the lede). */
export function EmblemPerks({ perks }: { perks: EmblemPerk[] }) {
  return (
    <section className="mt-perks" aria-labelledby="mt-perks-h" data-testid="mt-perks">
      <h2 className="mt-perks__h kicker" id="mt-perks-h">
        What the emblem does
      </h2>
      <ul className="mt-perks__list">
        {perks.map((p) => {
          const g = GLYPH[p.id];
          return (
            <li key={p.id} className="mt-perk" data-perk={p.id}>
              <span className="mt-perk__dot" aria-hidden="true">
                {g ? <Icon name={g} size={13} /> : <Laurel size={13} />}
              </span>
              <span className="mt-perk__t">
                <b>{p.title}</b> <span>{p.note}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
