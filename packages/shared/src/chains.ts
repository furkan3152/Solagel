/**
 * The only table of chains Elymum runs on (Elysium, Kinetiq's Arbitrum Orbit L2 with HYPE as gas).
 *
 * The server's RPC is the source of truth: the server reads `eth_chainId` from `EVM_RPC_URL` and
 * publishes `{ chainId, name, rpcUrl, explorerUrl }`; `chainInfo` fills in what it knows about that
 * id. Mainnet details are published at launch, so `elysium` has no fixed id or RPC here: any id
 * that is not the testnet or the localnet is treated as mainnet.
 *
 * Do not use viem's built-in `elysiumTestnet`: it is an unrelated chain (id 1338).
 * Plain data, no dependencies.
 */

export type ChainKey = 'elysium-testnet' | 'elysium' | 'localnet';

export interface NativeCurrency {
  name: string;
  symbol: string;
  decimals: number;
}

/** The gas token on every Elysium chain. */
export const HYPE: Readonly<NativeCurrency> = Object.freeze({ name: 'HYPE', symbol: 'HYPE', decimals: 18 });

export const ELYSIUM_TESTNET_CHAIN_ID = 99801;
export const LOCALNET_CHAIN_ID = 31337;
/** Display name for a chain id the table does not know (server `CHAIN_NAME` overrides it). */
export const CHAIN_NAME_DEFAULT = 'Elysium';

export interface ChainDef {
  key: ChainKey;
  /** Null when the id comes from the RPC (`elysium`, mainnet). */
  id: number | null;
  name: string;
  /** Public RPC; null when there is no public default. */
  rpcUrl: string | null;
  /** Blockscout-style explorer base URL (no trailing slash); null when there is none. */
  explorerUrl: string | null;
  testnet: boolean;
}

export const CHAINS: readonly ChainDef[] = Object.freeze([
  {
    key: 'elysium-testnet',
    id: ELYSIUM_TESTNET_CHAIN_ID,
    name: 'Elysium Testnet',
    rpcUrl: 'https://testnet-rpc.elysium.kinetiq.xyz',
    explorerUrl: 'https://explorer-elysium-testnet.t.conduit.xyz',
    testnet: true,
  },
  { key: 'elysium', id: null, name: CHAIN_NAME_DEFAULT, rpcUrl: null, explorerUrl: null, testnet: false },
  { key: 'localnet', id: LOCALNET_CHAIN_ID, name: 'Localnet', rpcUrl: 'http://127.0.0.1:8545', explorerUrl: null, testnet: true },
] as const satisfies readonly ChainDef[]);

/** A chain resolved for one chain id. */
export interface ChainInfo {
  key: ChainKey;
  id: number;
  name: string;
  rpcUrl: string | null;
  explorerUrl: string | null;
  nativeCurrency: NativeCurrency;
  testnet: boolean;
}

/** Values the server's environment sets (`CHAIN_NAME`, `PUBLIC_RPC_URL`, `EXPLORER_URL`); `undefined` keeps the table's. */
export interface ChainOverrides {
  name?: string | null;
  rpcUrl?: string | null;
  explorerUrl?: string | null;
}

export function isChainId(id: unknown): id is number {
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0;
}

export function chainByKey(key: ChainKey): ChainDef {
  const def = CHAINS.find((c) => c.key === key);
  if (!def) throw new RangeError(`unknown chain key ${key}`);
  return def;
}

/** The chain key of an id: the testnet, the localnet, else `elysium` (mainnet). */
export function chainKeyOf(chainId: number): ChainKey {
  if (chainId === ELYSIUM_TESTNET_CHAIN_ID) return 'elysium-testnet';
  if (chainId === LOCALNET_CHAIN_ID) return 'localnet';
  return 'elysium';
}

/** True for every chain id that is not the Elysium testnet or the localnet. */
export function isMainnet(chainId: number): boolean {
  return chainKeyOf(chainId) === 'elysium';
}

const trimSlash = (url: string): string => url.replace(/\/+$/, '');
const blankToNull = (s: string | null | undefined): string | null => (s == null || s.trim() === '' ? null : s.trim());

/** Everything known about `chainId`, with the server's overrides applied. Throws on a malformed id. */
export function chainInfo(chainId: number, overrides: ChainOverrides = {}): ChainInfo {
  if (!isChainId(chainId)) throw new RangeError(`invalid chain id ${chainId}`);
  const def = chainByKey(chainKeyOf(chainId));
  const name = blankToNull(overrides.name) ?? def.name;
  const rpcUrl = overrides.rpcUrl !== undefined ? blankToNull(overrides.rpcUrl) : def.rpcUrl;
  const explorer = overrides.explorerUrl !== undefined ? blankToNull(overrides.explorerUrl) : def.explorerUrl;
  return {
    key: def.key,
    id: chainId,
    name,
    rpcUrl,
    explorerUrl: explorer === null ? null : trimSlash(explorer),
    nativeCurrency: { ...HYPE },
    testnet: def.testnet,
  };
}

/** `0x`-prefixed hex chain id, as `wallet_switchEthereumChain` wants it. */
export function toHexChainId(chainId: number): `0x${string}` {
  if (!isChainId(chainId)) throw new RangeError(`invalid chain id ${chainId}`);
  return `0x${chainId.toString(16)}`;
}

/** EIP-3085 `wallet_addEthereumChain` parameters for a chain (null when it has no RPC to hand the wallet). */
export function addEthereumChainParams(info: ChainInfo): {
  chainId: `0x${string}`;
  chainName: string;
  nativeCurrency: NativeCurrency;
  rpcUrls: string[];
  blockExplorerUrls?: string[];
} | null {
  if (!info.rpcUrl) return null;
  return {
    chainId: toHexChainId(info.id),
    chainName: info.name,
    nativeCurrency: { ...info.nativeCurrency },
    rpcUrls: [info.rpcUrl],
    ...(info.explorerUrl ? { blockExplorerUrls: [info.explorerUrl] } : {}),
  };
}

/** `${explorerUrl}/tx/<hash>`, or null without an explorer. */
export function explorerTxUrl(explorerUrl: string | null | undefined, txHash: string): string | null {
  return explorerUrl ? `${trimSlash(explorerUrl)}/tx/${txHash}` : null;
}

/** `${explorerUrl}/address/<address>`, or null without an explorer. */
export function explorerAddressUrl(explorerUrl: string | null | undefined, address: string): string | null {
  return explorerUrl ? `${trimSlash(explorerUrl)}/address/${address}` : null;
}
