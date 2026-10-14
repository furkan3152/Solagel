import { Connection, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { MPL_CORE_ID, listOwnedPasses } from '../src';

const key = (byte: number) => new PublicKey(new Uint8Array(32).fill(byte));
const str = (s: string) => {
  const b = [...new TextEncoder().encode(s)];
  return [b.length, 0, 0, 0, ...b];
};
const asset = (owner: PublicKey, collection: PublicKey, name: string) =>
  Buffer.from([1, ...owner.toBytes(), 2, ...collection.toBytes(), ...str(name), ...str('u'), 0]);

describe('listOwnedPasses', () => {
  const owner = key(9);
  const collection = key(5);

  it('uses DAS getAssetsByOwner and keeps the collection’s Passes only', async () => {
    const bodies: unknown[] = [];
    const fetchFn = (async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      const item = (id: string, name: string, group: string, burnt = false) => ({
        id,
        burnt,
        content: { metadata: { name } },
        grouping: [{ group_key: 'collection', group_value: group }],
      });
      return {
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: {
            total: 4,
            items: [
              item('A2', 'Slana Pass #12', collection.toBase58()),
              item('A1', 'Slana Pass #3', collection.toBase58()),
              item('X', 'Slana Pass #4', key(6).toBase58()),
              item('B', 'Slana Pass #5', collection.toBase58(), true),
            ],
          },
        }),
      };
    }) as unknown as typeof fetch;
    const conn = { rpcEndpoint: 'https://rpc.example', getProgramAccounts: async () => { throw new Error('must not fall back'); } } as unknown as Connection;
    expect(await listOwnedPasses(conn, owner, collection, { fetch: fetchFn })).toEqual([
      { asset: 'A1', number: 3 },
      { asset: 'A2', number: 12 },
    ]);
    expect(bodies[0]).toMatchObject({ method: 'getAssetsByOwner', params: { ownerAddress: owner.toBase58() } });
  });

  it('falls back to getProgramAccounts with memcmp filters', async () => {
    const fetchFn = (async () => ({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } }) })) as unknown as typeof fetch;
    let call: { program: PublicKey; filters: unknown } | null = null;
    const a1 = key(21);
    const a2 = key(22);
    const conn = {
      rpcEndpoint: 'https://rpc.example',
      getProgramAccounts: async (program: PublicKey, cfg: { filters: unknown }) => {
        call = { program, filters: cfg.filters };
        return [
          { pubkey: a2, account: { data: asset(owner, collection, 'Slana Pass #8') } },
          { pubkey: a1, account: { data: asset(owner, collection, 'Slana Pass #2') } },
          { pubkey: key(23), account: { data: asset(owner, collection, 'Not a pass') } },
        ];
      },
    } as unknown as Connection;
    expect(await listOwnedPasses(conn, owner, collection, { fetch: fetchFn })).toEqual([
      { asset: a1.toBase58(), number: 2 },
      { asset: a2.toBase58(), number: 8 },
    ]);
    expect(call!.program.equals(MPL_CORE_ID)).toBe(true);
    const filters = call!.filters as { memcmp: { offset: number; bytes: string } }[];
    expect(filters.map((f) => f.memcmp.offset)).toEqual([0, 1, 33, 34]);
    expect(filters[0].memcmp.bytes).toBe('2'); // base58 of [1]
    expect(filters[1].memcmp.bytes).toBe(owner.toBase58());
    expect(filters[2].memcmp.bytes).toBe('3'); // base58 of [2]
    expect(filters[3].memcmp.bytes).toBe(collection.toBase58());
  });
});
