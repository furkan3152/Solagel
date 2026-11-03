import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Icon, usePreset } from '../../design';
import { engine } from '../../game/instance';
import { useT } from '../../i18n';
import { useUi } from '../../store';
import { BoostBar } from './BoostBar';
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

/** The chat button: the folded chat slip, with a dot while there are lines I have not seen. */
function ChatButton() {
  const t = useT();
  const lastId = useUi((s) => s.chat.at(-1)?.id ?? 0);
  const chatOpen = useUi((s) => s.chatOpen);
  const showChat = useUi((s) => s.settings.showChat);
  const seen = useRef(lastId);
  if (chatOpen) seen.current = lastId;
  const unread = showChat && !chatOpen && lastId > seen.current;
  return (
    <button type="button" className="g-touch__btn is-alt" onClick={() => useUi.setState({ chatOpen: true })} aria-label={unread ? t('g.chatUnread') : t('g.chat')} data-testid="touch-chat">
      <Icon name="chat" size={22} />
      {unread && <span className="g-touch__dot" aria-hidden="true" />}
    </button>
  );
}

/**
 * Phone controls: a joystick (a coin knob with a face on a dotted orbit disc) on the left,
 * chunky sticker buttons on the right with the bought power-ups. Every target is at least 44 px
 * (most 56+). Paid rooms have no cash-out (everyone alive is paid at the round's bell), so every room
 * gets the chat button.
 */
export function MobileControls() {
  const t = useT();
  const knob = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLDivElement>(null);
  const [emotes, setEmotes] = useState(false);
  const pop = usePreset('press', { fade: true });

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
  // the controls leave mid-press (eaten, the bell, back to the lobby): no pointerup ever reaches
  // them, so a held stick or Tip would keep steering / tipping into the next life
  useEffect(
    () => () => {
      const input = engine()?.input;
      input?.releaseStick();
      input?.stopEject();
    },
    [],
  );

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
        onLostPointerCapture={end}
      >
        <div ref={knob} className="g-stick__knob">
          <svg viewBox="0 0 40 40" aria-hidden="true">
            <circle cx="15" cy="17" r="4" className="g-stick__eye" />
            <circle cx="25" cy="17" r="4" className="g-stick__eye" />
            <circle cx="16" cy="18" r="1.8" className="g-stick__pupil" />
            <circle cx="26" cy="18" r="1.8" className="g-stick__pupil" />
            <path d="M15 25c3 3 7 3 10 0" className="g-stick__mouth" />
          </svg>
        </div>
      </div>
      <div className="g-touch">
        {/* bought power-ups ride with the thumb buttons (a row above them in portrait, a column beside them in landscape) */}
        <BoostBar touch />
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
        <button
          type="button"
          className={`g-touch__btn is-small${emotes ? ' is-on' : ''}`}
          onClick={() => setEmotes((v) => !v)}
          aria-label={t('g.emotes')}
          aria-expanded={emotes}
        >
          <Icon name="emote" size={22} />
        </button>
        <ChatButton />
      </div>
      <AnimatePresence>
        {emotes && (
          <motion.div
            className="g-touch__emotes"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={pop}
          >
            <EmoteBar keys={false} onPick={() => setEmotes(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
