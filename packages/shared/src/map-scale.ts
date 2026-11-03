import { WORLD_PRESETS } from './constants';
import { clamp } from './formulas';

/**
 * Adaptive map size: a room's square world is sized for the players it expects (humans plus the
 * bots that fill it), so the area per player, and with it how often coins meet, stays about the
 * same in a quiet pond and in a packed arena.
 *
 *   side(n) = clamp(perPlayer * sqrt(n), min, max), rounded up to `MAP_SIDE_STEP`
 *
 * Every player gets about `perPlayer^2` units of floor (default 900 x 900). Food, rug cacti and
 * power-ups follow the area at a practice pond's density (`worldForSide`).
 *
 * Defaults (perPlayer 900, min 3000, max 9000): 5 players 3000, 10 players 3000, 25 players 4500,
 * 50 players 6400, 100 players 9000 (the custom room sizes XS..XL span the same range).
 */
export interface MapScaleSettings {
  /** The world follows the player count (off: the room keeps its mode's fixed preset). */
  auto: boolean;
  /** Side (world units) of the square of floor each expected player gets. */
  perPlayer: number;
  /** Smallest side (world units). */
  min: number;
  /** Largest side (world units, at most `MAP_SPACE`). */
  max: number;
}

/**
 * Coordinate space (square, world units) of a resizable world: the playable square sits centred
 * inside it and grows outward on every side. The spatial grids are sized for the whole space once,
 * so a resize never rebuckets anything. Also the hard upper bound of `MapScaleSettings.max`.
 */
export const MAP_SPACE = 12_000;

/** Sides are rounded up to a multiple of this (fewer, larger steps). */
export const MAP_SIDE_STEP = 100;

/** Bounds of the admin values. */
export const MAP_SCALE_LIMITS = { perPlayerMin: 300, perPlayerMax: 2000, sideMin: 2000, sideMax: MAP_SPACE } as const;

export const MAP_SCALE_DEFAULT: MapScaleSettings = { auto: true, perPlayer: 900, min: 3000, max: 9000 };

/**
 * Pacing of growth during play: the room re-checks its expected count every `checkMs`, and grows by
 * at most `maxStep` (whole side) at most every `stepMs`, so a burst of joins opens the floor in a few
 * gentle steps rather than one jump. Clients ease the border over `animMs`.
 */
export const MAP_GROW = { checkMs: 1000, stepMs: 4000, maxStep: 600, animMs: 1500 } as const;

/** Upper bounds of an auto-sized world's food and cacti, whatever the size (the server is small). */
export const MAP_WORLD_CAPS = { food: 4000, viruses: 40, powerUps: 6 } as const;

/** The world side for `players` expected players. */
export function mapSideFor(players: number, s: Pick<MapScaleSettings, 'perPlayer' | 'min' | 'max'>): number {
  const n = Math.max(1, Number.isFinite(players) ? players : 1);
  const hi = Math.min(MAP_SPACE, Math.max(s.min, s.max));
  const raw = s.perPlayer * Math.sqrt(n);
  const stepped = Math.ceil(raw / MAP_SIDE_STEP) * MAP_SIDE_STEP;
  return clamp(stepped, Math.min(s.min, hi), hi);
}

/** A practice pond's food and cacti per square unit (the density every auto-sized world keeps). */
const REF = WORLD_PRESETS.practice;
export const FOOD_PER_AREA = REF.foodTarget / (REF.width * REF.height);
export const VIRUS_PER_AREA = REF.virusTarget / (REF.width * REF.height);
/** One power-up slot per this much area (a pond 3, an arena 4). */
const AREA_PER_POWERUP = 16_000_000;

/** A world's size and population targets (`WORLD_PRESETS` shape). */
export interface WorldShape {
  width: number;
  height: number;
  foodTarget: number;
  virusTarget: number;
  maxPowerUps: number;
}

/**
 * The population of a square world of `side`: food and cacti at a practice pond's density (times
 * `foodMul` / `virusMul`), capped by `MAP_WORLD_CAPS`; power-ups one per 16 M square units (1..6).
 * A `virusMul` of 0 grows no cacti; otherwise at least 2.
 */
export function worldForSide(side: number, o: { foodMul?: number; virusMul?: number; caps?: { food: number; viruses: number } } = {}): WorldShape {
  const area = side * side;
  const caps = o.caps ?? MAP_WORLD_CAPS;
  const vm = o.virusMul ?? 1;
  return {
    width: side,
    height: side,
    foodTarget: Math.min(caps.food, Math.round(area * FOOD_PER_AREA * (o.foodMul ?? 1))),
    virusTarget: vm <= 0 ? 0 : Math.min(caps.viruses, Math.max(2, Math.round(area * VIRUS_PER_AREA * vm))),
    maxPowerUps: clamp(Math.round(area / AREA_PER_POWERUP), 1, MAP_WORLD_CAPS.powerUps),
  };
}

/** Checks one field of an admin patch; returns an error message or null. */
export function mapScaleFieldError(field: keyof MapScaleSettings, v: unknown): string | null {
  if (field === 'auto') return typeof v === 'boolean' ? null : 'must be true or false';
  const [lo, hi] = field === 'perPlayer' ? [MAP_SCALE_LIMITS.perPlayerMin, MAP_SCALE_LIMITS.perPlayerMax] : [MAP_SCALE_LIMITS.sideMin, MAP_SCALE_LIMITS.sideMax];
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? null : `must be a whole number from ${lo} to ${hi}`;
}
