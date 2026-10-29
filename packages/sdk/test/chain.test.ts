import { describe, expect, it } from 'vitest';
import { createElymumPublicClient, createElymumWalletClient, elysiumChain, getCodeHash, isMainnetChain, resolveChain, toTransport } from '../src/chain';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256 } from 'viem';

describe('chain', () => {
  it('builds viem chains from the shared table', () => {
    const t = elysiumChain(99801);
    expect(t.id).toBe(99801);
    expect(t.name).toBe('Elysium Testnet');
    expect(t.nativeCurrency).toEqual({ name: 'HYPE', symbol: 'HYPE', decimals: 18 });
    expect(t.rpcUrls.default.http).toEqual(['https://testnet-rpc.elysium.kinetiq.xyz']);
    expect(t.blockExplorers?.default.url).toBe('https://explorer-elysium-testnet.t.conduit.xyz');
    expect(t.testnet).toBe(true);
    const m = elysiumChain(4242, { rpcUrl: 'https://rpc.example', explorerUrl: 'https://scan.example/' });
    expect(m.name).toBe('Elysium');
    expect(m.testnet).toBe(false);
    expect(m.blockExplorers?.default.url).toBe('https://scan.example');
    expect(isMainnetChain(4242)).toBe(true);
    expect(isMainnetChain(31337)).toBe(false);
    expect(elysiumChain(31337).blockExplorers).toBeUndefined();
  });

  it('accepts an RPC URL or an EIP-1193 provider', async () => {
    expect(() => toTransport('ws://x')).toThrow(TypeError);
    expect(() => toTransport({} as never)).toThrow(TypeError);
    const provider = {
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_chainId') return '0x185d9';
        if (method === 'eth_getCode') return '0x6001';
        throw new Error(method);
      },
    };
    const client = createElymumPublicClient(provider);
    expect(await client.getChainId()).toBe(99801);
    expect((await resolveChain(client)).name).toBe('Elysium Testnet');
    expect(await getCodeHash(client, '0x5FbDB2315678afecb367f032d93F642f64180aa3')).toBe(keccak256('0x6001'));
    const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
    const wallet = createElymumWalletClient('http://127.0.0.1:1', { account, chain: elysiumChain(31337) });
    expect(wallet.account?.address).toBe(account.address);
  });
});
