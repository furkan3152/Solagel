import { chainInfo, isMainnet, type ChainInfo, type ChainOverrides } from '@elymum/shared';
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  keccak256,
  type Account,
  type Address,
  type Chain,
  type EIP1193Provider,
  type Hash,
  type PublicClient,
  type Transport,
  type WalletClient,
} from 'viem';

/**
 * Chains and clients. The chain table lives in `@elymum/shared` (`chains.ts`); this module turns
 * an entry into a viem `Chain` and builds clients from an RPC URL or an EIP-1193 provider (a
 * browser wallet). Do not use viem's built-in `elysiumTestnet`: it is an unrelated chain.
 */

/** Where a client talks to: an HTTP(S) RPC URL or an EIP-1193 provider (`window.ethereum`, EIP-6963). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RpcSource = string | EIP1193Provider | { request: (args: { method: string; params?: any }) => Promise<any> };

/** viem `Chain` for a resolved chain (`chainInfo(id, overrides)` from `@elymum/shared`). */
export function toViemChain(info: ChainInfo): Chain {
  return defineChain({
    id: info.id,
    name: info.name,
    nativeCurrency: { ...info.nativeCurrency },
    rpcUrls: { default: { http: info.rpcUrl ? [info.rpcUrl] : [] } },
    ...(info.explorerUrl ? { blockExplorers: { default: { name: `${info.name} explorer`, url: info.explorerUrl } } } : {}),
    testnet: info.testnet,
  });
}

/** viem `Chain` for a chain id (the testnet, the localnet, or Elysium mainnet with the server's overrides). */
export function elysiumChain(chainId: number, overrides: ChainOverrides = {}): Chain {
  return toViemChain(chainInfo(chainId, overrides));
}

/** viem transport for an RPC URL or an EIP-1193 provider. */
export function toTransport(source: RpcSource): Transport {
  if (typeof source === 'string') {
    if (!/^https?:\/\//i.test(source)) throw new TypeError(`RPC URL must start with http:// or https://, got ${JSON.stringify(source)}`);
    return http(source);
  }
  if (!source || typeof source.request !== 'function') throw new TypeError('expected an RPC URL or an EIP-1193 provider');
  return custom(source as EIP1193Provider);
}

/** Read-only client. Without `chain`, chain-aware helpers read `eth_chainId` themselves. */
export function createElymumPublicClient(source: RpcSource, chain?: Chain, opts: { pollingInterval?: number } = {}): PublicClient {
  return createPublicClient({ chain, transport: toTransport(source), ...(opts.pollingInterval ? { pollingInterval: opts.pollingInterval } : {}) }) as PublicClient;
}

/**
 * Signing client. `account` is a local account (`privateKeyToAccount`, the CLI and the server) or
 * a JSON-RPC account address (a browser wallet: pass the provider as `source`).
 */
export function createElymumWalletClient(source: RpcSource, opts: { account: Account | Address; chain: Chain; pollingInterval?: number }): WalletClient {
  return createWalletClient({ account: opts.account, chain: opts.chain, transport: toTransport(source), ...(opts.pollingInterval ? { pollingInterval: opts.pollingInterval } : {}) });
}

/** Reads `eth_chainId` and returns the matching viem chain (the server's RPC is the source of truth). */
export async function resolveChain(client: Pick<PublicClient, 'getChainId'>, overrides: ChainOverrides = {}): Promise<Chain> {
  return elysiumChain(await client.getChainId(), overrides);
}

/** True when the chain id is Elysium mainnet (anything that is not the testnet or the localnet). */
export function isMainnetChain(chainId: number): boolean {
  return isMainnet(chainId);
}

/** keccak256 of the code at `address` (null when there is none). Compare with an artifact's `runtimeCodeHash`. */
export async function getCodeHash(client: Pick<PublicClient, 'getCode'>, address: Address): Promise<Hash | null> {
  const code = await client.getCode({ address });
  return code && code !== '0x' ? keccak256(code) : null;
}

/** Throws unless the receipt of `hash` succeeded; returns it. */
export async function waitForSuccess(client: Pick<PublicClient, 'waitForTransactionReceipt'>, hash: Hash) {
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`transaction ${hash} reverted`);
  return receipt;
}
