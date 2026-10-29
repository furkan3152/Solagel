import { elymumArenaAbi, elymumArenaArtifact, testTokenAbi, testTokenArtifact } from '@elymum/contracts';
import { DEFAULT_ARENAS } from '@elymum/shared';
import { erc20Abi, getAddress, isAddress, type Account, type Address, type Chain, type Hash, type PublicClient, type WalletClient } from 'viem';
import type { ContractCall } from './call';
import {
  MAX_ARENA_ID,
  MAX_ARENA_SESSIONS,
  MAX_FEE_BPS,
  MAX_UINT128,
  MAX_UINT64,
  MIN_ARENA_ID,
  MIN_ARENA_SESSIONS,
  REFUND_DELAY_SECS,
  SETTLE_CHUNK,
} from './constants';
import { isZeroAddress } from './format';

/**
 * `ElymumArena`: typed reads and call builders. Every builder validates its input like the
 * contract does (throws `RangeError` / `TypeError` before anything is signed) and returns a
 * `ContractCall` for `sendCall`, a browser wallet's `writeContract`, or a preview.
 */

type ReadClient = Pick<PublicClient, 'readContract'>;

export type ArenaAbi = typeof elymumArenaAbi;
export type ArenaCall = ContractCall<ArenaAbi>;
export type Erc20Call = ContractCall<typeof erc20Abi>;

/* -------------------------------------------------------------------- */
/* Views                                                                 */
/* -------------------------------------------------------------------- */

export interface ArenaConfig {
  address: Address;
  /** Owner (Ownable2Step). */
  admin: Address;
  /** Pending owner of a two-step transfer, null when none. */
  pendingAdmin: Address | null;
  serverAuthority: Address;
  feeWallet: Address;
  /** Game token, null until `setToken`. */
  token: Address | null;
  /** The token's decimals (18 until the token is set). */
  decimals: number;
  feeBps: number;
  paused: boolean;
  totals: {
    sessions: bigint;
    games: bigint;
    staked: bigint;
    paidOut: bigint;
    fees: bigint;
    burned: bigint;
  };
}

export interface ArenaInfo {
  id: number;
  entryFee: bigint;
  /** Spendable by settle / refund / sweepLoot / sweepArena. */
  vault: bigint;
  /** Reserved for finalized sessions (collected with `refund`). */
  owed: bigint;
  maxSessions: number;
  openSessions: number;
  enabled: boolean;
  exists: boolean;
  totalDeposited: bigint;
  totalPaidOut: bigint;
  totalBurned: bigint;
  lastSweepId: bigint;
}

export interface SessionInfo {
  arenaId: number;
  player: Address;
  /** 0n means no session. */
  id: bigint;
  entryFee: bigint;
  /** Unix seconds. */
  openedAt: number;
  feeBps: number;
  /** Settled; the player's share waits as `owed` (collect with `refund`). */
  finalized: boolean;
  owed: bigint;
}

const nullIfZero = (a: Address): Address | null => (isZeroAddress(a) ? null : getAddress(a));

export async function getArenaConfig(client: ReadClient, arena: Address): Promise<ArenaConfig> {
  const c = await client.readContract({ address: arena, abi: elymumArenaAbi, functionName: 'config' });
  return {
    address: getAddress(arena),
    admin: getAddress(c.admin),
    pendingAdmin: nullIfZero(c.pendingAdmin),
    serverAuthority: getAddress(c.serverAuthority),
    feeWallet: getAddress(c.feeWallet),
    token: nullIfZero(c.token),
    decimals: c.token && !isZeroAddress(c.token) ? Number(c.decimals) : 18,
    feeBps: Number(c.feeBps),
    paused: c.paused,
    totals: {
      sessions: c.totalSessions,
      games: c.totalGames,
      staked: c.totalStaked,
      paidOut: c.totalPaidOut,
      fees: c.totalFees,
      burned: c.totalBurned,
    },
  };
}

export async function getArenaIds(client: ReadClient, arena: Address): Promise<number[]> {
  const ids = await client.readContract({ address: arena, abi: elymumArenaAbi, functionName: 'arenaIds' });
  return ids.map(Number);
}

/** An arena by id (`exists: false` when it was never created). */
export async function getArena(client: ReadClient, arena: Address, id: number): Promise<ArenaInfo> {
  checkArenaId(id);
  const a = await client.readContract({ address: arena, abi: elymumArenaAbi, functionName: 'getArena', args: [id] });
  return {
    id: Number(a.id),
    entryFee: a.entryFee,
    vault: a.vault,
    owed: a.owed,
    maxSessions: Number(a.maxSessions),
    openSessions: Number(a.openSessions),
    enabled: a.enabled,
    exists: a.exists,
    totalDeposited: a.totalDeposited,
    totalPaidOut: a.totalPaidOut,
    totalBurned: a.totalBurned,
    lastSweepId: a.lastSweepId,
  };
}

/** A player's session in an arena (`id: 0n` when none). */
export async function getSession(client: ReadClient, arena: Address, arenaId: number, player: Address): Promise<SessionInfo> {
  checkArenaId(arenaId);
  const s = await client.readContract({ address: arena, abi: elymumArenaAbi, functionName: 'getSession', args: [arenaId, player] });
  return {
    arenaId,
    player: getAddress(player),
    id: s.id,
    entryFee: s.entryFee,
    openedAt: Number(s.openedAt),
    feeBps: Number(s.feeBps),
    finalized: s.finalized,
    owed: s.owed,
  };
}

/** Every created arena, in creation order. */
export async function listArenas(client: ReadClient, arena: Address): Promise<ArenaInfo[]> {
  const ids = await getArenaIds(client, arena);
  return Promise.all(ids.map((id) => getArena(client, arena, id)));
}

/** `ElymumArena.computeFee` on chain (the off-chain twin is `computeFee` in math.ts). */
export async function computeFeeOnChain(client: ReadClient, arena: Address, payout: bigint, entryFee: bigint, feeBps: number): Promise<bigint> {
  return client.readContract({ address: arena, abi: elymumArenaAbi, functionName: 'computeFee', args: [payout, entryFee, feeBps] });
}

/** What a session can do now: nothing, collect `owed` (finalized), or refund after the 24 h delay. */
export function sessionRefundState(
  s: Pick<SessionInfo, 'id' | 'finalized' | 'openedAt' | 'owed' | 'entryFee'>,
  nowSecs: number = Math.floor(Date.now() / 1000),
): { kind: 'none' } | { kind: 'collect'; amount: bigint } | { kind: 'refund'; amount: bigint } | { kind: 'wait'; availableAt: number } {
  if (s.id === 0n) return { kind: 'none' };
  if (s.finalized) return { kind: 'collect', amount: s.owed };
  const at = s.openedAt + REFUND_DELAY_SECS;
  return nowSecs >= at ? { kind: 'refund', amount: s.entryFee } : { kind: 'wait', availableAt: at };
}

/* -------------------------------------------------------------------- */
/* ERC-20 game token                                                     */
/* -------------------------------------------------------------------- */

export interface TokenInfo {
  address: Address;
  name: string | null;
  symbol: string | null;
  decimals: number;
}

/** Name, symbol and decimals of an ERC-20 (name/symbol null when the call fails; decimals default 18 like the contract). */
export async function getTokenInfo(client: ReadClient, token: Address): Promise<TokenInfo> {
  const [name, symbol, decimals] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: 'name' }).catch(() => null),
    client.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }).catch(() => null),
    client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }).catch(() => 18),
  ]);
  return { address: getAddress(token), name, symbol, decimals: Number(decimals) };
}

export function getTokenBalance(client: ReadClient, token: Address, owner: Address): Promise<bigint> {
  return client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] });
}

export function getAllowance(client: ReadClient, token: Address, owner: Address, spender: Address): Promise<bigint> {
  return client.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [owner, spender] });
}

export function approveCall(token: Address, spender: Address, amount: bigint): Erc20Call {
  checkAddress('spender', spender);
  if (amount < 0n || amount > (1n << 256n) - 1n) throw new RangeError(`approve amount out of range: ${amount}`);
  return { address: token, abi: erc20Abi, functionName: 'approve', args: [spender, amount] };
}

/* -------------------------------------------------------------------- */
/* Players                                                               */
/* -------------------------------------------------------------------- */

export function joinCall(arena: Address, arenaId: number): ArenaCall {
  checkArenaId(arenaId);
  return { address: arena, abi: elymumArenaAbi, functionName: 'join', args: [arenaId] };
}

/** Refund after 24 h, or collect `owed` of a finalized session. */
export function refundCall(arena: Address, arenaId: number): ArenaCall {
  checkArenaId(arenaId);
  return { address: arena, abi: elymumArenaAbi, functionName: 'refund', args: [arenaId] };
}

export interface JoinPlan {
  entryFee: bigint;
  allowance: bigint;
  balance: bigint;
  /** Exact-amount `approve` when the allowance is short, else null. */
  approve: Erc20Call | null;
  join: ArenaCall;
  /** Calls in order (approve first when needed). */
  calls: ContractCall[];
}

/**
 * The ticket flow: reads the arena's entry fee, the player's allowance and balance, and returns
 * `approve` (only when the allowance is short; exact amount) + `join`. Throws a `RangeError`
 * when the arena is missing, disabled or full, the token is not set, or the balance is short.
 */
export async function planJoin(
  client: ReadClient,
  p: { arena: Address; arenaId: number; player: Address; token?: Address },
): Promise<JoinPlan> {
  const [info, token] = await Promise.all([
    getArena(client, p.arena, p.arenaId),
    p.token ? Promise.resolve(p.token) : getArenaConfig(client, p.arena).then((c) => c.token),
  ]);
  if (!token) throw new RangeError('the arena contract has no game token yet');
  if (!info.exists) throw new RangeError(`arena #${p.arenaId} does not exist`);
  if (!info.enabled) throw new RangeError(`arena #${p.arenaId} is closed`);
  if (info.openSessions >= info.maxSessions) throw new RangeError(`arena #${p.arenaId} is full`);
  const [allowance, balance] = await Promise.all([getAllowance(client, token, p.player, p.arena), getTokenBalance(client, token, p.player)]);
  if (balance < info.entryFee) throw new RangeError(`balance too low for the ticket (need ${info.entryFee}, have ${balance} base units)`);
  const approve = allowance < info.entryFee ? approveCall(token, p.arena, info.entryFee) : null;
  const join = joinCall(p.arena, p.arenaId);
  return { entryFee: info.entryFee, allowance, balance, approve, join, calls: approve ? [approve, join] : [join] };
}

/* -------------------------------------------------------------------- */
/* Server                                                                */
/* -------------------------------------------------------------------- */

/** One item of a `settle` batch. */
export interface Settlement {
  arenaId: number;
  player: Address;
  sessionId: bigint;
  /** Base units (fee included); see `fromLedger`. */
  payout: bigint;
}

function checkSettlement(s: Settlement): void {
  checkArenaId(s.arenaId);
  checkAddress('player', s.player);
  if (typeof s.sessionId !== 'bigint' || s.sessionId <= 0n || s.sessionId > MAX_UINT64) throw new RangeError(`sessionId must be a uint64 > 0, got ${s.sessionId}`);
  if (typeof s.payout !== 'bigint' || s.payout < 0n || s.payout > MAX_UINT128) throw new RangeError(`payout must be a uint128, got ${s.payout}`);
}

/** Splits items into chunks of at most `size` (default 40, `SETTLE_CHUNK`). */
export function chunkSettlements<T>(items: readonly T[], size: number = SETTLE_CHUNK): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError(`chunk size must be a positive integer, got ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** One `settle` call for up to any number of items (prefer `settleCalls`, which chunks). */
export function settleCall(arena: Address, items: readonly Settlement[]): ArenaCall {
  if (items.length === 0) throw new RangeError('settle needs at least one item');
  for (const s of items) checkSettlement(s);
  return {
    address: arena,
    abi: elymumArenaAbi,
    functionName: 'settle',
    args: [items.map((s) => ({ arenaId: s.arenaId, player: getAddress(s.player), sessionId: s.sessionId, payout: s.payout }))],
  };
}

/** `settle` calls of at most `chunk` items each (default 40). */
export function settleCalls(arena: Address, items: readonly Settlement[], chunk: number = SETTLE_CHUNK): ArenaCall[] {
  return chunkSettlements(items, chunk).map((c) => settleCall(arena, c));
}

/** Burns floor loot; `sweepId` must be larger than the arena's `lastSweepId`. */
export function sweepLootCall(arena: Address, arenaId: number, sweepId: bigint, amount: bigint): ArenaCall {
  checkArenaId(arenaId);
  if (sweepId <= 0n || sweepId > MAX_UINT64) throw new RangeError(`sweepId must be a uint64 > 0, got ${sweepId}`);
  if (amount < 0n || amount > MAX_UINT128) throw new RangeError(`amount must be a uint128, got ${amount}`);
  return { address: arena, abi: elymumArenaAbi, functionName: 'sweepLoot', args: [arenaId, sweepId, amount] };
}

/* -------------------------------------------------------------------- */
/* Owner                                                                 */
/* -------------------------------------------------------------------- */

export function setTokenCall(arena: Address, token: Address): ArenaCall {
  checkAddress('token', token, { nonZero: true });
  return { address: arena, abi: elymumArenaAbi, functionName: 'setToken', args: [getAddress(token)] };
}

export function setFeeBpsCall(arena: Address, bps: number): ArenaCall {
  checkFeeBps(bps);
  return { address: arena, abi: elymumArenaAbi, functionName: 'setFeeBps', args: [bps] };
}

export function setFeeWalletCall(arena: Address, wallet: Address): ArenaCall {
  checkAddress('fee wallet', wallet, { nonZero: true });
  return { address: arena, abi: elymumArenaAbi, functionName: 'setFeeWallet', args: [getAddress(wallet)] };
}

export function setServerAuthorityCall(arena: Address, server: Address): ArenaCall {
  checkAddress('server authority', server, { nonZero: true });
  return { address: arena, abi: elymumArenaAbi, functionName: 'setServerAuthority', args: [getAddress(server)] };
}

export function setPausedCall(arena: Address, paused: boolean): ArenaCall {
  return { address: arena, abi: elymumArenaAbi, functionName: 'setPaused', args: [paused] };
}

export interface ArenaParams {
  id: number;
  entryFee: bigint;
  maxSessions: number;
}

export function createArenaCall(arena: Address, p: ArenaParams): ArenaCall {
  checkArenaId(p.id);
  checkArenaParams(p.entryFee, p.maxSessions);
  return { address: arena, abi: elymumArenaAbi, functionName: 'createArena', args: [p.id, p.entryFee, p.maxSessions] };
}

/** All fields are written (the contract has no partial update); the entry fee changes only while no ticket is open. */
export function updateArenaCall(arena: Address, p: ArenaParams & { enabled: boolean }): ArenaCall {
  checkArenaId(p.id);
  checkArenaParams(p.entryFee, p.maxSessions);
  return { address: arena, abi: elymumArenaAbi, functionName: 'updateArena', args: [p.id, p.entryFee, p.maxSessions, p.enabled] };
}

/** `updateArena` from the current state plus a partial change. */
export function updateArenaFrom(arena: Address, current: Pick<ArenaInfo, 'id' | 'entryFee' | 'maxSessions' | 'enabled'>, changes: Partial<Pick<ArenaInfo, 'entryFee' | 'maxSessions' | 'enabled'>>): ArenaCall {
  return updateArenaCall(arena, {
    id: current.id,
    entryFee: changes.entryFee ?? current.entryFee,
    maxSessions: changes.maxSessions ?? current.maxSessions,
    enabled: changes.enabled ?? current.enabled,
  });
}

export function sweepArenaCall(arena: Address, id: number): ArenaCall {
  checkArenaId(id);
  return { address: arena, abi: elymumArenaAbi, functionName: 'sweepArena', args: [id] };
}

/** Recovers HYPE (`token` null/zero) or a foreign ERC-20; never the game token. */
export function rescueCall(arena: Address, p: { token: Address | null; to: Address; amount: bigint }): ArenaCall {
  checkAddress('to', p.to, { nonZero: true });
  const token = p.token ?? '0x0000000000000000000000000000000000000000';
  return { address: arena, abi: elymumArenaAbi, functionName: 'rescue', args: [token, getAddress(p.to), p.amount] };
}

/** Ownable2Step: starts a transfer (the new owner must `acceptOwnership`). Works for the arena and the NFT. */
export function transferOwnershipCall(contract: Address, newOwner: Address): ArenaCall {
  checkAddress('new owner', newOwner, { nonZero: true });
  return { address: contract, abi: elymumArenaAbi, functionName: 'transferOwnership', args: [getAddress(newOwner)] };
}

export function acceptOwnershipCall(contract: Address): ArenaCall {
  return { address: contract, abi: elymumArenaAbi, functionName: 'acceptOwnership', args: [] };
}

/** The four default tiers of `@elymum/shared` in base units of a token with `decimals`. */
export function defaultArenaParams(decimals: number): ArenaParams[] {
  return DEFAULT_ARENAS.map((a) => ({ id: a.id, entryFee: BigInt(a.entryTokens) * 10n ** BigInt(decimals), maxSessions: a.maxSessions }));
}

/** `createArena` calls for the default tiers that do not exist yet. */
export function createDefaultArenaCalls(arena: Address, decimals: number, existingIds: readonly number[] = []): ArenaCall[] {
  return defaultArenaParams(decimals)
    .filter((p) => !existingIds.includes(p.id))
    .map((p) => createArenaCall(arena, p));
}

/* -------------------------------------------------------------------- */
/* Deploy                                                                */
/* -------------------------------------------------------------------- */

export interface DeployArenaArgs {
  admin: Address;
  serverAuthority: Address;
  feeWallet: Address;
}

/** Fields for viem's `deployContract` (also used to preview the deploy). */
export function deployArenaParams(args: DeployArenaArgs) {
  checkAddress('admin', args.admin, { nonZero: true });
  checkAddress('server authority', args.serverAuthority, { nonZero: true });
  checkAddress('fee wallet', args.feeWallet, { nonZero: true });
  return {
    abi: elymumArenaAbi,
    bytecode: elymumArenaArtifact.bytecode,
    args: [getAddress(args.admin), getAddress(args.serverAuthority), getAddress(args.feeWallet)] as const,
  };
}

type DeployOpts = { account?: Account | Address; chain?: Chain | null };

function deploy(wallet: WalletClient, p: { abi: readonly unknown[]; bytecode: `0x${string}`; args: readonly unknown[] }, opts: DeployOpts): Promise<Hash> {
  return wallet.deployContract({
    abi: p.abi,
    bytecode: p.bytecode,
    args: p.args,
    account: opts.account ?? wallet.account ?? null,
    chain: opts.chain === undefined ? wallet.chain : opts.chain,
  } as never);
}

/** Deploys `ElymumArena` with the bundled bytecode. Returns the transaction hash (see `deployedAddress`). */
export function deployArena(wallet: WalletClient, args: DeployArenaArgs, opts: DeployOpts = {}): Promise<Hash> {
  return deploy(wallet, deployArenaParams(args), opts);
}

/** Fields for deploying the `TestToken` (localnet and testnet only). */
export function deployTestTokenParams(args: { owner: Address }) {
  checkAddress('owner', args.owner, { nonZero: true });
  return { abi: testTokenAbi, bytecode: testTokenArtifact.bytecode, args: [getAddress(args.owner)] as const };
}

/** Deploys the `TestToken` (localnet and testnet only; the caller checks the chain). */
export function deployTestToken(wallet: WalletClient, args: { owner: Address }, opts: DeployOpts = {}): Promise<Hash> {
  return deploy(wallet, deployTestTokenParams(args), opts);
}

/** `TestToken.faucet()`: 1,000,000 tokens to the caller, once per hour. */
export function faucetCall(token: Address): ContractCall<typeof testTokenAbi> {
  return { address: token, abi: testTokenAbi, functionName: 'faucet', args: [] };
}

/** `TestToken.mint(to, amount)` (owner). */
export function testTokenMintCall(token: Address, to: Address, amount: bigint): ContractCall<typeof testTokenAbi> {
  checkAddress('to', to, { nonZero: true });
  return { address: token, abi: testTokenAbi, functionName: 'mint', args: [getAddress(to), amount] };
}

/** Waits for a deploy transaction and returns the new contract's address. */
export async function deployedAddress(client: Pick<PublicClient, 'waitForTransactionReceipt'>, hash: Hash): Promise<Address> {
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== 'success' || !r.contractAddress) throw new Error(`deploy transaction ${hash} failed`);
  return getAddress(r.contractAddress);
}

/* -------------------------------------------------------------------- */
/* Validation                                                            */
/* -------------------------------------------------------------------- */

export function checkArenaId(id: number): void {
  if (!Number.isInteger(id) || id < MIN_ARENA_ID || id > MAX_ARENA_ID) throw new RangeError(`arena id must be an integer in ${MIN_ARENA_ID}..${MAX_ARENA_ID}, got ${id}`);
}

export function checkFeeBps(bps: number): void {
  if (!Number.isInteger(bps) || bps < 0 || bps > MAX_FEE_BPS) throw new RangeError(`fee must be an integer in 0..${MAX_FEE_BPS} bps, got ${bps}`);
}

export function checkArenaParams(entryFee: bigint, maxSessions: number): void {
  if (typeof entryFee !== 'bigint' || entryFee <= 0n || entryFee > MAX_UINT128) throw new RangeError(`entry fee must be a uint128 > 0, got ${entryFee}`);
  if (!Number.isInteger(maxSessions) || maxSessions < MIN_ARENA_SESSIONS || maxSessions > MAX_ARENA_SESSIONS) {
    throw new RangeError(`max sessions must be an integer in ${MIN_ARENA_SESSIONS}..${MAX_ARENA_SESSIONS}, got ${maxSessions}`);
  }
}

export function checkAddress(label: string, a: string, opts: { nonZero?: boolean } = {}): void {
  if (typeof a !== 'string' || !isAddress(a, { strict: false })) throw new TypeError(`${label} is not an address: ${String(a)}`);
  if (opts.nonZero && isZeroAddress(a)) throw new RangeError(`${label} must not be the zero address`);
}
