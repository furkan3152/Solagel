import type { IntegrityTransfer } from '@elymum/shared';

/** Turn magnitude bin edges (degrees) of the direction-change histogram; bin 0 is an exact repeat (no change at all). */
export const TURN_EDGES_DEG = [0.02, 0.1, 0.3, 1, 2, 4, 8, 16, 32, 64, 128, 180] as const;
/** Bins: one "no change" bin plus one per edge. */
export const TURN_BINS = TURN_EDGES_DEG.length + 1;
/** Reaction samples kept per ticket. */
export const MAX_REACTION_SAMPLES = 48;

/**
 * Input statistics of one arena ticket (target, split and eject messages as they reach the server).
 * Only target messages whose aim moved count: the web client repeats an unchanged aim every 250 ms
 * while the mouse rests, and those keep-alives say nothing about who moves the mouse.
 */
export interface InputSummary {
  /** Target messages whose aim moved. */
  aims: number;
  /** Of those, aims on whole-number coordinates (the web client's aims are fractional world coordinates). */
  intAims: number;
  /** Inter-arrival samples between moved aims (gaps over 2 s are not counted). */
  n: number;
  /** Mean inter-arrival (ms). */
  meanMs: number;
  /** Sum of squared deviations (Welford), for pooling across tickets. */
  m2: number;
  /** Direction-change histogram (`TURN_EDGES_DEG`). */
  turnHist: number[];
  /** Reaction latency samples (ms): a threat came close while moving toward it → first input turning away. */
  reactionMs: number[];
  splits: number;
  ejects: number;
}

/** Summary of one arena ticket, kept in memory and persisted under `DATA_DIR/integrity/log/`. */
export interface SessionSummary {
  /** `<session key>#<session id>` (the session key already holds the id; the suffix keeps old records unique). */
  key: string;
  wallet: string;
  arenaId: number;
  roomId: string;
  entryFee: number;
  /** Round number and its window (Unix ms, server round clock). */
  round: number;
  roundStartsAt: number;
  joinsCloseAt: number;
  roundEndsAt: number;
  joinedAt: number;
  /** Null while the ticket is still in play. */
  endedAt: number | null;
  endReason: string | null;
  payout: number | null;
  /** Keyed hashes (HMAC with the server's integrity secret); never the raw IP or fingerprint. */
  ipHash: string;
  fpHash: string | null;
  /** Time spent idle (AFK, disconnected) during the ticket. */
  afkMs: number;
  afkAtEnd: boolean;
  /** Value taken from other stakers while idle. */
  receivedWhileAfk: number;
  input: InputSummary;
  /** Ejected blobs of this ticket eaten by other stakers (by wallet, at most 8) and by anyone else (bots, overflow). */
  ejects: { eatenBy: Record<string, number>; eatenOther: number };
  /** How the ticket ended in a death: the staker that ate it (null for a bot or a virus) and the approach share before it. */
  death: { by: string | null; byBot: boolean; approach: number; samples: number } | null;
}

/** What the detectors read: ended and live tickets plus value transfers. */
export interface IntegritySnapshot {
  now: number;
  sessions: SessionSummary[];
  transfers: IntegrityTransfer[];
}

export const emptyInput = (): InputSummary => ({ aims: 0, intAims: 0, n: 0, meanMs: 0, m2: 0, turnHist: new Array<number>(TURN_BINS).fill(0), reactionMs: [], splits: 0, ejects: 0 });

/** Bin of a turn of `deg` degrees (absolute). */
export function turnBin(deg: number): number {
  if (!(deg > 0)) return 0;
  for (let i = 0; i < TURN_EDGES_DEG.length; i++) if (deg <= TURN_EDGES_DEG[i]) return i + 1;
  return TURN_BINS - 1;
}
