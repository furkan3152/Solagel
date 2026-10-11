import { Connection, Keypair } from '@solana/web3.js';
import { SolagelClient } from '@solagel/sdk';
import { PROTOCOL_VERSION, type ChainStatus } from '@solagel/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAdminChain, SOLANA_GENESIS, verifyAdminNetwork } from '../src/admin/network';

describe('administration deployment and network guards', () => {
  let client: SolagelClient;
  let advertised: ChainStatus;
  beforeEach(() => {
    client = new SolagelClient(new Connection('http://127.0.0.1:1', 'confirmed'));
    vi.spyOn(client.connection, 'getGenesisHash').mockResolvedValue(SOLANA_GENESIS.devnet);
    vi.spyOn(client.connection, 'getAccountInfo').mockResolvedValue({ executable: true, owner: Keypair.generate().publicKey, lamports: 1, data: Buffer.alloc(0), rentEpoch: 0 });
    advertised = { enabled: true, cluster: 'devnet', programId: client.programId.toBase58(), rpcUrl: 'https://api.devnet.solana.com', stakeEnabled: true, currentSeason: 1 };
  });
  afterEach(() => { vi.useRealTimers(); });

  it('verifies the genesis and executable program despite an RPC override', async () => {
    const proof = await verifyAdminNetwork(client, advertised);
    expect(proof).toMatchObject({ cluster: 'devnet', genesisHash: SOLANA_GENESIS.devnet, programId: advertised.programId, rpcUrl: 'http://127.0.0.1:1' });
    expect(client.connection.getAccountInfo).toHaveBeenCalledWith(client.programId, 'confirmed');
  });

  it('blocks a mainnet RPC when the server advertises devnet even with the same program address', async () => {
    vi.mocked(client.connection.getGenesisHash).mockResolvedValue(SOLANA_GENESIS['mainnet-beta']);
    await expect(verifyAdminNetwork(client, advertised)).rejects.toThrow(/does not match.*devnet/);
  });

  it.each(['mainnet-beta', 'testnet'] as const)('checks the canonical %s genesis', async (cluster) => {
    advertised.cluster = cluster;
    await expect(verifyAdminNetwork(client, advertised)).rejects.toThrow(/does not match/);
    vi.mocked(client.connection.getGenesisHash).mockResolvedValue(SOLANA_GENESIS[cluster]);
    expect((await verifyAdminNetwork(client, advertised)).cluster).toBe(cluster);
  });

  it('blocks a freshly changed advertised program before building any instructions', async () => {
    advertised.programId = Keypair.generate().publicKey.toBase58();
    await expect(verifyAdminNetwork(client, advertised)).rejects.toThrow(/program changed/);
    expect(client.connection.getGenesisHash).not.toHaveBeenCalled();
  });

  it('requires the advertised program to be executable on the selected RPC', async () => {
    vi.mocked(client.connection.getAccountInfo).mockResolvedValue(null);
    await expect(verifyAdminNetwork(client, advertised)).rejects.toThrow(/not deployed as an executable/);
  });

  it('compares a custom RPC ledger against the server-advertised RPC ledger', async () => {
    advertised.cluster = 'localnet';
    advertised.rpcUrl = 'http://server-validator:8899';
    vi.mocked(client.connection.getGenesisHash).mockResolvedValue('local-genesis');
    const serverRpc = { getGenesisHash: vi.fn().mockResolvedValue('other-local-genesis') };
    const factory = vi.fn(() => serverRpc);
    await expect(verifyAdminNetwork(client, advertised, factory)).rejects.toThrow(/does not match/);
    expect(factory).toHaveBeenCalledWith('http://server-validator:8899');
    serverRpc.getGenesisHash.mockResolvedValue('local-genesis');
    expect((await verifyAdminNetwork(client, advertised, factory)).genesisHash).toBe('local-genesis');
  });

  it('fails closed when the server cannot identify its custom RPC', async () => {
    advertised.cluster = 'custom';
    advertised.rpcUrl = null;
    await expect(verifyAdminNetwork(client, advertised)).rejects.toThrow(/must advertise its public RPC/);
  });

  it('bounds a hung RPC verification so the admin can retry', async () => {
    vi.useFakeTimers();
    vi.mocked(client.connection.getGenesisHash).mockReturnValue(new Promise(() => {}));
    const request = expect(verifyAdminNetwork(client, advertised)).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(15_000);
    await request;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fetches fresh server deployment configuration without relying on a cached UI label', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ protocol: PROTOCOL_VERSION, chain: advertised })));
    expect(await fetchAdminChain('https://game.example/', fetcher)).toEqual(advertised);
    expect(fetcher).toHaveBeenCalledWith('https://game.example/api/config', expect.objectContaining({ cache: 'no-store', credentials: 'omit' }));
    fetcher.mockResolvedValue(new Response(JSON.stringify({ protocol: PROTOCOL_VERSION - 1, chain: advertised })));
    await expect(fetchAdminChain('https://game.example', fetcher)).rejects.toThrow(/protocol changed/);
  });
});
