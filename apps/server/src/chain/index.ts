import type { ServerConfig } from '../config';
import type { Journal } from '../stake/journal';
import { NullChain, type ChainGateway } from './types';

/**
 * Picks the Solana-backed gateway when PROGRAM_ID, SOLANA_RPC_URL and
 * SERVER_KEYPAIR are configured; otherwise free play runs without a chain.
 */
export async function createChain(cfg: ServerConfig, journal: Journal, log: (m: string) => void): Promise<ChainGateway> {
  if (cfg.devFakeChain) {
    // dev-only: never let a fake chain (free tickets, fake payouts) reach production
    if (cfg.production) throw new Error('DEV_FAKE_CHAIN=1 is refused when NODE_ENV=production');
    const { DevFakeChain } = await import('./dev-fake');
    log('chain: DEV_FAKE_CHAIN=1 — in-memory fake chain (free arena tickets, simulated settlements). Development only!');
    return new DevFakeChain(journal, log);
  }
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
