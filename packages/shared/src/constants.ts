/** Bumped whenever the wire format changes in an incompatible way. */
export const PROTOCOL_VERSION = 1;

/** Simulation + snapshot rate. */
export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;

/**
 * Gameplay rules. The server simulation reads these; the client uses the
 * subset it needs for presentation (radius, view size, speeds for effects).
 */
export const RULES = {
  startMass: 20,
  /** A cell can eat another when its mass is at least this many times larger. */
  eatRatio: 1.25,
  /** Eater must cover the victim: dist < rEater - eatOverlap * rVictim. */
  eatOverlap: 0.4,

  splitMinMass: 35,
  maxCells: 16,
  /** Launch speed (units/s) of a freshly split cell; decays with splitDecayPerSec. */
  splitSpeed: 1250,
  /** Fraction of boost velocity kept after one second (exponential decay → ~390u flight). */
  splitDecayPerSec: 0.04,
  /** Own-cell collisions are ignored this long after a split so halves can fly out. */
  splitNoCollideMs: 380,
  mergeBaseMs: 12_000,
  mergeMsPerMass: 15,

  ejectMinMass: 35,
  ejectCost: 18,
  ejectMass: 14,
  ejectSpeed: 1000,
  ejectCooldownMs: 100,
  /** Ejected blobs cannot be re-eaten by their owner for this long. */
  ejectOwnerGraceMs: 600,

  virusMass: 100,
  /** A fed virus splits when it reaches this mass. */
  virusSplitMass: 198,
  virusPopRatio: 1.33,
  virusShootSpeed: 1100,
  virusMaxPieces: 15,
  /** Fraction of the popped cell's mass that explodes into pieces. */
  virusPopFraction: 0.5,

  decayStartMass: 150,
  /** Fraction of mass lost per second above decayStartMass. */
  decayPerSec: 0.0015,
  maxCellMass: 12_000,

  /** speed(r) = speedK * r^-speedExp (units / second). */
  speedK: 1900,
  speedExp: 0.44,

  /** Power-up tuning. */
  magnetMs: 10_000,
  magnetRangeFactor: 3.2,
  pumpMs: 6_000,
  pumpSpeedMul: 1.4,
  shieldMs: 8_000,
  bagMassFraction: 0.15,
  bagMassMin: 40,

  /** Stake mode: cash-out channel duration. */
  cashoutMs: 3_000,
  /** Stake mode: disconnected players stay in the arena this long. */
  afkGraceMs: 45_000,
} as const;

/** View (camera) tuning shared by server visibility and client camera. */
export const VIEW = {
  /** Visible world units along the shorter screen side at start size. */
  base: 1150,
  exp: 0.45,
  max: 5200,
  spectatorBase: 2600,
  /** Server sends a little more than the client shows. */
  serverMargin: 1.18,
  minAspect: 0.42,
  maxAspect: 2.5,
} as const;

/** World presets per room mode. */
export const WORLD_PRESETS = {
  free: { width: 5600, height: 5600, foodTarget: 1100, virusTarget: 22, maxPowerUps: 3 },
  private: { width: 4600, height: 4600, foodTarget: 800, virusTarget: 16, maxPowerUps: 2 },
  stake: { width: 4200, height: 4200, foodTarget: 700, virusTarget: 14, maxPowerUps: 2 },
} as const;

export type RoomMode = keyof typeof WORLD_PRESETS;

export const FOOD_VARIANTS = 8;
/** Food variants 0..5 are pastel coins (mass 1), 6 is a gem (mass 2), 7 is a golden coin. */
export const FOOD_GEM = 6;
export const FOOD_GOLD = 7;
export const FOOD_MASS = [1, 1, 1, 1, 1, 1, 2, 8] as const;

export const MAX_NAME_LENGTH = 16;
export const MAX_CHAT_LENGTH = 100;

/** Season prize split (basis points) for ranks 1..10 — mirrors the on-chain constant. */
export const PRIZE_SHARES_BPS = [3000, 2000, 1400, 1000, 800, 600, 450, 300, 250, 200] as const;
export const LEADERBOARD_SIZE = 20;

export const LAMPORTS_PER_SOL = 1_000_000_000;
