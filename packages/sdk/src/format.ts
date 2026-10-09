import type { IntLike } from './math';

export const LAMPORTS_PER_SOL = 1_000_000_000;

export type Cluster = 'mainnet-beta' | 'devnet' | 'testnet' | 'localnet';

/** Accepts common spellings ("mainnet", "localhost", …); anything unknown is treated as localnet. */
export function normalizeCluster(cluster: string | null | undefined): Cluster {
  switch ((cluster ?? '').trim().toLowerCase()) {
    case 'mainnet':
    case 'mainnet-beta':
      return 'mainnet-beta';
    case 'devnet':
      return 'devnet';
    case 'testnet':
      return 'testnet';
    default:
      return 'localnet';
  }
}

/** Lamports → SOL as a JS number (display only). */
export function lamportsToSol(lamports: IntLike): number {
  return Number(typeof lamports === 'number' ? lamports : lamports.toString()) / LAMPORTS_PER_SOL;
}

/**
 * SOL → lamports without floating point drift (`0.29` → 290 000 000, not 289 999 999).
 * Accepts numbers or decimal strings; more than 9 decimals are rounded to the nearest lamport.
 */
export function solToLamports(sol: number | string): number {
  const n = typeof sol === 'string' ? Number(sol.trim()) : sol;
  if (typeof sol === 'string' && !/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(sol.trim())) {
    throw new RangeError(`invalid SOL amount: ${JSON.stringify(sol)}`);
  }
  if (!Number.isFinite(n)) throw new RangeError(`invalid SOL amount: ${sol}`);
  const negative = n < 0;
  // toFixed(9) rounds the exact binary value to 9 decimals (0.29 → "0.290000000").
  const [whole, frac = ''] = Math.abs(n).toFixed(9).split('.');
  const lamports = Number(whole) * LAMPORTS_PER_SOL + Number(frac.padEnd(9, '0'));
  if (!Number.isSafeInteger(lamports)) throw new RangeError(`SOL amount out of range: ${sol}`);
  return negative && lamports !== 0 ? -lamports : lamports;
}

const LOCAL_RPC = 'http://localhost:8899';

function explorerUrl(kind: 'tx' | 'address', value: string, cluster: string, customRpcUrl: string): string {
  const c = normalizeCluster(cluster);
  if (c === 'localnet') {
    return `https://explorer.solana.com/${kind}/${value}?cluster=custom&customUrl=${encodeURIComponent(customRpcUrl)}`;
  }
  const path = kind === 'tx' ? 'tx' : 'account';
  const query = c === 'mainnet-beta' ? '' : `?cluster=${c}`;
  return `https://solscan.io/${path}/${value}${query}`;
}

/** Link to a transaction: Solscan on mainnet/devnet/testnet, explorer.solana.com with a custom RPC on localnet. */
export function explorerTxUrl(signature: string, cluster: string, customRpcUrl: string = LOCAL_RPC): string {
  return explorerUrl('tx', signature, cluster, customRpcUrl);
}

/** Link to an account (see `explorerTxUrl`). */
export function explorerAddressUrl(address: string, cluster: string, customRpcUrl: string = LOCAL_RPC): string {
  return explorerUrl('address', address, cluster, customRpcUrl);
}

/** Public RPC endpoint of a cluster (localnet → the default solana-test-validator port). */
export function clusterDefaultRpc(cluster: string): string {
  switch (normalizeCluster(cluster)) {
    case 'mainnet-beta':
      return 'https://api.mainnet-beta.solana.com';
    case 'devnet':
      return 'https://api.devnet.solana.com';
    case 'testnet':
      return 'https://api.testnet.solana.com';
    default:
      return 'http://127.0.0.1:8899';
  }
}

/** `9xQe…3fTr` style shortening for UI. */
export function shortAddress(address: string, chars = 4): string {
  return address.length <= chars * 2 + 1 ? address : `${address.slice(0, chars)}…${address.slice(-chars)}`;
}
