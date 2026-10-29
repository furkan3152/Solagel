import { addEthereumChainParams, chainInfo, isMainnet, toHexChainId, type ChainInfo, type ChainStatus } from '@elymum/shared';
import { createElymumPublicClient, createElymumWalletClient, describeError, toViemChain } from '@elymum/sdk';
import type { Address, Chain, PublicClient, WalletClient } from 'viem';
import { CHAIN_OVERRIDES, SERVER } from '../config';
import type { Eip1193Provider } from './eip6963';
import { parseChainId, useWallet } from './store';

/**
 * The chain the game server is on (its RPC is the source of truth): a wallet is asked to switch
 * to exactly that chain, or to add it (`wallet_addEthereumChain`) when it does not know it. The
 * web never assumes a chain id.
 */

/** What the server says about its chain (a `ChainStatus`, or the fields of one). */
export type ServerChain = Pick<ChainStatus, 'chainId' | 'chainName' | 'rpcUrl' | 'explorerUrl'>;

/** `chainInfo` for the server's chain (null while the chain is off or unknown). */
export function serverChainInfo(chain: ServerChain | null | undefined): ChainInfo | null {
  if (!chain || chain.chainId === null || chain.chainId === undefined) return null;
  try {
    return chainInfo(chain.chainId, { name: chain.chainName || null, rpcUrl: CHAIN_OVERRIDES.rpcUrl ?? chain.rpcUrl, explorerUrl: chain.explorerUrl });
  } catch {
    return null;
  }
}

/** viem `Chain` for the server's chain. */
export function serverViemChain(chain: ServerChain | null | undefined): Chain | null {
  const info = serverChainInfo(chain);
  return info ? toViemChain(info) : null;
}

export const isMainnetChain = (chain: ServerChain | null | undefined): boolean => chain?.chainId != null && isMainnet(chain.chainId);

/** The chain switch failed (or the wallet ended on another chain). */
export class WrongChainError extends Error {
  override name = 'WrongChainError';
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}

async function walletChainId(p: Eip1193Provider): Promise<number | null> {
  return parseChainId(await p.request({ method: 'eth_chainId' }));
}

/**
 * Makes the wallet use the server's chain: `wallet_switchEthereumChain`; when the wallet does
 * not know it (4902), `wallet_addEthereumChain` with the server's RPC and explorer, then a
 * switch again for wallets that add without switching. Resolves when the wallet is on it;
 * rejects with the wallet's error (a decline stays a decline) or a `WrongChainError`.
 */
export async function ensureChain(provider: Eip1193Provider, chain: ServerChain): Promise<void> {
  const info = serverChainInfo(chain);
  if (!info) throw new WrongChainError('The game server reports no chain yet.');
  const target = info.id;
  if ((await walletChainId(provider)) === target) return;
  const hex = toHexChainId(target);
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch (err) {
    if (describeError(err).kind !== 'chain-not-added') throw err;
    const params = addEthereumChainParams(info);
    if (!params) throw new WrongChainError(`Your wallet does not know ${info.name} and the server publishes no public RPC for it. Add the network in your wallet by hand.`, err);
    await provider.request({ method: 'wallet_addEthereumChain', params: [params] });
    if ((await walletChainId(provider)) !== target) {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
    }
  }
  const now = await walletChainId(provider);
  if (now !== target) throw new WrongChainError(`Your wallet is still on another network. Switch to ${info.name} and try again.`);
  if (useWallet.getState().current?.provider === provider) useWallet.setState({ chainId: now });
}

/* ── clients ────────────────────────────────────────────────────────── */

let publicCache: { key: string; client: PublicClient } | null = null;

/**
 * A read client for the server's chain: the server's public RPC (or `VITE_RPC_URL`), else the
 * wallet's own provider. Null when there is neither.
 */
export function publicClientFor(chain: ServerChain | null | undefined, provider?: Eip1193Provider | null): PublicClient | null {
  const viemChain = serverViemChain(chain);
  if (!viemChain) return null;
  const rpc = CHAIN_OVERRIDES.rpcUrl ?? chain?.rpcUrl ?? null;
  if (rpc) {
    const key = `${viemChain.id}|${rpc}`;
    if (publicCache?.key !== key) publicCache = { key, client: createElymumPublicClient(rpc, viemChain, { pollingInterval: 1_000 }) };
    return publicCache.client;
  }
  if (provider) return createElymumPublicClient(provider, viemChain, { pollingInterval: 1_000 });
  return null;
}

/** A signing client on the wallet's provider for `address` on the server's chain. */
export function walletClientFor(provider: Eip1193Provider, address: Address, chain: ServerChain): WalletClient {
  const viemChain = serverViemChain(chain);
  if (!viemChain) throw new WrongChainError('The game server reports no chain yet.');
  return createElymumWalletClient(provider, { account: address, chain: viemChain, pollingInterval: 1_000 });
}

/* ── the server's chain status for pages without the game store ────── */

let serverChainCache: Promise<ChainStatus | null> | null = null;

/** `GET /api/config` → `chain` (null when the server cannot be reached). Cached per page unless `fresh`. */
export function fetchServerChain(opts: { fresh?: boolean; timeoutMs?: number } = {}): Promise<ChainStatus | null> {
  if (serverChainCache && !opts.fresh) return serverChainCache;
  const run = async (): Promise<ChainStatus | null> => {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 6000) : null;
    try {
      const res = await fetch(`${SERVER.http}/api/config`, ctrl ? { signal: ctrl.signal } : undefined);
      if (!res.ok) return null;
      return ((await res.json()) as { chain?: ChainStatus }).chain ?? null;
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const p = run();
  serverChainCache = p;
  void p.then((c) => {
    if (c === null && serverChainCache === p) serverChainCache = null;
  });
  return p;
}

/** For tests. */
export function resetServerChain(): void {
  serverChainCache = null;
}
