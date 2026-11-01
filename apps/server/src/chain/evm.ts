import {
  SETTLE_CHUNK,
  SettleSkipReason,
  chunkSettlements,
  computeFee,
  describeError,
  fromLedger,
  ledgerDecimals,
  settleCall,
  settleSkipReasonText,
  sweepLootCall,
  toLedger,
  type ArenaConfig,
  type Settlement,
} from '@elymum/sdk';
import { TOKEN_SYMBOL_DEFAULT, chainInfo, formatHype, formatToken, type ChainStatus } from '@elymum/shared';
import { getAddress, isAddress, type Address, type Hash, type Hex } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import type { ServerConfig } from '../config';
import type { Journal, JournalItem, SettlementItem, SweepItem } from '../stake/journal';
import { ChainCache } from './chain-cache';
import { hasMulticall3, readChainId, viemEvmClient, withTimeout, type ArenaEvent, type EvmClient } from './evm-client';
import { isRateLimited, isTransientRpcError, withRpcPriority } from './rpc-budget';
import { loadServerKey } from './server-key';
import { ChainBusyError, sessionKey, type ChainArena, type ChainGateway, type ChainSession, type ServerKeyInfo, type SettledEvent } from './types';

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

const WORKER_INTERVAL_MS = 1_000;
const REFRESH_INTERVAL_MS = 30_000;
const SWEEP_INTERVAL_MS = 5 * 60_000;
/** Sessions nobody plays for this long are settled at their entry fee; `STALE_SESSION_AFTER_S` overrides it. */
export const STALE_SESSION_AFTER_S = 15 * 60;
/** The arena list is re-read at most this often (settlements mark it stale; RPC errors serve the last good one). */
export const ARENA_TTL_MS = 60_000;
/** After a failed arena-list read the last good list is served this long before the next try. */
export const ARENA_RETRY_MS = 15_000;
/** The arena config is re-read at most this often by the 30 s watcher (`refresh()` always re-reads). */
export const CONFIG_TTL_MS = 3 * 60_000;
/** A journal item that failed on a rate limit / timeout is retried within this (never the 5-minute cap). */
export const TRANSIENT_RETRY_MAX_MS = 30_000;
/** `Joined` log scan: blocks per `eth_getLogs` (adaptive between these; the start is `LOG_CHUNK_BLOCKS`). */
const LOG_CHUNK_MIN = 100n;
const LOG_CHUNK_MAX = 500_000n;
/** The persisted last good reads (`DATA_DIR/chains/<id>/chain-cache.json`). */
export const CHAIN_CACHE_FILE = 'chain-cache.json';
/** How long the worker waits for a receipt before it re-checks on the next pass. */
export const RECEIPT_TIMEOUT_MS = 90_000;
/** How long a dropped item's earlier transaction is looked up (it is mined by then, or never). */
const LATE_RECEIPT_TIMEOUT_MS = 2_000;
/** Re-check delay of an item whose transaction is not confirmed yet. */
export const RECHECK_MS = 5_000;
/** Below this, the server key cannot pay gas for long: logged and shown in `/admin` (0.01 HYPE). */
export const LOW_BALANCE_WEI = 10n ** 16n;
const STOP_GRACE_MS = 5_000;
/** When the deploy block of the arena is unknown, the session index starts this many blocks back. */
const INDEX_LOOKBACK_BLOCKS = 1_000_000n;
/** Concurrent session reads of the stale sweeper. */
const READ_CONCURRENCY = 8;

/** A stale arena list: everything but the vaults, which are unknown (`pot: null` skips the vault guard). */
const unknownPots = (list: ChainArena[]): ChainArena[] => list.map((a) => ({ ...a, pot: null }));
const short = (s: string): string => (s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s);
const firstLine = (err: unknown): string => String((err as Error)?.message ?? err).split('\n')[0].slice(0, 240);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref());
const isEvm = (s: unknown): s is string => typeof s === 'string' && isAddress(s, { strict: false });

/** The contracts the gateway works with: the registry (written by `/admin`) with the env overrides applied. */
export interface ContractsView {
  arena: string | null;
  /** The arena's deploy (or registering) transaction, when known: the session index starts at its block. */
  arenaTx?: string | null;
  nft: string | null;
}

export interface EvmChainDeps {
  /** Chain access (tests inject a model of the contracts). Default: viem on `EVM_RPC_URL`. */
  client?: EvmClient;
  /** Server key (default: `SERVER_PRIVATE_KEY`). Ignored when `client` is given (it carries its address). */
  account?: PrivateKeyAccount;
  /** The registered contracts; read on every refresh, so a newly registered arena is picked up without a restart. */
  contracts?: () => ContractsView;
  now?: () => number;
  /** Start the background loops in `start()` (default true; tests drive them by hand). */
  loops?: boolean;
  /** Receipt wait per transaction (default 90 s). */
  receiptTimeoutMs?: number;
  /**
   * The chain id the server's chain-keyed state (journal, registry) was opened for at boot
   * (`DATA_DIR/chains/<id>/`). When the RPC answers another id (or the id was unknown at boot: null),
   * arenas and the settlement worker stay off until a restart. Undefined: no check (tests).
   */
  stateChainId?: number | null;
  /**
   * Where the last good chain reads are kept across restarts (`DATA_DIR/chains/<id>`): the arena list,
   * the arena config, the code check and the deploy block. Null / absent: memory only.
   */
  cacheDir?: string | null;
}

/** One item of a settle batch, with the on-chain session it was checked against. */
interface Checked {
  item: SettlementItem;
  sessionId: bigint;
  entryFee: bigint;
  feeBps: number;
}

/**
 * EVM `ChainGateway` (viem): cached reads for the rooms (arenas, sessions), the settlement worker that
 * turns journal items into `settle` batches and `sweepLoot` burns signed by the server key, and the
 * sweeper that settles sessions nobody played at their entry fee.
 *
 * States: no RPC answer → disabled (re-probed every 30 s); RPC up but no arena registered → enabled,
 * "waiting for contracts" (practice only); arena registered but the token not set → `tokenReady` false;
 * token set and the server key is the arena's server authority → arenas on. Every 30 s the registry and
 * `config()` are re-read; the first read that finds the token set fires `onStatusChange`, so rooms
 * attach and clients get a `chain` message without a restart. A newly registered arena is picked up the
 * same way.
 *
 * Amounts: the journal, the rooms and the wire are in ledger units (at most 6 decimals); this class
 * converts at the chain boundary only (`toLedger(…, 'floor')` when reading, `fromLedger` when sending).
 */
export class EvmChain implements ChainGateway {
  enabled = false;
  stakeEnabled = false;

  private client: EvmClient | null = null;
  private chainId: number | null = null;
  private serverAddress: Address | null = null;
  /** The arena contract in use (checksummed); null while none is registered. */
  private arena: Address | null = null;
  private arenaTx: string | null = null;
  /** `ok` once the code at `arena` matched the bundled artifact. */
  private arenaCode: 'ok' | 'missing' | 'mismatch' | null = null;
  private config: ArenaConfig | null = null;
  private configAt = 0;
  /** Server key == config.serverAuthority (null until the config was read once). */
  private authorized: boolean | null = null;
  /** The journal belongs to this arena (false: it still owes money on another contract). */
  private journalBound = true;
  private balance: bigint | null = null;
  /** The RPC's chain is not the one the state was opened for (`EvmChainDeps.stateChainId`). */
  private chainMismatch = false;

  private liveSessions: () => Set<string> = () => new Set();
  private readonly settledListeners: ((e: SettledEvent) => void)[] = [];
  private readonly statusListeners: (() => void)[] = [];
  /** The last transaction sent per journal key (a lost confirmation can still be reported). */
  private readonly sentTx = new Map<string, Hash>();
  private arenaCache: { at: number; value: ChainArena[] } | null = null;
  private probing: Promise<boolean> | null = null;
  /** `tokenReady` / `arenasEnabled` as last announced (status-change listeners fire on a change). */
  private announced = { tokenReady: false, arenasEnabled: false, arena: null as string | null };
  /** Settlements are held because a batch fails on the fee transfer (logs the recovery). */
  private feeHeld = false;

  /** Open-session index for the stale sweeper (from `Joined` logs). */
  private index: { next: bigint | null; candidates: Map<string, { arenaId: number; player: Address; sessionId: bigint }> } = { next: null, candidates: new Map() };

  private timers: NodeJS.Timeout[] = [];
  private running: Promise<void> | null = null;
  private rerun = false;
  private kickScheduled = false;
  private started = false;
  private stopped = false;
  private readonly lastWarn = new Map<string, number>();
  private readonly now: () => number;
  /** Last good reads on disk (arena list, config, code check, deploy block). */
  private readonly cache: ChainCache;
  /** When the last arena-list read failed (the stale list is served until `ARENA_RETRY_MS` later). */
  private arenaFailedAt = -Infinity;
  /** Blocks per `Joined` log request (adaptive). */
  private logChunk: bigint;

  constructor(
    private readonly cfg: ServerConfig,
    private readonly journal: Journal,
    private readonly log: (m: string) => void,
    private readonly deps: EvmChainDeps = {},
  ) {
    this.now = deps.now ?? Date.now;
    this.cache = ChainCache.in(deps.cacheDir ?? null, CHAIN_CACHE_FILE, log);
    this.logChunk = BigInt(Math.max(Number(LOG_CHUNK_MIN), cfg.chain.logChunkBlocks));
  }

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                        */
  /* ---------------------------------------------------------------- */

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    try {
      if (this.deps.client) {
        this.client = this.deps.client;
        this.serverAddress = getAddress(this.deps.client.address);
      } else {
        const account = this.deps.account ?? loadServerKey(this.cfg.chain.serverKey ?? '', this.cfg.dataDir);
        this.serverAddress = account.address;
        this.account = account;
        if (!this.cfg.chain.rpcUrl) throw new Error('EVM_RPC_URL is not set');
      }
    } catch (err) {
      this.log(`chain: disabled — ${(err as Error).message}; running practice only`);
      return;
    }
    this.log(`chain: server key ${this.serverAddress} (set it as the arena's server authority; it pays gas in HYPE)`);
    await this.probe();
    // the boot state is the baseline: the app attaches arenas itself after start, nobody is connected yet
    this.announced = { tokenReady: this.tokenReady, arenasEnabled: this.stakeEnabled, arena: this.arena };
    if (this.deps.loops === false) return;
    const staleAfterS = this.staleAfterS();
    if (staleAfterS !== STALE_SESSION_AFTER_S) this.log(`chain: unplayed sessions are settled at their entry fee after ${staleAfterS} s (STALE_SESSION_AFTER_S)`);
    this.timers.push(
      setInterval(() => this.kick(), WORKER_INTERVAL_MS),
      setInterval(() => void withRpcPriority('normal', () => this.refresh({ configMaxAgeMs: CONFIG_TTL_MS })), REFRESH_INTERVAL_MS),
      setInterval(() => void this.checkBalance(), SWEEP_INTERVAL_MS),
      setInterval(() => void this.sweepStale(), Math.min(SWEEP_INTERVAL_MS, Math.max(1_000, staleAfterS * 1000))),
    );
    for (const t of this.timers) t.unref();
    this.kick();
  }

  private account: PrivateKeyAccount | null = null;

  async stop(): Promise<void> {
    this.stopped = true;
    this.cache.flush();
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.running) await Promise.race([this.running.catch(() => {}), sleep(STOP_GRACE_MS)]);
  }

  /** The chain access in use (null while the RPC was never reached). The site reads the NFT through it. */
  evm(): EvmClient | null {
    return this.client;
  }

  /** Reads `eth_chainId` and builds the client on first success. Never throws. */
  private probe(): Promise<boolean> {
    this.probing ??= this.probeOnce().finally(() => (this.probing = null));
    return this.probing;
  }

  private async probeOnce(): Promise<boolean> {
    const where = this.cfg.chain.rpcUrl ?? 'injected client';
    try {
      if (!this.client) {
        const rpcUrl = this.cfg.chain.rpcUrl!;
        const chainId = await readChainId(rpcUrl);
        // concurrent eth_calls are merged into one Multicall3 call where the chain has it
        const multicall = await hasMulticall3(rpcUrl);
        this.client = viemEvmClient(rpcUrl, this.account!, { chainId, overrides: this.overrides(chainId), multicall });
        if (multicall) this.log('chain: Multicall3 found — concurrent reads are batched into one eth_call');
      }
      if (this.chainId === null) {
        this.chainId = await withTimeout(this.client.getChainId(), 20_000, 'eth_chainId');
        const info = this.chainInfo();
        this.log(`chain: ${info.name} (chain id ${this.chainId}) via ${where}`);
        const want = this.deps.stateChainId;
        if (want !== undefined && want !== this.chainId) {
          this.chainMismatch = true;
          this.log(
            `!!! chain: the server state was opened for ${want === null ? 'an unknown chain' : `chain ${want}`}, but the RPC is chain ${this.chainId}: ` +
              'arenas and settlements stay OFF until the server restarts (it then opens the state of this chain)',
          );
        }
      }
      this.enabled = true;
      await this.syncContracts();
      void this.checkBalance();
      return true;
    } catch (err) {
      this.warn('probe', `chain: RPC ${where} unreachable (${firstLine(err)}) — practice only (re-checking every 30 s)`);
      return false;
    }
  }

  private overrides(chainId: number) {
    // CHAIN_NAME names chain ids the table does not know; EXPLORER_URL applies whenever it is set
    const unknown = chainInfo(chainId).key === 'elysium';
    return {
      ...(unknown && this.cfg.chain.chainName ? { name: this.cfg.chain.chainName } : {}),
      ...(this.cfg.chain.explorerUrl ? { explorerUrl: this.cfg.chain.explorerUrl } : {}),
    };
  }

  private chainInfo() {
    return chainInfo(this.chainId!, this.overrides(this.chainId!));
  }

  /**
   * 30 s loop (also run right after a registry change): re-probe while offline, otherwise pick up a
   * newly registered arena and re-read its config. Public so tests (and the registry) drive it.
   */
  async refresh(opts: { configMaxAgeMs?: number } = {}): Promise<void> {
    if (this.stopped || !this.started || !this.serverAddress) return;
    if (!this.enabled) {
      if (await this.probe()) {
        this.announceStatus();
        this.kick();
      }
      return;
    }
    await this.syncContracts(opts.configMaxAgeMs ?? 0);
    this.announceStatus();
  }

  /**
   * Picks the arena address from the registry, checks its code once (a positive check is kept on
   * disk: code at an address does not change), reads its config when older than `configMaxAgeMs`
   * (0: now). A config kept on disk is applied first, so a restart while the RPC refuses us still
   * knows the token and the server authority (and refreshes them as soon as it can).
   */
  private async syncContracts(configMaxAgeMs = 0): Promise<void> {
    const view = this.deps.contracts?.() ?? { arena: this.cfg.chain.arenaAddress, nft: this.cfg.chain.nftAddress };
    const next = view.arena && isEvm(view.arena) ? getAddress(view.arena) : null;
    if (next !== this.arena) {
      if (this.arena) this.log(`chain: arena contract changed ${this.arena} → ${next ?? 'none'}`);
      this.arena = next;
      this.arenaTx = view.arenaTx ?? null;
      this.arenaCode = null;
      this.config = null;
      this.configAt = 0;
      this.authorized = null;
      this.arenaCache = null;
      this.index = { next: null, candidates: new Map() };
      this.updateStakeEnabled();
    }
    if (!this.arena) {
      this.warn('no-arena', 'chain: waiting for contracts — no arena registered yet (deploy and register it in /admin → Deploy); practice only', 30 * 60_000);
      return;
    }
    if (this.arenaCode !== 'ok') {
      const codeKey = `code:${this.arena.toLowerCase()}`;
      try {
        // a positive check is kept on disk (the code at an address does not change): no read after a restart
        this.arenaCode = this.cache.get<string>(codeKey) === 'ok' ? 'ok' : await this.client!.codeCheck(this.arena, 'arena');
        if (this.arenaCode === 'ok') this.cache.set(codeKey, 'ok');
      } catch (err) {
        this.warn('code', `chain: code check of ${this.arena} failed (${firstLine(err)})`);
        return;
      }
      if (this.arenaCode !== 'ok') {
        this.warn(
          'code',
          `!!! chain: ${this.arena} ${this.arenaCode === 'missing' ? 'holds no code' : 'is not the bundled ElymumArena (code hash differs)'} on chain ${this.chainId} — arenas stay off`,
        );
        return;
      }
      const bound = this.journal.bindContract(this.arena);
      if (!bound) {
        this.log(
          `!!! chain: the journal still owes money on arena ${this.journal.contract}, not ${this.arena}. ` +
            'Arenas stay OFF and nothing is sent until the old contract is registered again (or the journal is settled by hand).',
        );
      }
      this.journalBound = bound;
    }
    if (!this.config) {
      const kept = this.cache.get<ArenaConfig>(`config:${this.arena.toLowerCase()}`);
      // stale (read again below), but it knows the token and the authority while the RPC refuses us
      if (kept && typeof kept.serverAuthority === 'string') this.applyConfig(kept, 0);
    }
    await this.currentConfig(configMaxAgeMs);
  }

  /** The game token of the cached config, null while it is unset (or unknown). */
  private token(config: ArenaConfig | null = this.config): { address: Address; decimals: number } | null {
    return config?.token ? { address: config.token, decimals: config.decimals } : null;
  }

  get tokenReady(): boolean {
    return this.enabled && this.arenaCode === 'ok' && this.token() !== null;
  }

  onStatusChange(fn: () => void): void {
    this.statusListeners.push(fn);
  }

  /** Fires the status listeners when `tokenReady`, `arenasEnabled` or the arena changed since the last announcement. */
  private announceStatus(): void {
    const ready = this.tokenReady;
    const arenas = this.stakeEnabled;
    const before = this.announced;
    if (ready === before.tokenReady && arenas === before.arenasEnabled && this.arena === before.arena) return;
    this.announced = { tokenReady: ready, arenasEnabled: arenas, arena: this.arena };
    if (ready && !before.tokenReady) {
      const t = this.token()!;
      this.arenasStale();
      this.log(`chain: game token set — ${t.address} (${t.decimals} decimals) · arenas ${arenas ? 'on' : 'off'}`);
    }
    for (const fn of this.statusListeners) {
      try {
        fn();
      } catch (err) {
        this.log(`chain: status listener failed: ${(err as Error).stack ?? err}`);
      }
    }
  }

  private updateStakeEnabled(): void {
    this.stakeEnabled = this.authorized === true && this.cfg.chain.stakeEnabled && this.tokenReady && this.journalBound && !this.chainMismatch;
  }

  /** Ledger units with the token's display decimals and symbol (for logs). */
  private units(ledger: number): string {
    const t = this.token();
    if (!t) return `${ledger} ledger units`;
    return `${formatToken(ledger, ledgerDecimals(t.decimals), { maxFrac: 6 })} ${this.cfg.chain.tokenSymbol}`;
  }

  private applyConfig(config: ArenaConfig, at = this.now()): void {
    this.config = config;
    this.configAt = at;
    const ours = this.serverAddress!;
    const authorized = config.serverAuthority.toLowerCase() === ours.toLowerCase();
    if (!authorized && this.authorized !== false) {
      this.log(
        `!!! chain: the server key ${ours} is NOT the arena's server authority (${config.serverAuthority}). ` +
          'Arenas are OFF; pending settlements stay queued until this is fixed (/admin → Arena → server key).',
      );
    } else if (authorized && this.authorized === false) {
      this.log('chain: server authority matches again — settlements resume');
    }
    this.authorized = authorized;
    this.updateStakeEnabled();
  }

  /** Cached config, re-read when older than `maxAgeMs` (the cached one is kept on RPC errors). */
  private async currentConfig(maxAgeMs = CONFIG_TTL_MS): Promise<ArenaConfig | null> {
    if (this.config && this.now() - this.configAt < maxAgeMs) return this.config;
    return (await this.freshConfig()) ?? this.config;
  }

  /** Reads the config now; null when the RPC call failed (or there is no usable arena). */
  private async freshConfig(): Promise<ArenaConfig | null> {
    if (!this.client || !this.arena || this.arenaCode !== 'ok') return null;
    try {
      const config = await this.client.arenaConfig(this.arena);
      this.applyConfig(config);
      this.cache.set(`config:${this.arena.toLowerCase()}`, config);
      return config;
    } catch (err) {
      this.warn('config', `chain: config refresh failed (${firstLine(err)})`);
      return null;
    }
  }

  /** Reads the server key's HYPE balance; warns (at most every 30 min) when it runs low. */
  async checkBalance(): Promise<void> {
    if (!this.enabled || !this.client || !this.serverAddress) return;
    try {
      const client = this.client;
      const who = this.serverAddress;
      this.balance = await withRpcPriority('low', () => client.balance(who));
      if (this.balance < LOW_BALANCE_WEI) {
        this.warn('balance', `chain: WARNING the server key ${this.serverAddress} holds only ${formatHype(this.balance, 6)} — fund it, it pays the gas of every settlement`, 30 * 60_000);
      }
    } catch {
      /* best effort */
    }
  }

  serverInfo(): ServerKeyInfo {
    return {
      address: this.serverAddress,
      balanceWei: this.balance === null ? null : this.balance.toString(),
      low: this.balance !== null && this.balance < LOW_BALANCE_WEI,
    };
  }

  /** Logs at most once per `intervalMs` per key. */
  private warn(key: string, message: string, intervalMs = 60_000): void {
    const now = this.now();
    if (now - (this.lastWarn.get(key) ?? -Infinity) < intervalMs) return;
    this.lastWarn.set(key, now);
    this.log(message);
  }

  /* ---------------------------------------------------------------- */
  /* ChainGateway reads                                               */
  /* ---------------------------------------------------------------- */

  status(): ChainStatus {
    const view = this.deps.contracts?.() ?? { arena: this.cfg.chain.arenaAddress, nft: this.cfg.chain.nftAddress };
    const nftAddress = view.nft && isEvm(view.nft) ? getAddress(view.nft) : null;
    if (!this.enabled || this.chainId === null) {
      return {
        enabled: false,
        chainId: null,
        chainName: this.cfg.chain.chainName ?? 'Elysium',
        rpcUrl: null,
        explorerUrl: null,
        arenaAddress: null,
        nftAddress: null,
        arenasEnabled: false,
        tokenReady: false,
        token: null,
        feeBps: null,
        serverKey: this.serverAddress,
      };
    }
    const info = this.chainInfo();
    const token = this.tokenReady ? this.token() : null;
    return {
      enabled: true,
      chainId: this.chainId,
      chainName: info.name,
      rpcUrl: this.cfg.chain.publicRpcUrl,
      explorerUrl: info.explorerUrl,
      arenaAddress: this.arena,
      nftAddress,
      arenasEnabled: this.stakeEnabled,
      tokenReady: token !== null,
      token: token ? { address: token.address, symbol: this.cfg.chain.tokenSymbol || TOKEN_SYMBOL_DEFAULT, decimals: token.decimals } : null,
      feeBps: this.config?.feeBps ?? null,
      serverKey: this.serverAddress,
    };
  }

  /**
   * Always read fresh from the chain (high priority: a paid join waits on it); null when there is no
   * session. An RPC failure (after the budget's retries) throws `ChainBusyError`: never "no ticket".
   */
  async getSession(arenaId: number, player: string): Promise<ChainSession | null> {
    const t = this.token();
    if (!this.tokenReady || !t || !this.client || !this.arena || !isEvm(player) || !Number.isInteger(arenaId) || arenaId < 1 || arenaId > 65_535) return null;
    const client = this.client;
    const arena = this.arena;
    try {
      const s = await withRpcPriority('high', () => client.session(arena, arenaId, getAddress(player)));
      if (s.id === 0n || s.id > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      return {
        key: sessionKey(arenaId, player, s.id),
        id: Number(s.id),
        player: getAddress(player),
        arenaId,
        entryFee: toLedger(s.entryFee, t.decimals, 'floor'),
        openedAt: s.openedAt,
        finalized: s.finalized,
        owed: toLedger(s.owed, t.decimals, 'floor'),
      };
    } catch (err) {
      this.warn('session', `chain: session lookup failed (${firstLine(err)})`);
      throw new ChainBusyError('session lookup', err);
    }
  }

  /**
   * Created arenas, cached 60 s (`fresh` bypasses; a settlement or a sweep marks the list stale).
   * Amounts in ledger units (vaults rounded down). When the read fails, the last good list is served
   * (also one kept on disk from before a restart) and the next read waits `ARENA_RETRY_MS`; only when
   * no list was ever read does it throw `ChainBusyError`.
   */
  async listArenas(fresh = false): Promise<ChainArena[]> {
    const t = this.token();
    if (!this.tokenReady || !t || !this.client || !this.arena) return [];
    const cacheKey = `arenas:${this.arena.toLowerCase()}:${t.decimals}`;
    if (!this.arenaCache) {
      const kept = this.cache.get<ChainArena[]>(cacheKey);
      // from before a restart: served while the RPC refuses us, re-read at the first chance
      if (Array.isArray(kept) && kept.length > 0) this.arenaCache = { at: -Infinity, value: kept };
    }
    const now = this.now();
    if (!fresh && this.arenaCache && now - this.arenaCache.at < ARENA_TTL_MS) return this.arenaCache.value;
    if (!fresh && this.arenaCache && now - this.arenaFailedAt < ARENA_RETRY_MS) return unknownPots(this.arenaCache.value);
    const client = this.client;
    const arenaAddr = this.arena;
    try {
      const value = (await withRpcPriority('normal', () => client.arenas(arenaAddr)))
        .filter((a) => a.exists)
        .map(
          (a): ChainArena => ({
            id: a.id,
            entryFee: toLedger(a.entryFee, t.decimals, 'floor'),
            maxSessions: a.maxSessions,
            openSessions: a.openSessions,
            enabled: a.enabled,
            pot: toLedger(a.vault, t.decimals, 'floor'),
          }),
        );
      this.arenaCache = { at: this.now(), value };
      this.arenaFailedAt = -Infinity;
      this.cache.set(cacheKey, value);
      return value;
    } catch (err) {
      this.arenaFailedAt = this.now();
      this.warn('arenas', `chain: arena list failed (${firstLine(err)})${this.arenaCache ? ' — serving the last good list' : ''}`);
      // the vaults of a stale list are unknown now: the vault guard must not block an arena on them
      if (this.arenaCache) return unknownPots(this.arenaCache.value);
      throw new ChainBusyError('arena list', err);
    }
  }

  /** The arena list goes stale (re-read at the next ask); its value stays for RPC errors. */
  private arenasStale(): void {
    if (this.arenaCache) this.arenaCache.at = -Infinity;
  }

  async verifyMessage(address: string, message: string, signature: string): Promise<boolean> {
    if (!this.client || !isEvm(address) || !/^0x[0-9a-fA-F]*$/.test(signature)) return false;
    return this.client.verifyMessage(getAddress(address), message, signature as Hex);
  }

  /* ---------------------------------------------------------------- */
  /* Wiring                                                           */
  /* ---------------------------------------------------------------- */

  setLiveSessionProvider(fn: () => Set<string>): void {
    this.liveSessions = fn;
  }

  onSettled(fn: (e: SettledEvent) => void): void {
    this.settledListeners.push(fn);
  }

  private emit(e: SettledEvent): void {
    this.arenasStale();
    for (const fn of this.settledListeners) {
      try {
        fn(e);
      } catch (err) {
        this.log(`chain: onSettled listener failed: ${(err as Error).stack ?? err}`);
      }
    }
  }

  /** Wake the worker now (new journal items). */
  kick(): void {
    if (this.kickScheduled || this.stopped) return;
    this.kickScheduled = true;
    setImmediate(() => {
      this.kickScheduled = false;
      void this.pump();
    });
  }

  /* ---------------------------------------------------------------- */
  /* Settlement worker                                                */
  /* ---------------------------------------------------------------- */

  /** One worker pass; resolves when it is done (used by tests). Passes never overlap. */
  async processPending(): Promise<void> {
    await this.pump();
  }

  private pump(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.rerun = false;
        try {
          // settlements and loot sweeps go before every background read
          await withRpcPriority('high', () => this.pass());
        } catch (err) {
          this.log(`chain: worker error: ${(err as Error).stack ?? err}`);
        }
      } while (this.rerun && !this.stopped);
    })().finally(() => (this.running = null));
    return this.running;
  }

  /** Due items: settle batches per arena (chunks of 40, oldest first), then the oldest loot sweep of each arena. */
  private async pass(): Promise<void> {
    if (this.stopped || !this.enabled || !this.client) return;
    const now = this.now();
    const due = this.journal.pending
      // integrity holds wait for an admin decision (release or settle at 0)
      .filter((item) => item.nextAttemptAt <= now && !(item.kind === 'settle' && item.held))
      .sort((a, b) => a.createdAt - b.createdAt);
    if (due.length === 0) return;
    for (const item of due) {
      if (item.kind !== 'settle' && item.kind !== 'sweep') {
        this.log(`!!! chain: dropping journal item of unknown kind: ${JSON.stringify(item)}`);
        this.journal.remove((item as { key: string }).key);
      }
    }
    const blocked = await this.blockedReason();
    if (blocked) {
      // a config the RPC did not answer is an RPC hiccup: look again soon, not after minutes
      const transient = blocked === 'config unavailable';
      for (const item of due) if (this.isPending(item.key)) this.journal.retryLater(item.key, blocked, this.now(), transient ? { maxDelayMs: TRANSIENT_RETRY_MAX_MS } : {});
      return;
    }
    const byArena = new Map<number, SettlementItem[]>();
    for (const item of due) {
      if (item.kind !== 'settle') continue;
      if (!this.validSettlement(item)) continue;
      const list = byArena.get(item.arenaId!) ?? [];
      list.push(item);
      byArena.set(item.arenaId!, list);
    }
    for (const items of byArena.values()) {
      for (const chunk of chunkSettlements(items, SETTLE_CHUNK)) {
        if (this.stopped) return;
        await this.settleBatch(chunk);
      }
    }
    // one sweep per arena at a time, oldest first: a later sweep id must never land before an earlier one
    const firstSweep = new Map<number, SweepItem>();
    for (const item of this.journal.pending) {
      if (item.kind !== 'sweep') continue;
      const cur = firstSweep.get(item.arenaId);
      if (!cur || item.createdAt < cur.createdAt) firstSweep.set(item.arenaId, item);
    }
    for (const item of firstSweep.values()) {
      if (this.stopped) return;
      if (item.nextAttemptAt > now) continue;
      try {
        await this.processSweep(item);
      } catch (err) {
        if (this.isPending(item.key)) this.journal.retryLater(item.key, firstLine(err), this.now());
      }
    }
  }

  /** Why nothing can be sent now (null: the worker may send). */
  private async blockedReason(): Promise<string | null> {
    if (this.chainMismatch) return 'the RPC chain is not the chain the state was opened for (restart the server)';
    if (!this.arena) return 'no arena contract registered';
    if (this.arenaCode !== 'ok') return `arena contract ${this.arena} is not usable (${this.arenaCode ?? 'unchecked'})`;
    if (!this.journalBound) return `the journal belongs to arena ${this.journal.contract}, not ${this.arena}`;
    const config = await this.currentConfig();
    if (!config) return 'config unavailable';
    // no ticket can exist before the token is set; keep the items for when it is
    if (!this.token(config)) return 'game token not set';
    // money is owed: keep the items until the server key is fixed (or the players refund after 24 h)
    if (!this.authorized) return 'server key is not the arena server authority';
    return null;
  }

  /**
   * Retries a journal item later; an RPC rate limit / timeout (`err`) keeps the backoff short (at most
   * `TRANSIENT_RETRY_MAX_MS`): the RPC budget already spaces the calls, the item must not wait minutes.
   */
  private retryItem(key: string, label: string, err?: unknown, opts: { delayMs?: number } = {}): void {
    const transient = err !== undefined && isTransientRpcError(err);
    this.journal.retryLater(key, label, this.now(), { ...opts, ...(transient ? { maxDelayMs: TRANSIENT_RETRY_MAX_MS } : {}) });
  }

  private isPending(key: string): boolean {
    return this.journal.pending.some((p) => p.key === key);
  }

  private validSettlement(item: SettlementItem): boolean {
    const ok =
      Number.isInteger(item.arenaId) &&
      item.arenaId! >= 1 &&
      item.arenaId! <= 65_535 &&
      isEvm(item.player) &&
      Number.isSafeInteger(item.payout) &&
      item.payout! >= 0 &&
      Number.isSafeInteger(item.sessionId) &&
      item.sessionId! > 0;
    if (!ok) {
      this.log(`!!! chain: dropping malformed settlement (needs manual review): ${JSON.stringify(item)}`);
      this.journal.remove(item.key);
    }
    return ok;
  }

  /**
   * One `settle` transaction for up to 40 items of one arena. Each item is checked against its session
   * first (gone or re-opened → settled elsewhere; finalized → the player collects), then reconciled
   * after the receipt: its `Settled` event (or a read of the session) decides, a skipped or reverted
   * item is retried with backoff.
   */
  private async settleBatch(items: SettlementItem[]): Promise<void> {
    const client = this.client!;
    const arena = this.arena!;
    const t = this.token()!;
    const checked: Checked[] = [];
    await Promise.all(
      items.map(async (item) => {
        let s;
        try {
          s = await client.session(arena, item.arenaId!, getAddress(item.player));
        } catch (err) {
          this.retryItem(item.key, `session lookup failed: ${firstLine(err)}`, err);
          return;
        }
        const id = BigInt(item.sessionId!);
        if (s.id !== id) {
          await this.dropFinished(item, s.id === 0n ? 'session already closed' : `on-chain session is #${s.id}, item is for #${id}`);
          return;
        }
        if (s.finalized) {
          await this.dropFinished(item, 'session already finalized (the player collects the payout)');
          return;
        }
        if (item.reason === 'stale' && this.liveSessions().has(item.key)) {
          this.log(`chain: stale settlement of ${short(item.key)} cancelled — the player is in the arena now`);
          // only this stale item: a real result for the key may have replaced it during the read
          if (this.journal.pending.includes(item)) this.journal.remove(item.key);
          return;
        }
        checked.push({ item, sessionId: id, entryFee: s.entryFee, feeBps: s.feeBps });
      }),
    );
    // last check right before sending: a stale session may have been picked up meanwhile
    const send = checked.filter((c) => {
      // the exact item still pending: a stale refund replaced by the room's real result (`Journal.commit`)
      // is not sent with its old payout (the replacement goes in a later pass)
      if (!this.journal.pending.includes(c.item)) return false;
      if (c.item.reason === 'stale' && this.liveSessions().has(c.item.key)) {
        this.log(`chain: stale settlement of ${short(c.item.key)} cancelled — the player is in the arena now`);
        this.journal.remove(c.item.key);
        return false;
      }
      return true;
    });
    if (send.length === 0) return;
    send.sort((a, b) => a.item.createdAt - b.item.createdAt);
    const settlements: Settlement[] = send.map((c) => ({
      arenaId: c.item.arenaId!,
      player: getAddress(c.item.player),
      sessionId: c.sessionId,
      payout: fromLedger(c.item.payout!, t.decimals),
    }));
    let hash: Hash;
    try {
      hash = await client.send(settleCall(arena, settlements));
    } catch (err) {
      await this.onBatchError(send.map((c) => c.item), err);
      return;
    }
    for (const c of send) this.sentTx.set(c.item.key, hash);
    if (this.feeHeld) {
      this.feeHeld = false;
      this.log('chain: settle batches go through again — settlements resume');
    }
    const receipt = await client.receipt(hash, arena, this.deps.receiptTimeoutMs ?? RECEIPT_TIMEOUT_MS);
    if (!receipt) {
      // the next pass reads the sessions: settled ones are reported from this transaction then
      for (const c of send) this.journal.retryLater(c.item.key, `settle ${short(hash)} not confirmed yet`, this.now(), { delayMs: RECHECK_MS });
      return;
    }
    if (receipt.status !== 'success') {
      for (const c of send) this.journal.retryLater(c.item.key, `settle ${short(hash)} reverted`, this.now());
      this.log(`!!! chain: settle batch ${hash} (${send.length} item(s)) reverted — retrying with backoff`);
      return;
    }
    let settledCount = 0;
    for (const c of send) {
      if (await this.reconcile(c, hash, receipt.events)) settledCount++;
    }
    this.log(`chain: settle batch ${hash} · arena #${send[0].item.arenaId} · ${settledCount}/${send.length} settled`);
  }

  /** After a mined batch: true when the item is settled (removed and reported). */
  private async reconcile(c: Checked, hash: Hash, events: ArenaEvent[]): Promise<boolean> {
    const { item } = c;
    const same = (e: { arenaId: number; player: string; sessionId: bigint }) =>
      e.arenaId === item.arenaId && e.player.toLowerCase() === item.player.toLowerCase() && e.sessionId === c.sessionId;
    const settled = events.find((e): e is Extract<ArenaEvent, { name: 'Settled' }> => e.name === 'Settled' && same(e));
    if (settled) {
      this.settledNow(item, hash, settled);
      return true;
    }
    const skipped = events.find((e): e is Extract<ArenaEvent, { name: 'SettleSkipped' }> => e.name === 'SettleSkipped' && same(e));
    let s;
    try {
      s = await this.client!.session(this.arena!, item.arenaId!, getAddress(item.player));
    } catch (err) {
      this.retryItem(item.key, `${skipped ? `skipped (${settleSkipReasonText(skipped.reason)}); ` : ''}session re-check failed: ${firstLine(err)}`, err);
      return false;
    }
    if (s.id === c.sessionId && !s.finalized) {
      const why = skipped ? `skipped: ${settleSkipReasonText(skipped.reason)}` : 'not settled by the batch';
      if (skipped?.reason === SettleSkipReason.InsufficientVault) {
        this.warn(`pot-${item.arenaId}`, `!!! chain: arena #${item.arenaId} vault cannot cover ${short(item.key)} (${this.units(item.payout ?? 0)}) — retrying with backoff`);
      }
      if (item.attempts > 0 && item.attempts % 5 === 0) this.log(`!!! chain: settlement ${item.key} still failing after ${item.attempts + 1} attempts: ${why}`);
      this.journal.retryLater(item.key, why, this.now());
      return false;
    }
    this.sentTx.delete(item.key);
    this.journal.remove(item.key);
    this.log(
      `chain: dropping settlement ${short(item.key)} for ${short(item.player)} — ${s.id === c.sessionId ? 'already finalized (the player collects)' : 'settled elsewhere'} (already settled or refunded)`,
    );
    return false;
  }

  private settledNow(item: SettlementItem, hash: Hash, ev: Extract<ArenaEvent, { name: 'Settled' }>): void {
    const t = this.token()!;
    const fee = toLedger(ev.fee, t.decimals, 'floor');
    const payout = item.payout ?? 0;
    const collect = !ev.collected && ev.payout > ev.fee;
    this.journal.remove(item.key);
    this.sentTx.delete(item.key);
    this.log(
      `chain: ${collect ? 'finalized' : 'settled'} ${short(item.key)} (${item.reason ?? 'settle'}) · ${this.units(payout)}${fee ? ` (fee ${this.units(fee)})` : ''} → ${short(item.player)}${collect ? ' (to collect)' : ''} · ${hash}`,
    );
    this.emit({ key: item.key, player: getAddress(item.player), arenaId: item.arenaId, txHash: hash, payout, fee, ...(collect ? { collect: true } : {}) });
  }

  /** The session is gone (or re-opened, or finalized): drop the item, reporting our own earlier transaction if it settled it. */
  private async dropFinished(item: SettlementItem, why: string): Promise<void> {
    const hash = this.sentTx.get(item.key);
    if (hash) {
      const receipt = await this.client!.receipt(hash, this.arena, LATE_RECEIPT_TIMEOUT_MS).catch(() => null);
      const ev = receipt?.events.find(
        (e): e is Extract<ArenaEvent, { name: 'Settled' }> =>
          e.name === 'Settled' && e.arenaId === item.arenaId && e.player.toLowerCase() === item.player.toLowerCase() && e.sessionId === BigInt(item.sessionId ?? 0),
      );
      if (receipt?.status === 'success' && ev) {
        this.log(`chain: settled ${short(item.key)} (confirmation arrived late) · ${hash}`);
        this.settledNow(item, hash, ev);
        return;
      }
    }
    this.sentTx.delete(item.key);
    this.journal.remove(item.key);
    this.log(`chain: dropping settlement ${short(item.key)} for ${short(item.player)} — ${why} (already settled or refunded)`);
  }

  /** A batch failed before it was mined (the simulation reverted, or the send failed). */
  private async onBatchError(items: SettlementItem[], err: unknown): Promise<void> {
    const d = describeError(err);
    const label = `${d.name ?? 'error'}: ${d.kind === 'contract' ? d.message : firstLine(err)}`;
    if (d.name === 'NotServer') {
      // our key may have been rotated out: re-read the config to tell
      await this.freshConfig();
    } else if (d.name === 'SafeERC20FailedOperation') {
      // a failing fee transfer reverts the whole batch: the fee wallet cannot receive the token
      this.feeHeld = true;
      this.warn(
        'fee-wallet',
        `!!! chain: settle batches revert on the fee transfer — the fee wallet ${this.config?.feeWallet ?? '?'} cannot receive the game token. ` +
          'ALL settlements are held (never counted against the players); set a working fee wallet in /admin → Arena. They resume by themselves.',
      );
    } else if (d.kind === 'insufficient-funds') {
      this.warn('gas', `!!! chain: the server key ${this.serverAddress} cannot pay gas — fund it with HYPE (${label})`);
      void this.checkBalance();
    }
    for (const item of items) {
      if (item.attempts > 0 && item.attempts % 5 === 0) this.log(`!!! chain: settlement ${item.key} still failing after ${item.attempts + 1} attempts: ${label}`);
      this.retryItem(item.key, label, err);
    }
  }

  /**
   * Round end: burns exactly the journaled floor-loot value of one arena instance from the arena vault
   * (`sweepLoot`). The sweep id is assigned and persisted in the journal before the first send; the
   * contract refuses an id that is not above the arena's `lastSweepId`, so a resend can never burn
   * twice, and the sweep landed exactly when `lastSweepId` reaches its id.
   */
  private async processSweep(item: SweepItem): Promise<void> {
    const { key } = item;
    if (!Number.isSafeInteger(item.amount) || item.amount <= 0 || !Number.isInteger(item.arenaId) || item.arenaId < 1) {
      this.log(`!!! chain: dropping malformed loot sweep (needs manual review): ${JSON.stringify(item)}`);
      this.journal.remove(key);
      return;
    }
    const client = this.client!;
    const arenaAddr = this.arena!;
    const t = this.token()!;
    let info;
    try {
      info = await client.arena(arenaAddr, item.arenaId);
    } catch (err) {
      this.retryItem(key, `arena lookup failed: ${firstLine(err)}`, err);
      return;
    }
    if (!info.exists) {
      this.journal.retryLater(key, `arena #${item.arenaId} does not exist on ${arenaAddr}`, this.now());
      return;
    }
    const last = Number(info.lastSweepId);
    if (item.sweepId !== undefined && last >= item.sweepId) {
      this.journal.remove(key);
      this.arenasStale();
      this.log(`chain: burned ${this.units(item.amount)} loot of ${item.roomId} (round ${item.round}) · sweep #${item.sweepId} (confirmed)${item.sentTx ? ` · ${item.sentTx}` : ''}`);
      return;
    }
    const sweepId = this.journal.assignSweepId(key, last);
    const amount = fromLedger(item.amount, t.decimals);
    if (amount > info.vault) {
      this.warn(`sweep-pot-${item.arenaId}`, `!!! chain: arena #${item.arenaId} vault cannot cover the loot sweep ${key} (${this.units(item.amount)}) — retrying with backoff`);
      this.journal.retryLater(key, 'vault cannot cover the sweep', this.now());
      return;
    }
    let hash: Hash;
    try {
      hash = await client.send(sweepLootCall(arenaAddr, item.arenaId, BigInt(sweepId), amount));
    } catch (err) {
      const d = describeError(err);
      const label = `${d.name ?? 'error'}: ${d.kind === 'contract' ? d.message : firstLine(err)}`;
      if (d.name === 'SweepIdNotIncreasing') {
        // an earlier send of this very id landed meanwhile: the next pass confirms it from lastSweepId
        this.journal.retryLater(key, label, this.now(), { delayMs: RECHECK_MS });
        return;
      }
      if (d.name === 'NotServer') await this.freshConfig();
      if (d.name === 'InsufficientVault') this.warn(`sweep-pot-${item.arenaId}`, `!!! chain: arena #${item.arenaId} vault cannot cover the loot sweep ${key} — retrying with backoff`);
      if (item.attempts > 0 && item.attempts % 5 === 0) this.log(`!!! chain: loot sweep ${key} still failing after ${item.attempts + 1} attempts: ${label}`);
      this.retryItem(key, label, err);
      return;
    }
    this.journal.markSent(key, hash, this.now());
    const receipt = await client.receipt(hash, arenaAddr, this.deps.receiptTimeoutMs ?? RECEIPT_TIMEOUT_MS);
    if (receipt?.status === 'success') {
      this.journal.remove(key);
      this.arenasStale();
      this.log(`chain: burned ${this.units(item.amount)} loot of ${item.roomId} (round ${item.round}) · sweep #${sweepId} · ${hash}`);
      return;
    }
    // not mined yet, or reverted: the next pass reads lastSweepId and resends the same id if needed
    this.journal.retryLater(key, receipt ? `sweep ${short(hash)} reverted` : `sweep ${short(hash)} not confirmed yet`, this.now(), receipt ? {} : { delayMs: RECHECK_MS });
  }

  /* ---------------------------------------------------------------- */
  /* Stale sessions                                                   */
  /* ---------------------------------------------------------------- */

  /** `STALE_SESSION_AFTER_S` (default 15 min). */
  private staleAfterS(): number {
    const v = this.cfg.chain.staleSessionAfterS;
    return Number.isFinite(v) && v >= 1 ? Math.floor(v) : STALE_SESSION_AFTER_S;
  }

  /**
   * After a journal quarantine (`journal.json.corrupt-*`), sessions whose real result was in the
   * lost journal look "unplayed"; settling them at the entry fee would be wrong. The sweeper stays off
   * until the operator reviews the quarantined file and sets `STALE_SWEEP_ACK=1`. Logged every 30 minutes.
   */
  private staleSweepAllowed(): boolean {
    const files = this.journal.quarantinedFiles();
    if (files.length === 0 || this.cfg.chain.staleSweepAck) return true;
    this.warn(
      'stale-ack',
      `!!! chain: stale-session sweeper is OFF — quarantined journal ${files.join(', ')} needs manual review. ` +
        'Settle what it owed by hand, then set STALE_SWEEP_ACK=1 (or move the file away) and restart.',
      30 * 60_000,
    );
    return false;
  }

  /** Scans new `Joined` logs into the open-session index (chunked; resumes where it stopped). */
  private async scanJoined(): Promise<void> {
    const client = this.client!;
    const arena = this.arena!;
    const latest = await client.blockNumber();
    if (this.index.next === null) {
      const deployKey = `deploy:${arena.toLowerCase()}`;
      const kept = this.cache.get<bigint>(deployKey);
      let start: bigint | null = typeof kept === 'bigint' ? kept : null;
      if (start === null && this.arenaTx && /^0x[0-9a-fA-F]{64}$/.test(this.arenaTx)) start = await client.txBlock(this.arenaTx as Hash);
      // the binary search costs ~25 reads: done once per arena, then kept on disk
      start ??= await client.deployBlock(arena);
      if (start !== null) this.cache.set(deployKey, start);
      if (start === null) {
        start = latest > INDEX_LOOKBACK_BLOCKS ? latest - INDEX_LOOKBACK_BLOCKS : 0n;
        this.log(`chain: deploy block of ${arena} unknown — the stale-session index starts at block ${start}`);
      }
      this.index.next = start;
    }
    const index = this.index;
    let from: bigint = index.next!;
    while (from <= latest && !this.stopped) {
      const chunk = this.logChunk;
      const to: bigint = from + chunk - 1n < latest ? from + chunk - 1n : latest;
      let logs;
      try {
        logs = await client.joinedLogs(arena, from, to);
      } catch (err) {
        // a range the RPC refuses (too many results / too wide) is halved; a rate limit is not the range's fault
        if (!isRateLimited(err) && chunk > LOG_CHUNK_MIN) this.logChunk = chunk / 2n > LOG_CHUNK_MIN ? chunk / 2n : LOG_CHUNK_MIN;
        throw err;
      }
      for (const j of logs) {
        index.candidates.set(sessionKey(j.arenaId, j.player, j.sessionId), { arenaId: j.arenaId, player: j.player, sessionId: j.sessionId });
      }
      // a full-width success widens the next request (fewer calls while catching up)
      if (to - from + 1n === chunk && chunk < LOG_CHUNK_MAX) this.logChunk = chunk * 2n < LOG_CHUNK_MAX ? chunk * 2n : LOG_CHUNK_MAX;
      from = to + 1n;
      index.next = from;
    }
  }

  /**
   * Queues a settlement at the entry fee (no profit, so no fee) for every open session that is not in a
   * room, not already queued and older than `STALE_SESSION_AFTER_S` (15 minutes by default): the player
   * paid but never played. Open sessions come from the arena's `Joined` logs, checked with `getSession`.
   * Returns the number of sessions queued.
   */
  sweepStale(): Promise<number> {
    // background work: after joins, settlements and the arena list
    return withRpcPriority('low', () => this.sweepStaleNow());
  }

  private async sweepStaleNow(): Promise<number> {
    if (this.stopped || !this.enabled || this.authorized !== true || !this.client || !this.arena || !this.tokenReady || !this.journalBound || this.chainMismatch) return 0;
    if (!this.staleSweepAllowed()) return 0;
    const t = this.token()!;
    try {
      await this.scanJoined();
    } catch (err) {
      this.warn('sweep', `chain: stale-session scan failed (${firstLine(err)})`);
      return 0;
    }
    const live = this.liveSessions();
    const pending = new Set(this.journal.pending.map((p) => p.key));
    const only = this.cfg.chain.arenaIds;
    const now = this.now();
    const staleAfterS = this.staleAfterS();
    const enqueue: SettlementItem[] = [];
    const todo = [...this.index.candidates.entries()];
    for (let i = 0; i < todo.length; i += READ_CONCURRENCY) {
      await Promise.all(
        todo.slice(i, i + READ_CONCURRENCY).map(async ([key, c]) => {
          if (live.has(key) || pending.has(key)) return;
          let s;
          try {
            s = await this.client!.session(this.arena!, c.arenaId, c.player);
          } catch {
            return; // next sweep
          }
          // closed, re-opened (a newer key is indexed) or finalized (the player collects): not stale
          if (s.id !== c.sessionId || s.finalized) {
            this.index.candidates.delete(key);
            return;
          }
          if (now / 1000 - s.openedAt < staleAfterS) return;
          if (only.length > 0 && !only.includes(c.arenaId)) return;
          if (s.id > BigInt(Number.MAX_SAFE_INTEGER)) return;
          enqueue.push({
            kind: 'settle',
            key,
            player: getAddress(c.player),
            arenaId: c.arenaId,
            session: key,
            sessionId: Number(s.id),
            payout: toLedger(s.entryFee, t.decimals, 'floor'),
            score: 0,
            kills: 0,
            xp: 0,
            reason: 'stale',
            attempts: 0,
            nextAttemptAt: now,
            createdAt: now,
          });
        }),
      );
    }
    // re-read synchronously right before the commit: a ticket may have been seated (or a settlement queued)
    // during the awaits above; its room settles it with the real result, never at the entry fee
    const liveNow = this.liveSessions();
    const pendingNow = new Set(this.journal.pending.map((p) => p.key));
    const fresh = enqueue.filter((e) => !liveNow.has(e.key) && !pendingNow.has(e.key));
    if (fresh.length < enqueue.length) this.log(`chain: ${enqueue.length - fresh.length} stale settlement(s) skipped — the session is in the arena or queued now`);
    enqueue.length = 0;
    enqueue.push(...fresh);
    if (enqueue.length === 0) return 0;
    this.journal.commit({ enqueue });
    this.log(`chain: ${enqueue.length} unplayed session(s) older than ${staleAfterS >= 120 ? `${Math.round(staleAfterS / 60)} min` : `${staleAfterS} s`} → settlement at the entry fee queued`);
    this.kick();
    return enqueue.length;
  }

  /** Items the worker still has to send (tests). */
  pendingItems(): readonly JournalItem[] {
    return this.journal.pending;
  }

  /** Expected fee of a payout for a session (ledger units), as `settle` computes it. */
  feeFor(payoutLedger: number, entryFee: bigint, feeBps: number): number {
    const t = this.token();
    if (!t) return 0;
    return toLedger(computeFee(fromLedger(payoutLedger, t.decimals), entryFee, feeBps), t.decimals, 'floor');
  }
}
