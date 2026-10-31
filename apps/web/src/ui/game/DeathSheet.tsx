import { Button, DUR, Sheet, useReducedMotion } from '../../design';
import { engine } from '../../game/instance';
import { formatCountdown, useRound } from '../../game/round';
import { sound } from '../../audio';
import { useT } from '../../i18n';
import { requestTicket, useUi } from '../../store';
import { CoinPortrait } from './CoinPortrait';
import { formatClock, roomName, useTokenFormat } from './format';
import { useEffect, useState } from 'react';

/** The EATEN sheet waits for the death slow motion and the eater's mouth to shut (ms). */
export const DEATH_SHEET_DELAY_MS = Math.round((DUR.slowmo + 0.42) * 1000);

/**
 * Death: "Eaten.", who ate us (or the bot line: our tokens
 * spilled across the map), the value lost and two ways on: a new ticket or
 * practice. In an arena the new ticket re-enters the same round ("Buy back in")
 * while joins are open; in the final minute it says when the next round opens.
 */
export function DeathSheet() {
  const t = useT();
  const tf = useTokenFormat();
  const death = useUi((s) => s.death);
  const room = useUi((s) => s.room);
  const me = useUi((s) => s.me);
  const signedIn = useUi((s) => s.auth !== null);
  const dead = useUi((s) => s.screen === 'dead' && s.death !== null);
  const ticket = useUi((s) => s.ticket);
  const reduced = useReducedMotion();
  // the world slows down over the ink splash first; the verdict comes after that beat
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!dead) {
      setOpen(false);
      return;
    }
    if (reduced) {
      setOpen(true);
      return;
    }
    const id = setTimeout(() => setOpen(true), DEATH_SHEET_DELAY_MS);
    return () => clearTimeout(id);
  }, [dead, reduced]);

  useEffect(() => {
    if (!open) return;
    // the stamp lands ~290 ms in
    const id = setTimeout(() => sound.stamp('eaten'), 290);
    return () => clearTimeout(id);
  }, [open]);

  const s = death?.stats;
  const arena = room?.mode === 'arena';
  const byBot = arena && s?.byBot === true;
  const lost = arena ? (s?.valueLost ?? 0) : 0;
  const spilled = byBot ? (s?.lootSpilled ?? lost) : 0;
  const practice = () => {
    sound.punch();
    engine()?.play(room?.mode === 'private' && room.code ? `private:${room.code}` : 'practice');
  };
  const newTicket = () => {
    sound.click();
    // the lobby selects this arena's ticket (its confirm sheet opens once the old ticket is paid out)
    if (arena && room?.arenaId !== undefined) requestTicket(room.arenaId);
    engine()?.backToLobby();
  };
  const round = useRound(arena ? (room?.arenaId ?? null) : null, arena && open);
  const closed = round?.phase === 'closing';
  const fee = ticket?.entryFee ?? room?.entryFee ?? 0;
  const buyBack = closed ? (
    <Button variant="primary" size="lg" icon="ticket" sub={t('gd.nextRoundSub')} onClick={newTicket} data-autofocus>
      {t('gd.nextRoundIn', { time: formatCountdown(round.msLeft) })}
    </Button>
  ) : (
    <Button variant="primary" size="lg" icon="ticket" sub={t('gd.buyBackSub')} onClick={newTicket} data-autofocus>
      {t('gd.buyBack', { fee: tf.fmt(fee, { compact: true, maxFrac: 1 }), sym: tf.symbol })}
    </Button>
  );
  const killerLine = death?.killer ? (byBot ? t('gd.byBot') : t('gd.byPlayer', { name: death.killer })) : t('gd.byNobody');

  return (
    <Sheet
      open={open}
      onClose={() => engine()?.backToLobby()}
      closeLabel={t('gd.close')}
      kicker={t('gd.kicker', { room: roomName(room) })}
      className="g-sheet g-death"
      title={<span className="g-death__title">{t('gd.stamp')}</span>}
      footer={
        arena ? (
          <>
            {buyBack}
            <Button variant="secondary" size="lg" icon="play" onClick={practice}>
              {t('gd.practice')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" size="lg" icon="play" onClick={practice} data-autofocus>
              {t('gd.practice')}
            </Button>
            <Button variant="secondary" size="lg" icon="ticket" onClick={newTicket}>
              {t('gd.newTicket')}
            </Button>
          </>
        )
      }
    >
      {s && (
        <div className="g-death__body">
          <div className="g-death__who">
            <div className="g-death__scene" aria-hidden="true">
              {death?.killer && <CoinPortrait skin={death.killerSkin ?? 0} size={104} expression="proud" seed={7} className="g-death__killer" />}
              <CoinPortrait skin={me?.skin ?? 0} size={64} expression="dead" seed={3} className="g-death__me" />
              <span className="g-death__ground" />
            </div>
            <div className="g-death__said">
              <p className="g-death__line">{killerLine}</p>
              <p className="g-death__quip">{t(arena ? 'gd.quipArena' : 'gd.quip')}</p>
            </div>
          </div>

          {arena && (
            <dl className="g-death__loss">
              <div>
                <dt className="mono">{t('gd.valueLost')}</dt>
                <dd>
                  <span className="g-death__amount num">{lost > 0 ? `−${tf.fmt(lost)}` : tf.fmt(0)}</span>
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
              <dd>{Math.floor(s.maxMass).toLocaleString('en-US')}</dd>
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
