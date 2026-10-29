import { clampPrice, describeError, formatHypeAmount, needsReprice, priceDeviationBps, setPriceCall, usdCentsToWei } from '@elymum/sdk';
import type { Address } from 'viem';
import type { EvmClient } from './evm-client';

/** How often the keeper checks the price (5 minutes). */
export const PRICE_KEEPER_INTERVAL_MS = 5 * 60_000;
/** Re-price only when the price is off the target by more than this (2 %). */
export const PRICE_KEEPER_THRESHOLD_BPS = 200;

export type KeeperOutcome = 'off' | 'not-keeper' | 'no-bounds' | 'no-price' | 'in-range' | 'repriced' | 'failed';

export interface PriceKeeperDeps {
  client: () => EvmClient | null;
  /** The registered NFT. */
  nft: () => string | null;
  /** Mint target in US cents (`MINT_USD_CENTS`). */
  usdCents: number;
  /** HYPE/USD as the API's decimal string. */
  fetchPrice: () => Promise<{ price: string; value: number }>;
  log: (m: string) => void;
  intervalMs?: number;
  receiptTimeoutMs?: number;
}

/**
 * Keeps the mint at $1 in HYPE when the owner made the server key the NFT's `priceKeeper` and set the
 * price bounds: every 5 minutes it reads HYPE/USD and calls `setPrice` when the current price is off the
 * target by more than 2 %, always clamped into `[minPrice, maxPrice]`. Otherwise it does nothing (the
 * owner syncs the price from /admin).
 */
export class PriceKeeper {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastOutcome: KeeperOutcome | null = null;

  constructor(private readonly deps: PriceKeeperDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.deps.intervalMs ?? PRICE_KEEPER_INTERVAL_MS);
    this.timer.unref();
    setTimeout(() => void this.tick(), 5_000).unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** The outcome of the last check (for `/api/config` and tests). */
  get last(): KeeperOutcome | null {
    return this.lastOutcome;
  }

  /** One check. Never throws. */
  async tick(): Promise<KeeperOutcome> {
    if (this.running) return this.lastOutcome ?? 'off';
    this.running = true;
    try {
      return this.note(await this.check());
    } catch (err) {
      this.deps.log(`price keeper: check failed (${(err as Error).message})`);
      return this.note('failed');
    } finally {
      this.running = false;
    }
  }

  private note(o: KeeperOutcome): KeeperOutcome {
    const changed = o !== this.lastOutcome;
    this.lastOutcome = o;
    if (changed && o === 'not-keeper') this.deps.log('price keeper: idle — the server key is not the NFT price keeper (the owner syncs the $1 price from /admin)');
    if (changed && o === 'no-bounds') this.deps.log('price keeper: idle — the NFT has no price bounds (setPriceBounds) yet');
    return o;
  }

  private async check(): Promise<KeeperOutcome> {
    const client = this.deps.client();
    const nft = this.deps.nft() as Address | null;
    if (!client || !nft) return 'off';
    const state = await client.mintState(nft);
    if (!state.keeper || state.keeper.toLowerCase() !== client.address.toLowerCase()) return 'not-keeper';
    if (state.maxPrice === 0n || state.minPrice === 0n) return 'no-bounds';
    let price: { price: string; value: number };
    try {
      price = await this.deps.fetchPrice();
    } catch (err) {
      this.deps.log(`price keeper: HYPE/USD unavailable (${(err as Error).message})`);
      return 'no-price';
    }
    const target = usdCentsToWei(this.deps.usdCents, price.price);
    const next = clampPrice(target, state.minPrice, state.maxPrice);
    if (next === state.price || !needsReprice(state.price, target, PRICE_KEEPER_THRESHOLD_BPS)) return 'in-range';
    try {
      const hash = await client.send(setPriceCall(nft, next));
      const receipt = await client.receipt(hash, null, this.deps.receiptTimeoutMs ?? 90_000);
      if (receipt?.status !== 'success') {
        this.deps.log(`price keeper: setPrice ${hash} ${receipt ? 'reverted' : 'not confirmed yet'}`);
        return 'failed';
      }
      this.deps.log(
        `price keeper: HYPE $${price.value} → price ${formatHypeAmount(state.price)} → ${formatHypeAmount(next)} ` +
          `(target ${formatHypeAmount(target)}, off ${(priceDeviationBps(state.price, target) / 100).toFixed(2)} %${next !== target ? ', clamped to the bounds' : ''}) · ${hash}`,
      );
      return 'repriced';
    } catch (err) {
      this.deps.log(`price keeper: setPrice failed (${describeError(err).message})`);
      return 'failed';
    }
  }
}
