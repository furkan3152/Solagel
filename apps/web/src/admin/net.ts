import { PROGRAM_ID, clusterDefaultRpc, normalizeCluster, type Cluster } from '@slana/sdk';
import { inferCluster } from '@slana/sdk/ops';
import type { ChainStatus } from '@slana/shared';
import { CHAIN_OVERRIDES, SERVER } from '../config';
import { DEV_FAKE_PROGRAM_ID } from '../solana/devFakeLoader';
import { PRIORITY_MICRO_LAMPORTS } from '../solana/ticket';

/**
 * Where the admin panel talks to. Each value comes from the build environment first, then from
 * the game server's `/api/config` (the same chain status the lobby follows), then from the SDK:
 *
 *   VITE_RPC_URL                  RPC endpoint (shared with the game; may be a paid RPC)
 *   VITE_PROGRAM_ID               program id (default: the server's, else the SDK IDL address)
 *   VITE_SOLANA_CLUSTER           mainnet-beta | devnet | testnet | localnet (explorer links, mainnet banner)
 *   VITE_PRIORITY_MICROLAMPORTS   compute-unit price of admin transactions (default 20000, like tickets)
 */
export interface AdminNetwork {
  rpcUrl: string;
  cluster: Cluster;
  programId: string;
  /** The game server's signing key (`ChainStatus.serverKey`), null when unknown. */
  serverKey: string | null;
  /** The game server runs the DEV_FAKE_CHAIN stand-in: nothing real to administer. */
  fake: boolean;
  /** Where the settings came from, for the status card. */
  source: 'env' | 'server' | 'default';
  priorityMicroLamports: number;
}

const env = (name: string): string | null => ((import.meta.env as Record<string, string | undefined>)[name] || '').trim() || null;

function priority(): number {
  const raw = env('VITE_PRIORITY_MICROLAMPORTS');
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : PRIORITY_MICRO_LAMPORTS;
}

export function resolveNetwork(chain: ChainStatus | null): AdminNetwork {
  const envRpc = CHAIN_OVERRIDES.rpcUrl;
  const envProgram = env('VITE_PROGRAM_ID');
  const envCluster = env('VITE_SOLANA_CLUSTER');
  const serverCluster = chain?.enabled ? chain.cluster : null;
  const cluster = normalizeCluster(envCluster ?? serverCluster ?? (envRpc ? inferCluster(envRpc) : 'devnet'));
  const rpcUrl = envRpc ?? (chain?.enabled ? chain.rpcUrl : null) ?? clusterDefaultRpc(cluster);
  const programId = envProgram ?? (chain?.enabled ? chain.programId : null) ?? PROGRAM_ID.toBase58();
  return {
    rpcUrl,
    cluster,
    programId,
    serverKey: chain?.serverKey ?? null,
    fake: programId === DEV_FAKE_PROGRAM_ID,
    source: envRpc || envProgram || envCluster ? 'env' : chain?.enabled ? 'server' : 'default',
    priorityMicroLamports: priority(),
  };
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
