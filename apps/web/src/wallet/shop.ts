import type { BoostCounts, BoostKind, ChainStatus, ShopBuyError, ShopBuyResult, ShopPack, ShopView } from '@elymum/shared';
import { erc20Abi, type Address, type Hash } from 'viem';
import { SERVER } from '../config';
import { isDevFake, loadDevFake } from './devFakeLoader';
import { sendWithWallet, txErrorText, type TxPhase } from './tx';
import { serverText, t } from '../i18n';

/**
 * The power-up shop, client side: read the packs priced for the signed-in wallet, pay a pack with an
 * ERC-20 `transfer` of exactly its price to the shop's sink (the burn address or the treasury), then
 * hand the transaction hash to the server, which checks the receipt and credits the charges.
 */

/** `GET /api/shop` (with the session token when signed in: holder prices and the wallet's charges). */
export async function fetchShop(token: string | null, signal?: AbortSignal): Promise<ShopView> {
  const res = await fetch(`${SERVER.http}/api/shop`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal });
  if (!res.ok) throw new Error(res.status === 404 ? t('api.shopMissing') : t('api.shopLoad'));
  return (await res.json()) as ShopView;
}

/** A refused purchase (`error` is the server's code; `message` is for the player). */
export class ShopError extends Error {
  constructor(
    readonly code: ShopBuyError | 'rejected' | 'tx' | 'network',
    message: string,
    /** The payment went through on chain (its hash), so the player can retry the claim without paying again. */
    readonly txHash: string | null = null,
  ) {
    super(message);
  }
}

/** `POST /api/shop/buy {kind, txHash}`: retries a few times while the server cannot see the receipt yet. */
export async function claimPack(token: string, kind: BoostKind, txHash: string, opts: { retryMs?: readonly number[] } = {}): Promise<ShopBuyResult> {
  const waits = opts.retryMs ?? [0, 2_000, 4_000, 6_000];
  let last: ShopError | null = null;
  for (const wait of waits) {
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    let res: Response;
    try {
      res = await fetch(`${SERVER.http}/api/shop/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind, txHash }),
      });
    } catch {
      last = new ShopError('network', t('api.reach'), txHash);
      continue;
    }
    const body = (await res.json().catch(() => null)) as (ShopBuyResult & { error?: undefined }) | { error?: ShopBuyError; message?: string } | null;
    if (res.ok && body && 'ok' in body) return body;
    const code = (body && 'error' in body && body.error) || 'bad_request';
    last = new ShopError(code, serverText(body && 'message' in body ? body.message : undefined, res.status === 401 ? t('api.expiredVerify') : t('api.shopRefused')), txHash);
    // only "not visible yet" and a busy chain are worth another look
    if (code !== 'tx_pending' && code !== 'chain_busy' && code !== ('network' as ShopBuyError)) break;
  }
  throw last ?? new ShopError('bad_request', t('api.shopRefused'), txHash);
}

export type BuyPhase = TxPhase | 'verifying';

/**
 * Pays `pack` from the connected wallet and claims it. In a dev build talking to a `DEV_FAKE_CHAIN`
 * server the payment is simulated (the server records a fake transfer). Throws `ShopError`.
 */
export async function buyPack(
  view: ShopView,
  pack: ShopPack,
  ctx: { token: string; owner: string; chain: ChainStatus; onPhase?: (p: BuyPhase) => void },
): Promise<ShopBuyResult> {
  if (!view.open || !view.token || !view.sink) throw new ShopError('shop_closed', t('shop.closed'));
  const amount = BigInt(pack.priceRaw);
  let hash: string;
  if (isDevFake(ctx.chain)) {
    const dev = await loadDevFake();
    if (!dev) throw new ShopError('tx', 'No fake chain in this build.');
    hash = await dev.fakeShopTransfer(ctx.owner, view.sink, amount, (p) => ctx.onPhase?.(p));
  } else {
    const token = view.token.address as Address;
    const sink = view.sink as Address;
    const res = await sendWithWallet(
      (wallet, from) => wallet.writeContract({ address: token, abi: erc20Abi, functionName: 'transfer', args: [sink, amount], account: from, chain: wallet.chain }) as Promise<Hash>,
      { chain: ctx.chain, onPhase: (p) => ctx.onPhase?.(p) },
    );
    if (!res.ok) throw new ShopError(res.error.kind === 'rejected' ? 'rejected' : 'tx', txErrorText(res.error), res.hash);
    hash = res.hash;
  }
  ctx.onPhase?.('verifying');
  // the tokens are spent from here on: keep the hash until the server has credited it, so a claim
  // that cannot get through now (network, a slow chain, an expired session) is tried again later
  // instead of the player paying a second time
  savePendingClaim({ owner: ctx.owner, kind: pack.kind, txHash: hash, at: Date.now() });
  return settleClaim(ctx.token, ctx.owner, pack.kind, hash);
}

/** A paid pack the server has not credited yet (kept in this browser, per wallet). */
export interface PendingClaim {
  owner: string;
  kind: BoostKind;
  txHash: string;
  at: number;
}

const CLAIM_KEY = 'elymum.shop.claim.v1';
/** Refusals that are final for a payment (it was credited already, or it is not a valid payment). */
const FINAL: readonly string[] = ['tx_used', 'tx_failed', 'no_transfer', 'wrong_token', 'wrong_sender', 'wrong_recipient', 'wrong_amount', 'tx_stale'];

export function savePendingClaim(p: PendingClaim | null): void {
  try {
    if (p) localStorage.setItem(CLAIM_KEY, JSON.stringify(p));
    else localStorage.removeItem(CLAIM_KEY);
  } catch {
    /* storage unavailable: the claim lasts for this page only */
  }
}

/** The pending claim of `owner`, if one is kept. */
export function loadPendingClaim(owner: string | null | undefined): PendingClaim | null {
  if (!owner) return null;
  try {
    const p = JSON.parse(localStorage.getItem(CLAIM_KEY) ?? 'null') as PendingClaim | null;
    return p && typeof p.txHash === 'string' && typeof p.owner === 'string' && p.owner.toLowerCase() === owner.toLowerCase() ? p : null;
  } catch {
    return null;
  }
}

/** Claims a paid pack; the kept hash is dropped once credited or finally refused. */
export async function settleClaim(token: string, owner: string, kind: BoostKind, txHash: string, opts: { retryMs?: readonly number[] } = {}): Promise<ShopBuyResult> {
  try {
    const r = await claimPack(token, kind, txHash, opts);
    if (loadPendingClaim(owner)?.txHash === txHash) savePendingClaim(null);
    return r;
  } catch (e) {
    if (e instanceof ShopError && FINAL.includes(e.code) && loadPendingClaim(owner)?.txHash === txHash) savePendingClaim(null);
    throw e;
  }
}

/** Total charges (the HUD shows the shop button with a count). */
export function totalCharges(c: BoostCounts | null | undefined): number {
  return c ? c.magnet + c.shock + c.speed : 0;
}
