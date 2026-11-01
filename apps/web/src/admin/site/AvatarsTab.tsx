import { avatarPath, shortAddress, type AdminAvatarEntry } from '@elymum/shared';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../design';
import { SERVER } from '../../config';
import { errText, fmtDate, useFlash, type TabProps } from './common';

/**
 * Safety → Player pictures: every uploaded profile picture, newest first. Remove takes it off the
 * player's coin at once (the coin falls back to its basic skin), deletes the file and blocks it
 * from being uploaded again.
 */
export function AvatarsTab({ api }: TabProps) {
  const [items, setItems] = useState<AdminAvatarEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useFlash();

  const load = useCallback(() => {
    api.avatars().then(
      (r) => {
        setItems(r.items);
        setTotal(r.total);
      },
      (e) => setFlash('err', errText(e)),
    );
  }, [api, setFlash]);
  useEffect(load, [load]);

  const remove = async (e: AdminAvatarEntry) => {
    if (!window.confirm(`Remove the picture of ${e.name ?? shortAddress(e.wallet, 6, 4)}? It cannot be uploaded again.`)) return;
    setBusy(e.wallet);
    try {
      await api.removeAvatar(e.wallet);
      setFlash('ok', 'Picture removed. The coin is back to its basic skin.');
      load();
    } catch (err) {
      setFlash('err', errText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="ad-card" aria-labelledby="ad-avatars-h">
      <div className="ad-card__bar">
        <h2 className="ad-card__title" id="ad-avatars-h">
          Player pictures
        </h2>
        <span className="ad-note">{items ? `${total} picture${total === 1 ? '' : 's'}` : 'Loading…'}</span>
      </div>
      <p className="ad-card__lede">Pictures players put on their coins. Remove one and every room shows that coin as a basic coin again.</p>
      {flash}
      {items && items.length === 0 && <p className="ad-note">Nobody has uploaded a picture yet.</p>}
      {items && items.length > 0 && (
        <ul className="ad-avatars">
          {items.map((e) => (
            <li key={e.wallet} className="ad-avatars__item">
              <img src={`${SERVER.http}${avatarPath(e.avatar)}`} alt="" width={64} height={64} loading="lazy" className="ad-avatars__img" />
              <span className="ad-avatars__who">
                <strong>{e.name ?? 'No name'}</strong>
                <span className="mono ad-note">{shortAddress(e.wallet, 6, 4)}</span>
                <span className="ad-note">{fmtDate(e.at)}</span>
              </span>
              <Button variant="secondary" size="sm" disabled={busy === e.wallet} onClick={() => void remove(e)} aria-label={`Remove the picture of ${e.name ?? e.wallet}`}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
