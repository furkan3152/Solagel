/**
 * Integrity (cheat and collusion detection) types shared by the server and the admin panel.
 *
 * The server keeps lightweight telemetry of every arena ticket (who ate whom and how much value
 * moved, ejected mass that fed another player, shared IP or browser fingerprint hashes, input
 * timing statistics, round-bell patterns), runs pure detectors over it and shows the scored flags
 * to the admin. Nothing here changes on-chain behaviour: the only automatic action is the optional
 * auto-hold (`IntegritySettings.autoHold`, default off), which keeps a settlement in the journal
 * for an admin decision instead of paying it.
 */

export type IntegrityFlagKind =
  /** Value moved repeatedly from one wallet to the same other wallet, more than chance explains. */
  | 'pair_transfer'
  /** Most of one wallet's ejected mass was eaten by one other wallet. */
  | 'eject_feed'
  /** A much smaller player kept moving into the same bigger player and was eaten by them. */
  | 'suicide_feed'
  /** Several wallets played the same arena at the same time from one IP or one browser. */
  | 'shared_device'
  /** Input statistics outside the human range (periodic timing, no turn variety, instant reactions, 24/7 play). */
  | 'bot_input'
  /** Round-bell patterns: late join and idle until the bell, or value received while idle. */
  | 'bell_abuse';

export const INTEGRITY_FLAG_KINDS: readonly IntegrityFlagKind[] = ['pair_transfer', 'eject_feed', 'suicide_feed', 'shared_device', 'bot_input', 'bell_abuse'];

export type IntegrityFlagStatus = 'open' | 'reviewed' | 'dismissed';

/** Detector thresholds. Defaults (`INTEGRITY_DEFAULTS`) are conservative: they favour missed cheats over false accusations. */
export interface IntegrityThresholds {
  /** Flags scoring below this are not kept (0-100). */
  flagMinScore: number;
  /** Pair transfer: separate occasions (victim ticket, eater ticket) the same wallet took value from the same victim. */
  pairMinEvents: number;
  /** Pair transfer: distinct rounds those occasions span. */
  pairMinRounds: number;
  /** Pair transfer: the chance (Poisson tail) of that many occasions if eaters were random must be at most this. */
  pairMaxPValue: number;
  /** Pair transfer: net value moved, in entry fees of the arena. */
  pairMinNetFees: number;
  /** Eject feeding: ejected blobs of the feeder eaten by other players. */
  ejectMinEaten: number;
  /** Eject feeding: share of those eaten by one wallet. */
  ejectMinShare: number;
  /** Suicide feeding: deaths to the same bigger wallet while moving toward it. */
  suicideMinDeaths: number;
  /** Suicide feeding: share of the last seconds' samples spent moving toward the eater. */
  suicideMinApproach: number;
  /** Shared device: wallets must overlap at least this long in one arena (ms). */
  sharedMinOverlapMs: number;
  /** Shared device scores. A shared IP alone is common (households, cafes, mobile carriers): it scores below `flagMinScore` by default. */
  sharedIpScore: number;
  sharedFpScore: number;
  sharedBothScore: number;
  /** Bot input: inputs needed before the timing statistics count. */
  botMinInputs: number;
  /**
   * Bot input: inter-arrival coefficient of variation at or below this is "perfectly periodic". The web
   * client itself sends on a 33 ms frame budget, so only network-free regularity gets this low.
   */
  botMaxIntervalCv: number;
  /** Bot input: direction-change entropy (bits, 0-3.7) at or below this is "no turn variety". */
  botMaxTurnEntropy: number;
  /** Bot input: share of aims on whole-number coordinates at or above this is "exact aiming" (the web client's aims are fractional). */
  botMinIntegerShare: number;
  /** Bot input: median reaction to a new threat (ms, measured on the server, network included) below this is inhuman. */
  botMaxReactionMs: number;
  /** Bot input: reaction samples needed. */
  botMinReactionSamples: number;
  /** Bot input: distinct hours with play in the last 24 h at or above this (24/7 play). */
  botMaxActiveHours: number;
  /** Bell abuse: suspicious tickets needed. */
  bellMinSessions: number;
  /** Bell abuse: a join this close (ms) to the join close counts as late. */
  bellLateJoinMs: number;
  /** Bell abuse: share of the ticket's time spent idle (AFK). */
  bellMinAfkShare: number;
}

export interface IntegritySettings {
  /**
   * When on, a settlement whose wallet's risk score is at or above `holdScore` is held in the journal
   * for admin review (not paid, not lost). Default off.
   */
  autoHold: boolean;
  /** Risk score (0-100) at or above which `autoHold` holds a payout. */
  holdScore: number;
  thresholds: IntegrityThresholds;
}

export const INTEGRITY_THRESHOLDS_DEFAULT: IntegrityThresholds = {
  flagMinScore: 40,
  pairMinEvents: 4,
  pairMinRounds: 3,
  pairMaxPValue: 1e-4,
  pairMinNetFees: 2,
  ejectMinEaten: 40,
  ejectMinShare: 0.7,
  suicideMinDeaths: 2,
  suicideMinApproach: 0.6,
  sharedMinOverlapMs: 30_000,
  sharedIpScore: 30,
  sharedFpScore: 60,
  sharedBothScore: 80,
  botMinInputs: 900,
  botMaxIntervalCv: 0.01,
  botMaxTurnEntropy: 0.6,
  botMinIntegerShare: 0.95,
  botMaxReactionMs: 110,
  botMinReactionSamples: 20,
  botMaxActiveHours: 21,
  bellMinSessions: 3,
  bellLateJoinMs: 20_000,
  bellMinAfkShare: 0.8,
};

export const INTEGRITY_SETTINGS_DEFAULT: IntegritySettings = {
  autoHold: false,
  holdScore: 90,
  thresholds: INTEGRITY_THRESHOLDS_DEFAULT,
};

/** Allowed range of each threshold (the admin API clamps and rejects outside it). */
export const INTEGRITY_THRESHOLD_RANGES: Record<keyof IntegrityThresholds, readonly [number, number]> = {
  flagMinScore: [0, 100],
  pairMinEvents: [2, 1000],
  pairMinRounds: [1, 1000],
  pairMaxPValue: [1e-12, 0.05],
  pairMinNetFees: [0, 1000],
  ejectMinEaten: [5, 100_000],
  ejectMinShare: [0.3, 1],
  suicideMinDeaths: [1, 1000],
  suicideMinApproach: [0.3, 1],
  sharedMinOverlapMs: [0, 3_600_000],
  sharedIpScore: [0, 100],
  sharedFpScore: [0, 100],
  sharedBothScore: [0, 100],
  botMinInputs: [100, 1_000_000],
  botMaxIntervalCv: [0, 0.5],
  botMaxTurnEntropy: [0, 4],
  botMinIntegerShare: [0.5, 1],
  botMaxReactionMs: [0, 400],
  botMinReactionSamples: [5, 10_000],
  botMaxActiveHours: [12, 24],
  bellMinSessions: [1, 1000],
  bellLateJoinMs: [1000, 300_000],
  bellMinAfkShare: [0.3, 1],
};

/** Evidence values are plain, printable data. */
export type IntegrityEvidence = Record<string, number | string | boolean | null | string[] | number[]>;

export interface IntegrityFlag {
  /** Stable id: the same kind and subject keep the same id as new evidence arrives. */
  id: string;
  kind: IntegrityFlagKind;
  status: IntegrityFlagStatus;
  /** 0-100. */
  score: number;
  /** Wallets involved, sorted with the beneficiary first when there is one. */
  wallets: string[];
  /** The wallet the value went to (pairs, feeding); null for device and input flags. */
  beneficiary: string | null;
  arenaId: number | null;
  /** One English sentence for the list. */
  summary: string;
  evidence: IntegrityEvidence;
  firstSeen: number;
  lastSeen: number;
  /** Admin who last changed the status, when, and their note. */
  statusBy: string | null;
  statusAt: number | null;
  note: string;
  /** Score when the flag was last reviewed or dismissed (a big rise re-opens it). */
  scoreAtStatus: number | null;
}

/** One eaten cell that moved value from one staker to another. */
export interface IntegrityTransfer {
  at: number;
  arenaId: number;
  roomId: string;
  round: number;
  /** Victim wallet. */
  from: string;
  /** Eater wallet. */
  to: string;
  amount: number;
  /** Entry fee of the arena (normalizes amounts across arenas). */
  fee: number;
  /** Victim and eater ticket keys (`<arenaId>:<player lowercase>:<sessionId>`). */
  fromKey: string;
  toKey: string;
  /** Other stakers in the instance at that moment (without the victim). */
  others: number;
  /** The eater was idle (AFK) at that moment. */
  afkEater: boolean;
}

/** A settlement held for review (`SettlementItem.held` in the journal). */
export interface IntegrityHeld {
  key: string;
  player: string;
  arenaId: number | null;
  payout: number;
  reason: string | null;
  createdAt: number;
  heldAt: number;
  score: number;
  why: string;
  flags: string[];
}

export interface IntegrityBan {
  wallet: string;
  at: number;
  by: string;
  reason: string;
}

/** What the admin Integrity tab loads. */
export interface IntegrityOverview {
  settings: IntegritySettings;
  defaults: IntegritySettings;
  counts: { open: number; reviewed: number; dismissed: number; held: number; bans: number; sessions: number; transfers: number };
  held: IntegrityHeld[];
  bans: IntegrityBan[];
  /** When the detectors last ran (Unix ms). */
  scannedAt: number | null;
}

export interface IntegrityWalletView {
  wallet: string;
  ban: IntegrityBan | null;
  risk: number;
  flags: IntegrityFlag[];
  sessions: {
    key: string;
    arenaId: number;
    roomId: string;
    round: number;
    joinedAt: number;
    endedAt: number | null;
    entryFee: number;
    payout: number | null;
    endReason: string | null;
    afkMs: number;
  }[];
  transfers: IntegrityTransfer[];
}

/**
 * The browser fingerprint the web sends with `join` (`fp`): a hex SHA-256 prefix. It is untrusted:
 * the server re-hashes it with its own secret, uses it only as evidence and never as an identity.
 */
export const isFingerprint = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{16,64}$/.test(v);
