import { PROGRAM_ID, clusterDefaultRpc, normalizeCluster, type Cluster } from '@elymum/sdk';
import { inferCluster } from '@elymum/sdk/ops';
import type { ChainStatus } from '@elymum/shared';
import { CHAIN_OVERRIDES, SERVER } from '../config';
import { DEV_FAKE_PROGRAM_ID } from '../solana/devFakeLoader';
import { PRIORITY_MICRO_LAMPORTS } from '../solana/ticket';

/**
 * Where the admin panel talks to.
 *
 * - **Program id: pinned.** Always the SDK's `PROGRAM_ID`, compiled into the bundle from the IDL
 *   (`pnpm -F @elymum/sdk sync-idl` after `anchor keys sync`). The game server's claim is only
 *   compared with it: a different id blocks signing.
 * - **RPC:** `VITE_RPC_URL`, else the game server's public RPC, else the cluster default.
 * - **Cluster:** read from the RPC's genesis hash (`verifyNetwork`). `VITE_SOLANA_CLUSTER`, else the
 *   server's `SOLANA_CLUSTER`, is only the claim it is checked against.
 * - `VITE_PRIORITY_MICROLAMPORTS`: compute-unit price of admin transactions (default 20000, like
 *   tickets; capped at `MAX_PRIORITY_MICRO_LAMPORTS`).
 */
export interface AdminNetwork {
  rpcUrl: string;
  /** Verified from the genesis hash once `verifyNetwork` ran; before that, the claim (display only). */
  cluster: Cluster;
  /** The pinned program id (SDK `PROGRAM_ID`). */
  programId: string;
  /** The program id the game server reports (null when it reports none). */
  serverProgramId: string | null;
  /** The cluster the build or the game server claims (null when neither says). */
  claimedCluster: Cluster | null;
  /** The game server's signing key (`ChainStatus.serverKey`), null when unknown. */
  serverKey: string | null;
  /** The game server runs the DEV_FAKE_CHAIN stand-in: nothing real to administer. */
  fake: boolean;
  /** Where the RPC came from, for the status card. */
  source: 'env' | 'server' | 'default';
  priorityMicroLamports: number;
}

/** Upper bound of the admin compute-unit price (micro-lamports): 0.04 SOL per 200k-CU instruction at most. */
export const MAX_PRIORITY_MICRO_LAMPORTS = 200_000;

/** Genesis hashes of the public clusters. */
export const GENESIS: Record<string, Cluster> = {
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d': 'mainnet-beta',
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: 'devnet',
  '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY': 'testnet',
};

const env = (name: string): string | null => ((import.meta.env as Record<string, string | undefined>)[name] || '').trim() || null;

export function priorityFromEnv(raw: string | null): number {
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, MAX_PRIORITY_MICRO_LAMPORTS) : PRIORITY_MICRO_LAMPORTS;
}

export function resolveNetwork(chain: ChainStatus | null, vars: { rpcUrl?: string | null; cluster?: string | null; priority?: string | null } = {}): AdminNetwork {
  const envRpc = vars.rpcUrl !== undefined ? vars.rpcUrl : CHAIN_OVERRIDES.rpcUrl;
  const envCluster = vars.cluster !== undefined ? vars.cluster : env('VITE_SOLANA_CLUSTER');
  const serverCluster = chain?.enabled ? chain.cluster : null;
  const claim = envCluster ?? serverCluster;
  const claimedCluster = claim ? normalizeCluster(claim) : null;
  const display = claimedCluster ?? (envRpc ? normalizeCluster(inferCluster(envRpc)) : 'devnet');
  const rpcUrl = envRpc ?? (chain?.enabled ? chain.rpcUrl : null) ?? clusterDefaultRpc(display);
  const serverProgramId = chain?.enabled ? chain.programId : null;
  return {
    rpcUrl,
    cluster: display,
    programId: PROGRAM_ID.toBase58(),
    serverProgramId,
    claimedCluster,
    serverKey: chain?.serverKey ?? null,
    fake: serverProgramId === DEV_FAKE_PROGRAM_ID,
    source: envRpc ? 'env' : chain?.enabled && chain.rpcUrl ? 'server' : 'default',
    priorityMicroLamports: priorityFromEnv(vars.priority !== undefined ? vars.priority : env('VITE_PRIORITY_MICROLAMPORTS')),
  };
}

const isLocalRpc = (url: string): boolean => {
  try {
    return ['127.0.0.1', 'localhost', '[::1]', '0.0.0.0'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

export interface NetworkCheck {
  /** The network with `cluster` set from the genesis hash (or localnet for a local validator). */
  net: AdminNetwork;
  /** The cluster was read from the genesis hash (labels and the mainnet banner may be trusted). */
  verified: boolean;
  /** Why signing is blocked; empty = signing allowed. */
  blockers: string[];
}

/**
 * Checks the network before anything is signed:
 * - the game server's program id must equal the pinned one;
 * - the RPC's genesis hash must be a known cluster (a validator on this machine counts as localnet
 *   when localnet is claimed) and match the claimed cluster.
 * `genesisHash`: undefined while it is being read, null when it could not be read.
 */
export function verifyNetwork(net: AdminNetwork, genesisHash: string | null | undefined): NetworkCheck {
  const blockers: string[] = [];
  if (net.serverProgramId && net.serverProgramId !== net.programId) {
    blockers.push(`The game server reports program ${net.serverProgramId}, but this build is pinned to ${net.programId}. Signing is blocked.`);
  }
  let cluster: Cluster | null = null;
  if (genesisHash === undefined) {
    blockers.push('Checking the cluster (genesis hash)…');
  } else if (genesisHash === null) {
    blockers.push(`Cannot read the genesis hash from ${net.rpcUrl}. Signing is blocked.`);
  } else if (GENESIS[genesisHash]) {
    cluster = GENESIS[genesisHash];
  } else if (net.claimedCluster === 'localnet' && isLocalRpc(net.rpcUrl)) {
    cluster = 'localnet';
  } else {
    blockers.push(`Unknown genesis hash ${genesisHash} at ${net.rpcUrl}: not mainnet-beta, devnet or testnet. Signing is blocked.`);
  }
  if (cluster && net.claimedCluster && cluster !== net.claimedCluster) {
    blockers.push(`The RPC is ${cluster} (genesis hash), but the configuration claims ${net.claimedCluster}. Fix SOLANA_CLUSTER on the server or VITE_SOLANA_CLUSTER. Signing is blocked.`);
  }
  return { net: { ...net, cluster: cluster ?? net.cluster }, verified: cluster !== null, blockers };
}

/** The game server's chain status (null when the server cannot be reached). */
export async function fetchServerChain(timeoutMs = 4000): Promise<ChainStatus | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SERVER.http}/api/config`, { signal: ctrl.signal });
    if (!res.ok) return null;
    return ((await res.json()) as { chain?: ChainStatus }).chain ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const isMainnet = (net: Pick<AdminNetwork, 'cluster'>): boolean => net.cluster === 'mainnet-beta';

/** Upper bound of the fee of a transaction with `instructions` (besides compute budget): base fee + priority at the default 200k CU limit each. */
export function maxFeeLamports(instructions: number, priorityMicroLamports: number): number {
  return 5_000 + Math.ceil((priorityMicroLamports * 200_000 * instructions) / 1_000_000);
}
