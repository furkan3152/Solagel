import { useEffect, type ReactNode } from 'react';
import { Button, CoinCharacter, FoodBit, Sheet } from '../../design';
import { briefSeen, closeBrief, openBrief, useBrief } from '../../game/brief';
import { useT } from '../../i18n';
import { useUi } from '../../store';
import { useIsTouch } from './MobileControls';
import './brief.css';

function Step({ n, art, head, children }: { n: number; art: ReactNode; head: string; children: ReactNode }) {
  return (
    <li className="g-brief__step" style={{ rotate: `${n % 2 ? -0.6 : 0.5}deg` }}>
      <span className="g-brief__art" aria-hidden="true">
        {art}
      </span>
      <span className="g-brief__text">
        <span className="g-brief__head">
          <span className="g-brief__n mono">{String(n).padStart(2, '0')}</span>
          {head}
        </span>
        <span className="g-brief__line">{children}</span>
      </span>
    </li>
  );
}

/**
 * The first-play brief: four tiny steps before a newcomer's first drop. The join
 * waits behind it (engine `play` holds it), so nobody is eaten while reading.
 * Closing it (button, Esc, a click outside) remembers it; How to play opens it again.
 */
export function FirstPlayBrief() {
  const t = useT();
  const touch = useIsTouch();
  const { open, mode, room } = useBrief();
  const playing = useUi((s) => s.screen === 'playing');
  const roomMode = useUi((s) => s.room?.mode);

  // a game that began without a held join (a held ticket joining by itself): show it once over the game
  useEffect(() => {
    if (playing && !briefSeen() && !useBrief.getState().open) openBrief('first', null);
  }, [playing]);

  const arena = room ? room.startsWith('arena:') : roomMode === 'arena';
  const first = mode === 'first';

  return (
    <Sheet
      open={open}
      onClose={closeBrief}
      closeLabel={t('brief.close')}
      kicker={t('brief.kicker')}
      title={<span className="g-brief__title">{t('brief.title')}</span>}
      className="g-sheet g-brief"
      footer={
        <>
          <Button variant="primary" size="lg" icon={first ? 'play' : undefined} onClick={closeBrief} data-autofocus>
            {first ? t('brief.go') : t('brief.ok')}
          </Button>
          {!touch && <span className="g-brief__esc mono">{t('brief.esc')}</span>}
        </>
      }
    >
      <ol className="g-brief__steps">
        <Step n={1} head={t('brief.steer.head')} art={<CoinCharacter paint="cyan" mood="smile" size={58} look={[3.5, -1]} blink={false} />}>
          {touch ? (
            t('brief.steer.touch')
          ) : (
            <>
              {t('brief.steer.mouse')}{' '}
              <span className="g-brief__keys" aria-hidden="true">
                {['W', 'A', 'S', 'D'].map((k) => (
                  <kbd key={k} className="kb-key">
                    {k}
                  </kbd>
                ))}
              </span>
            </>
          )}
        </Step>
        <Step
          n={2}
          head={t('brief.eat.head')}
          art={
            <>
              <CoinCharacter paint="sun" mood="open" size={58} look={[3, 1]} blink={false} />
              <FoodBit kind="pear" size={22} className="g-brief__food" />
            </>
          }
        >
          {t('brief.eat.text')}
        </Step>
        <Step
          n={3}
          head={t('brief.avoid.head')}
          art={
            <>
              <CoinCharacter paint="coral" mood="smug" size={62} look={[3, 0]} blink={false} className="g-brief__big" />
              <CoinCharacter paint="foam" mood="scared" size={34} sweat look={[3, 0]} blink={false} className="g-brief__small" />
            </>
          }
        >
          {t('brief.avoid.text')}
        </Step>
        <Step
          n={4}
          head={t('brief.moves.head')}
          art={
            <>
              <CoinCharacter paint="cyan" mood="happy" size={40} blink={false} className="g-brief__half1" />
              <CoinCharacter paint="cyan" mood="open" size={34} look={[3, -1]} blink={false} className="g-brief__half2" />
            </>
          }
        >
          {touch ? t('brief.moves.touch') : t('brief.moves.keys')}
        </Step>
      </ol>
      <p className={`g-brief__note${arena ? ' is-arena' : ''}`}>{arena ? t('brief.arena') : t('brief.practice')}</p>
    </Sheet>
  );
}
