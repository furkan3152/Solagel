import { RULES, roundAt, type RoomInfo, type RoundInfo } from '@slana/shared';
import { useEffect, useState } from 'react';
import { useUi } from '../store';
import { serverClock } from './clock';

/**
 * Arena rounds on the client. Every arena plays the same wall-clock round (`roundAt` in
 * `@slana/shared`): the server sends the round in play (`RoundInfo`) with room listings and
 * `joined`; from it and the server clock offset (`serverClock`) anyone, players who were
 * eaten and lobby viewers included, can tell the round's phase and roll it forward past
 * `endsAt` without waiting for a new listing.
 */

export type RoundPhase = 'open' | 'closing';

export interface RoundState {
  n: number;
  endsAt: number;
  joinsCloseAt: number;
  /** Until the bell (ms, never negative). */
  msLeft: number;
  /** `open`: joins open; `closing`: the final minute, joins closed until the next round. */
  phase: RoundPhase;
}

/** The big countdown takes over the chip for the last 10 s. */
export const COUNTDOWN_MS = 10_000;

/**
 * Round and join-close lengths implied by a `RoundInfo` (the server may run shorter rounds for
 * tests and demos: `ROUND_SECONDS`). Round n ends at (n + 1) · roundMs.
 */
export function roundLengths(info: RoundInfo): { roundMs: number; closeMs: number } {
  const roundMs = info.endsAt / (info.n + 1);
  const closeMs = info.endsAt - info.joinsCloseAt;
  if (!Number.isInteger(roundMs) || roundMs <= 0 || closeMs < 0 || closeMs > roundMs) return { roundMs: RULES.roundMs, closeMs: RULES.roundJoinCloseMs };
  return { roundMs, closeMs };
}

/** The round in play at server time `now`, from the last known `RoundInfo` (rolled forward with `roundAt`). */
export function roundStateAt(info: RoundInfo, now: number): RoundState {
  let w: Pick<RoundState, 'n' | 'endsAt' | 'joinsCloseAt'> = info;
  if (now >= info.endsAt) {
    const { roundMs, closeMs } = roundLengths(info);
    w = roundAt(now, roundMs, closeMs);
  }
  return { n: w.n, endsAt: w.endsAt, joinsCloseAt: w.joinsCloseAt, msLeft: Math.max(0, w.endsAt - now), phase: now >= w.joinsCloseAt ? 'closing' : 'open' };
}

/**
 * The freshest `RoundInfo` for an arena: the room being played or watched, else its listing,
 * else any arena's (rounds are shared by every arena). `arenaId` null: any arena.
 */
export function roundInfoFor(rooms: readonly RoomInfo[], room: RoomInfo | null, arenaId: number | null): RoundInfo | null {
  if (room?.mode === 'arena' && room.round && (arenaId === null || room.arenaId === arenaId)) return room.round;
  const own = rooms.find((r) => r.mode === 'arena' && r.round && (arenaId === null || r.arenaId === arenaId));
  if (own?.round) return own.round;
  return rooms.find((r) => r.mode === 'arena' && r.round)?.round ?? null;
}

/** `m:ss` of a countdown, rounded up (0:01 until the very end). */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The current round state of an arena (server clock), or null while no round is known. */
export function currentRound(arenaId: number | null, now = serverClock.now()): RoundState | null {
  const s = useUi.getState();
  const info = roundInfoFor(s.rooms, s.room, arenaId);
  return info ? roundStateAt(info, now) : null;
}

/**
 * `{ n, msLeft, phase }` of an arena's round, re-rendering as the shown second changes.
 * `arenaId` null: any arena (they share one clock).
 */
export function useRound(arenaId: number | null, active = true): RoundState | null {
  const rooms = useUi((s) => s.rooms);
  const room = useUi((s) => s.room);
  const info = active ? roundInfoFor(rooms, room, arenaId) : null;
  const [now, setNow] = useState(() => serverClock.now());
  useEffect(() => {
    if (!info) return;
    // tick on the second boundary of the countdown (plus a hair), so m:ss flips on time
    let id: ReturnType<typeof setTimeout>;
    const step = () => {
      const t = serverClock.now();
      setNow(t);
      const left = roundStateAt(info, t).msLeft;
      id = setTimeout(step, (left % 1000) + 15);
    };
    step();
    return () => clearTimeout(id);
  }, [info?.n, info?.endsAt, info?.joinsCloseAt]);
  return info ? roundStateAt(info, now) : null;
}
