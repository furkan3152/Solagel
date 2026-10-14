import { InkButton, Sheet, Stamp } from '../../design';
import { engine } from '../../game/instance';
import { sound } from '../../game/sound';
import { useT } from '../../i18n';
import { requestTicket, useUi } from '../../store';
import { CoinPortrait } from './CoinPortrait';
import { formatClock, roomName, useTokenFormat } from './format';
import { useEffect } from 'react';

/**
 * Death: a "YENİLDİN" verdict stamp, who ate us (or the bot line: our tokens
 * spilled across the map), the value lost and two ways on: a new ticket or
 * practice.
 */
export function DeathSheet() {
  const t = useT();
  const tf = useTokenFormat();
  const death = useUi((s) => s.death);
  const room = useUi((s) => s.room);
  const me = useUi((s) => s.me);
  const lang = useUi((s) => s.settings.lang);
  const signedIn = useUi((s) => s.auth !== null);
  const open = useUi((s) => s.screen === 'dead' && s.death !== null);

  useEffect(() => {
    if (!open) return;
    // the stamp lands ~290 ms in
    const id = setTimeout(() => sound.stamp(), 290);
    return () => clearTimeout(id);
  }, [open]);

  const s = death?.stats;
  const arena = room?.mode === 'arena';
  const byBot = arena && s?.byBot === true;
  const lost = arena ? (s?.valueLost ?? 0) : 0;
  const spilled = byBot ? (s?.lootSpilled ?? lost) : 0;
  const practice = () => {
    sound.click();
    engine()?.play(room?.mode === 'private' && room.code ? `private:${room.code}` : 'practice');
  };
  const newTicket = () => {
    sound.click();
    // the lobby selects this arena's ticket (its confirm sheet opens once the old ticket is paid out)
    if (arena && room?.arenaId !== undefined) requestTicket(room.arenaId);
    engine()?.backToLobby();
  };
  const killerLine = death?.killer ? (byBot ? t('gd.byBot') : t('gd.byPlayer', { name: death.killer })) : t('gd.byNobody');

  return (
    <Sheet
      open={open}
      onClose={() => engine()?.backToLobby()}
      closeLabel={t('gd.close')}
      kicker={t('gd.kicker', { room: roomName(room, lang) })}
      className="g-sheet g-death"
      title={<Stamp text={t('gd.stamp')} size="lg" tone="red" rotate={-7} animateIn delay={0.12} />}
      footer={
        arena ? (
          <>
            <InkButton variant="pink" size="lg" icon="ticket" onClick={newTicket} data-autofocus>
              {t('gd.newTicket')}
            </InkButton>
            <InkButton variant="paper" size="lg" icon="play" onClick={practice}>
              {t('gd.practice')}
            </InkButton>
          </>
        ) : (
          <>
            <InkButton variant="pink" size="lg" icon="play" onClick={practice} data-autofocus>
              {t('gd.practice')}
            </InkButton>
            <InkButton variant="paper" size="lg" icon="ticket" onClick={newTicket}>
              {t('gd.newTicket')}
            </InkButton>
          </>
        )
      }
    >
      {s && (
        <div className="g-death__body">
          <div className="g-death__who">
            <div className="g-death__portraits" aria-hidden="true">
              <CoinPortrait skin={me?.skin ?? 0} size={74} expression="dead" seed={3} className="g-death__me" />
              {death?.killer && <CoinPortrait skin={death.killerSkin ?? 0} size={92} expression="proud" seed={7} className="g-death__killer" />}
            </div>
            <p className="g-death__line">{killerLine}</p>
          </div>

          {arena && (
            <dl className="g-death__loss">
              <div>
                <dt className="mono">{t('gd.valueLost')}</dt>
                <dd>
                  <span className="g-death__amount">{lost > 0 ? `−${tf.fmt(lost)}` : tf.fmt(0)}</span>
                  <span className="mono g-death__unit">{tf.symbol}</span>
                </dd>
              </div>
              {spilled > 0 && (
                <div className="is-muted">
                  <dt className="mono">{t('gd.spilled')}</dt>
                  <dd className="mono">{tf.fmt(spilled)}</dd>
                </div>
              )}
            </dl>
          )}

          <dl className="g-stats">
            <div>
              <dt className="mono">{t('gd.alive')}</dt>
              <dd>{formatClock(s.aliveMs)}</dd>
            </div>
            <div>
              <dt className="mono">{t('gd.maxMass')}</dt>
              <dd>{Math.floor(s.maxMass).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US')}</dd>
            </div>
            <div>
              <dt className="mono">{t('gd.rank')}</dt>
              <dd>{s.bestRank ? `#${s.bestRank}` : '—'}</dd>
            </div>
            <div>
              <dt className="mono">{t('gd.eaten')}</dt>
              <dd>{s.playersEaten}</dd>
            </div>
            {/* XP is still part of DeathStats in v2; it only counts for signed-in players */}
            {signedIn && s.xp !== undefined && (
              <div>
                <dt className="mono">{t('gd.xp')}</dt>
                <dd>+{s.xp}</dd>
              </div>
            )}
          </dl>

          <button type="button" className="g-link mono" onClick={() => engine()?.watch()}>
            {t('gd.watch')}
          </button>
        </div>
      )}
    </Sheet>
  );
}
