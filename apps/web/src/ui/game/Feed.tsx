import { lookForSkin as lookForBasicSkin } from '../../render/looks';
import { AnimatePresence, motion } from 'motion/react';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, usePreset, useReducedMotion } from '../../design';
import { engine } from '../../game/instance';
import { BotTag } from './BotTag';
import { useT, type TKey } from '../../i18n';
import { useUi, type KillItem } from '../../store';

/** System lines are UI chrome: no emoji there; player text stays as typed. */
const stripEmoji = (s: string) =>
  s
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

/** A skin's paint as a tiny inked coin. */
function InkDot({ skin }: { skin: number }) {
  const look = lookForBasicSkin(skin);
  return <span className="g-dot" aria-hidden="true" style={{ ['--dot' as string]: look.body }} />;
}

/** The feed's wry ways of saying "ate" (picked by the event id, so a line never changes its mind). */
const EAT_LINES: readonly TKey[] = ['g.kill.0', 'g.kill.1', 'g.kill.2', 'g.kill.3'];

/** One kill as a sentence: the killer and the victim keep their dots; "you" is printed in sun. */
function KillLine({ k, myName }: { k: KillItem; myName: string | null }) {
  const t = useT();
  const key = k.cause === 'left' ? 'g.wentHome' : k.cause === 'virus' ? 'g.kill.cactus' : EAT_LINES[k.id % EAT_LINES.length];
  const who = (name: string, skin: number, bot: boolean | undefined, mark: string) => {
    const me = myName !== null && name === myName && !bot;
    return (
      <b className={me ? 'is-me' : undefined} key={mark}>
        <InkDot skin={skin} />
        {me ? t('g.youName') : name}
        {bot && <BotTag />}
      </b>
    );
  };
  // the sentence comes from the copy with two markers for the names
  const text = t(key as 'g.kill.0', { k: '\u0001', v: '\u0002' });
  const parts: ReactNode[] = text.split(/(\u0001|\u0002)/).map((p, i) => {
    if (p === '\u0001') return who(k.killer, k.killerSkin, k.killerIsBot, `k${i}`);
    if (p === '\u0002') return who(k.victim, k.victimSkin, k.victimIsBot, `v${i}`);
    return <Fragment key={i}>{p}</Fragment>;
  });
  return <>{parts}</>;
}

/**
 * The feed under the timer: kills as small ink strips with a wry verb, and the chat slip.
 * Enter opens the chat line; Esc closes it.
 */
export function Feed({ narrow }: { narrow: boolean }) {
  const t = useT();
  const killfeed = useUi((s) => s.killfeed);
  const chat = useUi((s) => s.chat);
  const chatOpen = useUi((s) => s.chatOpen);
  const showChat = useUi((s) => s.settings.showChat);
  const myName = useUi((s) => s.me?.name ?? null);
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

  const kills = narrow ? killfeed.slice(-2) : killfeed.slice(-5);
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
              initial={reduced ? { opacity: 0 } : { opacity: 0, x: -18 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
              transition={spring}
            >
              <KillLine k={k} myName={myName} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {showSlip && (
        <div className="g-chat">
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
              <button type="submit" className="kb-iconbtn kb-iconbtn--sm g-chat__send" aria-label={t('g.chatSend')} onMouseDown={(e) => e.preventDefault()}>
                <Icon name="arrow" size={18} />
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
