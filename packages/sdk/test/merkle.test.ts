import { encodeAbiParameters, getAddress, keccak256, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { buildMerkleTree, hashPair, makeMerkleTree, merkleLeaf, merkleProofAt, merkleRoot, normalizeAllowlist, verifyMerkleProof } from '../src/merkle';

const addr = (i: number) => getAddress(`0x${(i * 0x1111).toString(16).padStart(40, '0')}`);

describe('merkle (OpenZeppelin StandardMerkleTree compatible)', () => {
  it('matches the OpenZeppelin merkle-tree README vector (sorted leaves, commutative pairs)', () => {
    // StandardMerkleTree.of([[0x1111…, 5e18], [0x2222…, 2.5e18]], ['address', 'uint256']).root
    const values: [Hex, bigint][] = [
      ['0x1111111111111111111111111111111111111111', 5_000_000_000_000_000_000n],
      ['0x2222222222222222222222222222222222222222', 2_500_000_000_000_000_000n],
    ];
    const leaves = values
      .map((v) => keccak256(keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], v))))
      .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
    expect(makeMerkleTree(leaves)[0]).toBe('0xd4dee0beab2d53f2cc83e567171bd2820e49898130a22622b10ead383e90bd77');
  });

  it('leaf is the double hash of abi.encode(address)', () => {
    const a = addr(1);
    expect(merkleLeaf(a)).toBe(keccak256(keccak256(encodeAbiParameters([{ type: 'address' }], [a]))));
  });

  it('hashPair is commutative', () => {
    const x = merkleLeaf(addr(1));
    const y = merkleLeaf(addr(2));
    expect(hashPair(x, y)).toBe(hashPair(y, x));
  });

  it('uses the OZ flat layout', () => {
    const l = [merkleLeaf(addr(1)), merkleLeaf(addr(2)), merkleLeaf(addr(3))];
    const t = makeMerkleTree(l);
    expect(t).toHaveLength(5);
    expect(t[4]).toBe(l[0]);
    expect(t[3]).toBe(l[1]);
    expect(t[2]).toBe(l[2]);
    expect(t[1]).toBe(hashPair(t[3], t[4]));
    expect(t[0]).toBe(hashPair(t[1], t[2]));
    expect(merkleProofAt(t, 4)).toEqual([t[3], t[2]]);
    expect(merkleProofAt(t, 2)).toEqual([t[1]]);
    expect(() => merkleProofAt(t, 1)).toThrow(RangeError);
  });

  it('every listed address verifies, others do not, for many sizes', () => {
    for (const n of [1, 2, 3, 4, 5, 7, 8, 9, 16, 33]) {
      const list = Array.from({ length: n }, (_, i) => addr(i + 1));
      const tree = buildMerkleTree(list);
      expect(tree.count).toBe(n);
      for (const a of list) {
        const proof = tree.proof(a)!;
        expect(verifyMerkleProof(tree.root, a, proof)).toBe(true);
      }
      expect(tree.proof(addr(999))).toBeNull();
      expect(verifyMerkleProof(tree.root, addr(999), tree.proof(list[0])!)).toBe(false);
    }
  });

  it('single-leaf tree: the root is the leaf and the proof is empty', () => {
    const t = buildMerkleTree([addr(5)]);
    expect(t.root).toBe(merkleLeaf(addr(5)));
    expect(t.proof(addr(5))).toEqual([]);
  });

  it('the root depends on the set only (order, case and duplicates do not matter)', () => {
    const list = [addr(1), addr(2), addr(3), addr(4), addr(5)];
    const r = merkleRoot(list);
    expect(merkleRoot([...list].reverse())).toBe(r);
    expect(merkleRoot([...list.map((a) => a.toLowerCase()), addr(3)])).toBe(r);
    expect(buildMerkleTree(list).has(addr(2).toLowerCase())).toBe(true);
  });

  it('normalizes and refuses malformed input', () => {
    expect(normalizeAllowlist([' 0x00000000000000000000000000000000000000AA ', '0x00000000000000000000000000000000000000aa'])).toEqual([
      '0x00000000000000000000000000000000000000AA',
    ]);
    expect(() => buildMerkleTree([])).toThrow(RangeError);
    expect(() => buildMerkleTree(['0x123'])).toThrow(TypeError);
    expect(() => buildMerkleTree(['So1anaAddre55'])).toThrow(TypeError);
  });
});
