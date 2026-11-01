import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RULES, type RoomMode, type League } from '@elymum/shared';
import type { BotManagerOptions } from './manager';
import { mixWeights, type BotMixWeights } from './personality';

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
}

/** Bounds of the admin values. */
export const BOT_LIMITS = { cap: 64, target: 200, stakedPerArena: 32, arenaIds: 64, massCap: 200_000 } as const;

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
  };
}

/** Settings of a kind from the env defaults (`ServerConfig.bots`); the mass cap defaults per `kind`. */
export function kindFromOptions(o: BotManagerOptions, kind?: BotRoomKind): BotKindSettings {
  const cap = Math.max(0, Math.min(BOT_LIMITS.cap, Math.floor(o.max)));
  const massCap = o.massCap ?? (kind ? DEFAULT_BOT_MASS_CAPS[kind] : 0);
  return {
    enabled: o.enabled !== false,
    cap,
    min: Math.max(0, Math.min(cap, Math.floor(o.min))),
    target: Math.max(0, Math.min(BOT_LIMITS.target, Math.floor(o.target))),
    mix: { ...mixWeights(o.mix) },
    massCap: Math.max(0, Math.min(BOT_LIMITS.massCap, Math.floor(massCap))),
  };
}

export function defaultBotSettings(defaults: Record<BotRoomKind, BotManagerOptions>): BotSettings {
  const kinds = {} as Record<BotRoomKind, BotKindSettings>;
  for (const k of BOT_ROOM_KINDS) kinds[k] = kindFromOptions(defaults[k], k);
  return { kinds, testnet: { ...BOT_TESTNET_DEFAULT, arenas: {} } };
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
  onlyKeys(body, ['kinds', 'testnet'], '');
  const next: BotSettings = structuredClone(cur);
  if (body.kinds !== undefined) {
    if (!isObj(body.kinds)) throw new BotSettingsError('kinds must be an object', 'kinds');
    onlyKeys(body.kinds, BOT_ROOM_KINDS, 'kinds.');
    for (const kind of BOT_ROOM_KINDS) {
      const patch = (body.kinds as Record<string, unknown>)[kind];
      if (patch === undefined) continue;
      const at = `kinds.${kind}`;
      if (!isObj(patch)) throw new BotSettingsError(`${at} must be an object`, at);
      onlyKeys(patch, ['enabled', 'cap', 'min', 'target', 'mix', 'massCap'], `${at}.`);
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
