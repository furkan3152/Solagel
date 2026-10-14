import { lookForBasicSkin } from '@slana/art';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Icon, usePreset, useReducedMotion } from '../../design';
import { engine } from '../../game/instance';
import { useT } from '../../i18n';
import { useUi } from '../../store';

/** System lines are UI chrome: no emoji there (ruling R4); player text stays as typed. */
const stripEmoji = (s: string) => s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s{2,}/g, ' ').trim();

/** A skin's ink as a tiny riso dot (body + misregistered overprint). */
function InkDot({ skin }: { skin: number }) {
  const look = lookForBasicSkin(skin);
  return (
    <span className="g-dot" aria-hidden="true" style={{ ['--dot' as string]: look.body, ['--dot-over' as string]: look.overprint }} />
  );
}

/**
 * Event feed (bottom left): kills printed as torn ticker strips and the chat
 * slip. Enter opens the chat line; Esc closes it.
 */
export function Feed({ narrow }: { narrow: boolean }) {
  const t = useT();
  const killfeed = useUi((s) => s.killfeed);
  const chat = useUi((s) => s.chat);
  const chatOpen = useUi((s) => s.chatOpen);
  const showChat = useUi((s) => s.settings.showChat);
  const screen = useUi((s) => s.screen);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reduced = useReducedMotion();
  const spring = usePreset('press', { fade: true });

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chat, chatOpen]);
  useEffect(() => {
    if (chatOpen) inputRef.current?.focus();
  }, [chatOpen]);

  const send = () => {
    engine()?.chat(text);
    setText('');
    useUi.setState({ chatOpen: false });
  };

  const kills = narrow ? killfeed.slice(-2) : killfeed;
  const lines = chat.slice(narrow ? -3 : -30);
  const showSlip = showChat && (chatOpen || (!narrow && lines.length > 0));
  return (
    <div className="g-feed" aria-label={t('g.feed')} role="log" aria-live="polite">
      <ul className="g-kills">
        <AnimatePresence initial={false}>
          {kills.map((k) => (
            <motion.li
              key={k.id}
              className="g-kill mono"
              initial={reduced ? { opacity: 0 } : { opacity: 0, x: -24, rotate: -2 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, x: 0, rotate: k.id % 2 ? -0.6 : 0.5 }}
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
              transition={spring}
            >
              <InkDot skin={k.killerSkin} />
              <b>{k.killer}</b>
              <span className="g-kill__verb">{k.cause === 'virus' ? t('g.cactus') : t('g.ate')}</span>
              <InkDot skin={k.victimSkin} />
              <span>{k.victim}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {showSlip && (
        <div className="g-chat g-slip">
          <div className="g-slip__paper">
            <div ref={listRef} className="g-chat__lines">
              {lines.map((c) => (
                <p key={c.id} className={`g-chat__line${c.system ? ' is-system' : ''}`}>
                  {!c.system && (
                    <b>
                      <InkDot skin={c.skin} />
                      {c.from}
                    </b>
                  )}
                  <span>{c.system ? stripEmoji(c.text) : c.text}</span>
                </p>
              ))}
            </div>
            {chatOpen && (
              <form
                className="g-chat__form"
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
              >
                <input
                  ref={inputRef}
                  className="g-chat__input"
                  value={text}
                  maxLength={100}
                  placeholder={t('hud.chat')}
                  aria-label={t('g.chat')}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') useUi.setState({ chatOpen: false });
                    e.stopPropagation();
                  }}
                  onBlur={() => useUi.setState({ chatOpen: false })}
                />
                <button type="submit" className="kb-iconbtn kb-iconbtn--sm" aria-label={t('g.chatSend')} onMouseDown={(e) => e.preventDefault()}>
                  <Icon name="arrow" size={18} />
                </button>
              </form>
            )}
          </div>
        </div>
      )}
      {screen === 'playing' && showChat && !chatOpen && !narrow && (
        <button type="button" className="g-chat__open mono" onClick={() => useUi.setState({ chatOpen: true })}>
          <Icon name="chat" size={16} /> {t('g.chat')} <kbd>Enter</kbd>
        </button>
      )}
    </div>
  );
}
