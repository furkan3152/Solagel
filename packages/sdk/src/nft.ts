import { elymumNFTAbi, elymumNFTArtifact } from '@elymum/contracts';
import { getAddress, type Account, type Address, type Chain, type Hash, type Hex, type PublicClient, type WalletClient } from 'viem';
import { checkAddress } from './arena';
import type { ContractCall } from './call';
import { BPS, DEFAULT_MINT_BUFFER_BPS, MAX_ROYALTY_BPS, MINT_PHASE_NAMES, MintPhase, type MintPhaseName } from './constants';
import { isZeroAddress } from './format';

/** `ElymumNFT`: typed reads, mint and owner call builders, deploy. */

type ReadClient = Pick<PublicClient, 'readContract'>;
export type NftAbi = typeof elymumNFTAbi;
export type NftCall = ContractCall<NftAbi>;

export interface MintState {
  address: Address;
  phase: MintPhase;
  phaseName: MintPhaseName;
  /** Wei per token. */
  price: bigint;
  /** Keeper bounds (0n/0n when unset). */
  minPrice: bigint;
  maxPrice: bigint;
  keeper: Address | null;
  /** Allowlist root (zero hash when unset). */
  root: Hex;
  maxSupply: number;
  totalSupply: number;
  wlLimit: number;
  publicLimit: number;
  treasury: Address;
  frozen: boolean;
  soldOut: boolean;
}

export async function getMintState(client: ReadClient, nft: Address): Promise<MintState> {
  const s = await client.readContract({ address: nft, abi: elymumNFTAbi, functionName: 'mintState' });
  const phase = Number(s.phase) as MintPhase;
  return {
    address: getAddress(nft),
    phase,
    phaseName: MINT_PHASE_NAMES[phase] ?? 'closed',
    price: s.price,
    minPrice: s.minPrice,
    maxPrice: s.maxPrice,
    keeper: isZeroAddress(s.keeper) ? null : getAddress(s.keeper),
    root: s.root,
    maxSupply: Number(s.maxSupply),
    totalSupply: Number(s.totalSupply),
    wlLimit: Number(s.wlLimit),
    publicLimit: Number(s.publicLimit),
    treasury: getAddress(s.treasury),
    frozen: s.frozen,
    soldOut: Number(s.totalSupply) >= Number(s.maxSupply),
  };
}

/** How many tokens a wallet minted in each phase. */
export async function getMintedBy(client: ReadClient, nft: Address, account: Address): Promise<{ wl: number; pub: number }> {
  const [wl, pub] = await client.readContract({ address: nft, abi: elymumNFTAbi, functionName: 'mintedBy', args: [account] });
  return { wl: Number(wl), pub: Number(pub) };
}

export function getNftBalance(client: ReadClient, nft: Address, owner: Address): Promise<bigint> {
  return client.readContract({ address: nft, abi: elymumNFTAbi, functionName: 'balanceOf', args: [owner] });
}

export function getNftOwner(client: ReadClient, nft: Address): Promise<Address> {
  return client.readContract({ address: nft, abi: elymumNFTAbi, functionName: 'owner' });
}

export function getTokenURI(client: ReadClient, nft: Address, id: bigint): Promise<string> {
  return client.readContract({ address: nft, abi: elymumNFTAbi, functionName: 'tokenURI', args: [id] });
}

/** Parses a phase name (`closed`, `allowlist` / `wl`, `public`) or number. */
export function parseMintPhase(value: string | number): MintPhase {
  if (typeof value === 'number') {
    if (value === 0 || value === 1 || value === 2) return value;
    throw new RangeError(`unknown mint phase ${value}`);
  }
  const v = value.trim().toLowerCase();
  if (v === 'wl') return MintPhase.Allowlist;
  const i = (MINT_PHASE_NAMES as readonly string[]).indexOf(v);
  if (i < 0) throw new RangeError(`unknown mint phase ${JSON.stringify(value)} (closed, allowlist, public)`);
  return i as MintPhase;
}

/* -------------------------------------------------------------------- */
/* Mint                                                                  */
/* -------------------------------------------------------------------- */

/**
 * `price × qty` plus a buffer (default 1 %, rounded up). The contract refunds everything above
 * `price × qty` in the same call, so a keeper re-price between the read and the mint cannot fail it.
 */
export function mintValue(price: bigint, qty: number, bufferBps: number = DEFAULT_MINT_BUFFER_BPS): bigint {
  checkQty(qty);
  if (!Number.isInteger(bufferBps) || bufferBps < 0 || bufferBps > BPS) throw new RangeError(`buffer must be 0..${BPS} bps, got ${bufferBps}`);
  const cost = price * BigInt(qty);
  return cost + (cost * BigInt(bufferBps) + BigInt(BPS) - 1n) / BigInt(BPS);
}

export function mintAllowlistCall(nft: Address, p: { qty: number; proof: readonly Hex[]; price: bigint; bufferBps?: number }): NftCall {
  return { address: nft, abi: elymumNFTAbi, functionName: 'mintAllowlist', args: [BigInt(p.qty), [...p.proof]], value: mintValue(p.price, p.qty, p.bufferBps) };
}

export function mintPublicCall(nft: Address, p: { qty: number; price: bigint; bufferBps?: number }): NftCall {
  return { address: nft, abi: elymumNFTAbi, functionName: 'mintPublic', args: [BigInt(p.qty)], value: mintValue(p.price, p.qty, p.bufferBps) };
}

/**
 * Why a wallet cannot mint `qty` now, or null when it can (mirrors the contract's checks; the
 * proof itself is verified by the contract, `verifyMerkleProof` checks it off chain).
 */
export function mintRefusal(
  s: Pick<MintState, 'phase' | 'maxSupply' | 'totalSupply' | 'wlLimit' | 'publicLimit'>,
  minted: { wl: number; pub: number },
  p: { kind: 'allowlist' | 'public'; qty: number; eligible?: boolean },
): string | null {
  if (!Number.isInteger(p.qty) || p.qty < 1) return 'choose at least one';
  if (s.phase === MintPhase.Closed) return 'the mint is closed';
  if (p.kind === 'public' && s.phase !== MintPhase.Public) return 'the public mint is not open yet';
  if (p.kind === 'allowlist' && p.eligible === false) return 'this wallet is not on the allowlist';
  if (s.totalSupply + p.qty > s.maxSupply) return s.totalSupply >= s.maxSupply ? 'sold out' : `only ${s.maxSupply - s.totalSupply} left`;
  if (p.kind === 'allowlist' && minted.wl + p.qty > s.wlLimit) return `allowlist limit is ${s.wlLimit} per wallet (minted ${minted.wl})`;
  if (p.kind === 'public' && minted.pub + p.qty > s.publicLimit) return `public limit is ${s.publicLimit} per wallet (minted ${minted.pub})`;
  return null;
}

/* -------------------------------------------------------------------- */
/* Owner                                                                 */
/* -------------------------------------------------------------------- */

const call = (nft: Address, functionName: string, args: readonly unknown[]): NftCall => ({ address: nft, abi: elymumNFTAbi, functionName, args });

export const setPhaseCall = (nft: Address, phase: MintPhase | MintPhaseName): NftCall =>
  call(nft, 'setPhase', [parseMintPhase(phase)]);

export function setMerkleRootCall(nft: Address, root: Hex): NftCall {
  if (!/^0x[0-9a-fA-F]{64}$/.test(root)) throw new TypeError(`not a bytes32 root: ${root}`);
  return call(nft, 'setMerkleRoot', [root]);
}

export function setPriceCall(nft: Address, wei: bigint): NftCall {
  if (wei < 0n) throw new RangeError('price must not be negative');
  return call(nft, 'setPrice', [wei]);
}

export function setPriceBoundsCall(nft: Address, minWei: bigint, maxWei: bigint): NftCall {
  if (minWei <= 0n || minWei > maxWei) throw new RangeError('price bounds need 0 < min <= max');
  return call(nft, 'setPriceBounds', [minWei, maxWei]);
}

/** `null` removes the keeper. */
export function setPriceKeeperCall(nft: Address, keeper: Address | null): NftCall {
  if (keeper !== null) checkAddress('keeper', keeper);
  return call(nft, 'setPriceKeeper', [keeper === null ? '0x0000000000000000000000000000000000000000' : getAddress(keeper)]);
}

export function setLimitsCall(nft: Address, wl: number, pub: number): NftCall {
  checkU16('allowlist limit', wl);
  checkU16('public limit', pub);
  return call(nft, 'setLimits', [wl, pub]);
}

export function setMaxSupplyCall(nft: Address, max: number): NftCall {
  checkU32('max supply', max);
  return call(nft, 'setMaxSupply', [max]);
}

export function ownerMintCall(nft: Address, to: Address, qty: number): NftCall {
  checkAddress('to', to, { nonZero: true });
  checkQty(qty);
  return call(nft, 'ownerMint', [getAddress(to), BigInt(qty)]);
}

export const setBaseURICall = (nft: Address, uri: string): NftCall => call(nft, 'setBaseURI', [uri]);
export const setContractURICall = (nft: Address, uri: string): NftCall => call(nft, 'setContractURI', [uri]);
export const freezeMetadataCall = (nft: Address): NftCall => call(nft, 'freezeMetadata', []);

export function setTreasuryCall(nft: Address, treasury: Address): NftCall {
  checkAddress('treasury', treasury, { nonZero: true });
  return call(nft, 'setTreasury', [getAddress(treasury)]);
}

export function setRoyaltyCall(nft: Address, receiver: Address, bps: number): NftCall {
  checkAddress('royalty receiver', receiver, { nonZero: true });
  if (!Number.isInteger(bps) || bps < 0 || bps > MAX_ROYALTY_BPS) throw new RangeError(`royalty must be 0..${MAX_ROYALTY_BPS} bps, got ${bps}`);
  return call(nft, 'setRoyalty', [getAddress(receiver), BigInt(bps)]);
}

export const withdrawCall = (nft: Address): NftCall => call(nft, 'withdraw', []);

/* -------------------------------------------------------------------- */
/* Deploy                                                                */
/* -------------------------------------------------------------------- */

export interface DeployNftArgs {
  owner: Address;
  maxSupply: number;
  /** Wei per token. */
  mintPrice: bigint;
  wlLimit: number;
  publicLimit: number;
  /** `tokenURI(id) = baseURI + id`; the deploy form defaults it to `${PUBLIC_URL}/api/nft/`. */
  baseURI: string;
  treasury: Address;
}

export function deployNftParams(args: DeployNftArgs) {
  checkAddress('owner', args.owner, { nonZero: true });
  checkAddress('treasury', args.treasury, { nonZero: true });
  checkU32('max supply', args.maxSupply);
  checkU16('allowlist limit', args.wlLimit);
  checkU16('public limit', args.publicLimit);
  if (args.mintPrice < 0n) throw new RangeError('mint price must not be negative');
  return {
    abi: elymumNFTAbi,
    bytecode: elymumNFTArtifact.bytecode,
    args: [getAddress(args.owner), args.maxSupply, args.mintPrice, args.wlLimit, args.publicLimit, args.baseURI, getAddress(args.treasury)] as const,
  };
}

/** Deploys `ElymumNFT` with the bundled bytecode. Returns the transaction hash (see `deployedAddress`). */
export function deployNft(wallet: WalletClient, args: DeployNftArgs, opts: { account?: Account | Address; chain?: Chain | null } = {}): Promise<Hash> {
  const p = deployNftParams(args);
  return wallet.deployContract({
    abi: p.abi,
    bytecode: p.bytecode,
    args: p.args,
    account: opts.account ?? wallet.account ?? null,
    chain: opts.chain === undefined ? wallet.chain : opts.chain,
  } as never);
}

/* -------------------------------------------------------------------- */

function checkQty(qty: number): void {
  if (!Number.isInteger(qty) || qty < 1 || qty > 0xffff) throw new RangeError(`quantity must be an integer in 1..65535, got ${qty}`);
}
function checkU16(label: string, v: number): void {
  if (!Number.isInteger(v) || v < 0 || v > 0xffff) throw new RangeError(`${label} must be an integer in 0..65535, got ${v}`);
}
function checkU32(label: string, v: number): void {
  if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new RangeError(`${label} must be an integer in 0..4294967295, got ${v}`);
}
