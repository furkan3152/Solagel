import type { RoomInfo } from '@elymum/shared';
import { useEffect, useState } from 'react';
import { Icon } from '../design';
import { serverClock } from '../game/clock';
import { formatCountdown } from '../game/round';
import { useT } from '../i18n';
import { toast, useUi } from '../store';
import { roomLink, roomsApi } from './api';
import './rooms.css';

/** In a custom room (top left, under its name): the time left, the invite link, and the creator's close button. */
export function CustomRoomBar({ room }: { room: RoomInfo }) {
  const t = useT();
  const auth = useUi((s) => s.auth);
  const [now, setNow] = useState(() => serverClock.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => setNow(serverClock.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const custom = room.custom!;
  const code = room.code ?? '';
  const mineRoom = !!auth && auth.address.toLowerCase() === custom.creator.toLowerCase();
  const copy = () =>
    void navigator.clipboard?.writeText(roomLink(code)).then(
      () => toast('success', t('cr.copied')),
      () => {},
    );
  const close = async () => {
    if (!auth || busy || !window.confirm(t('cr.closeConfirm'))) return;
    setBusy(true);
    try {
      await roomsApi.close(auth.token, code);
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <span className="g-pond__label mono" data-testid="custom-left">
        {t('cr.tag', { left: formatCountdown(custom.endsAt - now) })}
      </span>
      <span className="g-pond__custom">
        <button type="button" className="g-pond__btn mono" onClick={copy} aria-label={t('cr.inviteLabel')} data-testid="custom-invite">
          <Icon name="users" size={14} /> {t('cr.invite')}
        </button>
        {mineRoom && (
          <button type="button" className="g-pond__btn is-danger mono" onClick={() => void close()} disabled={busy} aria-label={t('cr.closeRoomLabel')} data-testid="custom-close">
            <Icon name="close" size={14} /> {t('cr.closeRoom')}
          </button>
        )}
      </span>
    </>
  );
}
