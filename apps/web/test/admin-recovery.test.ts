import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { beforeEach, describe, expect, it } from 'vitest';
import { SOLANA_GENESIS } from '../src/admin/network';
import { adminRecoveryKey, clearPendingAdmin, loadPendingAdmin, savePendingAdmin, type PendingAdminMetadata } from '../src/admin/recovery';

const context = { wallet: Keypair.generate().publicKey.toBase58(), programId: Keypair.generate().publicKey.toBase58(), rpcUrl: 'https://api.devnet.solana.com', cluster: 'devnet' };
const signature = bs58.encode(new Uint8Array(64).fill(7));
const otherSignature = bs58.encode(new Uint8Array(64).fill(8));
const metadata: PendingAdminMetadata = { ...context, signature, lastValidBlockHeight: 12_345, genesisHash: SOLANA_GENESIS.devnet, title: 'Fund the current season', createdAt: 1_800_000_000_000 };

describe('public administration transaction recovery', () => {
  let values: Map<string, string>;
  let storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  beforeEach(() => {
    values = new Map();
    storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } };
  });

  it('restores an unresolved signature after logout, remount or reload without losing the lock', () => {
    savePendingAdmin(storage, metadata);
    // A newly mounted panel reads only durable storage, with no old component state.
    expect(loadPendingAdmin(storage, context)).toEqual(metadata);
    expect(loadPendingAdmin(storage, context)).toEqual(metadata);
    expect(values.size).toBe(1);
  });

  it('scopes recovery to the same wallet, program, RPC and network', () => {
    savePendingAdmin(storage, metadata);
    expect(loadPendingAdmin(storage, { ...context, wallet: Keypair.generate().publicKey.toBase58() })).toBeNull();
    expect(loadPendingAdmin(storage, { ...context, programId: Keypair.generate().publicKey.toBase58() })).toBeNull();
    expect(loadPendingAdmin(storage, { ...context, rpcUrl: 'https://another-rpc.example' })).toBeNull();
    expect(loadPendingAdmin(storage, { ...context, cluster: 'mainnet-beta' })).toBeNull();
    expect(loadPendingAdmin(storage, context)?.signature).toBe(signature);
  });

  it('never stores bearer tokens, connection objects or a supplied explorer destination', () => {
    savePendingAdmin(storage, { ...metadata, token: 'private-admin-bearer', connection: { rpcEndpoint: 'https://evil.example' }, href: 'https://evil.example' } as PendingAdminMetadata);
    const raw = storage.getItem(adminRecoveryKey(context))!;
    expect(raw).not.toContain('private-admin-bearer');
    expect(raw).not.toContain('evil.example');
    expect(JSON.parse(raw)).toEqual(metadata);
  });

  it('clears only the matching transaction after a definitive outcome', () => {
    savePendingAdmin(storage, metadata);
    clearPendingAdmin(storage, context, otherSignature);
    expect(loadPendingAdmin(storage, context)?.signature).toBe(signature);
    clearPendingAdmin(storage, context, signature);
    expect(loadPendingAdmin(storage, context)).toBeNull();
  });

  it('does not allow a late old completion to clear a newer signature', () => {
    savePendingAdmin(storage, metadata);
    savePendingAdmin(storage, { ...metadata, signature: otherSignature });
    clearPendingAdmin(storage, context, signature);
    expect(loadPendingAdmin(storage, context)?.signature).toBe(otherSignature);
  });

  it.each([
    { signature: 'not a Solana signature' },
    { signature: bs58.encode(new Uint8Array(32)) },
    { lastValidBlockHeight: -1 },
    { lastValidBlockHeight: 1.5 },
    { genesisHash: 'bad ledger' },
    { title: '' },
    { createdAt: 0 },
    { rpcUrl: 'https://untrusted.example' },
  ])('fails closed for corrupt or mismatched saved data: %j', (change) => {
    storage.setItem(adminRecoveryKey(context), JSON.stringify({ ...metadata, ...change }));
    expect(() => loadPendingAdmin(storage, context)).toThrow();
    expect(values.size).toBe(1); // Never silently erase an unresolved recovery record.
  });

  it('fails before broadcast if storage cannot durably save the public signature', () => {
    const blocked = { ...storage, setItem() { throw new Error('Storage disabled'); } };
    expect(() => savePendingAdmin(blocked, metadata)).toThrow('Storage disabled');
    expect(loadPendingAdmin(storage, context)).toBeNull();
  });

  it('uses full 32-byte genesis hashes confirmed against the public RPCs', () => {
    expect(SOLANA_GENESIS).toEqual({
      'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
      devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
      testnet: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
    });
    for (const genesis of Object.values(SOLANA_GENESIS)) expect(bs58.decode(genesis)).toHaveLength(32);
  });
});
