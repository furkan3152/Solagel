import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BOOST_KINDS, SHOP_DEFAULTS, SHOP_LIMITS, parseToken, type ShopSettings } from '@elymum/shared';
import { getAddress, isAddress } from 'viem';

/** A bad admin value: `field` names it (`prices.magnet`, `arenaUsesPerRound`, …). */
export class ShopSettingsError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
  }
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

function int(x: unknown, field: string, min: number, max: number): number {
  if (typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max) throw new ShopSettingsError(`${field} must be a whole number from ${min} to ${max}`, field);
  return x;
}

function bool(x: unknown, field: string): boolean {
  if (typeof x !== 'boolean') throw new ShopSettingsError(`${field} must be true or false`, field);
  return x;
}

/** A pack price: whole tokens as a decimal string, above 0 and at most `SHOP_LIMITS.priceTokens`, at most 6 decimals. */
function price(x: unknown, field: string): string {
  if (typeof x !== 'string' || !/^\d{1,10}(\.\d{1,6})?$/.test(x)) throw new ShopSettingsError(`${field} must be a token amount like "300" or "12.5"`, field);
  const raw = parseToken(x, 6);
  if (raw <= 0n || raw > BigInt(SHOP_LIMITS.priceTokens) * 10n ** 6n) throw new ShopSettingsError(`${field} must be above 0 and at most ${SHOP_LIMITS.priceTokens}`, field);
  return x;
}

const KEYS = ['enabled', 'sink', 'treasury', 'packSize', 'prices', 'kinds', 'holderDiscountPct', 'arenaUsesPerRound', 'holderExtraArenaUses'] as const;

/**
 * Applies a partial update (`PUT /api/admin/shop`) to `cur`. Every given field is checked; unknown
 * fields are refused unless `strict` is false (loading a file written by a newer server).
 */
export function applyShopSettings(cur: ShopSettings, body: Record<string, unknown>, opts: { strict?: boolean } = {}): ShopSettings {
  const strict = opts.strict !== false;
  if (strict) for (const k of Object.keys(body)) if (!(KEYS as readonly string[]).includes(k)) throw new ShopSettingsError(`unknown field ${k}`, k);
  const next: ShopSettings = structuredClone(cur);
  if (body.enabled !== undefined) next.enabled = bool(body.enabled, 'enabled');
  if (body.sink !== undefined) {
    if (body.sink !== 'burn' && body.sink !== 'treasury') throw new ShopSettingsError('sink must be "burn" or "treasury"', 'sink');
    next.sink = body.sink;
  }
  if (body.treasury !== undefined) {
    if (body.treasury === null || body.treasury === '') next.treasury = null;
    else if (typeof body.treasury === 'string' && isAddress(body.treasury, { strict: false })) next.treasury = getAddress(body.treasury);
    else throw new ShopSettingsError('treasury must be a 0x wallet address (or empty for the owner)', 'treasury');
  }
  if (body.packSize !== undefined) next.packSize = int(body.packSize, 'packSize', 1, SHOP_LIMITS.packSize);
  if (body.holderDiscountPct !== undefined) next.holderDiscountPct = int(body.holderDiscountPct, 'holderDiscountPct', 0, SHOP_LIMITS.holderDiscountPct);
  if (body.arenaUsesPerRound !== undefined) next.arenaUsesPerRound = int(body.arenaUsesPerRound, 'arenaUsesPerRound', 0, SHOP_LIMITS.arenaUsesPerRound);
  if (body.holderExtraArenaUses !== undefined) next.holderExtraArenaUses = int(body.holderExtraArenaUses, 'holderExtraArenaUses', 0, SHOP_LIMITS.holderExtraArenaUses);
  for (const group of ['prices', 'kinds'] as const) {
    const patch = body[group];
    if (patch === undefined) continue;
    if (!isObj(patch)) throw new ShopSettingsError(`${group} must be an object`, group);
    if (strict) for (const k of Object.keys(patch)) if (!(BOOST_KINDS as readonly string[]).includes(k)) throw new ShopSettingsError(`unknown field ${group}.${k}`, `${group}.${k}`);
    for (const kind of BOOST_KINDS) {
      if (patch[kind] === undefined) continue;
      if (group === 'prices') next.prices[kind] = price(patch[kind], `prices.${kind}`);
      else next.kinds[kind] = bool(patch[kind], `kinds.${kind}`);
    }
  }
  return next;
}

/** Where the settings live under `DATA_DIR`. */
export const SHOP_SETTINGS_FILE = join('site', 'shop.json');

/** The admin's shop settings, persisted in `DATA_DIR/site/shop.json` (atomic write), applied at once. */
export class ShopSettingsStore {
  private cur: ShopSettings;

  constructor(
    private readonly dataDir: string | null,
    readonly defaults: ShopSettings = SHOP_DEFAULTS,
    private readonly log: (m: string) => void = () => {},
  ) {
    this.cur = structuredClone(defaults);
    this.load();
  }

  private path(): string | null {
    return this.dataDir ? join(this.dataDir, SHOP_SETTINGS_FILE) : null;
  }

  private load(): void {
    const p = this.path();
    if (!p || !existsSync(p)) return;
    try {
      const raw: unknown = JSON.parse(readFileSync(p, 'utf8'));
      if (!isObj(raw)) throw new Error('not an object');
      this.cur = applyShopSettings(this.defaults, raw, { strict: false });
    } catch (err) {
      const backup = `${p}.corrupt-${Date.now()}`;
      renameSync(p, backup);
      this.log(`shop: ${SHOP_SETTINGS_FILE} is unreadable (${(err as Error).message}); moved to ${backup}, using the defaults`);
    }
  }

  get settings(): ShopSettings {
    return structuredClone(this.cur);
  }

  /** Validates, stores and applies an admin update; throws `ShopSettingsError` on a bad field. */
  update(body: Record<string, unknown>): ShopSettings {
    this.cur = applyShopSettings(this.cur, body);
    const p = this.path();
    if (p) {
      mkdirSync(join(this.dataDir!, 'site'), { recursive: true });
      writeFileSync(`${p}.tmp`, JSON.stringify(this.cur, null, 2));
      renameSync(`${p}.tmp`, p);
    }
    return this.settings;
  }
}
