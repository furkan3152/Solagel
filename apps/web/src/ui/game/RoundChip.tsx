import { AnimatePresence, motion } from 'motion/react';
import { springs, useReducedMotion } from '../../design';
import { COUNTDOWN_MS, formatCountdown, useRound, type RoundState } from '../../game/round';
import { useT } from '../../i18n';
import { useUi } from '../../store';

/** The arena round on screen (null outside arenas). */
function useArenaRound(): RoundState | null {
  const room = useUi((s) => s.room);
  const arena = room?.mode === 'arena';
  return useRound(arena ? (room.arenaId ?? null) : null, arena);
}

/** Seconds of the last-ten countdown, or null before it. */
const countOf = (r: RoundState): number | null => (r.msLeft <= COUNTDOWN_MS ? Math.max(1, Math.ceil(r.msLeft / 1000)) : null);

/**
 * The round clock on the HUD (arenas only): a paper chip with `m:ss` to the bell. In the final
 * minute (joins closed) it turns mustard and says so. A polite live region speaks the phase
 * changes only, never every second.
 */
export function RoundChip() {
  const t = useT();
  const round = useArenaRound();
  if (!round) return null;
  const time = formatCountdown(round.msLeft);
  const closing = round.phase === 'closing';
  const count = countOf(round);
  const label = closing ? t('g.finalMinuteLeft', { time }) : t('g.roundEnds', { time });
  return (
    <>
      <div className={`g-round${closing ? ' is-closing' : ''}${count !== null ? ' is-count' : ''}`} role="timer" aria-label={label} data-phase={round.phase}>
        <span className="g-round__label mono">{closing ? t('g.finalMinute') : t('g.round')}</span>
        <span className="g-round__time mono" aria-hidden="true">
          {time}
        </span>
      </div>
      {/* phase changes only: "Final minute", then "10 seconds left" */}
      <span className="sr-only" aria-live="polite">
        {count !== null ? t('g.countdown', { s: 10 }) : closing ? t('g.finalMinute') : ''}
      </span>
    </>
  );
}

/** The last ten seconds: a big number stamped in once a second over the top of the world. */
export function RoundCountdown() {
  const round = useArenaRound();
  const reduced = useReducedMotion();
  const count = round ? countOf(round) : null;
  return (
    <div className={`g-count${count !== null ? ' is-on' : ''}`} aria-hidden="true">
      <AnimatePresence initial={false}>
        {count !== null && (
          <motion.span
            key={count}
            className={`g-count__n${count <= 3 ? ' is-last' : ''}`}
            data-testid="round-count"
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.6, rotate: -8 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, rotate: -3 }}
            exit={reduced ? { opacity: 0, transition: { duration: 0.1 } } : { opacity: 0, scale: 0.9, transition: { duration: 0.18 } }}
            transition={reduced ? { duration: 0.12 } : springs.stamp}
          >
            {count}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
