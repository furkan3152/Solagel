import type { ChainStatus } from '@elymum/shared';
import type { EvmClient } from './evm-client';

/**
 * Amounts in this module are **ledger units** (see `toLedger` / `fromLedger` in `@elymum/sdk`): the game
 * token with at most 6 decimals, a safe JS integer. The EVM gateway converts at the chain boundary only.
 */

/** Journal key of an arena ticket: `<arenaId>:<player lowercase>:<sessionId>` (session ids are global and never reused). */
export function sessionKey(arenaId: number, player: string, sessionId: number | bigint): string {
  return `${arenaId}:${player.toLowerCase()}:${sessionId}`;
}

/** Parts of a session key; null when it is not one. */
export function parseSessionKey(key: string): { arenaId: number; player: string; sessionId: number } | null {
  const m = /^(\d{1,5}):(0x[0-9a-f]{40}):(\d{1,20})$/.exec(key);
  if (!m) return null;
  const sessionId = Number(m[3]);
  return Number.isSafeInteger(sessionId) ? { arenaId: Number(m[1]), player: m[2], sessionId } : null;
}

/**
 * The chain could not be read right now (the RPC is rate-limiting or unreachable). Not an answer:
 * the caller must not conclude "no ticket" or "no arena" from it; it tells the player the network is
 * busy and tries again (`chain_busy`).
 */
export class ChainBusyError extends Error {
  readonly code = 'chain_busy';
  constructor(what: string, cause?: unknown) {
    super(`chain busy: ${what}${cause ? ` (${String((cause as Error)?.message ?? cause).split('\n')[0].slice(0, 200)})` : ''}`);
    this.name = 'ChainBusyError';
  }
}

export interface ChainSession {
  /** Journal key `<arenaId>:<player lowercase>:<sessionId>` (the settlement's key). */
  key: string;
  /** On-chain session id (must be echoed in `settle`). */
  id: number;
  /** Player wallet, EIP-55 checksummed. */
  player: string;
  arenaId: number;
  /** Ticket price, ledger units. */
  entryFee: number;
  /** Unix seconds. */
  openedAt: number;
  /**
   * Already settled but the token transfer to the player failed; the result is final and
   * `owed` waits for the player to collect it (`refund`). Never playable, never settled again.
   */
  finalized: boolean;
  /** Ledger units the player can collect (finalized sessions; 0 otherwise). */
  owed: number;
}

export interface ChainArena {
  id: number;
  /** Ticket price, ledger units. */
  entryFee: number;
  /** On-chain cap on open sessions. */
  maxSessions: number;
  openSessions: number;
  enabled: boolean;
  /**
   * Ledger units the arena vault can spend (rounded down); null when the gateway has no real vault
   * (dev-fake) or the vault is unknown right now (a stale list served while the RPC refuses the read),
   * which skips the vault-vs-journal guard.
   */
  pot: number | null;
}

export interface SettledEvent {
  /** Journal key (`<arenaId>:<player lowercase>:<sessionId>`). */
  key: string;
  /** Player wallet, EIP-55 checksummed. */
  player: string;
  /** Arena of the settled session (absent on journal items written before it existed). */
  arenaId?: number;
  /** The settlement transaction (0x hash). */
  txHash: string;
  /** Ledger units paid out of the vault (before the fee). */
  payout: number;
  /** Fee on profit, ledger units (absent when unknown, e.g. a late confirmation). */
  fee?: number;
  /** The transfer to the player failed; the session is finalized and the player collects the net payout. */
  collect?: boolean;
}

/** The server key and its gas balance (admins see it in `/api/config` and `/admin`). */
export interface ServerKeyInfo {
  /** EIP-55 address of the server key; null when there is none. */
  address: string | null;
  /** HYPE balance in wei (decimal string); null when unknown. */
  balanceWei: string | null;
  /** The balance is below the warning threshold. */
  low: boolean;
}

/** An ERC-20 `Transfer` log of a receipt. */
export interface TokenTransfer {
  /** The token contract that emitted the log (EIP-55). */
  token: string;
  from: string;
  to: string;
  /** Raw base units. */
  value: bigint;
}

/** What a power-up purchase is checked against: a mined transaction's status and its ERC-20 transfers. */
export interface TokenReceipt {
  status: 'success' | 'reverted';
  blockNumber: bigint;
  transfers: TokenTransfer[];
}

/** Everything the rooms need from the chain. `NullChain` is used when it is off. */
export interface ChainGateway {
  /** The server talks to an EVM RPC (`EVM_RPC_URL` reachable). */
  readonly enabled: boolean;
  /**
   * The game token is set on the arena contract (`setToken`). False while no arena is registered or
   * the token is not set: practice only, arena joins answer `token_not_set`.
   */
  readonly tokenReady: boolean;
  /** Arena tickets can be played (chain on, token set and usable, server authorized). */
  readonly stakeEnabled: boolean;
  status(): ChainStatus;
  /**
   * The wallet's session in an arena; null when it has none. Throws `ChainBusyError` when the chain
   * cannot be read (after the RPC budget's retries): that is not "no session".
   */
  getSession(arenaId: number, player: string): Promise<ChainSession | null>;
  /**
   * On-chain arenas; cached unless `fresh` (a re-read that bypasses the cache). When the RPC fails the
   * last good list is served (stale); `ChainBusyError` only when no list was ever read.
   */
  listArenas(fresh?: boolean): Promise<ChainArena[]>;
  /** Wake the settlement worker (new journal items). */
  kick(): void;
  /** Keys of sessions currently owned by a room (live): never settled as stale. */
  setLiveSessionProvider(fn: () => Set<string>): void;
  onSettled(fn: (e: SettledEvent) => void): void;
  /**
   * `status()` changed in a way clients must see without reconnecting (the token was set, so
   * `tokenReady` turned true and arenas can attach). Listeners re-read `status()`.
   */
  onStatusChange(fn: () => void): void;
  /** The server key and its HYPE balance. */
  serverInfo(): ServerKeyInfo;
  /**
   * Verifies a signed message on chain (ERC-1271 / ERC-6492 smart wallets). Absent or false when the
   * chain is off; EOA signatures are checked without it.
   */
  verifyMessage?(address: string, message: string, signature: string): Promise<boolean>;
  /** The EVM access (the site reads the NFT and checks registered contracts through it); absent or null when off. */
  evm?(): EvmClient | null;
  /** Re-reads the registry and the arena config now (after a registry change). */
  refresh?(): Promise<void>;
  /**
   * The ERC-20 transfers of a mined transaction (power-up purchases); null when it is not mined (or
   * unknown). One receipt read at `normal` priority through the RPC budget. Throws `ChainBusyError`
   * when the RPC refuses the read. Absent when the chain is off.
   */
  tokenReceipt?(hash: string): Promise<TokenReceipt | null>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export class NullChain implements ChainGateway {
  readonly enabled = false;
  readonly tokenReady = false;
  readonly stakeEnabled = false;
  constructor(private readonly chainName = 'Elysium') {}
  status(): ChainStatus {
    return {
      enabled: false,
      chainId: null,
      chainName: this.chainName,
      rpcUrl: null,
      explorerUrl: null,
      arenaAddress: null,
      nftAddress: null,
      arenasEnabled: false,
      tokenReady: false,
      token: null,
      feeBps: null,
      serverKey: null,
    };
  }
  async getSession(): Promise<ChainSession | null> {
    return null;
  }
  async listArenas(): Promise<ChainArena[]> {
    return [];
  }
  kick(): void {}
  setLiveSessionProvider(): void {}
  onSettled(): void {}
  onStatusChange(): void {}
  serverInfo(): ServerKeyInfo {
    return { address: null, balanceWei: null, low: false };
  }
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}
