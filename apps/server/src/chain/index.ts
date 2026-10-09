import type { ServerConfig } from '../config';
import type { Journal } from '../stake/journal';
import { NullChain, type ChainGateway } from './types';

/**
 * Picks the Solana-backed gateway when PROGRAM_ID, SOLANA_RPC_URL and
 * SERVER_KEYPAIR are configured; otherwise free play runs without a chain.
 */
export async function createChain(cfg: ServerConfig, journal: Journal, log: (m: string) => void): Promise<ChainGateway> {
  const { programId, rpcUrl, serverKeypair, cluster } = cfg.chain;
  if (!programId || !rpcUrl || !serverKeypair) {
    log('chain: disabled (set PROGRAM_ID, SOLANA_RPC_URL and SERVER_KEYPAIR to enable on-chain features)');
    return new NullChain(cluster);
  }
  try {
    const { SolanaChain } = await import('./solana');
    const chain = new SolanaChain(cfg, journal, log);
    return chain;
  } catch (err) {
    log(`chain: failed to initialise (${(err as Error).message}); running without chain`);
    return new NullChain(cluster);
  }
}
