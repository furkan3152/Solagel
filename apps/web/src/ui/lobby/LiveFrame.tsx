import { useLayoutEffect, useRef } from 'react';
import { Icon, StampSpinner, Tape } from '../../design';
import { engine } from '../../game/instance';
import { useT } from '../../i18n';
import { useUi } from '../../store';
import { roomName } from '../game/format';

/**
 * The front-page photo: a window cut into the lobby paper through which the
 * live game canvas (spectating the busiest room) shows. The hole is a CSS mask
 * on the lobby root (`--hole-*`), kept in sync with this element's box, so the
 * world is rendered once by the engine and never copied.
 */
export function LiveFrame() {
  const t = useT();
  const watched = useUi((s) => s.room);
  // live counts come with the room list; the spectate message only carries a snapshot
  const room = useUi((s) => (watched ? (s.rooms.find((r) => r.id === watched.id) ?? watched) : null));
  const connected = useUi((s) => s.connected);
  // the spectator camera follows the room's leader: credit them like a press photo
  const target = useUi((s) => s.spectateTarget);
  const inFrame = useUi((s) => s.lb.find((e) => e.pid === target)?.name ?? s.lb[0]?.name ?? null);
  const windowRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    // the lobby root (`.has-hole`) is an ancestor; its ref is not attached yet when this runs
    const win = windowRef.current;
    const root = win?.closest<HTMLElement>('.kl-root');
    if (!root || !win) return;
    let last = '';
    let raf = 0;
    const sync = () => {
      const r = root.getBoundingClientRect();
      const w = win.getBoundingClientRect();
      const key = `${w.left - r.left}|${w.top - r.top}|${w.width}|${w.height}`;
      if (key !== last) {
        last = key;
        root.style.setProperty('--hole-x', `${w.left - r.left}px`);
        root.style.setProperty('--hole-y', `${w.top - r.top}px`);
        root.style.setProperty('--hole-w', `${w.width}px`);
        root.style.setProperty('--hole-h', `${w.height}px`);
      }
      raf = requestAnimationFrame(sync);
    };
    sync();
    return () => cancelAnimationFrame(raf);
  }, []);

  const name = room ? roomName(room) : '';
  const humans = room?.players ?? 0;
  const bots = room?.bots ?? 0;
  return (
    <figure className="kl-live">
      <div className="kl-live__frame">
        <Tape rotate={-6} width={96} style={{ left: -18, top: -10 }} />
        <Tape rotate={8} width={84} tone="pink" style={{ right: -16, bottom: -8 }} />
        <div ref={windowRef} className="kl-live__window" role="img" aria-label={room ? t('lo.live.label', { room: name }) : t('lo.live.connecting')}>
          {!connected && (
            <span className="kl-live__wait mono kb-wait">
              <StampSpinner size="md" />
              {t('lo.live.connecting')}
            </span>
          )}
        </div>
        <span className="kl-live__badge mono" aria-hidden="true">
          <span className="kl-live__rec" />
          {t('lo.live')}
        </span>
      </div>
      <figcaption className="kl-live__cap">
        <span className="kl-live__room">{name || '—'}</span>
        <span className="kl-live__meta mono">
          {humans === 1 ? t('lo.humans1') : t('lo.humans', { n: humans })} · {bots === 1 ? t('lo.bots1') : t('lo.bots', { n: bots })}
          {inFrame && ` · ${t('lo.live.photo', { name: inFrame })}`}
        </span>
        <button type="button" className="kl-link mono" onClick={() => engine()?.watch()} disabled={!room}>
          <Icon name="play" size={14} />
          {t('lo.live.watch')}
        </button>
      </figcaption>
    </figure>
  );
}
