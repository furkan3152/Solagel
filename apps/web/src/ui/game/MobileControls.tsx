import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Icon, usePreset } from '../../design';
import { engine } from '../../game/instance';
import { useT } from '../../i18n';
import { useUi } from '../../store';
import { useTicker } from '../common';
import { EmoteBar } from './EmoteBar';

const TOUCH_QUERY = '(hover: none) and (pointer: coarse)';

export function useIsTouch(): boolean {
  const [touch, setTouch] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(TOUCH_QUERY).matches === true);
  useEffect(() => {
    const m = window.matchMedia?.(TOUCH_QUERY);
    if (!m) return;
    const on = () => setTouch(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return touch;
}

/**
 * Phone controls: a printed joystick (coin knob on a ruled disc) on the left,
 * round ink buttons on the right. Every target is at least 44 px (most 56+).
 */
export function MobileControls() {
  const t = useT();
  const room = useUi((s) => s.room);
  const cashout = useUi((s) => s.cashout);
  const knob = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLDivElement>(null);
  const ring = useRef<SVGCircleElement>(null);
  const [emotes, setEmotes] = useState(false);
  const pop = usePreset('press', { fade: true });
  const arena = room?.mode === 'arena';
  const channel = cashout.state === 'channel';

  useTicker(() => {
    const p = Math.max(0, Math.min(1, 1 - (cashout.until - performance.now()) / (cashout.total || 3000)));
    ring.current?.setAttribute('stroke-dasharray', `${(p * 100).toFixed(1)} 100`);
  }, channel);

  const move = (clientX: number, clientY: number) => {
    const e = engine();
    const b = base.current;
    if (!e || !b) return;
    const r = b.getBoundingClientRect();
    const k = e.input.setStick(clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2), r.width / 2);
    knob.current!.style.transform = `translate(${k.x}px, ${k.y}px)`;
  };
  const end = () => {
    if (knob.current) knob.current.style.transform = '';
    engine()?.input.releaseStick();
  };

  return (
    <>
      <div
        ref={base}
        className="g-stick"
        role="application"
        aria-label={t('g.joystick')}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          move(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => e.buttons && move(e.clientX, e.clientY)}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div ref={knob} className="g-stick__knob" />
      </div>
      <div className="g-touch">
        <button type="button" className="g-touch__btn is-split" onPointerDown={() => engine()?.split()} aria-label={t('hud.split')}>
          <Icon name="split" size={26} />
          <span className="mono">{t('hud.split')}</span>
        </button>
        <button
          type="button"
          className="g-touch__btn is-eject"
          onPointerDown={() => engine()?.input.startEject()}
          onPointerUp={() => engine()?.input.stopEject()}
          onPointerLeave={() => engine()?.input.stopEject()}
          onPointerCancel={() => engine()?.input.stopEject()}
          aria-label={t('hud.eject')}
        >
          <Icon name="eject" size={24} />
          <span className="mono">{t('hud.eject')}</span>
        </button>
        <button type="button" className={`g-touch__btn is-small${emotes ? ' is-on' : ''}`} onClick={() => setEmotes((v) => !v)} aria-label={t('g.emotes')} aria-expanded={emotes}>
          <Icon name="emote" size={22} />
        </button>
        {arena ? (
          <button type="button" className={`g-touch__btn is-cash${channel ? ' is-printing' : ''}`} onClick={() => engine()?.cashout()} disabled={channel} aria-label={t('g.cashout')}>
            <svg className="g-touch__ring" viewBox="0 0 40 40" aria-hidden="true">
              <circle ref={ring} cx="20" cy="20" r="18" pathLength="100" strokeDasharray="0 100" />
            </svg>
            <Icon name="cashout" size={24} />
            <span className="mono">{t('g.cashout')}</span>
          </button>
        ) : (
          <button type="button" className="g-touch__btn is-alt" onClick={() => useUi.setState({ chatOpen: true })} aria-label={t('g.chat')}>
            <Icon name="chat" size={22} />
          </button>
        )}
      </div>
      <AnimatePresence>
        {emotes && (
          <motion.div
            className="g-touch__emotes g-slip"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={pop}
          >
            <div className="g-slip__paper">
              <EmoteBar keys={false} onPick={() => setEmotes(false)} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
