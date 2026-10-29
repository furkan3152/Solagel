import { PROGRAM_ID } from '@elymum/sdk';
import type { ChainStatus } from '@elymum/shared';
import { describe, expect, it } from 'vitest';
import { MAX_PRIORITY_MICRO_LAMPORTS, maxFeeLamports, priorityFromEnv, resolveNetwork, verifyNetwork } from '../src/admin/net';

const MAINNET = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const DEVNET = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const chain = (over: Partial<ChainStatus> = {}): ChainStatus => ({
  enabled: true,
  cluster: 'mainnet-beta',
  programId: PROGRAM_ID.toBase58(),
  rpcUrl: 'https://rpc.example',
  arenasEnabled: true,
  tokenReady: false,
  token: null,
  feeBps: 500,
  ...over,
});
const none = { rpcUrl: null, cluster: null, priority: null };

describe('admin network: pinned program id', () => {
  it('always uses the compiled program id, whatever the server reports', () => {
    const n = resolveNetwork(chain({ programId: '11111111111111111111111111111111' }), none);
    expect(n.programId).toBe(PROGRAM_ID.toBase58());
    expect(n.serverProgramId).toBe('11111111111111111111111111111111');
    expect(verifyNetwork(n, MAINNET).blockers.join(' ')).toMatch(/pinned to/);
    expect(verifyNetwork(resolveNetwork(chain(), none), MAINNET).blockers).toEqual([]);
  });
});

describe('admin network: cluster from the genesis hash', () => {
  it('labels the cluster from the genesis hash and blocks a mismatch or an unknown hash', () => {
    const n = resolveNetwork(chain(), none);
    expect(verifyNetwork(n, MAINNET)).toMatchObject({ verified: true, blockers: [], net: { cluster: 'mainnet-beta' } });
    expect(verifyNetwork(n, DEVNET).blockers.join(' ')).toMatch(/RPC is devnet .* claims mainnet-beta/);
    expect(verifyNetwork(n, 'SomeOtherGenesis1111111111111111111111111111').blockers.join(' ')).toMatch(/Unknown genesis hash/);
    expect(verifyNetwork(n, null).blockers.join(' ')).toMatch(/Cannot read the genesis hash/);
    expect(verifyNetwork(n, undefined)).toMatchObject({ verified: false });
    // the server's default SOLANA_CLUSTER=localnet on a mainnet RPC is caught
    expect(verifyNetwork(resolveNetwork(chain({ cluster: 'localnet' }), none), MAINNET).blockers.join(' ')).toMatch(/claims localnet/);
  });

  it('a local validator counts as localnet only when localnet is claimed', () => {
    const local = resolveNetwork(chain({ cluster: 'localnet', rpcUrl: 'http://127.0.0.1:8899' }), none);
    expect(verifyNetwork(local, 'LocalGenesis11111111111111111111111111111111')).toMatchObject({ verified: true, blockers: [], net: { cluster: 'localnet' } });
    const remote = resolveNetwork(chain({ cluster: 'localnet', rpcUrl: 'https://rpc.example' }), none);
    expect(verifyNetwork(remote, 'LocalGenesis11111111111111111111111111111111').blockers.join(' ')).toMatch(/Unknown genesis/);
  });
});

describe('admin network: priority fee', () => {
  it('is capped and bounds the fee', () => {
    expect(priorityFromEnv('99999999')).toBe(MAX_PRIORITY_MICRO_LAMPORTS);
    expect(priorityFromEnv('-1')).toBe(20_000);
    expect(priorityFromEnv(null)).toBe(20_000);
    expect(maxFeeLamports(2, 20_000)).toBe(5_000 + 8_000);
  });
});
