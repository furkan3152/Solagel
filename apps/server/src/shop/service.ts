import {
  BOOST_KINDS,
  BURN_ADDRESS,
  boostCooldownMs,
  emptyBoostCounts,
  isBoostKind,
  packPriceRaw,
  type BoostCounts,
  type BoostKind,
  type BoostRefusal,
  type BoostState,
  type ShopBuyError,
  type ShopBuyResult,
  type ShopPack,
  type ShopSettings,
  type ShopView,
} from '@elymum/shared';
import { getAddress } from 'viem';
import { ChainBusyError, type ChainGateway } from '../chain/types';
import { InventoryError, type BoostInventory } from './inventory';
import type { ShopSettingsStore } from './settings';
import { verifyPurchase } from './verify';

/** A refused purchase: HTTP status, the `ShopBuyError` code and a player-facing message. */
export class ShopFail extends Error {
  constructor(
    readonly status: number,
    readonly code: ShopBuyError,
    message: string,
  ) {
    super(message);
  }
}

const BUY_MESSAGES: Record<ShopBuyError, string> = {
  shop_closed: 'The power-up shop is closed right now.',
  kind_disabled: 'This power-up is not sold right now.',
  bad_request: 'That purchase request is not valid.',
  tx_used: 'This transaction was already used for a purchase.',
  tx_pending: 'The payment is not confirmed on chain yet. Try again in a moment.',
  tx_failed: 'The payment transaction failed on chain.',
  no_transfer: 'That transaction moved no tokens.',
  wrong_token: 'That transaction did not pay with the game token.',
  wrong_sender: 'That payment was not sent from your signed-in wallet.',
  wrong_recipient: 'That payment did not go to the shop address.',
  wrong_amount: 'That payment does not match the pack price.',
  chain_busy: 'The network is busy. Your payment is safe: try again in a moment.',
};

/** Where a player is when they press a power-up key. */
export interface UseContext {
  /** The signed-in wallet (null: a guest). */
  wallet: string | null;
  isBot: boolean;
  /** A paid arena (per-round cap). */
  arena: boolean;
  /** The arena round in play (arena rooms). */
  round: number | null;
  /** The player wears the emblem laurel (`PlayerFlag.Holder`). */
  holder: boolean;
}

export interface ShopDeps {
  settings: ShopSettingsStore;
  inventory: BoostInventory;
  chain: ChainGateway;
  /** The owner's wallet (the first `ADMIN_WALLETS` entry): the treasury when none is set. */
  owner: () => string | null;
  /** Emblem holder check (cached; `fresh` re-reads the chain). */
  holder: (wallet: string, fresh?: boolean) => Promise<boolean>;
  /** Wall clock (cooldowns). */
  now?: () => number;
  /** Waits before re-reading a receipt that is not visible yet (default 0, 1.5 s, 3 s, 5 s). */
  receiptRetryMs?: readonly number[];
  log?: (m: string) => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.());

/**
 * The power-up shop: prices and packs (`GET /api/shop`), purchase verification
 * (`POST /api/shop/buy`: the receipt of a game-token transfer from the signed-in wallet to the sink,
 * exactly the pack price, a hash credited once) and the in-room rules (charges, cooldowns per
 * power-up and wallet, the paid arenas' per-round cap). Bots never use bought power-ups.
 */
export class ShopService {
  private readonly now: () => number;
  /** `<wallet lower>:<kind>` → wall-clock ms it can be used again. */
  private readonly readyAt = new Map<string, number>();
  /** Paid arenas: wallet lower → uses this round. */
  private readonly arenaUses = new Map<string, { round: number; used: number }>();
  private readonly inflight = new Set<string>();
  private readonly chargeListeners: ((wallet: string) => void)[] = [];

  constructor(private readonly deps: ShopDeps) {
    this.now = deps.now ?? Date.now;
  }

  get settings(): ShopSettings {
    return this.deps.settings.settings;
  }

  /** `fn(wallet)`: the wallet's charges changed outside a room (a purchase): live rooms push the new state. */
  onCharges(fn: (wallet: string) => void): void {
    this.chargeListeners.push(fn);
  }

  /** The address payments go to; null when the treasury is chosen but no owner wallet is known. */
  sink(s: ShopSettings = this.settings): string | null {
    if (s.sink === 'burn') return BURN_ADDRESS;
    const w = s.treasury ?? this.deps.owner();
    try {
      return w ? getAddress(w) : null;
    } catch {
      return null;
    }
  }

  private token(): { address: string; symbol: string; decimals: number } | null {
    const st = this.deps.chain.status();
    return st.tokenReady && st.token ? st.token : null;
  }

  private closedReason(s: ShopSettings): ShopView['closedReason'] | null {
    if (!s.enabled) return 'disabled';
    if (!this.deps.chain.enabled || !this.deps.chain.tokenReceipt) return 'no_chain';
    if (!this.token()) return 'no_token';
    if (!this.sink(s)) return 'no_sink';
    return null;
  }

  /** `GET /api/shop`: packs priced for `wallet` (public prices for guests) and its charges. */
  async view(wallet: string | null): Promise<ShopView> {
    const s = this.settings;
    const token = this.token();
    const holder = wallet ? await this.deps.holder(wallet).catch(() => false) : false;
    const closed = this.closedReason(s);
    const decimals = token?.decimals ?? 18;
    const packs: ShopPack[] = BOOST_KINDS.map((kind) => {
      const full = packPriceRaw(s.prices[kind], decimals, 0);
      const mine = holder ? packPriceRaw(s.prices[kind], decimals, s.holderDiscountPct) : full;
      return { kind, charges: s.packSize, priceRaw: mine.toString(), fullPriceRaw: full.toString(), enabled: s.enabled && s.kinds[kind] };
    });
    return {
      open: closed === null,
      ...(closed ? { closedReason: closed } : {}),
      token,
      sink: this.sink(s),
      sinkKind: s.sink,
      packs,
      holder,
      holderDiscountPct: s.holderDiscountPct,
      arenaUsesPerRound: s.arenaUsesPerRound + (holder ? s.holderExtraArenaUses : 0),
      holderExtraArenaUses: s.holderExtraArenaUses,
      ...(wallet ? { charges: this.deps.inventory.get(wallet) } : {}),
    };
  }

  /**
   * `POST /api/shop/buy {kind, txHash}`: verifies the payment and credits a pack to `wallet`.
   * Throws `ShopFail` with the reason; never credits a hash twice (also not two requests at once).
   */
  async buy(wallet: string, body: Record<string, unknown>): Promise<ShopBuyResult> {
    const s = this.settings;
    const fail = (status: number, code: ShopBuyError): never => {
      throw new ShopFail(status, code, BUY_MESSAGES[code]);
    };
    const kind = body.kind;
    const txHash = typeof body.txHash === 'string' ? body.txHash.toLowerCase() : '';
    if (!isBoostKind(kind) || !/^0x[0-9a-f]{64}$/.test(txHash)) return fail(400, 'bad_request');
    if (this.closedReason(s)) return fail(403, 'shop_closed');
    if (!s.kinds[kind]) return fail(403, 'kind_disabled');
    const token = this.token()!;
    const sink = this.sink(s)!;
    if (this.deps.inventory.isUsed(txHash) || this.inflight.has(txHash)) return fail(409, 'tx_used');
    this.inflight.add(txHash);
    try {
      const full = packPriceRaw(s.prices[kind], token.decimals, 0);
      const discounted = packPriceRaw(s.prices[kind], token.decimals, s.holderDiscountPct);
      let receipt = null;
      for (const wait of this.deps.receiptRetryMs ?? [0, 1_500, 3_000, 5_000]) {
        if (wait > 0) await sleep(wait);
        try {
          receipt = await this.deps.chain.tokenReceipt!(txHash);
        } catch (err) {
          if (err instanceof ChainBusyError) return fail(503, 'chain_busy');
          throw err;
        }
        if (receipt) break;
      }
      const check = verifyPurchase(receipt, { token: token.address, from: wallet, to: sink, amounts: discounted === full ? [full] : [full, discounted] });
      if (!check.ok) return fail(check.code === 'tx_pending' ? 409 : 400, check.code);
      // the discounted price is only for emblem holders (re-read on chain when the cache says no)
      if (check.paid !== full) {
        const holder = (await this.deps.holder(wallet).catch(() => false)) || (await this.deps.holder(wallet, true).catch(() => false));
        if (!holder) return fail(400, 'wrong_amount');
      }
      let charges: BoostCounts;
      try {
        charges = this.deps.inventory.credit(wallet, kind, s.packSize, txHash, check.paid);
      } catch (err) {
        if (err instanceof InventoryError) return fail(err.code === 'tx_used' ? 409 : 400, err.code);
        throw err;
      }
      for (const fn of this.chargeListeners) {
        try {
          fn(wallet);
        } catch (err) {
          this.deps.log?.(`shop: charge listener failed: ${(err as Error).message}`);
        }
      }
      return { ok: true, kind, added: s.packSize, charges };
    } finally {
      this.inflight.delete(txHash);
    }
  }

  private arenaMax(s: ShopSettings, holder: boolean): number {
    return s.arenaUsesPerRound + (holder ? s.holderExtraArenaUses : 0);
  }

  private arenaUsed(wallet: string, round: number | null): number {
    const u = this.arenaUses.get(wallet.toLowerCase());
    return u && u.round === round ? u.used : 0;
  }

  /** The in-room state of a player (`boosts` message). */
  state(ctx: UseContext): BoostState {
    const s = this.settings;
    const now = this.now();
    const charges = ctx.wallet && !ctx.isBot ? this.deps.inventory.get(ctx.wallet) : emptyBoostCounts();
    const cooldownMs = emptyBoostCounts();
    if (ctx.wallet) for (const k of BOOST_KINDS) cooldownMs[k] = Math.max(0, (this.readyAt.get(`${ctx.wallet.toLowerCase()}:${k}`) ?? 0) - now);
    const disabled = BOOST_KINDS.filter((k) => !s.kinds[k]);
    const state: BoostState = { usable: s.enabled && !!ctx.wallet && !ctx.isBot, signedIn: !!ctx.wallet, charges, cooldownMs };
    if (ctx.arena) {
      const max = this.arenaMax(s, ctx.holder);
      state.arena = { max, left: ctx.wallet ? Math.max(0, max - this.arenaUsed(ctx.wallet, ctx.round)) : 0 };
    }
    if (disabled.length) state.disabled = disabled;
    return state;
  }

  /**
   * A press of a power-up key: checks the rules, then `apply` (the world's effect; false when the
   * player is not alive), and only then takes the charge, starts the cooldown and counts the arena use.
   */
  use(ctx: UseContext, kind: BoostKind, apply: () => boolean): { ok: true } | { ok: false; reason: BoostRefusal } {
    const s = this.settings;
    if (ctx.isBot) return { ok: false, reason: 'bot' };
    if (!s.enabled || !s.kinds[kind]) return { ok: false, reason: 'disabled' };
    if (!ctx.wallet) return { ok: false, reason: 'guest' };
    const wallet = ctx.wallet.toLowerCase();
    if (this.deps.inventory.get(wallet)[kind] <= 0) return { ok: false, reason: 'no_charges' };
    const now = this.now();
    if ((this.readyAt.get(`${wallet}:${kind}`) ?? 0) > now) return { ok: false, reason: 'cooldown' };
    if (ctx.arena && this.arenaUsed(wallet, ctx.round) >= this.arenaMax(s, ctx.holder)) return { ok: false, reason: 'round_limit' };
    if (!apply()) return { ok: false, reason: 'dead' };
    this.deps.inventory.consume(wallet, kind);
    this.readyAt.set(`${wallet}:${kind}`, now + boostCooldownMs(kind));
    if (ctx.arena) this.arenaUses.set(wallet, { round: ctx.round ?? 0, used: this.arenaUsed(wallet, ctx.round) + 1 });
    this.prune(now);
    return { ok: true };
  }

  private prune(now: number): void {
    if (this.readyAt.size < 4096) return;
    for (const [k, t] of this.readyAt) if (t <= now) this.readyAt.delete(k);
  }
}
