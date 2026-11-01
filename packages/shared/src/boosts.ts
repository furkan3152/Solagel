import { RULES } from './constants';
import { parseToken } from './token';

/**
 * Bought power-ups ("boosts"): charges a signed-in wallet buys with the game token and spends in
 * any room. They are separate from the map power-ups (`PowerUpType`, picked up off the floor);
 * Magnet and Speed reuse the map power-up effects (and their `CellFlag.Magnet` / `CellFlag.Pump`
 * visuals), Shockwave is new (`CellFlag.Shock`).
 */
export const BOOST_KINDS = ['magnet', 'shock', 'speed'] as const;
export type BoostKind = (typeof BOOST_KINDS)[number];

export function isBoostKind(x: unknown): x is BoostKind {
  return typeof x === 'string' && (BOOST_KINDS as readonly string[]).includes(x);
}

/** Desktop keys (`KeyboardEvent.code`): clear of Space split, E tip, WASD / arrows, Q spectate, Enter chat and 1-8 emotes. */
export const BOOST_KEYS: Readonly<Record<BoostKind, string>> = { magnet: 'KeyR', shock: 'KeyF', speed: 'KeyG' };
/** The key caps printed on the HUD buttons. */
export const BOOST_KEY_LABELS: Readonly<Record<BoostKind, string>> = { magnet: 'R', shock: 'F', speed: 'G' };

/**
 * Effect tuning (server-authoritative; the client reads it for the HUD rings and the shockwave ring).
 * They help but do not decide a fight: Magnet only pulls food, Speed is short, Shockwave only moves
 * coins no bigger than about yours and never lets anyone eat through it.
 */
export const BOOST_RULES = {
  magnet: {
    /** Pulls food (never loot, never coins) toward every cell of the user, like the map magnet. */
    durationMs: 8_000,
    cooldownMs: 20_000,
  },
  speed: {
    /** A short burst at the map pump's multiplier (`RULES.pumpSpeedMul`). */
    durationMs: 3_000,
    cooldownMs: 18_000,
  },
  shock: {
    cooldownMs: 15_000,
    /** Reach of the push from each cell of the user: `r * rangeFactor + rangeBase` (world units). */
    rangeFactor: 1.4,
    rangeBase: 240,
    /** Launch speed (units/s) of a pushed coin at the user's edge; falls to 40 % at the rim. Decays like a split. */
    pushSpeed: 950,
    /** Coins up to this many times the pushing cell's mass are pushed; bigger ones are not moved. */
    massRatio: 1.15,
    /** A pushed coin can neither eat nor be eaten by another coin this long (no eating through the push). */
    graceMs: 1_200,
    /** Food inside the reach is moved this fraction of the way to the rim. */
    foodPush: 0.7,
    /** How long the ring shows (`CellFlag.Shock` on the user's cells). */
    fxMs: 450,
  },
} as const;

/** Duration (ms) a boost's effect lasts (0: instant). */
export function boostDurationMs(kind: BoostKind): number {
  return kind === 'magnet' ? BOOST_RULES.magnet.durationMs : kind === 'speed' ? BOOST_RULES.speed.durationMs : 0;
}

export function boostCooldownMs(kind: BoostKind): number {
  return BOOST_RULES[kind].cooldownMs;
}

/** The shockwave's reach from a cell of radius `r` (the server pushes inside it, the ring is drawn to it). */
export function shockRange(r: number): number {
  return r * BOOST_RULES.shock.rangeFactor + BOOST_RULES.shock.rangeBase;
}

/** The speed burst multiplier (the map pump's). */
export const BOOST_SPEED_MUL = RULES.pumpSpeedMul;

/** The burn address the default sink sends to. */
export const BURN_ADDRESS = '0x000000000000000000000000000000000000dEaD';

export type ShopSink = 'burn' | 'treasury';

/** The admin's shop settings (`/api/admin/shop`, stored in `DATA_DIR/site/shop.json`). */
export interface ShopSettings {
  /** Buying and using bought power-ups is on. */
  enabled: boolean;
  /** Where payments go: the burn address (default) or the treasury wallet. */
  sink: ShopSink;
  /** The treasury wallet (EIP-55); null: the first `ADMIN_WALLETS` entry (the owner). */
  treasury: string | null;
  /** Charges in one pack. */
  packSize: number;
  /** Price of one pack, whole game tokens as a decimal string ("300", "12.5"). */
  prices: Record<BoostKind, string>;
  /** Per power-up on/off (off: not sold and not usable). */
  kinds: Record<BoostKind, boolean>;
  /** Emblem holders pay this many percent less (0..90). */
  holderDiscountPct: number;
  /** Paid arenas: uses per round per player, all power-ups together. */
  arenaUsesPerRound: number;
  /** Paid arenas: extra uses per round for emblem holders. */
  holderExtraArenaUses: number;
}

/** Testnet defaults: a pack of 3 costs a fraction of the cheapest arena ticket (1,000 tELYMUM). */
export const SHOP_DEFAULTS: ShopSettings = {
  enabled: true,
  sink: 'burn',
  treasury: null,
  packSize: 3,
  prices: { magnet: '300', shock: '450', speed: '300' },
  kinds: { magnet: true, shock: true, speed: true },
  holderDiscountPct: 30,
  arenaUsesPerRound: 2,
  holderExtraArenaUses: 1,
};

/** Bounds of the admin values. */
export const SHOP_LIMITS = { packSize: 20, holderDiscountPct: 90, arenaUsesPerRound: 20, holderExtraArenaUses: 10, priceTokens: 1_000_000_000 } as const;

/**
 * Raw base units of one pack for a wallet: the price in whole tokens scaled by `decimals`, less the
 * holder discount (rounded down to a whole base unit). Throws on a malformed price.
 */
export function packPriceRaw(price: string, decimals: number, discountPct: number): bigint {
  const full = parseToken(price, decimals);
  const pct = BigInt(Math.max(0, Math.min(100, Math.floor(discountPct))));
  return (full * (100n - pct)) / 100n;
}

export type BoostCounts = Record<BoostKind, number>;

export const emptyBoostCounts = (): BoostCounts => ({ magnet: 0, shock: 0, speed: 0 });

/** One pack in the shop, for one wallet. */
export interface ShopPack {
  kind: BoostKind;
  /** Charges in the pack. */
  charges: number;
  /** What this wallet pays, raw base units (decimal string): send exactly this. */
  priceRaw: string;
  /** The full price, raw base units (decimal string); equal to `priceRaw` without a holder discount. */
  fullPriceRaw: string;
  /** Sold right now. */
  enabled: boolean;
}

/** `GET /api/shop`: the packs for the signed-in wallet (or the public prices) and its charges. */
export interface ShopView {
  /** The shop is on and a game token is set (buying is possible). */
  open: boolean;
  /** Why buying is not possible right now, when `open` is false. */
  closedReason?: 'disabled' | 'no_token' | 'no_chain' | 'no_sink';
  /** The game token (null until it is set). */
  token: { address: string; symbol: string; decimals: number } | null;
  /** Where the transfer goes (EIP-55). */
  sink: string | null;
  sinkKind: ShopSink;
  packs: ShopPack[];
  /** The wallet holds an Elymum emblem (its prices carry the discount). */
  holder: boolean;
  holderDiscountPct: number;
  /** Paid arenas: uses per round (the wallet's, holder bonus included). */
  arenaUsesPerRound: number;
  holderExtraArenaUses: number;
  /** The wallet's charges (absent for guests). */
  charges?: BoostCounts;
}

/** `POST /api/shop/buy {kind, txHash}` answer. */
export interface ShopBuyResult {
  ok: true;
  kind: BoostKind;
  added: number;
  charges: BoostCounts;
}

/** Why a purchase was refused (`error` of the 4xx body). */
export type ShopBuyError =
  | 'shop_closed'
  | 'kind_disabled'
  | 'bad_request'
  | 'tx_used'
  | 'tx_pending'
  | 'tx_failed'
  | 'no_transfer'
  | 'wrong_token'
  | 'wrong_sender'
  | 'wrong_recipient'
  | 'wrong_amount'
  | 'chain_busy';

/**
 * The boost state of the player in a room (`boosts` message): charges, cooldowns and the arena's
 * per-round allowance. Sent on join, after every use and after a purchase.
 */
export interface BoostState {
  /** The room lets bought power-ups be used (the shop is on and this is a signed-in human). */
  usable: boolean;
  /** Signed in (guests cannot buy; the HUD shows a sign-in hint). */
  signedIn: boolean;
  charges: BoostCounts;
  /** Milliseconds until each power-up can be used again (0: ready). */
  cooldownMs: BoostCounts;
  /** Paid arenas: uses left this round and the round's total (absent elsewhere: no per-round cap). */
  arena?: { left: number; max: number };
  /** Power-ups the admin turned off. */
  disabled?: BoostKind[];
}

/** Why a use was refused (`boost` message with `ok: false`). */
export type BoostRefusal = 'guest' | 'disabled' | 'no_charges' | 'cooldown' | 'round_limit' | 'dead' | 'bot';
