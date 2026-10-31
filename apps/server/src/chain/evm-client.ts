import {
  createElymumPublicClient,
  createElymumWalletClient,
  elymumArenaAbi,
  elymumNFTAbi,
  getAllowance,
  getArena,
  getArenaConfig,
  getTestTokenFaucet,
  getTokenBalance,
  isArenaHolder,
  isTestTokenMinter,
  getMintState,
  getNftBalance,
  getSession,
  listArenas,
  sendCall,
  simulateCall,
  toViemChain,
  type ArenaConfig,
  type ArenaInfo,
  type ContractCall,
  type MintState,
  type SessionInfo,
  type TestTokenFaucetConfig,
} from '@elymum/sdk';
import { checkDeployedCode, type CodeCheck } from '@elymum/sdk/ops';
import { chainInfo, type ChainOverrides } from '@elymum/shared';
import { getAddress, parseEventLogs, verifyMessage as verifyEoaMessage, type Address, type Hash, type Hex, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';

export type { CodeCheck } from '@elymum/sdk/ops';
export type ContractKindCode = 'arena' | 'nft' | 'token';

/** An `ElymumArena` event the settlement worker reads from a receipt. */
export type ArenaEvent =
  | { name: 'Settled'; arenaId: number; player: Address; sessionId: bigint; payout: bigint; fee: bigint; collected: boolean }
  | { name: 'SettleSkipped'; arenaId: number; player: Address; sessionId: bigint; reason: number }
  | { name: 'LootBurned'; arenaId: number; sweepId: bigint; amount: bigint };

export interface TxReceipt {
  status: 'success' | 'reverted';
  blockNumber: bigint;
  /** Arena events emitted by the arena contract in this transaction. */
  events: ArenaEvent[];
}

export interface JoinedLog {
  arenaId: number;
  player: Address;
  sessionId: bigint;
  entryFee: bigint;
  blockNumber: bigint;
}

export interface TransferLog {
  from: Address;
  to: Address;
  tokenId: bigint;
  blockNumber: bigint;
}

/**
 * Everything the server reads from and sends to the chain. `viemEvmClient` is the real one; tests
 * inject a fake (a TypeScript model of the contracts).
 */
export interface EvmClient {
  /** The server key's address (EIP-55). */
  readonly address: Address;
  getChainId(): Promise<number>;
  blockNumber(): Promise<bigint>;
  /** Code at `address` vs the bundled artifact of `kind`. */
  codeCheck(address: Address, kind: ContractKindCode): Promise<CodeCheck>;
  /** Whether there is any code at `address`. */
  hasCode(address: Address): Promise<boolean>;
  arenaConfig(arena: Address): Promise<ArenaConfig>;
  arenas(arena: Address): Promise<ArenaInfo[]>;
  arena(arena: Address, id: number): Promise<ArenaInfo>;
  session(arena: Address, arenaId: number, player: Address): Promise<SessionInfo>;
  /** HYPE balance (wei). */
  balance(address: Address): Promise<bigint>;
  /** `Joined` events of an arena contract in `[from, to]` (the caller chunks). */
  joinedLogs(arena: Address, from: bigint, to: bigint): Promise<JoinedLog[]>;
  /** NFT `Transfer` events in `[from, to]` (the caller chunks). */
  transferLogs(nft: Address, from: bigint, to: bigint): Promise<TransferLog[]>;
  /** Block a contract was deployed in (binary search on `eth_getCode`); null when the RPC cannot tell. */
  deployBlock(address: Address): Promise<bigint | null>;
  /** Block of a mined transaction; null when unknown. */
  txBlock(hash: Hash): Promise<bigint | null>;
  /** Simulates (throws the decoded revert) then sends `call` signed by the server key. */
  send(call: ContractCall): Promise<Hash>;
  /** The receipt of `hash`; null when it is not mined within `timeoutMs`. */
  receipt(hash: Hash, arena: Address | null, timeoutMs: number): Promise<TxReceipt | null>;
  /** On-chain signature check (EOA, ERC-1271 and ERC-6492). */
  verifyMessage(address: Address, message: string, signature: Hex): Promise<boolean>;
  /** `owner()` of an Ownable contract. */
  ownerOf(contract: Address): Promise<Address>;
  mintState(nft: Address): Promise<MintState>;
  nftBalance(nft: Address, owner: Address): Promise<bigint>;
  /** `royaltyInfo(1, 10000)`: receiver and basis points; null when unreadable. */
  royalty(nft: Address): Promise<{ receiver: Address; bps: number } | null>;
  /** ERC-20 `balanceOf`. */
  tokenBalance(token: Address, owner: Address): Promise<bigint>;
  /** ERC-20 `allowance`. */
  allowance(token: Address, owner: Address, spender: Address): Promise<bigint>;
  /** `TestToken.isMinter(who)` (the owner may always mint). */
  isMinter(token: Address, who: Address): Promise<boolean>;
  /** The TestToken's faucet settings. */
  testTokenFaucet(token: Address): Promise<TestTokenFaucetConfig>;
  /** `ElymumArena.isHolder(who)`: holds the arena's holder NFT. */
  isArenaHolder(arena: Address, who: Address): Promise<boolean>;
  /** Sends `wei` HYPE from the server key to `to`. */
  sendValue(to: Address, wei: bigint): Promise<Hash>;
  /** A signer for another key on the same RPC (the testnet bot wallets). */
  signer(privateKey: Hex): EvmSigner;
}

/** Another key on the server's RPC: simulates (throws the decoded revert) then sends. */
export interface EvmSigner {
  readonly address: Address;
  send(call: ContractCall): Promise<Hash>;
}

/** What reading an NFT's holders needs (also on a chain the server does not run on: `TESTNET_RPC_URL`). */
export type HolderReader = Pick<EvmClient, 'getChainId' | 'blockNumber' | 'transferLogs' | 'deployBlock' | 'txBlock' | 'nftBalance'>;

const ownableAbi = [
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
] as const;

const RPC_TIMEOUT_MS = 20_000;

/** Decodes the arena's events of a receipt (logs of other contracts are ignored). */
export function decodeArenaEvents(logs: readonly { address: string; data: Hex; topics: readonly Hex[] }[], arena: Address | null): ArenaEvent[] {
  const own = arena ? logs.filter((l) => l.address.toLowerCase() === arena.toLowerCase()) : [];
  const parsed = parseEventLogs({ abi: elymumArenaAbi, logs: own as never, strict: false });
  const out: ArenaEvent[] = [];
  for (const e of parsed) {
    const a = e.args as Record<string, unknown>;
    if (e.eventName === 'Settled') {
      out.push({
        name: 'Settled',
        arenaId: Number(a.arenaId),
        player: getAddress(a.player as string),
        sessionId: a.sessionId as bigint,
        payout: a.payout as bigint,
        fee: a.fee as bigint,
        collected: a.collected as boolean,
      });
    } else if (e.eventName === 'SettleSkipped') {
      out.push({ name: 'SettleSkipped', arenaId: Number(a.arenaId), player: getAddress(a.player as string), sessionId: a.sessionId as bigint, reason: Number(a.reason) });
    } else if (e.eventName === 'LootBurned') {
      out.push({ name: 'LootBurned', arenaId: Number(a.arenaId), sweepId: a.sweepId as bigint, amount: a.amount as bigint });
    }
  }
  return out;
}

/** The read side shared by the server client and the holder reader. */
function viemReads(publicClient: PublicClient): HolderReader {
  return {
    getChainId: () => publicClient.getChainId(),
    blockNumber: () => publicClient.getBlockNumber({ cacheTime: 0 }),
    transferLogs: async (nft, from, to) => {
      const logs = await publicClient.getContractEvents({ address: nft, abi: elymumNFTAbi, eventName: 'Transfer', fromBlock: from, toBlock: to, strict: true });
      return logs.map((l) => ({ from: getAddress(l.args.from), to: getAddress(l.args.to), tokenId: l.args.tokenId, blockNumber: l.blockNumber }));
    },
    deployBlock: async (address) => {
      try {
        const latest = await publicClient.getBlockNumber();
        const has = async (b: bigint) => {
          const code = await publicClient.getCode({ address, blockNumber: b });
          return !!code && code !== '0x';
        };
        if (!(await has(latest))) return null;
        let lo = 0n;
        let hi = latest;
        while (lo < hi) {
          const mid = (lo + hi) / 2n;
          if (await has(mid)) hi = mid;
          else lo = mid + 1n;
        }
        return lo;
      } catch {
        return null; // a pruned node cannot read old state
      }
    },
    txBlock: async (hash) => {
      try {
        return (await publicClient.getTransactionReceipt({ hash })).blockNumber;
      } catch {
        return null;
      }
    },
    nftBalance: (nft, owner) => getNftBalance(publicClient, nft, owner),
  };
}

/** A read-only client for an NFT's holders on any RPC (the testnet emblem import). */
export function viemHolderReader(rpcUrl: string): HolderReader {
  return viemReads(createElymumPublicClient(rpcUrl, undefined, { pollingInterval: 1_000 }));
}

/** Runs async jobs one at a time (the server key's sends: nonces come from the pending count). */
function serial(): <T>(job: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>) => {
    const run = tail.then(job, job);
    tail = run.catch(() => undefined);
    return run;
  };
}

/** `EvmClient` over viem: a public client on `rpcUrl` and a wallet client with the server key. */
export function viemEvmClient(rpcUrl: string, account: PrivateKeyAccount, opts: { chainId: number; overrides?: ChainOverrides; pollingInterval?: number }): EvmClient {
  const chain = toViemChain(chainInfo(opts.chainId, { ...opts.overrides, rpcUrl }));
  const pollingInterval = opts.pollingInterval ?? 1_000;
  const publicClient: PublicClient = createElymumPublicClient(rpcUrl, chain, { pollingInterval });
  const wallet: WalletClient = createElymumWalletClient(rpcUrl, { account, chain, pollingInterval });
  // one server-key transaction at a time (the settlement worker, the price keeper and the bot funding share the key)
  const queue = serial();
  const signers = new Map<string, EvmSigner>();
  return {
    ...viemReads(publicClient),
    address: account.address,
    codeCheck: (address, kind) => checkDeployedCode(publicClient, address, kind),
    hasCode: async (address) => {
      const code = await publicClient.getCode({ address });
      return !!code && code !== '0x';
    },
    arenaConfig: (arena) => getArenaConfig(publicClient, arena),
    arenas: (arena) => listArenas(publicClient, arena),
    arena: (arena, id) => getArena(publicClient, arena, id),
    session: (arena, arenaId, player) => getSession(publicClient, arena, arenaId, player),
    balance: (address) => publicClient.getBalance({ address }),
    joinedLogs: async (arena, from, to) => {
      const logs = await publicClient.getContractEvents({ address: arena, abi: elymumArenaAbi, eventName: 'Joined', fromBlock: from, toBlock: to, strict: true });
      return logs.map((l) => ({
        arenaId: Number(l.args.arenaId),
        player: getAddress(l.args.player),
        sessionId: l.args.sessionId,
        entryFee: l.args.entryFee,
        blockNumber: l.blockNumber,
      }));
    },
    send: (call) =>
      queue(async () => {
        await simulateCall(publicClient, call, account);
        return sendCall(wallet, call, { account, chain });
      }),
    sendValue: (to, wei) => queue(() => wallet.sendTransaction({ account, chain, to, value: wei })),
    signer: (privateKey) => {
      const bot = privateKeyToAccount(privateKey);
      let s = signers.get(bot.address);
      if (!s) {
        const w = createElymumWalletClient(rpcUrl, { account: bot, chain, pollingInterval });
        const q = serial();
        s = {
          address: bot.address,
          send: (call) =>
            q(async () => {
              await simulateCall(publicClient, call, bot);
              return sendCall(w, call, { account: bot, chain });
            }),
        };
        signers.set(bot.address, s);
      }
      return s;
    },
    receipt: async (hash, arena, timeoutMs) => {
      try {
        const r = await publicClient.waitForTransactionReceipt({ hash, timeout: timeoutMs });
        return { status: r.status, blockNumber: r.blockNumber, events: decodeArenaEvents(r.logs, arena) };
      } catch {
        return null;
      }
    },
    verifyMessage: async (address, message, signature) => {
      try {
        return await publicClient.verifyMessage({ address, message, signature });
      } catch {
        return false;
      }
    },
    ownerOf: (contract) => publicClient.readContract({ address: contract, abi: ownableAbi, functionName: 'owner' }).then(getAddress),
    mintState: (nft) => getMintState(publicClient, nft),
    royalty: async (nft) => {
      try {
        const [receiver, amount] = await publicClient.readContract({ address: nft, abi: elymumNFTAbi, functionName: 'royaltyInfo', args: [1n, 10_000n] });
        return { receiver: getAddress(receiver), bps: Number(amount) };
      } catch {
        return null;
      }
    },
    tokenBalance: (token, owner) => getTokenBalance(publicClient, token, owner),
    allowance: (token, owner, spender) => getAllowance(publicClient, token, owner, spender),
    isMinter: (token, who) => isTestTokenMinter(publicClient, token, who),
    testTokenFaucet: (token) => getTestTokenFaucet(publicClient, token),
    isArenaHolder: (arena, who) => isArenaHolder(publicClient, arena, who),
  };
}

/** Reads `eth_chainId` of an RPC (with a timeout). */
export async function readChainId(rpcUrl: string): Promise<number> {
  const client = createElymumPublicClient(rpcUrl);
  return withTimeout(client.getChainId(), RPC_TIMEOUT_MS, 'eth_chainId');
}

/** EOA signature check without any RPC (personal_sign / EIP-191). */
export async function verifyEoa(address: Address, message: string, signature: Hex): Promise<boolean> {
  try {
    return await verifyEoaMessage({ address, message, signature });
  } catch {
    return false;
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms);
    timer.unref();
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
