import { LAMPORTS_PER_SOL, RULES, VIEW } from './constants';

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const massToRadius = (mass: number): number => Math.sqrt(Math.max(0, mass)) * 10;

export const radiusToMass = (radius: number): number => (radius * radius) / 100;

export const START_RADIUS = massToRadius(RULES.startMass);

/** Movement speed in world units per second for a cell of radius r. */
export const speedForRadius = (r: number): number =>
  RULES.speedK * Math.pow(Math.max(r, 1), -RULES.speedExp);

/** Milliseconds a freshly split cell must wait before it can merge back. */
export const mergeDelayMs = (mass: number): number => RULES.mergeBaseMs + RULES.mergeMsPerMass * mass;

/** Per-tick multiplier for boost velocity given the tick length in ms. */
export const boostDecayFactor = (dtMs: number): number => Math.pow(RULES.splitDecayPerSec, dtMs / 1000);

export const canEat = (eaterMass: number, victimMass: number): boolean =>
  eaterMass >= victimMass * RULES.eatRatio;

/** Whether an eater at distance `dist` covers enough of the victim to swallow it. */
export const coversVictim = (eaterR: number, victimR: number, dist: number): boolean =>
  dist < eaterR - RULES.eatOverlap * victimR;

/**
 * Visible world size for a player with `totalMass` on a screen with the given
 * aspect ratio (width / height). The shorter side always shows `base` units at
 * start size and grows with the player.
 */
export function viewSize(totalMass: number, aspect: number, spectator = false): { w: number; h: number } {
  const a = clamp(Number.isFinite(aspect) ? aspect : 16 / 9, VIEW.minAspect, VIEW.maxAspect);
  let short: number;
  if (spectator) {
    short = VIEW.spectatorBase;
  } else {
    const r = massToRadius(Math.max(totalMass, RULES.startMass));
    short = Math.min(VIEW.max, VIEW.base * Math.pow(r / START_RADIUS, VIEW.exp));
  }
  return a >= 1 ? { w: short * a, h: short } : { w: short, h: short / a };
}

/** Level from on-chain XP (mirrors the program: 1 + floor(sqrt(xp / 50))). */
export function levelFromXp(xp: number): number {
  const units = Math.floor(Math.max(0, xp) / 50);
  let s = Math.floor(Math.sqrt(units));
  // guard against floating point drift
  while ((s + 1) * (s + 1) <= units) s++;
  while (s * s > units) s--;
  return 1 + s;
}

/** Minimum XP needed to reach `level`. */
export const xpForLevel = (level: number): number => 50 * Math.max(0, level - 1) ** 2;

/** XP a finished game is worth (server computes; program clamps to 2000). */
export function xpForGame(score: number, kills: number, aliveMs: number): number {
  const xp = Math.floor(score / 10) + kills * 8 + Math.floor(aliveMs / 30_000);
  return clamp(xp, 1, 2000);
}

export const lamportsToSol = (lamports: number | bigint): number => Number(lamports) / LAMPORTS_PER_SOL;

/** Compact SOL formatting for HUD/leaderboards: ◎0.153, ◎1.2, ◎12. */
export function formatSol(lamports: number | bigint, maxDecimals = 3): string {
  const sol = lamportsToSol(lamports);
  const decimals = sol >= 100 ? 0 : sol >= 10 ? 1 : sol >= 1 ? 2 : maxDecimals;
  let s = sol.toFixed(decimals);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return `◎${s}`;
}

/** Score shown to players: rounded total mass. */
export const displayMass = (mass: number): number => Math.floor(mass);

/**
 * Size tier 0..3 of a loot piece (the Loot entity `variant`), from its value
 * relative to the arena's entry fee (both in raw token units).
 *
 * A "nominal" piece is `entryFee × lootPieceEntryFraction`, which is what a
 * victim holding exactly one ticket spills. Tier 0 is a crumb (under half of
 * that), 1 a normal piece, 2 a big one (from 1.5×) and 3 a jackpot (from 4×,
 * i.e. a piece worth a whole entry fee).
 */
export function lootTier(value: number, entryFee: number): 0 | 1 | 2 | 3 {
  if (!(value > 0) || !(entryFee > 0)) return 0;
  const ratio = value / (entryFee * RULES.lootPieceEntryFraction);
  return ratio >= 4 ? 3 : ratio >= 1.5 ? 2 : ratio >= 0.5 ? 1 : 0;
}
