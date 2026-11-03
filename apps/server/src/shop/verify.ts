import type { ShopBuyError } from '@elymum/shared';
import type { TokenReceipt } from '../chain/types';

/** What a purchase transaction must contain. */
export interface PurchaseExpectation {
  /** The game token (any case). */
  token: string;
  /** The signed-in wallet that claims the purchase (any case). */
  from: string;
  /** The sink: the burn address or the treasury (any case). */
  to: string;
  /** Accepted amounts, raw base units: the wallet's price (and the full price, for a holder whose discount was not seen). */
  amounts: readonly bigint[];
  /** Wall clock (unix ms): with it, a payment mined more than `maxAgeMs` ago is refused (`tx_stale`). */
  now?: number;
  /** Default `SHOP_PAYMENT_MAX_AGE_MS`. */
  maxAgeMs?: number;
}

/**
 * Oldest payment a purchase may claim (24 h). The used-hash list lives on the server's disk: should it be
 * lost, only the payments of the last day could be credited a second time, never the whole history (and an
 * old transfer of the right amount to the sink can never be claimed as a new purchase).
 */
export const SHOP_PAYMENT_MAX_AGE_MS = 24 * 3600_000;

export type PurchaseCheck = { ok: true; paid: bigint } | { ok: false; code: Extract<ShopBuyError, 'tx_pending' | 'tx_failed' | 'no_transfer' | 'wrong_token' | 'wrong_sender' | 'wrong_recipient' | 'wrong_amount' | 'tx_stale'> };

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Checks a receipt against a purchase: it is mined and succeeded, and one of its `Transfer` logs
 * was emitted by the game token, moves tokens from the signed-in wallet to the sink, and carries
 * exactly one of the accepted amounts. The most specific reason is reported when nothing matches.
 * (Replays are the inventory's job: a hash is credited once.)
 */
export function verifyPurchase(receipt: TokenReceipt | null, exp: PurchaseExpectation): PurchaseCheck {
  if (!receipt) return { ok: false, code: 'tx_pending' };
  if (receipt.status !== 'success') return { ok: false, code: 'tx_failed' };
  if (receipt.transfers.length === 0) return { ok: false, code: 'no_transfer' };
  const ofToken = receipt.transfers.filter((t) => eq(t.token, exp.token));
  if (ofToken.length === 0) return { ok: false, code: 'wrong_token' };
  const toSink = ofToken.filter((t) => eq(t.to, exp.to));
  if (toSink.length === 0) return { ok: false, code: 'wrong_recipient' };
  const mine = toSink.filter((t) => eq(t.from, exp.from));
  if (mine.length === 0) return { ok: false, code: 'wrong_sender' };
  const hit = mine.find((t) => exp.amounts.includes(t.value));
  if (!hit) return { ok: false, code: 'wrong_amount' };
  if (exp.now !== undefined && receipt.timestamp !== undefined && exp.now - receipt.timestamp > (exp.maxAgeMs ?? SHOP_PAYMENT_MAX_AGE_MS)) {
    return { ok: false, code: 'tx_stale' };
  }
  return { ok: true, paid: hit.value };
}
