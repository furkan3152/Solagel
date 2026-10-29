import { concat, encodeAbiParameters, getAddress, isAddress, keccak256, type Address, type Hex } from 'viem';

/**
 * OpenZeppelin `StandardMerkleTree`-compatible allowlist tree for address leaves, the scheme
 * `ElymumNFT.mintAllowlist` verifies with `MerkleProof.verifyCalldata`:
 *
 * - leaf = `keccak256(bytes.concat(keccak256(abi.encode(address))))` (double hashed, so an inner
 *   node can never pass as a leaf);
 * - inner node = keccak256 of the two children sorted as bytes (`hashPair`, commutative);
 * - OZ's layout: leaves sorted by hash, stored at the end of a flat array (`tree[n-1-i]`), each
 *   inner node `tree[i] = hashPair(tree[2i+1], tree[2i+2])`, root `tree[0]`. The same set of
 *   addresses therefore gives the same root as `StandardMerkleTree.of(values, ['address'])`.
 *
 * Browser-safe: viem's keccak only.
 */

/** keccak256(bytes.concat(keccak256(abi.encode(address)))). */
export function merkleLeaf(address: Address): Hex {
  return keccak256(keccak256(encodeAbiParameters([{ type: 'address' }], [getAddress(address)])));
}

const cmp = (a: Hex, b: Hex): number => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);

/** OZ `Hashes.commutativeKeccak256`. */
export function hashPair(a: Hex, b: Hex): Hex {
  return keccak256(cmp(a, b) <= 0 ? concat([a, b]) : concat([b, a]));
}

/** OZ `makeMerkleTree`: a flat array, root at 0, leaves (in the given order) at the end, reversed. */
export function makeMerkleTree(leaves: readonly Hex[]): Hex[] {
  if (leaves.length === 0) throw new RangeError('a Merkle tree needs at least one leaf');
  const tree = new Array<Hex>(2 * leaves.length - 1);
  for (let i = 0; i < leaves.length; i++) tree[tree.length - 1 - i] = leaves[i];
  for (let i = tree.length - 1 - leaves.length; i >= 0; i--) tree[i] = hashPair(tree[2 * i + 1], tree[2 * i + 2]);
  return tree;
}

/** OZ `getProof` for a tree index. */
export function merkleProofAt(tree: readonly Hex[], index: number): Hex[] {
  if (index < tree.length - Math.ceil(tree.length / 2) || index >= tree.length) throw new RangeError(`index ${index} is not a leaf`);
  const proof: Hex[] = [];
  let i = index;
  while (i > 0) {
    proof.push(tree[i % 2 === 1 ? i + 1 : i - 1]);
    i = Math.floor((i - 1) / 2);
  }
  return proof;
}

/** OZ `processProof` + compare (what the contract does). */
export function verifyMerkleProof(root: Hex, address: Address, proof: readonly Hex[]): boolean {
  let h = merkleLeaf(address);
  for (const p of proof) h = hashPair(h, p);
  return BigInt(h) === BigInt(root);
}

/** Checksums, de-duplicates (case-insensitively) and sorts addresses; throws `TypeError` on a malformed one. */
export function normalizeAllowlist(addresses: Iterable<string>): Address[] {
  const seen = new Map<string, Address>();
  for (const raw of addresses) {
    const a = String(raw).trim();
    if (!isAddress(a, { strict: false })) throw new TypeError(`not an EVM address: ${JSON.stringify(raw)}`);
    const c = getAddress(a);
    seen.set(c.toLowerCase(), c);
  }
  return [...seen.values()].sort((x, y) => (x.toLowerCase() < y.toLowerCase() ? -1 : x.toLowerCase() > y.toLowerCase() ? 1 : 0));
}

export interface AllowlistTree {
  /** 0x root for `setMerkleRoot`. */
  root: Hex;
  /** The normalized list (checksummed, unique, sorted). */
  addresses: Address[];
  count: number;
  /** Whether an address is on the list (any case). */
  has(address: string): boolean;
  /** Proof for an address; null when it is not on the list. */
  proof(address: string): Hex[] | null;
  /** The flat OZ tree (root first). */
  tree: readonly Hex[];
}

/** Builds the allowlist tree. Throws `RangeError` for an empty list, `TypeError` for a malformed address. */
export function buildMerkleTree(addresses: Iterable<string>): AllowlistTree {
  const list = normalizeAllowlist(addresses);
  if (list.length === 0) throw new RangeError('the allowlist is empty');
  const hashed = list.map((a) => ({ a, h: merkleLeaf(a) }));
  // OZ sorts the leaves by hash before building (sortLeaves: true)
  const sorted = [...hashed].sort((x, y) => cmp(x.h, y.h));
  const tree = makeMerkleTree(sorted.map((x) => x.h));
  const indexOf = new Map<string, number>();
  sorted.forEach((x, i) => indexOf.set(x.a.toLowerCase(), tree.length - 1 - i));
  return {
    root: tree[0],
    addresses: list,
    count: list.length,
    tree,
    has: (address) => indexOf.has(address.trim().toLowerCase()),
    proof(address) {
      const i = indexOf.get(address.trim().toLowerCase());
      return i === undefined ? null : merkleProofAt(tree, i);
    },
  };
}

/** Root of an allowlist (see `buildMerkleTree`). */
export function merkleRoot(addresses: Iterable<string>): Hex {
  return buildMerkleTree(addresses).root;
}
