import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  CUSTOM_HOLDER_PERKS,
  CUSTOM_MAP_WIDTH,
  CUSTOM_SETTINGS_DEFAULT,
  CUSTOM_SETTINGS_LIMITS,
  WORLD_PRESETS,
  customRoomPrice,
  validateCustomConfig,
  type CustomBest,
  type CustomRoomConfig,
  type CustomRoomError,
  type CustomRoomQuote,
  type CustomRoomSettings,
  type CustomRoomSummary,
  type CustomRoomView,
} from '@elymum/shared';
import { getAddress, parseEther } from 'viem';
import type { BotManagerOptions } from '../bots/manager';
import type { BotMixWeights } from '../bots/personality';
import { PaymentChainBusy, TX_HASH_RE, checkPayment, type PaymentReader, type UsedPayments } from '../chain/payment';
import type { CustomRoomHooks, RoomManager } from './manager';
import type { Room, WorldShape } from './room';

/** A refusal of the custom room API: HTTP status, code and a friendly message. */
export class CustomRoomFail extends Error {
  constructor(
    readonly status: number,
    readonly code: CustomRoomError,
    message: string,
    readonly field?: string,
    /** `slots_busy` after a verified payment: the payment stays unused, the creator can retry with it. */
    readonly paid?: boolean,
  ) {
    super(message);
  }
}

/** A custom room as stored (`DATA_DIR/site/custom-rooms.json`). */
export interface CustomRecord {
  code: string;
  config: CustomRoomConfig;
  creator: string;
  createdAt: number;
  endsAt: number;
  paidWith: 'paid' | 'free';
  txHash: string | null;
  /** Wei paid (decimal string). */
  paidWei: string;
  best: CustomBest[];
  /** The "1 minute left" line was said. */
  warned?: boolean;
}

interface RoomsFile {
  v: 1;
  rooms: CustomRecord[];
  /** Holder wallet (lower case) → UTC day (YYYY-MM-DD) of its last free room. */
  freeUsed: Record<string, string>;
}

/** Bot difficulty weights per choice. */
export const CUSTOM_BOT_MIX: Record<CustomRoomConfig['difficulty'], BotMixWeights> = {
  easy: { easy: 100, medium: 0, hard: 0 },
  mixed: { easy: 45, medium: 40, hard: 15 },
  hard: { easy: 0, medium: 35, hard: 65 },
};

const FOOD_MUL: Record<CustomRoomConfig['food'], number> = { low: 0.6, normal: 1, high: 1.6 };
const POWERUPS: Record<CustomRoomConfig['mapSize'], number> = { S: 2, M: 3, L: 4 };

/** The world of a config: food and thorn bushes scale with the area like a practice pond's. */
export function customWorld(c: CustomRoomConfig): WorldShape {
  const ref = WORLD_PRESETS.practice;
  const w = CUSTOM_MAP_WIDTH[c.mapSize];
  const ratio = (w * w) / (ref.width * ref.height);
  return {
    width: w,
    height: w,
    foodTarget: Math.round(ref.foodTarget * ratio * FOOD_MUL[c.food]),
    virusTarget: Math.max(3, Math.round(ref.virusTarget * ratio)),
    maxPowerUps: c.powerUps ? POWERUPS[c.mapSize] : 0,
  };
}

/** Bots of a config: exactly `bots` of them, whatever the humans do. */
export function customBots(c: CustomRoomConfig): BotManagerOptions | null {
  if (c.bots <= 0) return null;
  return { enabled: true, target: c.bots, min: c.bots, max: c.bots, mix: { ...CUSTOM_BOT_MIX[c.difficulty] } };
}

const BEST_KEPT = 10;
const BEST_FLUSH_MS = 10_000;
/** The room says "1 minute left" this long before it closes. */
export const CUSTOM_WARN_MS = 60_000;

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Validates an admin update of the settings; returns the merged settings. */
export function applyCustomSettings(cur: CustomRoomSettings, body: Record<string, unknown>, strict = true): CustomRoomSettings {
  const next = { ...cur };
  const bad = (field: string, message: string) => new CustomRoomFail(400, 'bad_request', message, field);
  const keys: (keyof CustomRoomSettings)[] = ['enabled', 'priceHype', 'treasury', 'holderPerk', 'holderDiscountPct', 'maxLive', 'maxPerWallet'];
  for (const k of Object.keys(body)) if (!keys.includes(k as keyof CustomRoomSettings) && strict) throw bad(k, `unknown field ${k}`);
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw bad('enabled', 'enabled must be true or false');
    next.enabled = body.enabled;
  }
  if (body.priceHype !== undefined) {
    const p = body.priceHype;
    if (typeof p !== 'string' || !/^\d{1,6}(\.\d{1,18})?$/.test(p)) throw bad('priceHype', 'priceHype must be a HYPE amount like "0.05"');
    if (parseEther(p) > parseEther('1000')) throw bad('priceHype', 'priceHype must be at most 1000 HYPE');
    next.priceHype = p;
  }
  if (body.treasury !== undefined) {
    if (body.treasury === null || body.treasury === '') next.treasury = null;
    else {
      try {
        if (typeof body.treasury !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(body.treasury)) throw new Error();
        next.treasury = getAddress(body.treasury.toLowerCase());
      } catch {
        throw bad('treasury', 'treasury must be a wallet address (0x...) or empty for the owner wallet');
      }
    }
  }
  if (body.holderPerk !== undefined) {
    if (!(CUSTOM_HOLDER_PERKS as readonly unknown[]).includes(body.holderPerk)) throw bad('holderPerk', `holderPerk must be one of ${CUSTOM_HOLDER_PERKS.join(', ')}`);
    next.holderPerk = body.holderPerk as CustomRoomSettings['holderPerk'];
  }
  const int = (v: unknown, field: string, min: number, max: number): number => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw bad(field, `${field} must be a whole number from ${min} to ${max}`);
    return v;
  };
  if (body.holderDiscountPct !== undefined) next.holderDiscountPct = int(body.holderDiscountPct, 'holderDiscountPct', 0, 100);
  if (body.maxLive !== undefined) next.maxLive = int(body.maxLive, 'maxLive', 0, CUSTOM_SETTINGS_LIMITS.maxLive);
  if (body.maxPerWallet !== undefined) next.maxPerWallet = int(body.maxPerWallet, 'maxPerWallet', 1, CUSTOM_SETTINGS_LIMITS.maxPerWallet);
  return next;
}

export interface CustomRoomDeps {
  rooms: RoomManager;
  /** `DATA_DIR` (settings and rooms under `site/`); null: memory only. */
  dataDir: string | null;
  /** File-name suffix (`.dev-fake` on the fake chain, so dev rooms never mix with real ones). */
  suffix?: string;
  /** Used payment hashes of the server's chain (persisted per chain). */
  used: UsedPayments;
  /** Reads payments on the server's chain; null while the chain is off (paid rooms closed). */
  reader: () => PaymentReader | null;
  /** The server's chain id (shown in the quote: the payment goes there). */
  chainId: () => number | null;
  /** Whether a wallet holds an Elymum NFT (cached by the mint service). */
  isHolder: (wallet: string) => Promise<boolean>;
  /** The treasury when the admin set none: the owner (first `ADMIN_WALLETS` wallet); null: none. */
  ownerWallet: string | null;
  now?: () => number;
  log?: (m: string) => void;
}

/**
 * Custom rooms: settings (`site/custom-rooms-settings.json`), the live rooms (`site/custom-rooms.json`,
 * restored after a restart for their remaining time), payment checks, caps, expiry and the rooms'
 * own leaderboards.
 */
export class CustomRoomService implements CustomRoomHooks {
  private cur: CustomRoomSettings;
  private readonly records = new Map<string, CustomRecord>();
  private freeUsed: Record<string, string> = {};
  /** Wallets with a create under way (one at a time per wallet). */
  private readonly creating = new Set<string>();
  private bestDirty = false;
  private lastBestFlush = 0;
  private readonly now: () => number;
  private readonly log: (m: string) => void;

  constructor(private readonly d: CustomRoomDeps) {
    this.now = d.now ?? Date.now;
    this.log = d.log ?? (() => {});
    this.cur = { ...CUSTOM_SETTINGS_DEFAULT };
    this.loadSettings();
    this.loadRooms();
    d.rooms.setCustomRooms(this);
  }

  /* ------------------------------ files ------------------------------ */

  private file(name: string): string | null {
    return this.d.dataDir ? join(this.d.dataDir, 'site', `${name}${this.d.suffix ?? ''}.json`) : null;
  }

  private write(path: string | null, body: unknown): void {
    if (!path) return;
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(body, null, 1));
    renameSync(tmp, path);
  }

  private loadSettings(): void {
    const p = this.file('custom-rooms-settings');
    if (!p || !existsSync(p)) return;
    try {
      const raw: unknown = JSON.parse(readFileSync(p, 'utf8'));
      if (!isObj(raw)) throw new Error('not an object');
      this.cur = applyCustomSettings(this.cur, raw, false);
    } catch (err) {
      const backup = `${p}.corrupt-${Date.now()}`;
      renameSync(p, backup);
      this.log(`custom rooms: settings unreadable (${(err as Error).message}); moved to ${backup}, using the defaults`);
    }
  }

  private loadRooms(): void {
    const p = this.file('custom-rooms');
    if (!p || !existsSync(p)) return;
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8')) as RoomsFile;
      this.freeUsed = isObj(raw.freeUsed) ? (raw.freeUsed as Record<string, string>) : {};
      for (const r of Array.isArray(raw.rooms) ? raw.rooms : []) {
        const v = validateCustomConfig(r?.config);
        if (!v.ok || typeof r.code !== 'string' || !Number.isFinite(r.endsAt)) continue;
        this.records.set(r.code, { ...r, config: v.config, best: Array.isArray(r.best) ? r.best.slice(0, BEST_KEPT) : [] });
      }
    } catch (err) {
      const backup = `${p}.corrupt-${Date.now()}`;
      renameSync(p, backup);
      this.log(`custom rooms: ${p} unreadable (${(err as Error).message}); moved to ${backup}`);
    }
  }

  private saveRooms(): void {
    this.bestDirty = false;
    this.lastBestFlush = this.now();
    this.write(this.file('custom-rooms'), { v: 1, rooms: [...this.records.values()], freeUsed: this.freeUsed } satisfies RoomsFile);
  }

  /** Writes the rooms' leaderboards if they changed (shutdown). */
  flush(): void {
    if (this.bestDirty) this.saveRooms();
  }

  /**
   * Re-opens the stored rooms that still have time left (after a restart) and forgets the
   * expired ones. Returns how many were re-opened.
   */
  restore(): number {
    const now = this.now();
    let n = 0;
    let dropped = 0;
    for (const [code, r] of [...this.records]) {
      if (r.endsAt <= now) {
        this.records.delete(code);
        dropped++;
        continue;
      }
      if (this.d.rooms.rooms.has(`priv-${code}`)) continue;
      this.open(r);
      n++;
    }
    if (n > 0 || dropped > 0) {
      this.log(`custom rooms: ${n} re-opened for their remaining time, ${dropped} expired while the server was down`);
      this.saveRooms();
    }
    return n;
  }

  private open(r: CustomRecord): Room {
    return this.d.rooms.createCustomRoom(r.code, {
      name: r.config.name,
      maxPlayers: r.config.maxPlayers,
      bots: customBots(r.config),
      world: customWorld(r.config),
      powerUps: r.config.powerUps,
      custom: this.summary(r),
    });
  }

  /* ------------------------------ settings ------------------------------ */

  get settings(): CustomRoomSettings {
    return { ...this.cur };
  }

  updateSettings(body: Record<string, unknown>): CustomRoomSettings {
    this.cur = applyCustomSettings(this.cur, body);
    this.write(this.file('custom-rooms-settings'), this.cur);
    return this.settings;
  }

  /** Where fees go: the admin's treasury, else the owner wallet. */
  treasury(): string | null {
    return this.cur.treasury ?? this.d.ownerWallet;
  }

  priceWei(): bigint {
    return parseEther(this.cur.priceHype);
  }

  /* ------------------------------ views ------------------------------ */

  private summary(r: CustomRecord): CustomRoomSummary {
    const c = r.config;
    return {
      durationMin: c.durationMin,
      mapSize: c.mapSize,
      bots: c.bots,
      difficulty: c.difficulty,
      food: c.food,
      powerUps: c.powerUps,
      creator: r.creator,
      createdAt: r.createdAt,
      endsAt: r.endsAt,
    };
  }

  view(r: CustomRecord): CustomRoomView {
    const room = this.d.rooms.rooms.get(`priv-${r.code}`);
    return {
      ...this.summary(r),
      code: r.code,
      name: r.config.name,
      maxPlayers: r.config.maxPlayers,
      players: room?.humans.size ?? 0,
      best: r.best.slice(0, BEST_KEPT),
      paidWith: r.paidWith,
      txHash: r.txHash,
    };
  }

  get(code: string): CustomRoomView | null {
    const r = this.records.get(code);
    return r ? this.view(r) : null;
  }

  list(): CustomRoomView[] {
    return [...this.records.values()].sort((a, b) => a.endsAt - b.endsAt).map((r) => this.view(r));
  }

  mine(wallet: string): CustomRoomView[] {
    const w = wallet.toLowerCase();
    return this.list().filter((r) => r.creator.toLowerCase() === w);
  }

  get live(): number {
    return this.records.size;
  }

  private freeAvailable(wallet: string): boolean {
    return this.cur.holderPerk === 'free_daily' && this.freeUsed[wallet.toLowerCase()] !== utcDay(this.now());
  }

  async quote(wallet: string | null): Promise<CustomRoomQuote> {
    const holder = wallet ? await this.d.isHolder(wallet).catch(() => false) : false;
    const free = !!wallet && holder && this.freeAvailable(wallet);
    const price = this.priceWei();
    const treasury = this.treasury();
    return {
      enabled: this.cur.enabled && !!treasury,
      priceWei: price.toString(),
      youPayWei: customRoomPrice(price, this.cur, holder, free).toString(),
      treasury,
      holderPerk: this.cur.holderPerk,
      holderDiscountPct: this.cur.holderDiscountPct,
      holder,
      freeAvailable: free,
      live: this.live,
      maxLive: this.cur.maxLive,
      mine: wallet ? this.mine(wallet).length : 0,
      maxPerWallet: this.cur.maxPerWallet,
      chainId: this.d.chainId(),
    };
  }

  /* ------------------------------ create ------------------------------ */

  private checkCaps(wallet: string, extra: number): void {
    if (this.live + extra > this.cur.maxLive) {
      throw new CustomRoomFail(503, 'slots_busy', 'All room slots are busy right now. Try again in a few minutes, when a room closes.');
    }
    if (this.mine(wallet).length >= this.cur.maxPerWallet) {
      throw new CustomRoomFail(409, 'wallet_limit', `You already have ${this.cur.maxPerWallet} rooms open. Close one or wait for it to end.`);
    }
  }

  /**
   * Creates a room for a signed-in `wallet` (`POST /api/rooms/custom {config, txHash}`). The price
   * (after the holder perk) must be paid with a native transfer to the treasury, checked on chain;
   * a free room needs no transaction. Throws `CustomRoomFail`.
   */
  async create(wallet: string, body: Record<string, unknown>): Promise<CustomRoomView> {
    if (!this.cur.enabled) throw new CustomRoomFail(503, 'rooms_closed', 'Creating rooms is closed right now.');
    const treasury = this.treasury();
    if (!treasury) throw new CustomRoomFail(503, 'rooms_closed', 'Creating rooms is not set up on this server yet.');
    const v = validateCustomConfig(body.config);
    if (!v.ok) throw new CustomRoomFail(400, 'bad_request', v.message, v.field);
    const w = wallet.toLowerCase();
    if (this.creating.has(w)) throw new CustomRoomFail(409, 'bad_request', 'Your room is being created. Wait a moment.');
    this.checkCaps(wallet, 1);
    this.creating.add(w);
    let claimed: string | null = null;
    try {
      const holder = await this.d.isHolder(wallet).catch(() => false);
      const free = holder && this.freeAvailable(wallet);
      const price = customRoomPrice(this.priceWei(), this.cur, holder, free);
      let txHash: string | null = null;
      if (price > 0n) {
        const hash = typeof body.txHash === 'string' ? body.txHash.trim() : '';
        if (!hash) throw new CustomRoomFail(402, 'payment_required', 'Pay the room fee first.', 'txHash');
        if (!TX_HASH_RE.test(hash)) throw new CustomRoomFail(400, 'payment_invalid', 'That is not a transaction hash.', 'txHash');
        if (this.d.used.has(hash)) throw new CustomRoomFail(409, 'payment_used', 'This payment already opened a room.', 'txHash');
        if (!this.d.used.claim(hash)) throw new CustomRoomFail(409, 'payment_pending', 'This payment is being checked. Wait a moment.', 'txHash');
        claimed = hash;
        const reader = this.d.reader();
        if (!reader) throw new CustomRoomFail(503, 'rooms_closed', 'Paid rooms need the chain, which is off on this server.');
        let res;
        try {
          res = await checkPayment(reader, this.d.used, { hash, from: wallet, to: treasury, minWei: price, now: this.now() });
        } catch (err) {
          if (err instanceof PaymentChainBusy) throw new CustomRoomFail(503, 'chain_busy', 'The network is busy. Your payment is safe: try again in a moment.', 'txHash');
          throw err;
        }
        if (!res.ok) throw new CustomRoomFail(res.code === 'payment_pending' ? 409 : 400, res.code, res.message, 'txHash');
        txHash = hash;
      }
      // the awaits above let other rooms open meanwhile: a paid hash stays unused when the slots filled up
      try {
        this.checkCaps(wallet, 1);
      } catch (err) {
        if (err instanceof CustomRoomFail && txHash) throw new CustomRoomFail(err.status, err.code, `${err.message} Your payment is kept: open the room with it later.`, undefined, true);
        throw err;
      }
      const now = this.now();
      const code = this.d.rooms.newPrivateCode();
      const rec: CustomRecord = {
        code,
        config: v.config,
        creator: getAddress(w),
        createdAt: now,
        endsAt: now + v.config.durationMin * 60_000,
        paidWith: txHash ? 'paid' : 'free',
        txHash,
        paidWei: price.toString(),
        best: [],
      };
      // the hash is used for good before the room opens (a crash between the two loses the room, never doubles it)
      if (txHash) this.d.used.markUsed(txHash, { at: now, wallet: rec.creator, code });
      claimed = null;
      if (!txHash && holder && this.cur.holderPerk === 'free_daily') this.freeUsed[w] = utcDay(now);
      this.records.set(code, rec);
      this.open(rec);
      this.saveRooms();
      this.log(`custom rooms: ${code} "${rec.config.name}" opened by ${rec.creator} (${rec.paidWith}${txHash ? ` ${txHash}` : ''}, ${rec.config.durationMin} min)`);
      return this.view(rec);
    } finally {
      if (claimed) this.d.used.release(claimed);
      this.creating.delete(w);
    }
  }

  /* ------------------------------ close / expire ------------------------------ */

  /** Closes a room early: its creator (`by` = creator wallet) or an admin. */
  close(code: string, by: { wallet: string; admin: boolean }): CustomRoomView {
    const r = this.records.get(code);
    if (!r) throw new CustomRoomFail(404, 'not_found', 'No open room with that code.');
    const creator = r.creator.toLowerCase() === by.wallet.toLowerCase();
    if (!creator && !by.admin) throw new CustomRoomFail(403, 'forbidden', 'Only the room creator can close it.');
    const view = this.view(r);
    this.shut(r, creator ? 'The room creator closed this room.' : 'An admin closed this room.');
    this.log(`custom rooms: ${code} closed early by ${by.wallet}${creator ? ' (creator)' : ' (admin)'}`);
    return view;
  }

  private shut(r: CustomRecord, message: string): void {
    this.records.delete(r.code);
    this.d.rooms.closeCustomRoom(r.code, message);
    this.saveRooms();
  }

  /** Closes rooms whose time ran out; says "1 minute left" before. Called from the tick loop. */
  sweep(now = this.now()): void {
    for (const r of [...this.records.values()]) {
      if (r.endsAt <= now) {
        this.shut(r, 'Time is up: this room has closed. Thanks for playing!');
        this.log(`custom rooms: ${r.code} expired`);
        continue;
      }
      if (!r.warned && r.endsAt - now <= CUSTOM_WARN_MS) {
        r.warned = true;
        this.d.rooms.rooms.get(`priv-${r.code}`)?.announce('1 minute left in this room!');
        this.bestDirty = true;
      }
    }
    if (this.bestDirty && now - this.lastBestFlush >= BEST_FLUSH_MS) this.saveRooms();
  }

  /** A game ended in a custom room: its own leaderboard keeps the best 10 games. */
  onGame(room: Room, e: { name: string; score: number; kills: number }): void {
    const code = room.opts.code;
    const r = code ? this.records.get(code) : undefined;
    if (!r || e.score <= 0) return;
    r.best.push({ name: e.name, score: e.score, kills: e.kills, at: this.now() });
    r.best.sort((a, b) => b.score - a.score || a.at - b.at);
    r.best.length = Math.min(r.best.length, BEST_KEPT);
    this.bestDirty = true;
  }
}
