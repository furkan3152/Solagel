import type { ServerConfig } from '../config';
import type { Journal } from '../stake/journal';
import type { ContractsView } from './evm';
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
  const real = [cfg.chain.rpcUrl && 'EVM_RPC_URL', cfg.chain.serverKey && 'SERVER_PRIVATE_KEY'].filter(Boolean);
  if (real.length > 0) {
    throw new Error(`DEV_FAKE_CHAIN=1 cannot run with a real chain configured (${real.join(', ')} set); unset them or drop DEV_FAKE_CHAIN`);
  }
}

/** Journal / leaderboard file names: the fake chain keeps its own, so it never touches real money records. */
export function dataFileNames(cfg: ServerConfig): { journal: string; leaderboards: string; profiles: string; boosts: string } {
  return cfg.devFakeChain
    ? { journal: 'journal.dev-fake.json', leaderboards: 'leaderboards.dev-fake.json', profiles: 'profiles.dev-fake.json', boosts: 'boosts.dev-fake.json' }
    : { journal: 'journal.json', leaderboards: 'leaderboards.json', profiles: 'profiles.json', boosts: 'boosts.json' };
}

/**
 * Picks the EVM gateway when `EVM_RPC_URL` and `SERVER_PRIVATE_KEY` are configured; the contract
 * addresses may come later from the registry (the gateway then waits for contracts, practice only).
 * Otherwise the game runs practice only, without a chain.
 */
export async function createChain(
  cfg: ServerConfig,
  journal: Journal,
  log: (m: string) => void,
  opts: { contracts?: () => ContractsView; stateChainId?: number | null; cacheDir?: string | null } = {},
): Promise<ChainGateway> {
  if (cfg.devFakeChain) {
    assertDevFakeChainAllowed(cfg);
    const { DevFakeChain } = await import('./dev-fake');
    log(
      `chain: DEV_FAKE_CHAIN=1 — in-memory fake chain (free arena tickets, simulated settlements, token ${cfg.devFakeToken ? 'set' : 'not set: POST /api/dev/token sets it'}). Development only!`,
    );
    return new DevFakeChain(journal, log, undefined, { tokenSet: cfg.devFakeToken });
  }
  const { rpcUrl, serverKey, chainName } = cfg.chain;
  if (!rpcUrl || !serverKey) {
    log('chain: off (set EVM_RPC_URL and SERVER_PRIVATE_KEY to enable the arenas and the mint) — practice only');
    return new NullChain(chainName ?? undefined);
  }
  try {
    const { EvmChain } = await import('./evm');
    return new EvmChain(cfg, journal, log, {
      contracts: opts.contracts,
      cacheDir: opts.cacheDir ?? null,
      ...(opts.stateChainId !== undefined ? { stateChainId: opts.stateChainId } : {}),
    });
  } catch (err) {
    log(`chain: failed to initialise (${(err as Error).message}); running without chain`);
    return new NullChain(chainName ?? undefined);
  }
}
