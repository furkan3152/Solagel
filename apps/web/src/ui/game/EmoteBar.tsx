import { EMOTES } from '@slana/shared';
import { engine } from '../../game/instance';
import { useT, type TKey } from '../../i18n';
import { stickerUrl } from './stickers';

/** Sticker sheet: the eight system emotes as die-cut stickers (keys 1–8). */
export function EmoteBar({ onPick, keys = true }: { onPick?: () => void; keys?: boolean }) {
  const t = useT();
  return (
    <ul className="g-emotes" aria-label={t('g.emotes')}>
      {EMOTES.map((e) => {
        const label = t(`g.emote.${e.id}` as TKey);
        return (
          <li key={e.id}>
            <button
              type="button"
              className="g-emote"
              onClick={() => {
                engine()?.emote(e.id);
                onPick?.();
              }}
              aria-label={label}
              title={keys ? `${label} · ${e.id + 1}` : label}
              aria-keyshortcuts={keys ? String(e.id + 1) : undefined}
            >
              <img src={stickerUrl(e.id)} alt="" width={40} height={40} draggable={false} />
              {keys && <span className="g-emote__key mono">{e.id + 1}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
