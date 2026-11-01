import type { BoostCounts, BoostKind, ChainStatus, ShopBuyError, ShopBuyResult, ShopPack, ShopView } from '@elymum/shared';
import { erc20Abi, type Address, type Hash } from 'viem';
import { SERVER } from '../config';
import { isDevFake, loadDevFake } from './devFakeLoader';
import { sendWithWallet, txErrorText, type TxPhase } from './tx';

/**
 * The power-up shop, client side: read the packs priced for the signed-in wallet, pay a pack with an
 * ERC-20 `transfer` of exactly its price to the shop's sink (the burn address or the treasury), then
 * hand the transaction hash to the server, which checks the receipt and credits the charges.
 */

/** `GET /api/shop` (with the session token when signed in: holder prices and the wallet's charges). */
export async function fetchShop(token: string | null, signal?: AbortSignal): Promise<ShopView> {
  const res = await fetch(`${SERVER.http}/api/shop`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal });
  if (!res.ok) throw new Error(res.status === 404 ? 'The shop is not available on this server.' : 'Cannot load the shop right now.');
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
      last = new ShopError('network', 'Cannot reach the server right now.', txHash);
      continue;
    }
    const body = (await res.json().catch(() => null)) as (ShopBuyResult & { error?: undefined }) | { error?: ShopBuyError; message?: string } | null;
    if (res.ok && body && 'ok' in body) return body;
    const code = (body && 'error' in body && body.error) || 'bad_request';
    last = new ShopError(code, (body && 'message' in body && body.message) || (res.status === 401 ? 'Your sign-in expired. Verify your wallet again.' : 'The purchase was not accepted.'), txHash);
    // only "not visible yet" and a busy chain are worth another look
    if (code !== 'tx_pending' && code !== 'chain_busy' && code !== ('network' as ShopBuyError)) break;
  }
  throw last ?? new ShopError('bad_request', 'The purchase was not accepted.', txHash);
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
  if (!view.open || !view.token || !view.sink) throw new ShopError('shop_closed', 'The shop is closed right now.');
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
  return claimPack(ctx.token, pack.kind, hash);
}

/** Total charges (the HUD shows the shop button with a count). */
export function totalCharges(c: BoostCounts | null | undefined): number {
  return c ? c.magnet + c.shock + c.speed : 0;
}
