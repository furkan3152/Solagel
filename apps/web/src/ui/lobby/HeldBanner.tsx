import { arenaMeta } from '@elymum/shared';
import { useEffect, useState } from 'react';
import { serverClock } from '../../game/clock';
import { formatCountdown } from '../../game/round';
import { useT } from '../../i18n';
import { useUi } from '../../store';

/** Milliseconds until a held ticket's round opens (server clock), re-rendering every second. */
export function useHeldCountdown(): { arenaId: number; msLeft: number } | null {
  const held = useUi((s) => s.held);
  const [now, setNow] = useState(() => serverClock.now());
  useEffect(() => {
    if (!held) return;
    let id: ReturnType<typeof setTimeout>;
    const step = () => {
      const t = serverClock.now();
      setNow(t);
      id = setTimeout(step, ((held.opensAt - t) % 1000 + 1000) % 1000 + 15);
    };
    step();
    return () => clearTimeout(id);
  }, [held?.arenaId, held?.opensAt]);
  return held ? { arenaId: held.arenaId, msLeft: Math.max(0, held.opensAt - now) } : null;
}

/**
 * A ticket bought (or resumed) in a round's final minute is not lost: joins are closed until
 * the bell, so the ticket is held and the game joins by itself when the next round opens.
 */
export function HeldBanner() {
  const t = useT();
  const held = useHeldCountdown();
  if (!held) return null;
  const opening = held.msLeft <= 0;
  return (
    <section className="kl-owed kl-held" aria-labelledby="kl-held-k">
      {/* said once; the countdown itself is not read out every second */}
      <span className="sr-only" role="status">
        {t('lo.held')}
      </span>
      <div className="kl-owed__slip">
        <div className="kl-owed__top">
          <span id="kl-held-k" className="kl-owed__kicker kl-held__kicker mono">
            {arenaMeta(held.arenaId).name}
          </span>
        </div>
        <p className="kl-owed__title">{opening ? t('lo.held.opening') : t('lo.held.banner', { time: formatCountdown(held.msLeft) })}</p>
        <p className="kl-owed__note">{t('lo.held.note')}</p>
      </div>
    </section>
  );
}
