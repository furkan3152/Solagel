import { RULES } from './constants';

/** One arena round on the shared wall clock (all times are Unix milliseconds). */
export interface RoundWindow {
  /** Round number: floor(nowMs / roundMs). */
  n: number;
  startsAt: number;
  endsAt: number;
  /** New joins are refused from here until `endsAt` (= the next round's `startsAt`). */
  joinsCloseAt: number;
}

/**
 * The round running at `nowMs`. Rounds are aligned to Unix time, so every arena and every
 * server instance agrees on them: round n runs [n·roundMs, (n+1)·roundMs) and joins close
 * `closeMs` before it ends.
 */
export function roundAt(nowMs: number, roundMs: number = RULES.roundMs, closeMs: number = RULES.roundJoinCloseMs): RoundWindow {
  const n = Math.floor(nowMs / roundMs);
  const startsAt = n * roundMs;
  const endsAt = startsAt + roundMs;
  return { n, startsAt, endsAt, joinsCloseAt: endsAt - closeMs };
}
