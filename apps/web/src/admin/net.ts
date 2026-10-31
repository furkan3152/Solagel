import { isMainnet, type ChainInfo, type ChainStatus } from '@elymum/shared';
import { getAddress, isAddress, type Address } from 'viem';
import { isDevFake } from '../wallet/devFakeLoader';
import { fetchServerChain, serverChainInfo } from '../wallet/network';

/**
 * Where the admin panel talks to: exactly the chain the game server is on (its RPC is the
 * source of truth, published in `/api/config`). There is no pinned program id any more: the
 * contracts are pinned by their runtime code hash, which the server checks when an address is
 * registered and the panel shows (`checkDeployedCode`).
 */
export interface AdminNetwork {
  /** The server's chain status (null when the server cannot be reached). */
  chain: ChainStatus | null;
  /** `chainInfo` of the server's chain (null while it is off or unknown). */
  info: ChainInfo | null;
  /** Elysium mainnet (every chain id that is not the testnet or the localnet). */
  mainnet: boolean;
  /** The game server's signing key (`ChainStatus.serverKey`), null when unknown. */
  serverKey: Address | null;
  /** The registered contracts (null until registered). */
  arenaAddress: Address | null;
  nftAddress: Address | null;
  /** The game server runs the DEV_FAKE_CHAIN stand-in: nothing real to administer. */
  fake: boolean;
}

const addr = (v: string | null | undefined): Address | null => (v && isAddress(v, { strict: false }) ? getAddress(v) : null);

export function resolveNetwork(chain: ChainStatus | null): AdminNetwork {
  const info = chain?.enabled ? serverChainInfo(chain) : null;
  return {
    chain,
    info,
    mainnet: info ? isMainnet(info.id) : false,
    serverKey: addr(chain?.serverKey),
    arenaAddress: addr(chain?.arenaAddress),
    nftAddress: addr(chain?.nftAddress),
    fake: isDevFake(chain),
  };
}

export { fetchServerChain };

/**
 * Why signing is blocked before the wallet is even asked (empty = allowed): the server must
 * publish a chain, the RPC the panel reads must be on that same chain, and a fake chain has
 * nothing to sign. The wallet's own chain is not a blocker: it is switched (or the chain added)
 * right before each prompt, and a wallet that ends elsewhere is refused there.
 */
export function chainBlockers(net: AdminNetwork, rpcChainId: number | null | undefined): string[] {
  const out: string[] = [];
  if (net.fake) out.push('The game server runs the DEV_FAKE_CHAIN stand-in: there is no real chain to administer.');
  if (!net.chain) out.push('The game server cannot be reached, so its chain is unknown. Signing is blocked.');
  else if (!net.info) out.push('The game server reports no chain (EVM_RPC_URL is unset). Signing is blocked.');
  if (net.info && rpcChainId !== undefined && rpcChainId !== null && rpcChainId !== net.info.id) {
    out.push(`The RPC this panel reads is on chain ${rpcChainId}, but the game server is on ${net.info.name} (${net.info.id}). Signing is blocked.`);
  }
  return out;
}

/** "Your wallet is on chain X": a note (it is switched before signing), or null when it is on the server's chain. */
export function walletChainNote(net: AdminNetwork, walletChainId: number | null): string | null {
  if (!net.info || walletChainId === null || walletChainId === net.info.id) return null;
  return `Your wallet is on chain ${walletChainId}. It will be asked to switch to ${net.info.name} (${net.info.id}) before it signs.`;
}
