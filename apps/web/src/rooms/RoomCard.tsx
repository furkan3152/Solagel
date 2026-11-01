import { parseInviteCode, type CustomRoomView } from '@elymum/shared';
import { useEffect, useRef, useState } from 'react';
import { Button, Chip, CoinCharacter } from '../design';
import { engine } from '../game/instance';
import { useT } from '../i18n';
import { useUi } from '../store';
import { roomsApi } from './api';
import { RoomCreator } from './RoomCreator';
import './rooms.css';

/**
 * Opens an invite link (`/play?room=CODE`) straight into its room, once per page load, as soon as
 * the game server says hello. Guests and wallets alike.
 */
export function useInviteLink(): void {
  const connected = useUi((s) => s.connected);
  const done = useRef(false);
  useEffect(() => {
    if (!connected || done.current) return;
    let code: string | null = null;
    try {
      code = parseInviteCode(new URLSearchParams(location.search).get('room'));
    } catch {
      code = null;
    }
    if (!code) return;
    done.current = true;
    engine()?.play(`private:${code}`);
  }, [connected]);
}

/** The lobby's "Your own room" card: create a room (sheet), join one by code, rejoin my live rooms. */
export function RoomCard() {
  const t = useT();
  const auth = useUi((s) => s.auth);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [bad, setBad] = useState(false);
  const [mine, setMine] = useState<CustomRoomView[]>([]);
  useInviteLink();

  useEffect(() => {
    if (!auth?.token || open) return;
    let live = true;
    roomsApi.mine(auth.token).then(
      (r) => live && setMine(r),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [auth?.token, open]);

  const join = () => {
    const c = parseInviteCode(code);
    setBad(!c);
    if (c) engine()?.play(`private:${c}`);
  };

  return (
    <section className="cr-card" aria-labelledby="cr-card-h" data-testid="room-card">
      <CoinCharacter paint="foam" mood="happy" size={56} bob />
      <div>
        <span className="cr-card__kicker mono">{t('cr.card.kicker')}</span>
        <h3 id="cr-card-h" className="cr-card__title">
          {t('cr.card.title')}
        </h3>
        <p className="cr-card__body">{t('cr.card.body')}</p>
        <div className="cr-card__actions">
          <Button variant="secondary" size="sm" lead="key" onClick={() => setOpen(true)} data-testid="room-create">
            {t('cr.card.create')}
          </Button>
          <form
            className="cr-card__join"
            onSubmit={(e) => {
              e.preventDefault();
              join();
            }}
          >
            <input
              className="cr-card__code mono"
              value={code}
              maxLength={5}
              placeholder="AB2CD"
              aria-label={t('cr.card.code')}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                setBad(false);
              }}
            />
            <Button size="sm" variant="ghost" type="submit">
              {t('cr.card.join')}
            </Button>
          </form>
          {bad && <p className="cr-card__err">{t('cr.card.badCode')}</p>}
          {mine.length > 0 && (
            <div className="cr-card__mine">
              {mine.map((r) => (
                <Chip key={r.code} tone="sun" icon="play" onClick={() => engine()?.play(`private:${r.code}`)}>
                  {`${r.name} · ${r.code}`}
                </Chip>
              ))}
            </div>
          )}
        </div>
      </div>
      <RoomCreator open={open} onClose={() => setOpen(false)} />
    </section>
  );
}
