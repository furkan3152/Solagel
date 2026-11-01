import { useLayoutEffect, useRef } from 'react';
import { Icon, StampSpinner, Tape } from '../../design';
import { setWorldCovered } from '../../game/backdrop';
import { engine } from '../../game/instance';
import { useT } from '../../i18n';
import { useUi } from '../../store';
import { roomName } from '../game/format';

/**
 * The live window: a sticker frame cut into the lobby page through which the
 * live game canvas (spectating the busiest room) shows. The page has no paper
 * of its own while it has a window (`.has-hole`): the paper is the spread of a
 * clear box laid over this element's window (`.kl-hole`, in the page's own
 * coordinates), so the world is rendered once by the engine and never copied,
 * and scrolling moves the window and its hole together on the compositor.
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
    const page = root?.querySelector<HTMLElement>(':scope > .kl-sheet-page');
    if (!root || !page || !win) return;
    // The hole is placed in the page's own coordinates, so it scrolls with the page on the
    // compositor: scrolling never touches it. It is measured again only while the layout
    // moves: a burst of frames from mount (which follows the page's entrance motion) and after
    // any resize of the window, the page or the root, until it has held still for 30 frames.
    const hole = document.createElement('div');
    hole.className = 'kl-hole';
    hole.setAttribute('aria-hidden', 'true');
    page.prepend(hole);
    root.dataset.hole = '';
    let last = '';
    let raf = 0;
    let still = 0;
    const measure = () => {
      const p = page.getBoundingClientRect();
      const w = win.getBoundingClientRect();
      const x = w.left - p.left;
      const y = w.top - p.top;
      const key = `${x}|${y}|${w.width}|${w.height}`;
      if (key === last) return false;
      last = key;
      hole.style.transform = `translate(${x}px, ${y}px)`;
      hole.style.width = `${w.width}px`;
      hole.style.height = `${w.height}px`;
      // the scrollbar's gutter is not page: it gets the paper too (a plain property, not an
      // inherited variable, so nothing under the root restyles)
      root.style.backgroundSize = `${root.offsetWidth - root.clientWidth}px 100%`;
      return true;
    };
    const tick = () => {
      still = measure() ? 0 : still + 1;
      // settled for half a second: stop until the layout moves again
      raf = still < 30 ? requestAnimationFrame(tick) : 0;
    };
    const wake = () => {
      still = 0;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    measure();
    wake();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(wake);
    ro?.observe(win);
    ro?.observe(page);
    ro?.observe(root);
    // the world is drawn only while some of the window is on screen
    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            for (const e of entries) setWorldCovered(!e.isIntersecting);
          });
    io?.observe(win);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
      hole.remove();
      delete root.dataset.hole;
      root.style.removeProperty('background-size');
    };
  }, []);

  const name = room ? roomName(room) : '';
  const humans = room?.players ?? 0;
  const bots = room?.bots ?? 0;
  return (
    <figure className="kl-live">
      <div className="kl-live__frame">
        <Tape rotate={-4} width={96} style={{ left: '50%', marginLeft: -48, top: -15 }} />
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
