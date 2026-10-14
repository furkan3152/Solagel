import { PublicKey, SystemProgram } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { MPL_CORE_ID, createCollectionIx, parseCoreAsset, passNumberFromName } from '../src';

const key = (byte: number) => new PublicKey(new Uint8Array(32).fill(byte));

const borshString = (s: string): number[] => {
  const b = [...new TextEncoder().encode(s)];
  return [b.length & 0xff, (b.length >> 8) & 0xff, 0, 0, ...b];
};

/** AssetV1: key | owner | update authority (tag [+ pubkey]) | name | uri | seq (Option<u64>). */
function assetData(owner: PublicKey, ua: { tag: 0 } | { tag: 1 | 2; key: PublicKey }, name: string, uri: string, extra: number[] = [0]): Uint8Array {
  return Uint8Array.from([
    1,
    ...owner.toBytes(),
    ua.tag,
    ...(ua.tag === 0 ? [] : [...ua.key.toBytes()]),
    ...borshString(name),
    ...borshString(uri),
    ...extra,
  ]);
}

describe('Metaplex Core helpers', () => {
  it('MPL_CORE_ID', () => {
    expect(MPL_CORE_ID.toBase58()).toBe('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
  });

  it('parseCoreAsset reads owner, collection, name and uri', () => {
    const owner = key(9);
    const collection = key(5);
    const data = assetData(owner, { tag: 2, key: collection }, 'Slana Pass #42', 'https://slana.example/pass/42.json');
    expect(parseCoreAsset(data)).toEqual({
      owner: owner.toBase58(),
      collection: collection.toBase58(),
      name: 'Slana Pass #42',
      uri: 'https://slana.example/pass/42.json',
    });
    // trailing plugin data after seq is ignored
    expect(parseCoreAsset(assetData(owner, { tag: 2, key: collection }, 'n', 'u', [1, 5, 0, 0, 0, 0, 0, 0, 0, 9, 9]))?.name).toBe('n');
    // update authority = an address (not a collection) or none
    expect(parseCoreAsset(assetData(owner, { tag: 1, key: collection }, 'x', 'y'))).toMatchObject({ collection: null, name: 'x', uri: 'y' });
    expect(parseCoreAsset(assetData(owner, { tag: 0 }, 'x', 'y'))).toMatchObject({ owner: owner.toBase58(), collection: null, name: 'x' });
  });

  it('parseCoreAsset rejects other accounts and truncated data', () => {
    const good = assetData(key(9), { tag: 2, key: key(5) }, 'Slana Pass #1', 'u');
    expect(parseCoreAsset(Uint8Array.from([5, ...good.subarray(1)]))).toBeNull(); // a collection (key 5)
    expect(parseCoreAsset(good.subarray(0, 40))).toBeNull();
    expect(parseCoreAsset(good.subarray(0, good.length - 2))).toBeNull(); // uri cut short
    expect(parseCoreAsset(new Uint8Array())).toBeNull();
    const badTag = Uint8Array.from(good);
    badTag[33] = 7;
    expect(parseCoreAsset(badTag)).toBeNull();
  });

  it('passNumberFromName', () => {
    expect(passNumberFromName('Slana Pass #42')).toBe(42);
    expect(passNumberFromName('Slana Pass #1')).toBe(1);
    expect(passNumberFromName('Slana Pass #99999')).toBe(99_999);
    expect(passNumberFromName('Slana Pass #100000')).toBeNull();
    expect(passNumberFromName('Slana Pass #')).toBeNull();
    expect(passNumberFromName('Slana Pass #4a')).toBeNull();
    expect(passNumberFromName('Fake Pass #4')).toBeNull();
    expect(passNumberFromName(' Slana Pass #4')).toBeNull();
  });

  it('createCollectionIx matches the mpl-core 0.12.1 CreateCollectionV2 builder byte for byte', () => {
    const ix = createCollectionIx({
      collection: key(1),
      updateAuthority: key(2),
      payer: key(3),
      name: 'Slana Pass',
      uri: 'https://x.io/collection.json',
      royaltyBps: 500,
      royaltyTo: key(4),
    });
    // Produced by mpl_core::instructions::CreateCollectionV2Builder with
    // plugins = [PluginAuthorityPair { plugin: Plugin::Royalties(Royalties { basis_points: 500,
    // creators: [Creator { address: [4; 32], percentage: 100 }], rule_set: RuleSet::None }), authority: None }].
    const golden =
      '150a000000536c616e6120506173731c00000068747470733a2f2f782e696f2f636f6c6c656374696f6e2e6a736f6e' +
      '010100000000f40101000000' +
      '04'.repeat(32) +
      '64000000';
    expect(Buffer.from(ix.data).toString('hex')).toBe(golden);
    expect(ix.programId.equals(MPL_CORE_ID)).toBe(true);
    expect(ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual([
      [key(1).toBase58(), true, true],
      [key(2).toBase58(), false, false],
      [key(3).toBase58(), true, true],
      [SystemProgram.programId.toBase58(), false, false],
    ]);
  });

  it('createCollectionIx validates royalties', () => {
    const base = { collection: key(1), updateAuthority: key(2), payer: key(3), name: 'n', uri: 'u', royaltyTo: key(4) };
    expect(() => createCollectionIx({ ...base, royaltyBps: 10_001 })).toThrow(RangeError);
    expect(() => createCollectionIx({ ...base, royaltyBps: -1 })).toThrow(RangeError);
    expect(() => createCollectionIx({ ...base, royaltyBps: 1.5 })).toThrow(RangeError);
  });
});
