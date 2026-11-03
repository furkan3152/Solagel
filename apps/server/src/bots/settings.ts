import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAP_SCALE_DEFAULT, OLD_MAP_SCALE_DEFAULT, RULES, mapScaleFieldError, type MapScaleSettings, type RoomMode, type League } from '@elymum/shared';
import type { BotManagerOptions } from './manager';
import { BOT_MIX_PRESETS, OLD_BOT_MIX_PRESETS, mixWeights, type BotMixWeights } from './personality';

/** The room kinds bots are configured for. */
export const BOT_ROOM_KINDS = ['practiceRookie', 'practicePro', 'arena', 'private'] as const;
export type BotRoomKind = (typeof BOT_ROOM_KINDS)[number];

/** Bot settings of one room kind (`/api/admin/bots`). */
export interface BotKindSettings {
  /** Bots on in this kind of room. */
  enabled: boolean;
  /** Most bots one room holds (default 12). */
  cap: number;
  /** Bots kept even when the room is busy (≤ cap). */
  min: number;
  /** Wanted population, humans + bots: bots fill `target − humans` (within min..cap). */
  target: number;
  /** Difficulty mix, as weights (percent by convention). */
  mix: BotMixWeights;
  /**
   * Most mass one bot keeps in this kind of room (0: no cap). Bots never spawn above it and shed
   * what they eat past it within a second or two. Defaults: `DEFAULT_BOT_MASS_CAPS`.
   */
  massCap: number;
  /**
   * Bot strength in percent (25..200; 100 = the difficulty levels as tuned): scales hunting drive,
   * split attacks and chase length up, reaction delay, aim error and lapses down. Defaults:
   * `DEFAULT_BOT_STRENGTH`.
   */
  strength: number;
  /** Most bots chasing one person at once (0: no limit). Defaults: `DEFAULT_MAX_CHASERS`. */
  maxChasers: number;
}

/** Testnet staked bots of one arena (overrides `BotTestnetSettings` defaults). */
export interface BotArenaSettings {
  /** Staked bots this arena fields. */
  stakedBots?: number;
  /** tELYMUM each bot wallet is funded with, whole tokens as a decimal string. */
  bankroll?: string;
}

/**
 * Testnet staked bots (stored for the staked-bot source, see `StakedBotSource`). They only ever
 * play on Elysium Testnet; on any other chain arenas field zero-value bots.
 */
export interface BotTestnetSettings {
  /** Staked bots fielded per arena unless the arena says otherwise (default 6). */
  stakedPerArena: number;
  /** tELYMUM each bot wallet is funded with, whole tokens as a decimal string (default "1000000"). */
  bankroll: string;
  /** HYPE each bot wallet keeps for gas, decimal string (default "0.05"). */
  gasHype: string;
  /** Per arena id (as a string key): overrides. */
  arenas: Record<string, BotArenaSettings>;
}

export interface BotSettings {
  kinds: Record<BotRoomKind, BotKindSettings>;
  testnet: BotTestnetSettings;
  /**
   * Adaptive map size per room kind (`map-scale.ts`): on/off and the curve. Stored with the bot
   * settings because the expected player count it sizes for is humans plus these bots. Custom rooms
   * whose creator picked "Auto" follow the `private` curve (always on); a chosen size is kept.
   */
  maps: Record<BotRoomKind, MapScaleSettings>;
}

/** Bounds of the admin values. */
export const BOT_LIMITS = { cap: 64, target: 200, stakedPerArena: 32, arenaIds: 64, massCap: 200_000, strengthMin: 25, strengthMax: 200, maxChasers: 12 } as const;

/** Default bot strength (percent) per room kind: the rookie league a little softer. */
export const DEFAULT_BOT_STRENGTH: Record<BotRoomKind, number> = { practiceRookie: 85, practicePro: 100, arena: 100, private: 100 };

/** Default most bots chasing one person at once: one in rookie and private rooms, two in pro ponds and arenas. */
export const DEFAULT_MAX_CHASERS: Record<BotRoomKind, number> = { practiceRookie: 1, practicePro: 2, arena: 2, private: 1 };

export const BOT_TESTNET_DEFAULT: BotTestnetSettings = { stakedPerArena: 6, bankroll: '1000000', gasHype: '0.05', arenas: {} };

/** The bot kind of a room. */
export function botKindOf(mode: RoomMode, league?: League): BotRoomKind {
  if (mode === 'arena') return 'arena';
  if (mode === 'private') return 'private';
  return league === 'pro' ? 'practicePro' : 'practiceRookie';
}

/**
 * Rookie league (newcomers): no bot keeps more mass than this (about 4x the start radius), so a
 * fresh player never meets a whale there.
 */
export const ROOKIE_BOT_MASS_CAP = 300;

/** Pro ponds and arenas: bots stop growing here, so no bot turns into an absurd whale. */
export const BOT_MASS_CAP = 2500;

/** Default bot mass cap per room kind (0: none; private rooms are the host's own business). */
export const DEFAULT_BOT_MASS_CAPS: Record<BotRoomKind, number> = {
  practiceRookie: ROOKIE_BOT_MASS_CAP,
  practicePro: BOT_MASS_CAP,
  arena: BOT_MASS_CAP,
  private: 0,
};

/** Room-manager options of a kind's settings (a `massCap` of 0 means no cap). */
export function managerOptions(k: BotKindSettings): BotManagerOptions {
  return {
    enabled: k.enabled,
    target: k.target,
    min: Math.min(k.min, k.cap),
    max: k.cap,
    mix: { ...k.mix },
    ...(k.massCap > 0 ? { massCap: k.massCap } : {}),
    strength: k.strength,
    ...(k.maxChasers > 0 ? { maxChasers: k.maxChasers } : {}),
  };
}

/** Settings of a kind from the env defaults (`ServerConfig.bots`); the mass cap defaults per `kind`. */
export function kindFromOptions(o: BotManagerOptions, kind?: BotRoomKind): BotKindSettings {
  const cap = Math.max(0, Math.min(BOT_LIMITS.cap, Math.floor(o.max)));
  const massCap = o.massCap ?? (kind ? DEFAULT_BOT_MASS_CAPS[kind] : 0);
  const strength = o.strength ?? (kind ? DEFAULT_BOT_STRENGTH[kind] : 100);
  const maxChasers = o.maxChasers ?? (kind ? DEFAULT_MAX_CHASERS[kind] : 0);
  return {
    enabled: o.enabled !== false,
    cap,
    min: Math.max(0, Math.min(cap, Math.floor(o.min))),
    target: Math.max(0, Math.min(BOT_LIMITS.target, Math.floor(o.target))),
    mix: { ...mixWeights(o.mix) },
    massCap: Math.max(0, Math.min(BOT_LIMITS.massCap, Math.floor(massCap))),
    strength: Math.max(BOT_LIMITS.strengthMin, Math.min(BOT_LIMITS.strengthMax, Math.round(strength))),
    maxChasers: Math.max(0, Math.min(BOT_LIMITS.maxChasers, Math.floor(maxChasers))),
  };
}

export function defaultBotSettings(defaults: Record<BotRoomKind, BotManagerOptions>): BotSettings {
  const kinds = {} as Record<BotRoomKind, BotKindSettings>;
  for (const k of BOT_ROOM_KINDS) kinds[k] = kindFromOptions(defaults[k], k);
  return { kinds, testnet: { ...BOT_TESTNET_DEFAULT, arenas: {} }, maps: defaultMapSettings() };
}

/** Every kind starts on the default curve (auto on). */
export function defaultMapSettings(): Record<BotRoomKind, MapScaleSettings> {
  const maps = {} as Record<BotRoomKind, MapScaleSettings>;
  for (const k of BOT_ROOM_KINDS) maps[k] = { ...MAP_SCALE_DEFAULT };
  return maps;
}

/** A bad admin value: `field` names it (`kinds.arena.cap`, `testnet.bankroll`, …). */
export class BotSettingsError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
  }
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

function int(x: unknown, field: string, min: number, max: number): number {
  if (typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max) throw new BotSettingsError(`${field} must be a whole number from ${min} to ${max}`, field);
  return x;
}

function amount(x: unknown, field: string): string {
  if (typeof x !== 'string' || !/^\d{1,30}(\.\d{1,18})?$/.test(x)) throw new BotSettingsError(`${field} must be a decimal amount like "1000000" or "0.05"`, field);
  return x;
}

let strictKeys = true;

function onlyKeys(x: Record<string, unknown>, keys: readonly string[], at: string): void {
  if (!strictKeys) return;
  for (const k of Object.keys(x)) if (!keys.includes(k)) throw new BotSettingsError(`unknown field ${at}${k}`, `${at}${k}`);
}

/**
 * Applies a partial update (`PUT /api/admin/bots`) to `cur` and returns the new settings.
 * Every given field is checked; unknown fields are refused; anything left out keeps its value.
 * `min` is clamped to `cap` after the merge. `strict: false` (loading the file) ignores unknown
 * fields instead, so a file written by a newer server still loads.
 */
export function applyBotSettings(cur: BotSettings, body: Record<string, unknown>, opts: { strict?: boolean } = {}): BotSettings {
  strictKeys = opts.strict !== false;
  try {
    return applyInner(cur, body);
  } finally {
    strictKeys = true;
  }
}

function applyInner(cur: BotSettings, body: Record<string, unknown>): BotSettings {
  onlyKeys(body, ['kinds', 'testnet', 'maps'], '');
  const next: BotSettings = structuredClone(cur);
  // settings written before the map curve existed
  next.maps ??= defaultMapSettings();
  for (const k of BOT_ROOM_KINDS) next.maps[k] ??= { ...MAP_SCALE_DEFAULT };
  if (body.maps !== undefined) {
    if (!isObj(body.maps)) throw new BotSettingsError('maps must be an object', 'maps');
    onlyKeys(body.maps, BOT_ROOM_KINDS, 'maps.');
    for (const kind of BOT_ROOM_KINDS) {
      const patch = (body.maps as Record<string, unknown>)[kind];
      if (patch === undefined) continue;
      const at = `maps.${kind}`;
      if (!isObj(patch)) throw new BotSettingsError(`${at} must be an object`, at);
      onlyKeys(patch, ['auto', 'perPlayer', 'min', 'max'], `${at}.`);
      const m = next.maps[kind];
      for (const f of ['auto', 'perPlayer', 'min', 'max'] as const) {
        if (patch[f] === undefined) continue;
        const err = mapScaleFieldError(f, patch[f]);
        if (err) throw new BotSettingsError(`${at}.${f} ${err}`, `${at}.${f}`);
        (m as unknown as Record<string, unknown>)[f] = patch[f];
      }
      // like a bot minimum above the cap: the smallest map never exceeds the largest
      if (m.min > m.max) m.min = m.max;
    }
  }
  if (body.kinds !== undefined) {
    if (!isObj(body.kinds)) throw new BotSettingsError('kinds must be an object', 'kinds');
    onlyKeys(body.kinds, BOT_ROOM_KINDS, 'kinds.');
    for (const kind of BOT_ROOM_KINDS) {
      const patch = (body.kinds as Record<string, unknown>)[kind];
      if (patch === undefined) continue;
      const at = `kinds.${kind}`;
      if (!isObj(patch)) throw new BotSettingsError(`${at} must be an object`, at);
      onlyKeys(patch, ['enabled', 'cap', 'min', 'target', 'mix', 'massCap', 'strength', 'maxChasers'], `${at}.`);
      const k = next.kinds[kind];
      if (patch.enabled !== undefined) {
        if (typeof patch.enabled !== 'boolean') throw new BotSettingsError(`${at}.enabled must be true or false`, `${at}.enabled`);
        k.enabled = patch.enabled;
      }
      if (patch.cap !== undefined) k.cap = int(patch.cap, `${at}.cap`, 0, BOT_LIMITS.cap);
      if (patch.target !== undefined) k.target = int(patch.target, `${at}.target`, 0, BOT_LIMITS.target);
      if (patch.min !== undefined) k.min = int(patch.min, `${at}.min`, 0, BOT_LIMITS.cap);
      if (patch.massCap !== undefined) {
        const m = int(patch.massCap, `${at}.massCap`, 0, BOT_LIMITS.massCap);
        if (m > 0 && m < RULES.startMass * 2) throw new BotSettingsError(`${at}.massCap must be 0 (no cap) or at least ${RULES.startMass * 2}`, `${at}.massCap`);
        k.massCap = m;
      }
      if (patch.strength !== undefined) k.strength = int(patch.strength, `${at}.strength`, BOT_LIMITS.strengthMin, BOT_LIMITS.strengthMax);
      if (patch.maxChasers !== undefined) k.maxChasers = int(patch.maxChasers, `${at}.maxChasers`, 0, BOT_LIMITS.maxChasers);
      if (patch.mix !== undefined) {
        if (!isObj(patch.mix)) throw new BotSettingsError(`${at}.mix must be an object`, `${at}.mix`);
        onlyKeys(patch.mix, ['easy', 'medium', 'hard'], `${at}.mix.`);
        const m = { ...k.mix };
        for (const level of ['easy', 'medium', 'hard'] as const) if (patch.mix[level] !== undefined) m[level] = int(patch.mix[level], `${at}.mix.${level}`, 0, 100);
        if (m.easy + m.medium + m.hard <= 0) throw new BotSettingsError(`${at}.mix needs at least one level above 0`, `${at}.mix`);
        k.mix = m;
      }
      if (k.min > k.cap) k.min = k.cap;
    }
  }
  if (body.testnet !== undefined) {
    const t = body.testnet;
    if (!isObj(t)) throw new BotSettingsError('testnet must be an object', 'testnet');
    onlyKeys(t, ['stakedPerArena', 'bankroll', 'gasHype', 'arenas'], 'testnet.');
    if (t.stakedPerArena !== undefined) next.testnet.stakedPerArena = int(t.stakedPerArena, 'testnet.stakedPerArena', 0, BOT_LIMITS.stakedPerArena);
    if (t.bankroll !== undefined) next.testnet.bankroll = amount(t.bankroll, 'testnet.bankroll');
    if (t.gasHype !== undefined) next.testnet.gasHype = amount(t.gasHype, 'testnet.gasHype');
    if (t.arenas !== undefined) {
      if (!isObj(t.arenas)) throw new BotSettingsError('testnet.arenas must be an object keyed by arena id', 'testnet.arenas');
      for (const [id, a] of Object.entries(t.arenas)) {
        const at = `testnet.arenas.${id}`;
        if (!/^\d{1,5}$/.test(id) || Number(id) > 65535) throw new BotSettingsError(`${at}: arena ids are numbers`, at);
        if (a === null) {
          delete next.testnet.arenas[id];
          continue;
        }
        if (!isObj(a)) throw new BotSettingsError(`${at} must be an object (or null to remove it)`, at);
        onlyKeys(a, ['stakedBots', 'bankroll'], `${at}.`);
        const cur = { ...(next.testnet.arenas[id] ?? {}) };
        if (a.stakedBots !== undefined) cur.stakedBots = int(a.stakedBots, `${at}.stakedBots`, 0, BOT_LIMITS.stakedPerArena);
        if (a.bankroll !== undefined) cur.bankroll = amount(a.bankroll, `${at}.bankroll`);
        next.testnet.arenas[String(Number(id))] = cur;
      }
      if (Object.keys(next.testnet.arenas).length > BOT_LIMITS.arenaIds) throw new BotSettingsError(`at most ${BOT_LIMITS.arenaIds} arenas`, 'testnet.arenas');
    }
  }
  return next;
}

const sameMix = (a: unknown, b: BotMixWeights): boolean => isObj(a) && a.easy === b.easy && a.medium === b.medium && a.hard === b.hard && Object.keys(a).length === 3;

/**
 * Upgrades a saved file in place: values still equal to an old default take the new default (the
 * admin page saves every field, so an untouched old default looks like a choice). A difficulty mix
 * equal to an old preset becomes the new preset (2026-11 softer bots); a map curve equal to the old
 * default (perPlayer 900, min 3000, max 9000) becomes the new one (1000, 10000, 12000), `auto`
 * kept. Returns what changed (for the log).
 */
export function upgradeSavedBotSettings(raw: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (isObj(raw.kinds)) {
    for (const [kind, k] of Object.entries(raw.kinds)) {
      if (!isObj(k)) continue;
      for (const preset of ['rookie', 'standard'] as const) {
        if (sameMix(k.mix, OLD_BOT_MIX_PRESETS[preset])) {
          k.mix = { ...BOT_MIX_PRESETS[preset] };
          out.push(`kinds.${kind}.mix -> ${preset} preset`);
          break;
        }
      }
    }
  }
  if (isObj(raw.maps)) {
    for (const [kind, m] of Object.entries(raw.maps)) {
      if (!isObj(m)) continue;
      if (m.perPlayer === OLD_MAP_SCALE_DEFAULT.perPlayer && m.min === OLD_MAP_SCALE_DEFAULT.min && m.max === OLD_MAP_SCALE_DEFAULT.max) {
        m.perPlayer = MAP_SCALE_DEFAULT.perPlayer;
        m.min = MAP_SCALE_DEFAULT.min;
        m.max = MAP_SCALE_DEFAULT.max;
        out.push(`maps.${kind} -> ${MAP_SCALE_DEFAULT.perPlayer}/${MAP_SCALE_DEFAULT.min}/${MAP_SCALE_DEFAULT.max}`);
      }
    }
  }
  return out;
}

/** Where the settings live under `DATA_DIR`. */
export const BOT_SETTINGS_FILE = join('site', 'bots.json');

/**
 * The admin's bot settings, persisted in `DATA_DIR/site/bots.json` (atomic write) and applied live:
 * every `update` notifies the listeners (the room manager re-applies them to every room).
 * Missing kinds or fields in the file fall back to the env defaults.
 */
export class BotSettingsStore {
  private cur: BotSettings;
  private readonly listeners: ((s: BotSettings) => void)[] = [];

  constructor(
    private readonly dataDir: string | null,
    readonly defaults: BotSettings,
    private readonly log: (m: string) => void = () => {},
  ) {
    this.cur = structuredClone(defaults);
    this.load();
  }

  private path(): string | null {
    return this.dataDir ? join(this.dataDir, BOT_SETTINGS_FILE) : null;
  }

  private load(): void {
    const p = this.path();
    if (!p || !existsSync(p)) return;
    try {
      const raw: unknown = JSON.parse(readFileSync(p, 'utf8'));
      if (!isObj(raw)) throw new Error('not an object');
      const upgraded = upgradeSavedBotSettings(raw);
      if (upgraded.length) this.log(`bots: old defaults in ${BOT_SETTINGS_FILE} upgraded: ${upgraded.join(', ')}`);
      // the file is applied over the defaults like an admin update, so a bad field cannot sneak in
      this.cur = applyBotSettings(this.defaults, raw, { strict: false });
    } catch (err) {
      const backup = `${p}.corrupt-${Date.now()}`;
      renameSync(p, backup);
      this.log(`bots: ${BOT_SETTINGS_FILE} is unreadable (${(err as Error).message}); moved to ${backup}, using the defaults`);
    }
  }

  private save(): void {
    const p = this.path();
    if (!p) return;
    mkdirSync(join(this.dataDir!, 'site'), { recursive: true });
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.cur, null, 2));
    renameSync(tmp, p);
  }

  get settings(): BotSettings {
    return structuredClone(this.cur);
  }

  kind(kind: BotRoomKind): BotKindSettings {
    return structuredClone(this.cur.kinds[kind]);
  }

  /** Bot-manager options of a room kind (what rooms run with). */
  options(kind: BotRoomKind): BotManagerOptions {
    return managerOptions(this.cur.kinds[kind]);
  }

  /** Adaptive map settings of a room kind. */
  mapScale(kind: BotRoomKind): MapScaleSettings {
    return { ...(this.cur.maps?.[kind] ?? MAP_SCALE_DEFAULT) };
  }

  /** Testnet: staked bots the admin wants in this arena (0 when arena bots are off). */
  stakedWanted(arenaId: number): number {
    const arena = this.cur.kinds.arena;
    if (!arena.enabled) return 0;
    const n = this.cur.testnet.arenas[String(arenaId)]?.stakedBots ?? this.cur.testnet.stakedPerArena;
    return Math.min(n, arena.cap);
  }

  /** Testnet: tELYMUM bankroll of a bot wallet in this arena (whole tokens, decimal string). */
  bankroll(arenaId: number): string {
    return this.cur.testnet.arenas[String(arenaId)]?.bankroll ?? this.cur.testnet.bankroll;
  }

  /** Validates, stores and applies an admin update; throws `BotSettingsError` on a bad field. */
  update(body: Record<string, unknown>): BotSettings {
    this.cur = applyBotSettings(this.cur, body);
    this.save();
    for (const fn of this.listeners) {
      try {
        fn(this.settings);
      } catch (err) {
        this.log(`bots: settings listener failed: ${(err as Error).message}`);
      }
    }
    return this.settings;
  }

  onChange(fn: (s: BotSettings) => void): void {
    this.listeners.push(fn);
  }
}
