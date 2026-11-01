import type { GameAccess } from '@elymum/shared';
import { Suspense, lazy, useEffect, useState } from 'react';
import { Kb, useReducedMotion } from '../../design';
import { auth, site } from '../api';
import { readStoredSession, type SiteSession } from '../storedSession';
import { GateScene } from './GateScene';
import './play.css';

/** The closed / holders page (site shell, wallet sign-in): only downloaded when the gate stays shut. */
const ArenaSoon = lazy(() => import('./ArenaSoon').then((m) => ({ default: m.ArenaSoon })));

export type PlayAccess =
  | { allowed: true; reason: 'public' | 'admin' | 'holder'; session: SiteSession | null }
  /** `holders`: the game is open to NFT holders and this visitor is not a signed-in holder (yet). */
  | { allowed: false; reason: 'closed' | 'holders'; session: null };

/**
 * Who may open `/play` (`gameAccess`, the server's `GAME_ACCESS` overrides it): everyone when
 * `public`; when `holders`, a signed-in wallet holding an Elymum NFT (`/api/auth/me` says
 * `canPlay`) or an admin; when `admins`, only a signed-in admin wallet. The server enforces the
 * same rule on the WebSocket; this only spares visitors the game download and a refused join.
 */
export async function playAccess(): Promise<PlayAccess> {
  const stored = readStoredSession();
  let access: GameAccess = 'admins';
  try {
    const settings = await site.settings();
    access = settings.gameAccess;
    if (access === 'public') return { allowed: true, reason: 'public', session: stored };
  } catch {
    /* the server is down: only a session can be checked, and that needs the server too */
  }
  if (stored) {
    try {
      const me = await auth.me(stored.token);
      if (me.admin) return { allowed: true, reason: 'admin', session: { ...stored, admin: true } };
      if (access === 'holders' && (me.canPlay === true || me.holder === true)) return { allowed: true, reason: 'holder', session: stored };
    } catch {
      /* expired or unreachable */
    }
  }
  return { allowed: false, reason: access === 'holders' ? 'holders' : 'closed', session: null };
}

/** `/play`: checks access, then hands over to the game (`onAllowed`) or shows "The arena opens soon". */
export function PlayGate({
  onAllowed,
  onOpening,
  check = playAccess,
}: {
  onAllowed: (session: SiteSession | null) => void;
  /** The gate is opening: the arena can start downloading during the barrier's swing. */
  onOpening?: () => void;
  check?: () => Promise<PlayAccess>;
}) {
  const [state, setState] = useState<'checking' | 'closed' | 'holders' | 'open'>('checking');
  const [round, setRound] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    let live = true;
    let lift: ReturnType<typeof setTimeout> | undefined;
    void check().then((r) => {
      if (!live) return;
      if (r.allowed) {
        setState('open');
        onOpening?.();
        // the barrier swings up before the arena takes over (a beat, not a wait)
        if (reduced) onAllowed(r.session);
        else lift = setTimeout(() => onAllowed(r.session), 560);
      } else setState(r.reason === 'holders' ? 'holders' : 'closed');
    });
    return () => {
      live = false;
      if (lift) clearTimeout(lift);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);
  if (state === 'closed' || state === 'holders')
    return (
      <Suspense fallback={<GateWait state="checking" />}>
        {state === 'closed' ? <ArenaSoon /> : <ArenaSoon holders onSignedIn={() => setRound((n) => n + 1)} />}
      </Suspense>
    );
  return <GateWait state={state} />;
}

function GateWait({ state }: { state: 'checking' | 'open' }) {
  return (
    <Kb theme="night" className="pg-wait">
      <div className="pg-wait__gate">
        <GateScene mode={state === 'open' ? 'open' : 'checking'} />
      </div>
      <span className="mono pg-wait__label" role="status">
        {state === 'open' ? 'Opening the ring…' : 'Checking the gate…'}
      </span>
    </Kb>
  );
}
