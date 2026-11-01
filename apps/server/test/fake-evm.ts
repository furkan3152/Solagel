import { elymumArenaAbi, elymumNFTAbi, testTokenAbi, type ArenaConfig, type ArenaInfo, type ContractCall, type MintState, type SessionInfo, type TestTokenFaucetConfig } from '@elymum/sdk';
import { encodeErrorResult, getAddress, keccak256, toHex, type Address, type Hash, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { ArenaEvent, CodeCheck, ContractKindCode, EvmClient, EvmSigner, JoinedLog, TransferLog, TxReceipt } from '../src/chain/evm-client';

export const SERVER = getAddress('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
export const ADMIN = getAddress('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
export const FEE_WALLET = getAddress('0x15d34aaf54267db7d7c367839aaf71a00a2c6a65');
export const ARENA = getAddress('0x5fbdb2315678afecb367f032d93f642f64180aa3');
export const NFT = getAddress('0xe7f1725e7734ce288f8367e1bb143e90bb3f0512');
export const TOKEN = getAddress('0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0');
export const E18 = 10n ** 18n;
const ZERO = '0x0000000000000000000000000000000000000000' as Address;

/** An error shaped like a viem/RPC revert carrying a custom error of the contracts (decoded by `describeError`). */
export function revert(name: string, args: readonly unknown[] = [], abi: readonly unknown[] = elymumArenaAbi): Error & { data: Hex } {
  const data = encodeErrorResult({ abi: abi as never, errorName: name, args } as never);
  return Object.assign(new Error(`execution reverted: ${name}`), { code: 3, data });
}

let hashSeq = 0;
const nextHash = (): Hash => keccak256(toHex(`tx-${++hashSeq}-${Math.random()}`));

/**
 * A TypeScript model of `ElymumArena` + `ElymumNFT` behind the `EvmClient` seam: sessions, vaults, the
 * skip rules of `settle`, sweep ids, `Joined` logs and receipts. Tests poke its state directly.
 */
export class FakeEvm implements EvmClient {
  readonly address: Address;
  chainId = 31337;
  block = 1_000n;
  rpcDown = false;
  balanceWei = 5n * E18;
  code = new Map<string, CodeCheck>();
  config: ArenaConfig;
  arenaMap = new Map<number, ArenaInfo>();
  sessions = new Map<string, SessionInfo>();
  joined: (JoinedLog & { arena: Address })[] = [];
  transfers: TransferLog[] = [];
  receipts = new Map<Hash, TxReceipt>();
  /** Every call sent (after the simulation passed). */
  sent: ContractCall[] = [];
  /** Thrown by the next `send` calls, in order (before anything changes). */
  failures: unknown[] = [];
  /** `receipt` answers null (not mined yet) while true; the effects already happened. */
  holdReceipts = false;
  /** Players whose token transfer fails (`settle` finalizes them with `owed`). */
  refusing = new Set<string>();
  /** The fee wallet cannot receive the token: a settle with a fee reverts (SafeERC20FailedOperation). */
  feeWalletBroken = false;
  /** Runs right before a `settle` is executed (lets a test change state between the pre-check and the tx). */
  beforeSettle: (() => void) | null = null;
  deployAt = 10n;
  nextSessionId = 1n;
  owners = new Map<string, Address>();
  mint: MintState;
  balances = new Map<string, bigint>();
  /** Game token balances (base units), by lower-case owner. */
  tokens = new Map<string, bigint>();
  /** ERC-20 allowances: `owner:spender` (lower case). */
  allowances = new Map<string, bigint>();
  /** HYPE of every address but the server key (that one is `balanceWei`). */
  hype = new Map<string, bigint>();
  /** TestToken minters (lower case); the token owner (`owners`, default ADMIN) may always mint. */
  minters = new Set<string>();
  /** Arena holder checks (`isHolder`): wallets holding the holder NFT (lower case). */
  arenaHolders = new Set<string>();
  faucet: TestTokenFaucetConfig = { address: TOKEN, owner: ADMIN, amount: 1_000_000n * E18, holderAmount: 2_000_000n * E18, cooldownSecs: 3600, holderNft: null };
  /** Every call sent by another key (`signer`), with its sender. */
  sentBy: { from: Address; call: ContractCall }[] = [];
  /** HYPE sends of the server key. */
  valueSent: { to: Address; wei: bigint }[] = [];
  verified: { address: string; message: string; signature: string }[] = [];

  constructor(opts: { address?: Address; token?: Address | null; decimals?: number } = {}) {
    this.address = opts.address ?? SERVER;
    this.config = {
      address: ARENA,
      admin: ADMIN,
      pendingAdmin: null,
      serverAuthority: this.address,
      feeWallet: FEE_WALLET,
      token: opts.token === undefined ? TOKEN : opts.token,
      decimals: opts.decimals ?? 18,
      feeBps: 500,
      paused: false,
      totals: { sessions: 0n, games: 0n, staked: 0n, paidOut: 0n, fees: 0n, burned: 0n },
      holderNft: null,
      holderFeeBps: 500,
    };
    this.owners.set(NFT.toLowerCase(), ADMIN);
    this.mint = {
      address: NFT,
      phase: 0,
      phaseName: 'closed',
      price: 10n ** 16n,
      minPrice: 0n,
      maxPrice: 0n,
      keeper: null,
      root: `0x${'0'.repeat(64)}`,
      maxSupply: 1000,
      totalSupply: 0,
      wlLimit: 2,
      publicLimit: 5,
      treasury: ADMIN,
      frozen: false,
      soldOut: false,
    };
  }

  /**
   * Methods answering like the rate-limited public RPC (HTTP 429): method name → how many more calls
   * fail (`Infinity`: until removed).
   */
  limited = new Map<string, number>();

  private check(method?: string): void {
    if (this.rpcDown) throw new TypeError('fetch failed');
    const n = method ? this.limited.get(method) : undefined;
    if (n !== undefined && n > 0) {
      this.limited.set(method!, n - 1);
      throw Object.assign(new Error('HTTP request failed.\n\nStatus: 429\nDetails: {"error":"Rate Limit Exceeded. Please get an api key"}'), { status: 429 });
    }
  }

  /** Creates an arena (entry fee in whole tokens). */
  addArena(id: number, entryTokens: bigint, opts: Partial<ArenaInfo> = {}): ArenaInfo {
    const unit = 10n ** BigInt(this.config.decimals);
    const a: ArenaInfo = {
      id,
      entryFee: entryTokens * unit,
      vault: 0n,
      owed: 0n,
      holdersOnly: false,
      maxSessions: 300,
      openSessions: 0,
      enabled: true,
      exists: true,
      totalDeposited: 0n,
      totalPaidOut: 0n,
      totalBurned: 0n,
      lastSweepId: 0n,
      ...opts,
    };
    this.arenaMap.set(id, a);
    return a;
  }

  /** A player buys a ticket: the session opens, the vault grows, a `Joined` log is recorded. */
  join(arenaId: number, player: string, opts: { openedAt?: number } = {}): SessionInfo {
    const a = this.arenaMap.get(arenaId)!;
    const id = this.nextSessionId++;
    const s: SessionInfo = {
      arenaId,
      player: getAddress(player),
      id,
      entryFee: a.entryFee,
      openedAt: opts.openedAt ?? Math.floor(Date.now() / 1000),
      feeBps: this.config.feeBps,
      finalized: false,
      owed: 0n,
    };
    this.sessions.set(`${arenaId}:${player.toLowerCase()}`, s);
    a.vault += a.entryFee;
    a.openSessions += 1;
    this.block += 1n;
    this.joined.push({ arena: ARENA, arenaId, player: getAddress(player), sessionId: id, entryFee: a.entryFee, blockNumber: this.block });
    return s;
  }

  /** The player refunds / someone else settles: the session closes. */
  close(arenaId: number, player: string): void {
    const s = this.sessions.get(`${arenaId}:${player.toLowerCase()}`);
    if (!s) return;
    this.sessions.delete(`${arenaId}:${player.toLowerCase()}`);
    const a = this.arenaMap.get(arenaId)!;
    a.openSessions -= 1;
  }

  /* ---------------- EvmClient ---------------- */

  async getChainId() {
    this.check();
    return this.chainId;
  }
  async blockNumber() {
    this.check();
    return this.block;
  }
  async codeCheck(address: Address, _kind: ContractKindCode) {
    this.check('codeCheck');
    return this.code.get(address.toLowerCase()) ?? 'ok';
  }
  async hasCode(address: Address) {
    return (this.code.get(address.toLowerCase()) ?? 'ok') !== 'missing';
  }
  configReads = 0;
  async arenaConfig(_arena: Address) {
    this.check('arenaConfig');
    this.configReads++;
    return structuredClone(this.config);
  }
  async arenas(_arena: Address) {
    this.check('arenas');
    return [...this.arenaMap.values()].map((a) => ({ ...a }));
  }
  async arena(_arena: Address, id: number) {
    this.check('arena');
    const a = this.arenaMap.get(id);
    return a ? { ...a } : { ...this.addArenaShape(id) };
  }
  private addArenaShape(id: number): ArenaInfo {
    return { id, entryFee: 0n, vault: 0n, owed: 0n, maxSessions: 0, openSessions: 0, enabled: false, exists: false, totalDeposited: 0n, totalPaidOut: 0n, totalBurned: 0n, lastSweepId: 0n, holdersOnly: false };
  }
  sessionReads = 0;
  async session(_arena: Address, arenaId: number, player: Address) {
    this.check('session');
    this.sessionReads++;
    const s = this.sessions.get(`${arenaId}:${player.toLowerCase()}`);
    return s ? { ...s } : { arenaId, player: getAddress(player), id: 0n, entryFee: 0n, openedAt: 0, feeBps: 0, finalized: false, owed: 0n };
  }
  async balance(address: Address) {
    this.check();
    return address.toLowerCase() === this.address.toLowerCase() ? this.balanceWei : (this.hype.get(address.toLowerCase()) ?? 0n);
  }
  tokenOf(owner: string): bigint {
    return this.tokens.get(owner.toLowerCase()) ?? 0n;
  }
  private addTokens(owner: string, amount: bigint): void {
    this.tokens.set(owner.toLowerCase(), this.tokenOf(owner) + amount);
  }
  async tokenBalance(_token: Address, owner: Address) {
    this.check();
    return this.tokenOf(owner);
  }
  async allowance(_token: Address, owner: Address, spender: Address) {
    this.check();
    return this.allowances.get(`${owner.toLowerCase()}:${spender.toLowerCase()}`) ?? 0n;
  }
  async isMinter(_token: Address, who: Address) {
    this.check();
    return this.minters.has(who.toLowerCase());
  }
  async testTokenFaucet(_token: Address) {
    this.check();
    return { ...this.faucet };
  }
  async isArenaHolder(_arena: Address, who: Address) {
    this.check();
    return this.arenaHolders.has(who.toLowerCase());
  }
  async sendValue(to: Address, wei: bigint): Promise<Hash> {
    this.check();
    if (this.balanceWei < wei) throw new Error('insufficient funds for gas * price + value');
    this.balanceWei -= wei;
    this.hype.set(to.toLowerCase(), (this.hype.get(to.toLowerCase()) ?? 0n) + wei);
    this.valueSent.push({ to: getAddress(to), wei });
    return this.mined([]);
  }
  /** Gas a bot transaction burns (the model charges every bot send this much HYPE). */
  botGasWei = 10n ** 14n;
  signer(privateKey: Hex): EvmSigner {
    const address = privateKeyToAccount(privateKey).address;
    return { address, send: (call) => this.sendFrom(address, call) };
  }
  private mined(events: ArenaEvent[]): Hash {
    const hash = nextHash();
    this.block += 1n;
    this.receipts.set(hash, { status: 'success', blockNumber: this.block, events });
    return hash;
  }
  /** A player-side call (`approve`, `join`, `refund`) sent by `from`. */
  async sendFrom(from: Address, call: ContractCall): Promise<Hash> {
    this.check();
    const key = from.toLowerCase();
    const gas = this.hype.get(key) ?? 0n;
    if (gas < this.botGasWei) throw new Error('insufficient funds for gas * price + value');
    if (call.functionName === 'approve') {
      const [spender, amount] = call.args as [Address, bigint];
      this.allowances.set(`${key}:${spender.toLowerCase()}`, amount);
    } else if (call.functionName === 'join') {
      const [arenaId] = call.args as [number];
      const a = this.arenaMap.get(arenaId);
      if (!a || !a.exists) throw revert('UnknownArena');
      if (!a.enabled) throw revert('ArenaDisabled');
      if (a.holdersOnly && !this.arenaHolders.has(key)) throw revert('HoldersOnly');
      if (this.sessions.has(`${arenaId}:${key}`)) throw revert('SessionExists');
      const allowance = this.allowances.get(`${key}:${ARENA.toLowerCase()}`) ?? 0n;
      if (allowance < a.entryFee || this.tokenOf(from) < a.entryFee) throw new Error('execution reverted: ERC20InsufficientAllowance/Balance');
      this.allowances.set(`${key}:${ARENA.toLowerCase()}`, allowance === (1n << 256n) - 1n ? allowance : allowance - a.entryFee);
      this.addTokens(from, -a.entryFee);
      this.join(arenaId, from);
    } else if (call.functionName === 'refund') {
      const [arenaId] = call.args as [number];
      const s = this.sessions.get(`${arenaId}:${key}`);
      if (!s?.finalized) throw revert('NothingToRefund');
      this.addTokens(from, s.owed);
      this.arenaMap.get(arenaId)!.owed -= s.owed;
      this.sessions.delete(`${arenaId}:${key}`);
    } else {
      throw new Error(`FakeEvm: ${call.functionName} from a player key is not modelled`);
    }
    this.hype.set(key, gas - this.botGasWei);
    this.sentBy.push({ from: getAddress(from), call });
    return this.mined([]);
  }
  logRequests: [bigint, bigint][] = [];
  async joinedLogs(_arena: Address, from: bigint, to: bigint) {
    this.check();
    this.logRequests.push([from, to]);
    return this.joined.filter((j) => j.blockNumber >= from && j.blockNumber <= to);
  }
  async transferLogs(_nft: Address, from: bigint, to: bigint) {
    this.check('transferLogs');
    return this.transfers.filter((t) => t.blockNumber >= from && t.blockNumber <= to);
  }
  async deployBlock() {
    return this.deployAt;
  }
  async txBlock() {
    return null;
  }

  async send(call: ContractCall): Promise<Hash> {
    this.check();
    const failure = this.failures.shift();
    if (failure !== undefined) throw failure;
    const hash = nextHash();
    let events: ArenaEvent[] = [];
    if (call.functionName === 'settle') {
      if (this.config.serverAuthority.toLowerCase() !== this.address.toLowerCase()) throw revert('NotServer');
      this.beforeSettle?.();
      this.beforeSettle = null;
      const items = call.args[0] as { arenaId: number; player: Address; sessionId: bigint; payout: bigint }[];
      // simulation: a failing fee transfer reverts the whole batch before anything happens
      if (this.feeWalletBroken && items.some((it) => this.feeOf(it) > 0n)) throw revert('SafeERC20FailedOperation', [TOKEN]);
      for (const it of items) events.push(this.settleOne(it));
    } else if (call.functionName === 'sweepLoot') {
      if (this.config.serverAuthority.toLowerCase() !== this.address.toLowerCase()) throw revert('NotServer');
      const [arenaId, sweepId, amount] = call.args as [number, bigint, bigint];
      const a = this.arenaMap.get(arenaId);
      if (!a) throw revert('UnknownArena');
      if (sweepId <= a.lastSweepId) throw revert('SweepIdNotIncreasing');
      if (amount > a.vault) throw revert('InsufficientVault');
      a.lastSweepId = sweepId;
      a.vault -= amount;
      a.totalBurned += amount;
      events = [{ name: 'LootBurned', arenaId, sweepId, amount }];
    } else if (call.functionName === 'mint' && call.abi === testTokenAbi) {
      const [to, amount] = call.args as [Address, bigint];
      const owner = this.owners.get(TOKEN.toLowerCase()) ?? ADMIN;
      if (owner.toLowerCase() !== this.address.toLowerCase() && !this.minters.has(this.address.toLowerCase())) throw revert('OwnableUnauthorizedAccount', [this.address], testTokenAbi);
      this.addTokens(to, amount);
    } else if (call.functionName === 'setPrice') {
      const [wei] = call.args as [bigint];
      if (this.mint.keeper?.toLowerCase() !== this.address.toLowerCase()) throw revert('NotPriceSetter', [], elymumNFTAbi);
      if (this.mint.maxPrice !== 0n && (wei < this.mint.minPrice || wei > this.mint.maxPrice)) throw revert('PriceOutOfBounds', [], elymumNFTAbi);
      this.mint.price = wei;
    }
    this.sent.push(call);
    this.block += 1n;
    this.receipts.set(hash, { status: 'success', blockNumber: this.block, events });
    return hash;
  }

  private feeOf(it: { arenaId: number; player: Address; payout: bigint }): bigint {
    const s = this.sessions.get(`${it.arenaId}:${it.player.toLowerCase()}`);
    if (!s) return 0n;
    return it.payout > s.entryFee ? ((it.payout - s.entryFee) * BigInt(s.feeBps)) / 10_000n : 0n;
  }

  private settleOne(it: { arenaId: number; player: Address; sessionId: bigint; payout: bigint }): ArenaEvent {
    const skip = (reason: number): ArenaEvent => ({ name: 'SettleSkipped', arenaId: it.arenaId, player: getAddress(it.player), sessionId: it.sessionId, reason });
    const a = this.arenaMap.get(it.arenaId);
    if (!a) return skip(1);
    const key = `${it.arenaId}:${it.player.toLowerCase()}`;
    const s = this.sessions.get(key);
    if (!s || s.id !== it.sessionId) return skip(2);
    if (s.finalized) return skip(3);
    if (it.payout > a.vault) return skip(4);
    const fee = this.feeOf(it);
    const toPlayer = it.payout - fee;
    this.sessions.delete(key);
    a.vault -= it.payout;
    a.openSessions -= 1;
    a.totalPaidOut += it.payout;
    let collected = true;
    if (toPlayer > 0n && this.refusing.has(it.player.toLowerCase())) {
      collected = false;
      this.sessions.set(key, { ...s, finalized: true, owed: toPlayer });
      a.owed += toPlayer;
    } else if (toPlayer > 0n) {
      this.addTokens(it.player, toPlayer);
    }
    return { name: 'Settled', arenaId: it.arenaId, player: getAddress(it.player), sessionId: it.sessionId, payout: it.payout, fee, collected };
  }

  async receipt(hash: Hash): Promise<TxReceipt | null> {
    if (this.holdReceipts) return null;
    return this.receipts.get(hash) ?? null;
  }
  async verifyMessage(address: Address, message: string, signature: Hex) {
    this.verified.push({ address, message, signature });
    return signature === '0x1271';
  }
  async ownerOf(contract: Address) {
    this.check();
    return this.owners.get(contract.toLowerCase()) ?? ADMIN;
  }
  async mintState(_nft: Address) {
    this.check('mintState');
    return { ...this.mint, soldOut: this.mint.totalSupply >= this.mint.maxSupply };
  }
  async nftBalance(_nft: Address, owner: Address) {
    this.check();
    return this.balances.get(owner.toLowerCase()) ?? 0n;
  }
  /** `royaltyInfo` reads so far (the server caches them). */
  royaltyCalls = 0;
  async royalty() {
    this.royaltyCalls++;
    return { receiver: ADMIN, bps: 500 };
  }

  /** Mints NFT `qty` to `to` (Transfer logs, balances, supply). */
  mintNft(to: string, qty = 1): void {
    for (let i = 0; i < qty; i++) {
      this.mint.totalSupply += 1;
      this.block += 1n;
      this.transfers.push({ from: ZERO, to: getAddress(to), tokenId: BigInt(this.mint.totalSupply), blockNumber: this.block });
    }
    this.balances.set(to.toLowerCase(), (this.balances.get(to.toLowerCase()) ?? 0n) + BigInt(qty));
  }
}
