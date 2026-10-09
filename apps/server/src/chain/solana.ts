import type { ServerConfig } from '../config';
import type { Journal } from '../stake/journal';
import { NullChain } from './types';

/** Placeholder until the Solana gateway is implemented (see chain/solana.ts in the next commit). */
export class SolanaChain extends NullChain {
  constructor(cfg: ServerConfig, _journal: Journal, log: (m: string) => void) {
    super(cfg.chain.cluster);
    log('chain: Solana gateway not implemented yet — running free play only');
  }
}
