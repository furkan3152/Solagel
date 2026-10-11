import type { SolagelClient } from '@solagel/sdk';
import { PROTOCOL_VERSION, type ChainStatus } from '@solagel/shared';
import { Connection } from '@solana/web3.js';

export const SOLANA_GENESIS = {
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  testnet: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
} as const;

export interface AdminNetworkProof {
  cluster: string;
  programId: string;
  genesisHash: string;
  rpcUrl: string;
  fingerprint: string;
}

/** Read the current server deployment, bypassing the background UI polling cache. */
export async function fetchAdminChain(serverHttp: string, fetcher: typeof fetch = fetch): Promise<ChainStatus> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetcher(`${serverHttp.replace(/\/$/, '')}/api/config`, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
    if (!response.ok) throw new Error('Cannot verify the game server’s current network. Try again before signing.');
    const data = await response.json() as { protocol?: number; chain?: ChainStatus };
    if (!data || data.protocol !== PROTOCOL_VERSION) throw new Error('The server protocol changed. Refresh this page before administering the program.');
    const chain = data.chain;
    if (!chain || typeof chain.enabled !== 'boolean' || typeof chain.cluster !== 'string' || !chain.cluster.trim() || (chain.programId !== null && typeof chain.programId !== 'string') || (chain.rpcUrl !== null && typeof chain.rpcUrl !== 'string')) {
      throw new Error('The server did not provide a valid network configuration.');
    }
    return chain;
  } finally {
    clearTimeout(timeout);
  }
}

async function boundedRpc<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Network verification timed out. Check the RPC connection and try again before signing.')), 15_000);
    })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** An RPC override must identify the same ledger and executable program as the server. */
export async function verifyAdminNetwork(
  client: Pick<SolagelClient, 'programId' | 'connection'>,
  advertised: ChainStatus,
  makeConnection: (url: string) => Pick<Connection, 'getGenesisHash'> = (url) => new Connection(url, 'confirmed'),
): Promise<AdminNetworkProof> {
  if (!advertised.enabled || !advertised.programId) throw new Error('On-chain administration is unavailable on the current game server.');
  if (client.programId.toBase58() !== advertised.programId) throw new Error('The game server’s program changed. Refresh before signing any transaction.');
  const label = advertised.cluster.trim().toLowerCase();
  const cluster = label === 'mainnet' ? 'mainnet-beta' : label;
  const canonical = SOLANA_GENESIS[cluster as keyof typeof SOLANA_GENESIS];
  if (!canonical && (!advertised.rpcUrl || !/^https?:\/\//i.test(advertised.rpcUrl))) {
    throw new Error('The game server must advertise its public RPC to verify this custom network.');
  }
  const selectedGenesis = client.connection.getGenesisHash();
  const expectedGenesis = canonical ? Promise.resolve(canonical)
    : advertised.rpcUrl === client.connection.rpcEndpoint ? selectedGenesis
      : makeConnection(advertised.rpcUrl!).getGenesisHash();
  const [genesisHash, expected, program] = await boundedRpc(Promise.all([
    selectedGenesis,
    expectedGenesis,
    client.connection.getAccountInfo(client.programId, 'confirmed'),
  ]));
  if (!genesisHash || genesisHash !== expected) {
    throw new Error(`The wallet RPC does not match the game server’s ${advertised.cluster} network. Correct the RPC override before signing.`);
  }
  if (!program?.executable) throw new Error('The advertised program is not deployed as an executable on this RPC network.');
  const programId = client.programId.toBase58();
  const rpcUrl = client.connection.rpcEndpoint;
  return { cluster, programId, genesisHash, rpcUrl, fingerprint: JSON.stringify([cluster, programId, genesisHash, rpcUrl]) };
}
