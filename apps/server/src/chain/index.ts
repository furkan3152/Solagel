import type { ServerConfig } from '../config';
import type { Journal } from '../stake/journal';
import { NullChain, type ChainGateway } from './types';

/**
 * `DEV_FAKE_CHAIN=1` guard: the fake chain hands out free tickets and fake
 * payouts, so it runs only with an explicit `NODE_ENV=development` and never
 * next to a real chain configuration. Throws with the reason otherwise.
 */
export function assertDevFakeChainAllowed(cfg: ServerConfig): void {
  if (!cfg.devFakeChain) return;
  if (cfg.nodeEnv !== 'development') {
    throw new Error(`DEV_FAKE_CHAIN=1 needs NODE_ENV=development (NODE_ENV is ${cfg.nodeEnv ?? 'unset'}); refusing to start`);
  }
  const real = [cfg.chain.programId && 'PROGRAM_ID', cfg.chain.serverKeypair && 'SERVER_KEYPAIR'].filter(Boolean);
  if (real.length > 0) {
    throw new Error(`DEV_FAKE_CHAIN=1 cannot run with a real chain configured (${real.join(', ')} set); unset them or drop DEV_FAKE_CHAIN`);
  }
}

/** Journal / leaderboard file names: the fake chain keeps its own, so it never touches real money records. */
export function dataFileNames(cfg: ServerConfig): { journal: string; leaderboards: string } {
  return cfg.devFakeChain
    ? { journal: 'journal.dev-fake.json', leaderboards: 'leaderboards.dev-fake.json' }
    : { journal: 'journal.json', leaderboards: 'leaderboards.json' };
}

/**
 * Picks the Solana-backed gateway when PROGRAM_ID, SOLANA_RPC_URL and
 * SERVER_KEYPAIR are configured; otherwise free play runs without a chain.
 */
export async function createChain(cfg: ServerConfig, journal: Journal, log: (m: string) => void): Promise<ChainGateway> {
  if (cfg.devFakeChain) {
    assertDevFakeChainAllowed(cfg);
    const { DevFakeChain } = await import('./dev-fake');
    log(`chain: DEV_FAKE_CHAIN=1 — in-memory fake chain (free arena tickets, simulated settlements, Pass ${cfg.devFakePass === 'revealed' ? 'revealed' : 'mint open'}). Development only!`);
    return new DevFakeChain(journal, log, undefined, cfg.devFakePass);
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
