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
}

export type PurchaseCheck = { ok: true; paid: bigint } | { ok: false; code: Extract<ShopBuyError, 'tx_pending' | 'tx_failed' | 'no_transfer' | 'wrong_token' | 'wrong_sender' | 'wrong_recipient' | 'wrong_amount'> };

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
  return hit ? { ok: true, paid: hit.value } : { ok: false, code: 'wrong_amount' };
}
