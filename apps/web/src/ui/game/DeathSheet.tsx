import { Button, DUR, Sheet, useReducedMotion } from '../../design';
import { engine } from '../../game/instance';
import { formatCountdown, useRound } from '../../game/round';
import { useT } from '../../i18n';
import { requestTicket, useUi } from '../../store';
import { CoinPortrait } from './CoinPortrait';
import { formatClock, roomName, useTokenFormat } from './format';
import { useEffect, useState } from 'react';

/** The game-over sheet waits for the death slow motion and the eater's mouth to shut (ms). */
export const DEATH_SHEET_DELAY_MS = Math.round((DUR.slowmo + 0.42) * 1000);

/**
 * Death: "Game over" and one way on, "Start over". Practice (and a private room)
 * rejoins the same room at once; an arena goes back to the lobby with this
 * arena's ticket flow open (a new ticket: the button's sub line says the fee, or
 * when the next round opens in the final minute). Who ate us and the stats sit
 * small under the headline. Silent on purpose: no stamp, no sheet lift.
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

  const s = death?.stats;
  const arena = room?.mode === 'arena';
  const byBot = arena && s?.byBot === true;
  const lost = arena ? (s?.valueLost ?? 0) : 0;
  const spilled = byBot ? (s?.lootSpilled ?? lost) : 0;
  const startOver = () => {
    if (arena) {
      // a new ticket: the lobby selects this arena's ticket and opens its flow (once the old one is paid out)
      if (room?.arenaId !== undefined) requestTicket(room.arenaId);
      engine()?.backToLobby();
      return;
    }
    engine()?.play(room?.mode === 'private' && room.code ? `private:${room.code}` : 'practice');
  };
  const round = useRound(arena ? (room?.arenaId ?? null) : null, arena && open);
  const closed = round?.phase === 'closing';
  const fee = ticket?.entryFee ?? room?.entryFee ?? 0;
  const sub = !arena
    ? undefined
    : closed
      ? t('gd.nextRoundIn', { time: formatCountdown(round.msLeft) })
      : t('gd.newTicketFee', { fee: tf.fmt(fee, { compact: true, maxFrac: 1 }), sym: tf.symbol });
  const killerLine = death?.killer ? (byBot ? t('gd.byBot') : t('gd.byPlayer', { name: death.killer })) : t('gd.byNobody');

  return (
    <Sheet
      open={open}
      onClose={() => engine()?.backToLobby()}
      closeLabel={t('gd.close')}
      kicker={t('gd.kicker', { room: roomName(room) })}
      className="g-sheet g-death"
      quiet
      title={<span className="g-death__title">{t('gd.stamp')}</span>}
      footer={
        <Button variant="primary" size="lg" icon={arena ? 'ticket' : 'play'} sub={sub} onClick={startOver} data-autofocus>
          {t('gd.startOver')}
        </Button>
      }
    >
      {s && (
        <div className="g-death__body">
          <div className="g-death__who">
            <div className="g-death__scene" aria-hidden="true">
              {death?.killer && <CoinPortrait skin={death.killerSkin ?? 0} size={64} expression="proud" seed={7} className="g-death__killer" />}
              <CoinPortrait skin={me?.skin ?? 0} size={40} expression="dead" seed={3} className="g-death__me" />
              <span className="g-death__ground" />
            </div>
            <p className="g-death__line">{killerLine}</p>
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

          <dl className="g-stats g-stats--small">
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
