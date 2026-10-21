import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  SlanaClient,
  SlanaErrorCode,
  assertSafeSupply,
  ata,
  clusterDefaultRpc,
  describeError,
  feeWalletAta,
  isTokenSet,
  lamportsToSol,
  programErrorCode,
  requireToken,
  splitPayout,
  type ArenaView,
  type ConfigView,
  type GameToken,
  type ProfileView,
  type SessionView,
} from '@slana/sdk';
import { TOKEN_SYMBOL_DEFAULT, formatToken, toSafeAmount, type ChainStatus } from '@slana/shared';
import { Connection, Keypair, PublicKey, type TransactionInstruction } from '@solana/web3.js';
import type { ServerConfig } from '../config';
import type { Journal, JournalItem, SettlementItem, SweepItem } from '../stake/journal';
import type { ChainArena, ChainGateway, ChainProfile, ChainSession, SettledEvent } from './types';

export type { SettledEvent } from './types';

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

const WORKER_INTERVAL_MS = 1_000;
const REFRESH_INTERVAL_MS = 30_000;
const SWEEP_INTERVAL_MS = 5 * 60_000;
/** Sessions nobody plays for this long are refunded (payout = buy-in); `STALE_SESSION_AFTER_S` overrides it. */
export const STALE_SESSION_AFTER_S = 15 * 60;
const PROFILE_TTL_MS = 60_000;
const ARENA_TTL_MS = 30_000;
const CONFIG_TTL_MS = 30_000;
const MAX_IN_FLIGHT = 4;
/** Upper bound for one send+confirm (a blockhash lives ~60–90 s). */
const SEND_TIMEOUT_MS = 120_000;
const RPC_TIMEOUT_MS = 20_000;
const LOW_BALANCE_LAMPORTS = 50_000_000; // 0.05 SOL
const MAX_PROFILE_CACHE = 5_000;
/**
 * Failed attempts caused by the player's token account (owner changed, Token-2022
 * MemoTransfer required, closed between check and send, ...) before the worker settles
 * without it and the session is finalized with `owed` (R24).
 */
export const TOKEN_FAILURES_BEFORE_FINALIZE = 3;
/** Anchor constraint errors that name the player's token account. */
const TOKEN_ACCOUNT_CODES: readonly number[] = [2014, 2015, 2021];
/** SPL Token and Token-2022 program ids (a failure inside them on settle is the player's account). */
const TOKEN_PROGRAM_FAILED = /Program (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA|TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb) failed/;
const STOP_GRACE_MS = 5_000;
/** A usable fee wallet token account is trusted this long before it is checked again. */
const FEE_ACCOUNT_TTL_MS = 30_000;

/**
 * Why a token account cannot receive the fee: null when it is usable (exists, owned by the token
 * program, holds the game mint, belongs to the fee wallet, initialized and not frozen). SPL Token
 * and Token-2022 share the base layout: mint [0, 32), owner [32, 64), state u8 at 108.
 */
export function feeAccountProblem(
  account: { owner: string; data: Uint8Array } | null,
  expect: { tokenProgram: string; tokenMint: string; feeWallet: string },
): string | null {
  if (!account) return 'missing';
  if (account.owner !== expect.tokenProgram) return `owned by ${account.owner}, not the token program`;
  if (account.data.length < 165) return 'not a token account';
  const key = (from: number) => new PublicKey(account.data.subarray(from, from + 32)).toBase58();
  if (key(0) !== expect.tokenMint) return `holds mint ${key(0)}, not the game token`;
  if (key(32) !== expect.feeWallet) return `belongs to ${key(32)}, not the fee wallet`;
  const state = account.data[108];
  if (state === 2) return 'frozen';
  if (state !== 1) return 'not initialized';
  return null;
}
/** How long the worker waits before re-checking a sent sweep that may still land. */
export const SWEEP_RECHECK_MS = 5_000;

const ERR = {
  unauthorized: SlanaErrorCode.Unauthorized,
  sessionMismatch: SlanaErrorCode.SessionMismatch,
  sessionFinalized: SlanaErrorCode.SessionFinalized,
  insufficientPot: SlanaErrorCode.InsufficientPot,
  /** Anchor: account does not exist (session already closed / profile missing). */
  accountNotInitialized: 3012,
  /** Anchor: account owned by another program (a closed PDA that received lamports). */
  accountOwnedByWrongProgram: 3007,
  /** Anchor: PDA seeds mismatch. */
  constraintSeeds: 2006,
  constraintAddress: 2012,
} as const;

/* ------------------------------------------------------------------ */
/* Dependency seam                                                     */
/* ------------------------------------------------------------------ */

/** What the gateway needs from `SlanaClient` (tests inject a fake). */
export interface ChainClient {
  readonly programId: PublicKey;
  isDeployed(): Promise<boolean>;
  fetchConfig(): Promise<ConfigView | null>;
  fetchProfile(owner: string): Promise<ProfileView | null>;
  fetchArenas(): Promise<ArenaView[]>;
  fetchSession(arenaId: number, player: string): Promise<SessionView | null>;
  fetchSessions(): Promise<SessionView[]>;
  /** Raw supply of the game-token mint (base units). */
  fetchMintSupply(mint: string): Promise<bigint>;
  /** Whether an account exists (used for the player's token account). */
  accountExists(address: string): Promise<boolean>;
  /** Owner program and data of an account, null when it does not exist (the fee wallet's token account). */
  fetchAccount(address: string): Promise<{ owner: string; data: Uint8Array } | null>;
  readonly ix: Pick<SlanaClient['ix'], 'settleSession' | 'sweepLoot'>;
}

/** `ChainClient` over a real `SlanaClient` + its connection. */
export function sdkChainClient(sdk: SlanaClient, connection: Connection): ChainClient {
  return {
    programId: sdk.programId,
    ix: sdk.ix,
    isDeployed: () => sdk.isDeployed(),
    fetchConfig: () => sdk.fetchConfig(),
    fetchProfile: (owner) => sdk.fetchProfile(owner),
    fetchArenas: () => sdk.fetchArenas(),
    fetchSession: (arenaId, player) => sdk.fetchSession(arenaId, player),
    fetchSessions: () => sdk.fetchSessions(),
    fetchMintSupply: async (mint) => BigInt((await connection.getTokenSupply(new PublicKey(mint), 'confirmed')).value.amount),
    accountExists: async (address) => (await connection.getAccountInfo(new PublicKey(address), 'confirmed')) !== null,
    fetchAccount: async (address) => {
      const info = await connection.getAccountInfo(new PublicKey(address), 'confirmed');
      return info ? { owner: info.owner.toBase58(), data: info.data } : null;
    },
  };
}

export interface SolanaChainDeps {
  client?: ChainClient;
  /** Server authority keypair (default: `cfg.chain.serverKeypair`). */
  keypair?: Keypair;
  /**
   * Signs `ixs` with the server key, sends and waits for 'confirmed'; returns the signature.
   * `onSignature` must be called before sending (lets the worker find a lost confirmation later),
   * with the `lastValidBlockHeight` of the transaction's blockhash.
   */
  send?: (ixs: TransactionInstruction[], onSignature: (signature: string, lastValidBlockHeight?: number) => void) => Promise<string>;
  /**
   * Whether a previously sent transaction landed successfully (false: not found, or landed with
   * an error). Throws when the status cannot be read.
   */
  signatureLanded?: (signature: string) => Promise<boolean>;
  /** Current block height ('confirmed', the blockhash commitment). */
  blockHeight?: () => Promise<number>;
  /** Server wallet balance in lamports. */
  balance?: () => Promise<number>;
  now?: () => number;
  /** Start the background loops in `start()` (default true; tests drive them by hand). */
  loops?: boolean;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Reads the server keypair from a JSON file path or from the JSON array itself. `auto` keeps the key in
 * `<dataDir>/server-keypair.json`, creating it (mode 0600) on the first start, so a host never has to be given the
 * secret: the operator reads the public key from the log or `/api/health` and sets it as the server authority.
 */
export function loadServerKeypair(spec: string, dataDir?: string): Keypair {
  const trimmed = spec.trim();
  if (trimmed === 'auto') {
    if (!dataDir) throw new Error('SERVER_KEYPAIR=auto needs DATA_DIR');
    const path = join(dataDir, 'server-keypair.json');
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(Array.from(Keypair.generate().secretKey)), { mode: 0o600, flag: 'wx' });
    }
    return loadServerKeypair(path);
  }
  let raw: string;
  if (trimmed.startsWith('[')) {
    raw = trimmed;
  } else {
    const path = trimmed === '~' || trimmed.startsWith('~/') ? resolve(homedir(), trimmed.slice(2)) : resolve(trimmed);
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      throw new Error(`SERVER_KEYPAIR: cannot read ${path}`);
    }
  }
  try {
    const bytes = JSON.parse(raw) as unknown;
    if (!Array.isArray(bytes) || bytes.length !== 64) throw new Error('bad shape');
    return Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
  } catch {
    throw new Error('SERVER_KEYPAIR is not a valid keypair (expected a JSON array of 64 numbers)');
  }
}

function isPubkey(s: unknown): s is string {
  if (typeof s !== 'string' || s.length < 32 || s.length > 44) return false;
  try {
    new PublicKey(s);
    return true;
  } catch {
    return false;
  }
}

const clampInt = (v: unknown, max: number): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0;
};

const short = (s: string): string => (s.length > 12 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s);
const sol = (lamports: number): string => `◎${lamportsToSol(lamports).toFixed(4).replace(/\.?0+$/, '')}`;
const firstLine = (err: unknown): string => String((err as Error)?.message ?? err).split('\n')[0].slice(0, 240);
/** Transaction log lines carried by a send error (SendTransactionError, TransactionFailedError, ...). */
function errorLogs(err: unknown, depth = 0): string[] {
  if (!err || typeof err !== 'object' || depth > 3) return [];
  const r = err as Record<string, unknown>;
  for (const k of ['logs', 'transactionLogs']) {
    const v = r[k];
    if (Array.isArray(v) && v.every((l) => typeof l === 'string')) return v as string[];
  }
  for (const k of ['cause', 'error', 'err']) {
    const inner = errorLogs(r[k], depth + 1);
    if (inner.length > 0) return inner;
  }
  return [];
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref());

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms);
    timer.unref();
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** `fetch` with a per-request timeout (web3.js has none, so a dead RPC would hang forever). */
function fetchWithTimeout(ms: number): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(ms) })) as typeof fetch;
}

const toChainProfile = (p: ProfileView): ChainProfile => ({
  owner: p.owner,
  name: p.name,
  skin: p.skin,
  xp: p.xp,
  level: p.level,
  premiumSkins: 0, // no premium skins: everyone picks from the basic skins
  gamesPlayed: p.gamesPlayed,
  bestScore: p.bestScore,
});

/* ------------------------------------------------------------------ */
/* Gateway                                                             */
/* ------------------------------------------------------------------ */

/**
 * Solana-backed `ChainGateway`: cached reads for the rooms (profiles, arenas, sessions), plus the
 * settlement worker that turns journal items into `settle_session` / `sweep_loot` (burn)
 * transactions signed by the server authority, and a sweeper that refunds sessions nobody played.
 *
 * Token watcher: the program may be initialized without a mint (`set_token_mint` comes later).
 * The config is read at start and every 30 s; while the mint is unset the gateway reports
 * `tokenReady: false` (practice only). The first read that finds the mint set turns arenas on
 * (after the supply check) and fires `onStatusChange`, so rooms attach without a restart.
 */
export class SolanaChain implements ChainGateway {
  enabled = false;
  stakeEnabled = false;

  private client: ChainClient | null = null;
  private sdk: SlanaClient | null = null;
  private connection: Connection | null = null;
  private keypair: Keypair | null = null;
  private config: ConfigView | null = null;
  private configAt = 0;
  /** Server key == config.serverAuthority (null until the config was read once). */
  private authorized: boolean | null = null;
  /** The token's raw supply fits a JS number (null until read). Arenas stay off otherwise. */
  private supplySafe: boolean | null = null;

  private liveSessions: () => Set<string> = () => new Set();
  private readonly settledListeners: ((e: SettledEvent) => void)[] = [];
  private readonly inFlight = new Map<string, Promise<void>>();
  /** Last signature sent per journal key (a lost confirmation can still be reported). */
  private readonly sentSignatures = new Map<string, string>();

  private readonly profiles = new Map<string, { at: number; value: ChainProfile | null }>();
  private readonly profileFetches = new Map<string, Promise<ChainProfile | null>>();
  private arenaCache: { at: number; value: ChainArena[] } | null = null;
  private probing: Promise<boolean> | null = null;
  private readonly statusListeners: (() => void)[] = [];
  /** `tokenReady` / `arenasEnabled` as last announced (status-change listeners fire on a change). */
  private announced = { tokenReady: false, arenasEnabled: false };
  /** The fee wallet token account last found usable (address and when); re-checked after the TTL. */
  private feeAccountOk: { address: string; at: number } | null = null;
  /** Settlements are held because the fee wallet token account is unusable (logs the recovery). */
  private feeAccountHeld = false;

  private timers: NodeJS.Timeout[] = [];
  private kickScheduled = false;
  private started = false;
  private stopped = false;
  private readonly lastWarn = new Map<string, number>();
  private readonly now: () => number;

  constructor(
    private readonly cfg: ServerConfig,
    private readonly journal: Journal,
    private readonly log: (m: string) => void,
    private readonly deps: SolanaChainDeps = {},
  ) {
    this.now = deps.now ?? Date.now;
  }

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                        */
  /* ---------------------------------------------------------------- */

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    try {
      this.keypair = this.deps.keypair ?? loadServerKeypair(this.cfg.chain.serverKeypair ?? '', this.cfg.dataDir);
      if (this.deps.client) {
        this.client = this.deps.client;
      } else {
        const { rpcUrl, wsUrl, programId } = this.cfg.chain;
        if (!rpcUrl) throw new Error('SOLANA_RPC_URL is not set');
        this.connection = new Connection(rpcUrl, {
          commitment: 'confirmed',
          wsEndpoint: wsUrl ?? undefined,
          fetch: fetchWithTimeout(RPC_TIMEOUT_MS),
        });
        this.sdk = new SlanaClient(this.connection, programId ?? undefined);
        this.client = sdkChainClient(this.sdk, this.connection);
      }
    } catch (err) {
      this.log(`chain: disabled — ${(err as Error).message}; running free play only`);
      return;
    }
    await this.probe();
    // the boot state is the baseline: the app attaches arenas itself after start, nobody is connected yet
    this.announced = { tokenReady: this.tokenReady, arenasEnabled: this.stakeEnabled };
    if (this.deps.loops === false) return;
    const staleAfterS = this.staleAfterS();
    if (staleAfterS !== STALE_SESSION_AFTER_S) this.log(`chain: unplayed sessions are refunded after ${staleAfterS} s (STALE_SESSION_AFTER_S)`);
    this.timers.push(
      setInterval(() => this.pump(), WORKER_INTERVAL_MS),
      setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS),
      setInterval(() => void this.checkBalance(), SWEEP_INTERVAL_MS),
      setInterval(() => void this.sweepStale(), Math.min(SWEEP_INTERVAL_MS, Math.max(1_000, staleAfterS * 1000))),
    );
    for (const t of this.timers) t.unref();
    this.kick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.inFlight.size > 0) {
      await Promise.race([Promise.allSettled([...this.inFlight.values()]), sleep(STOP_GRACE_MS)]);
    }
  }

  /** Checks deployment + config; enables the gateway when both exist. Never throws. */
  private probe(): Promise<boolean> {
    this.probing ??= this.probeOnce().finally(() => (this.probing = null));
    return this.probing;
  }

  private async probeOnce(): Promise<boolean> {
    const client = this.client!;
    const where = `${this.cfg.chain.cluster} (${this.cfg.chain.rpcUrl ?? 'injected client'})`;
    try {
      if (!(await client.isDeployed())) {
        this.warn('probe', `chain: program ${client.programId.toBase58()} is not deployed on ${where} — free play only (re-checking every 30 s)`);
        return false;
      }
      const config = await client.fetchConfig();
      if (!config) {
        this.warn('probe', `chain: program ${client.programId.toBase58()} is not initialized on ${where} (run \`pnpm admin init\`) — free play only`);
        return false;
      }
      this.applyConfig(config);
      this.enabled = true;
      await this.checkSupply();
      this.log(
        `chain: ${where} · program ${client.programId.toBase58()} · ` +
          `token ${config.tokenMint ?? 'not set (practice only until `pnpm admin set-token`; re-checking every 30 s)'} · ` +
          `fee ${config.feeBps / 100} % → ${config.feeWallet} · ` +
          `server ${this.keypair!.publicKey.toBase58()} · stake ${this.stakeEnabled ? 'on' : 'off'}`,
      );
      void this.checkBalance();
      return true;
    } catch (err) {
      this.warn('probe', `chain: RPC ${where} unreachable (${firstLine(err)}) — free play only (re-checking every 30 s)`);
      return false;
    }
  }

  /**
   * 30 s loop: re-probe while offline, otherwise re-read the config (server authority, pause,
   * and, until it is set, the token mint) and the supply. Public so tests drive it by hand.
   */
  async refresh(): Promise<void> {
    if (this.stopped || !this.client) return;
    if (!this.enabled) {
      if (await this.probe()) {
        this.announceStatus();
        this.kick();
      }
      return;
    }
    await this.freshConfig();
    await this.checkSupply();
    this.announceStatus();
  }

  /** The game token of the cached config, null while it is unset (or the config is unknown). */
  private token(config: ConfigView | null = this.config): GameToken | null {
    return config && isTokenSet(config) ? requireToken(config) : null;
  }

  get tokenReady(): boolean {
    return this.enabled && this.token() !== null;
  }

  onStatusChange(fn: () => void): void {
    this.statusListeners.push(fn);
  }

  /** Fires the status listeners when `tokenReady` or `arenasEnabled` changed since the last announcement. */
  private announceStatus(): void {
    const ready = this.tokenReady;
    const arenas = this.stakeEnabled;
    const before = this.announced;
    if (ready === before.tokenReady && arenas === before.arenasEnabled) return;
    this.announced = { tokenReady: ready, arenasEnabled: arenas };
    if (ready && !before.tokenReady) {
      const c = this.config!;
      this.arenaCache = null;
      this.log(`chain: game token set — mint ${c.tokenMint} (${c.tokenDecimals} decimals) · arenas ${this.stakeEnabled ? 'on' : 'off'}`);
    }
    for (const fn of this.statusListeners) {
      try {
        fn();
      } catch (err) {
        this.log(`chain: status listener failed: ${(err as Error).stack ?? err}`);
      }
    }
  }

  /**
   * Reads the mint supply: arenas only run while every amount fits a JS number
   * (`assertSafeSupply`). RPC errors keep the last known answer.
   */
  private async checkSupply(): Promise<void> {
    const token = this.token();
    if (!token) return;
    let safe: boolean;
    try {
      const supply = await this.client!.fetchMintSupply(token.tokenMint);
      try {
        assertSafeSupply(supply);
        safe = true;
      } catch (err) {
        if (this.supplySafe !== false) this.log(`!!! chain: arenas OFF — ${(err as Error).message}`);
        safe = false;
      }
    } catch (err) {
      this.warn('supply', `chain: token supply lookup failed (${firstLine(err)})`);
      return;
    }
    if (safe && this.supplySafe === false) this.log('chain: token supply is safe again — arenas back on');
    this.supplySafe = safe;
    this.updateStakeEnabled();
  }

  private updateStakeEnabled(): void {
    this.stakeEnabled = this.authorized === true && this.cfg.chain.stakeEnabled && this.token() !== null && this.supplySafe === true;
  }

  /** Raw token units with the mint's decimals and the display symbol (for logs). */
  private units(raw: number): string {
    const decimals = this.token()?.tokenDecimals;
    if (decimals === undefined) return `${raw} token units`;
    try {
      return `${formatToken(raw, decimals, { maxFrac: decimals })} ${this.cfg.chain.tokenSymbol}`;
    } catch {
      return `${raw} token units`;
    }
  }

  private applyConfig(config: ConfigView): void {
    this.config = config;
    this.configAt = this.now();
    const ours = this.keypair!.publicKey.toBase58();
    const authorized = config.serverAuthority === ours;
    if (!authorized && this.authorized !== false) {
      this.log(
        `!!! chain: SERVER_KEYPAIR ${ours} is NOT the program's server authority (${config.serverAuthority}). ` +
          'Arenas are OFF; pending settlements stay queued until this is fixed ' +
          `(e.g. \`pnpm admin update-config --server ${ours}\`).`,
      );
    } else if (authorized && this.authorized === false) {
      this.log('chain: server authority matches again — settlements resume');
    }
    this.authorized = authorized;
    this.updateStakeEnabled();
  }

  /** Cached config, re-read when older than `maxAgeMs` (the cached one is kept on RPC errors). */
  private async currentConfig(maxAgeMs = CONFIG_TTL_MS): Promise<ConfigView | null> {
    if (this.config && this.now() - this.configAt < maxAgeMs) return this.config;
    return (await this.freshConfig()) ?? this.config;
  }

  /** Reads the config now; null when the RPC call failed. */
  private async freshConfig(): Promise<ConfigView | null> {
    try {
      const config = await this.client!.fetchConfig();
      if (config) this.applyConfig(config);
      return config;
    } catch (err) {
      this.warn('config', `chain: config refresh failed (${firstLine(err)})`);
      return null;
    }
  }

  private async checkBalance(): Promise<void> {
    if (!this.enabled || !this.keypair) return;
    try {
      const lamports = this.deps.balance ? await this.deps.balance() : await this.connection!.getBalance(this.keypair.publicKey, 'confirmed');
      if (lamports < LOW_BALANCE_LAMPORTS) {
        this.warn(
          'balance',
          `chain: WARNING server wallet ${this.keypair.publicKey.toBase58()} holds only ${sol(lamports)} — fund it, it pays every settlement fee`,
          30 * 60_000,
        );
      }
    } catch {
      /* best effort */
    }
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
    const { cluster, publicRpcUrl } = this.cfg.chain;
    if (!this.enabled || !this.client) {
      return { enabled: false, cluster, programId: null, rpcUrl: null, arenasEnabled: false, tokenReady: false, token: null, feeBps: null, serverKey: this.keypair?.publicKey.toBase58() ?? null };
    }
    const token = this.token();
    return {
      enabled: true,
      cluster,
      programId: this.client.programId.toBase58(),
      rpcUrl: publicRpcUrl ?? clusterDefaultRpc(cluster),
      arenasEnabled: this.stakeEnabled,
      tokenReady: token !== null,
      token: token ? { mint: token.tokenMint, symbol: this.cfg.chain.tokenSymbol || TOKEN_SYMBOL_DEFAULT, decimals: token.tokenDecimals } : null,
      feeBps: this.config?.feeBps ?? null,
      serverKey: this.keypair?.publicKey.toBase58() ?? null,
    };
  }

  /** Cached 60 s (`fresh` bypasses). Never throws: RPC errors yield the last known value or null. */
  async getProfile(owner: string, fresh = false): Promise<ChainProfile | null> {
    if (!this.enabled || !this.client || !isPubkey(owner)) return null;
    const cached = this.profiles.get(owner);
    if (!fresh && cached && this.now() - cached.at < PROFILE_TTL_MS) return cached.value;
    const running = this.profileFetches.get(owner);
    if (running && !fresh) return running;
    const fetching: Promise<ChainProfile | null> = this.fetchProfileNow(owner, cached?.value ?? null).finally(() => {
      if (this.profileFetches.get(owner) === fetching) this.profileFetches.delete(owner);
    });
    this.profileFetches.set(owner, fetching);
    return fetching;
  }

  private async fetchProfileNow(owner: string, fallback: ChainProfile | null): Promise<ChainProfile | null> {
    try {
      const view = await this.client!.fetchProfile(owner);
      const value = view ? toChainProfile(view) : null;
      if (this.profiles.size >= MAX_PROFILE_CACHE) this.profiles.delete(this.profiles.keys().next().value!);
      this.profiles.delete(owner);
      this.profiles.set(owner, { at: this.now(), value });
      return value;
    } catch (err) {
      this.warn('profile', `chain: profile lookup failed (${firstLine(err)})`);
      return fallback;
    }
  }

  /** Always read fresh from the chain; null when missing or on RPC errors. */
  async getSession(arenaId: number, player: string): Promise<ChainSession | null> {
    if (!this.enabled || !this.client || !isPubkey(player) || !Number.isInteger(arenaId)) return null;
    try {
      const s = await this.client.fetchSession(arenaId, player);
      if (!s) return null;
      return {
        address: s.address,
        id: s.id,
        player: s.player,
        arenaId: s.arenaId,
        entryFee: toSafeAmount(s.entryFee),
        openedAt: s.openedAt,
        finalized: s.finalized,
        owed: toSafeAmount(s.owed),
      };
    } catch (err) {
      this.warn('session', `chain: session lookup failed (${firstLine(err)})`);
      return null;
    }
  }

  /** Cached 30 s. */
  async listArenas(fresh = false): Promise<ChainArena[]> {
    if (!this.enabled || !this.client || !this.tokenReady) return [];
    if (!fresh && this.arenaCache && this.now() - this.arenaCache.at < ARENA_TTL_MS) return this.arenaCache.value;
    try {
      const value = (await this.client.fetchArenas()).map(
        (a): ChainArena => ({
          id: a.id,
          address: a.address,
          entryFee: toSafeAmount(a.entryFee),
          maxSessions: a.maxSessions,
          openSessions: a.openSessions,
          enabled: a.enabled,
          pot: toSafeAmount(a.pot),
        }),
      );
      this.arenaCache = { at: this.now(), value };
      return value;
    } catch (err) {
      this.warn('arenas', `chain: arena list failed (${firstLine(err)})`);
      return this.arenaCache?.value ?? [];
    }
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
    this.profiles.delete(e.player);
    this.arenaCache = null;
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
      this.pump();
    });
  }

  /* ---------------------------------------------------------------- */
  /* Settlement worker                                                */
  /* ---------------------------------------------------------------- */

  /** One worker pass; resolves when every send it started has finished (used by tests). */
  async processPending(): Promise<void> {
    this.pump();
    await Promise.allSettled([...this.inFlight.values()]);
  }

  /** Starts due journal items, oldest first, keeping at most 4 in flight. */
  private pump(): void {
    if (this.stopped || !this.enabled || !this.client || !this.keypair) return;
    const now = this.now();
    const due = this.journal.pending
      // integrity holds wait for an admin decision (release or settle at 0)
      .filter((item) => item.nextAttemptAt <= now && !this.inFlight.has(item.key) && !(item.kind === 'settle' && item.held))
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const item of due) {
      if (this.inFlight.size >= MAX_IN_FLIGHT) break;
      const run = this.process(item)
        .catch((err) => {
          this.log(`chain: worker error on ${short(item.key)}: ${(err as Error).stack ?? err}`);
          if (this.isPending(item.key)) this.journal.retryLater(item.key, firstLine(err), this.now());
        })
        .finally(() => {
          // Safety net: an item must never stay due after an attempt (no hot loop).
          const left = this.journal.pending.find((p) => p.key === item.key);
          if (left && left.nextAttemptAt <= this.now()) this.journal.retryLater(item.key, left.lastError ?? 'no progress', this.now());
          this.inFlight.delete(item.key);
          if (!this.stopped) this.kick();
        });
      this.inFlight.set(item.key, run);
    }
  }

  private isPending(key: string): boolean {
    return this.journal.pending.some((p) => p.key === key);
  }

  private async process(item: JournalItem): Promise<void> {
    if (item.kind === 'settle') return this.processSettle(item);
    if (item.kind === 'sweep') return this.processSweep(item);
    this.log(`!!! chain: dropping journal item of unknown kind: ${JSON.stringify(item)}`);
    this.journal.remove((item as { key: string }).key);
  }

  /**
   * Round end: burns exactly the journaled floor-loot value of one arena instance from the arena
   * vault (`sweep_loot`, server-signed; the mint supply drops). The program caps it only
   * by the vault balance, so the amount is never anything but what the room computed, and the
   * same item is never executed twice: its last signature and blockhash `lastValidBlockHeight`
   * are persisted before each send, and it is sent again only when the block height is past that
   * height (the transaction can never land) and the signature did not land.
   */
  private async processSweep(item: SweepItem): Promise<void> {
    const { key } = item;
    if (!Number.isSafeInteger(item.amount) || item.amount <= 0 || !Number.isInteger(item.arenaId) || item.arenaId < 0) {
      this.log(`!!! chain: dropping malformed loot sweep (needs manual review): ${JSON.stringify(item)}`);
      this.journal.remove(key);
      return;
    }
    if (item.sentSignature) {
      // Resend only once the earlier transaction provably cannot land: block height first (a
      // blockhash past its lastValidBlockHeight can never land), then its status.
      const sig = item.sentSignature;
      const wait = (why: string) => this.journal.retryLater(key, `sweep ${short(sig)}: ${why}`, this.now(), { delayMs: SWEEP_RECHECK_MS });
      let height: number;
      try {
        height = await this.currentBlockHeight();
      } catch (err) {
        wait(`block height unavailable (${firstLine(err)})`);
        return;
      }
      const landed = await this.sweepLanded(sig);
      if (landed === null) {
        wait('status unknown');
        return;
      }
      if (landed) {
        this.journal.remove(key);
        this.arenaCache = null;
        this.log(`chain: burned ${this.units(item.amount)} loot of ${item.roomId} (round ${item.round}) (confirmation arrived late) · ${sig}`);
        return;
      }
      const lvbh = item.sentLastValidBlockHeight;
      if (lvbh === undefined) {
        this.warn(`sweep-lvbh-${key}`, `!!! chain: loot sweep ${key} was sent as ${sig} without a recorded blockhash expiry; not resending (needs manual review)`);
        wait('no recorded blockhash expiry');
        return;
      }
      if (!(height > lvbh)) {
        wait(`not landed yet, blockhash valid until height ${lvbh} (now ${height})`);
        return;
      }
    }
    const config = await this.currentConfig();
    if (!config) {
      this.journal.retryLater(key, 'config unavailable', this.now());
      return;
    }
    const token = this.token(config);
    if (!token) {
      this.journal.retryLater(key, 'game token not set', this.now());
      return;
    }
    if (!this.authorized) {
      this.journal.retryLater(key, 'server key is not the program server authority', this.now());
      return;
    }
    const ix = await this.client!.ix.sweepLoot(this.keypair!.publicKey, {
      id: item.arenaId,
      amount: item.amount,
      tokenMint: token.tokenMint,
      tokenProgram: token.tokenProgram,
    });
    try {
      const signature = await this.send(key, [ix], (sig, lvbh) => this.journal.markSent(key, sig, this.now(), lvbh));
      this.journal.remove(key);
      this.sentSignatures.delete(key);
      this.arenaCache = null;
      this.log(`chain: burned ${this.units(item.amount)} loot of ${item.roomId} (round ${item.round}) · ${signature}`);
    } catch (err) {
      const code = programErrorCode(err);
      const d = describeError(err);
      const label = `${d.name ?? 'error'}${code !== null ? ` ${code}` : ''}: ${firstLine(err)}`;
      // a program error is final (rejected in preflight, or landed with an error): nothing moved,
      // so the next attempt may send at once
      if (code !== null) this.journal.markSent(key, '', 0);
      if (code === ERR.constraintSeeds || code === ERR.constraintAddress) this.configAt = 0;
      if (code === ERR.unauthorized) await this.freshConfig();
      if (code === ERR.insufficientPot) {
        this.warn(`sweep-pot-${item.arenaId}`, `!!! chain: arena #${item.arenaId} vault cannot cover the loot sweep ${short(key)} (${this.units(item.amount)}) — retrying with backoff`);
      }
      if (item.attempts > 0 && item.attempts % 5 === 0) this.log(`!!! chain: loot sweep ${key} still failing after ${item.attempts + 1} attempts: ${label}`);
      this.journal.retryLater(key, label, this.now());
    }
  }

  /**
   * Whether a sent sweep landed: true (landed, err null), false (not found, or landed with an
   * error), null when the status cannot be read now or is not final yet ('processed').
   */
  private async sweepLanded(signature: string): Promise<boolean | null> {
    try {
      if (this.deps.signatureLanded) return await this.deps.signatureLanded(signature);
      if (!this.connection) return null;
      const status = (
        await withTimeout(this.connection.getSignatureStatuses([signature], { searchTransactionHistory: true }), RPC_TIMEOUT_MS, 'getSignatureStatuses')
      ).value[0];
      if (!status) return false;
      if (status.err) return false;
      return status.confirmationStatus === 'processed' ? null : true;
    } catch {
      return null;
    }
  }

  /** Block height at the blockhash commitment ('confirmed'). Throws on RPC failure. */
  private async currentBlockHeight(): Promise<number> {
    if (this.deps.blockHeight) return this.deps.blockHeight();
    if (!this.connection) throw new Error('no connection');
    return withTimeout(this.connection.getBlockHeight('confirmed'), RPC_TIMEOUT_MS, 'getBlockHeight');
  }

  private async processSettle(item: SettlementItem): Promise<void> {
    const { key } = item;
    if (item.arenaId === undefined || !isPubkey(item.player) || !Number.isSafeInteger(item.payout) || (item.payout ?? -1) < 0) {
      this.log(`!!! chain: dropping malformed settlement (needs manual review): ${JSON.stringify(item)}`);
      this.journal.remove(key);
      return;
    }
    const payout = item.payout!;
    const config = await this.currentConfig();
    if (!config) {
      this.journal.retryLater(key, 'config unavailable', this.now());
      return;
    }
    const token = this.token(config);
    if (!token) {
      // no ticket can exist before the mint is set; keep the item for when it is
      this.journal.retryLater(key, 'game token not set', this.now());
      return;
    }
    if (!this.authorized) {
      // Money is owed: keep the item until the server key is fixed (or the player refunds).
      this.journal.retryLater(key, 'server key is not the program server authority', this.now());
      return;
    }

    let session: SessionView | null;
    try {
      session = await this.client!.fetchSession(item.arenaId, item.player);
    } catch (err) {
      this.journal.retryLater(key, `session lookup failed: ${firstLine(err)}`, this.now());
      return;
    }
    // Journal items written before session ids existed fall back to the open time.
    const sameSession = session && (item.sessionId !== undefined ? session.id === item.sessionId : session.openedAt * 1000 <= item.createdAt);
    if (!session || !sameSession) {
      await this.dropFinished(item, session ? `on-chain session is #${session.id}, item is for #${item.sessionId}` : 'session already closed');
      return;
    }
    if (session.finalized) {
      // our earlier settlement landed without the token account (R24); the player collects
      await this.dropFinished(item, 'session already finalized (the player collects the payout)');
      return;
    }
    if (item.reason === 'stale' && this.liveSessions().has(session.address)) {
      this.log(`chain: stale refund of ${short(key)} cancelled — the player is in the arena now`);
      this.journal.remove(key);
      return;
    }

    // Settle pays into the player's token account. The server never pays its rent (a player
    // could close and re-open it to drain the server). R24: without a usable account
    // the server settles anyway, without it: the fee and stats happen now and the session is
    // finalized with `owed`, which the player collects themselves (no waiting).
    // The fee goes to the fee wallet's ATA. When the player IS the fee wallet, both accounts are
    // the same ATA and the program refuses the duplicate (Anchor 2040): settle without the
    // player's account then (finalize; the fee wallet collects `owed` with `refund_session`).
    const feeWalletToken = feeWalletAta(config).toBase58();
    // Every settle (and finalize) needs the fee wallet's token account. When it is missing or
    // unusable, every item waits: never counted against the player, never paid for by the server.
    const feeHold = await this.feeAccountHold(config, feeWalletToken);
    if (feeHold) {
      this.journal.retryLater(key, feeHold, this.now());
      return;
    }
    const playerAta = ata(item.player, token.tokenMint, token.tokenProgram).toBase58();
    const feeWalletPlays = playerAta === feeWalletToken;
    let ataExists = false;
    if (!feeWalletPlays) {
      try {
        ataExists = await this.client!.accountExists(playerAta);
      } catch (err) {
        this.journal.retryLater(key, `token account lookup failed: ${firstLine(err)}`, this.now());
        return;
      }
    }
    const tokenFailures = item.tokenFailures ?? 0;
    const finalize = feeWalletPlays || !ataExists || tokenFailures >= TOKEN_FAILURES_BEFORE_FINALIZE;
    if (finalize) {
      const why = feeWalletPlays
        ? `the player is the fee wallet (its token account ${short(playerAta)} receives the fee)`
        : ataExists
          ? `token account ${short(playerAta)} refused ${tokenFailures} time(s)`
          : `no token account ${short(playerAta)}`;
      this.log(`chain: settlement ${short(key)} — ${why}; settling without it (the player collects the payout)`);
    }
    const ixs: TransactionInstruction[] = [];
    const ix = await this.client!.ix.settleSession(this.keypair!.publicKey, {
      player: item.player,
      arenaId: item.arenaId,
      sessionId: session.id,
      payout,
      score: clampInt(item.score, 0xffff_ffff),
      kills: clampInt(item.kills, 0xffff),
      xp: clampInt(item.xp, 0xffff_ffff),
      tokenMint: token.tokenMint,
      tokenProgram: token.tokenProgram,
      feeWalletToken,
      ...(finalize ? { playerToken: null } : {}),
    });
    // Last check right before sending: a stale session may have been picked up meanwhile.
    if (item.reason === 'stale' && this.liveSessions().has(session.address)) {
      this.log(`chain: stale refund of ${short(key)} cancelled — the player is in the arena now`);
      this.journal.remove(key);
      return;
    }
    ixs.push(ix);
    let fee: number | undefined;
    try {
      // the fee fixed in the session at join: exactly what `settle_session` charges
      fee = toSafeAmount(splitPayout(payout, session.entryFee, session.feeBps).fee);
    } catch {
      fee = undefined;
    }
    try {
      const signature = await this.send(key, ixs);
      this.journal.remove(key);
      this.sentSignatures.delete(key);
      this.log(
        `chain: ${finalize ? 'finalized' : 'settled'} ${short(key)} (${item.reason ?? 'settle'}) · ${this.units(payout)}${fee ? ` (fee ${this.units(fee)})` : ''} → ${short(item.player)}${finalize ? ' (to collect)' : ''} · ${signature}`,
      );
      this.emit({ key, player: item.player, arenaId: item.arenaId, signature, payout, ...(fee === undefined ? {} : { fee }), ...(finalize && payout > 0 ? { collect: true } : {}) });
    } catch (err) {
      await this.onSendError(item, err, finalize);
    }
  }

  /**
   * Null when the fee wallet's token account can receive the fee (checked at most every 30 s while
   * it is fine; `fresh` re-reads it now). Otherwise the reason to hold the item, logged loudly about
   * once a minute. The server never creates it (the admin does, `pnpm admin set-token` /
   * `update-config --fee-wallet` create it idempotently).
   */
  private async feeAccountHold(config: ConfigView, address: string, fresh = false): Promise<string | null> {
    const ok = this.feeAccountOk;
    if (!fresh && ok && ok.address === address && this.now() - ok.at < FEE_ACCOUNT_TTL_MS) return null;
    const token = this.token(config);
    if (!token) return 'game token not set';
    let problem: string | null;
    try {
      problem = feeAccountProblem(await this.client!.fetchAccount(address), { ...token, feeWallet: config.feeWallet });
    } catch (err) {
      return `fee wallet token account lookup failed: ${firstLine(err)}`;
    }
    if (problem === null) {
      if (this.feeAccountHeld) this.log(`chain: fee wallet token account ${address} is usable again — settlements resume`);
      this.feeAccountHeld = false;
      this.feeAccountOk = { address, at: this.now() };
      this.lastWarn.delete('fee-account'); // a later outage is logged at once
      return null;
    }
    this.feeAccountOk = null;
    this.feeAccountHeld = true;
    this.warn(
      'fee-account',
      `!!! chain: fee wallet token account ${address} (fee wallet ${config.feeWallet}) is ${problem}: ALL settlements are held. ` +
        'Recreate it with `pnpm admin update-config --fee-wallet <current fee wallet>` (an idempotent ATA creation, signed by the admin); ' +
        'settlements resume by themselves.',
    );
    return `fee wallet token account ${problem}`;
  }

  /** The session is gone (or re-opened): drop the item, reporting our own earlier send if it landed. */
  private async dropFinished(item: SettlementItem, why: string): Promise<void> {
    const signature = this.sentSignatures.get(item.key);
    this.sentSignatures.delete(item.key);
    this.journal.remove(item.key);
    if (signature && (await this.landed(signature))) {
      this.log(`chain: settled ${short(item.key)} (confirmation arrived late) · ${signature}`);
      this.emit({ key: item.key, player: item.player, arenaId: item.arenaId, signature, payout: item.payout ?? 0 });
      return;
    }
    this.log(`chain: dropping settlement ${short(item.key)} for ${short(item.player)} — ${why} (already settled or refunded)`);
  }

  private async landed(signature: string): Promise<boolean> {
    try {
      if (this.deps.signatureLanded) return await this.deps.signatureLanded(signature);
      if (!this.connection) return false;
      const status = (
        await withTimeout(this.connection.getSignatureStatuses([signature], { searchTransactionHistory: true }), RPC_TIMEOUT_MS, 'getSignatureStatuses')
      ).value[0];
      return !!status && !status.err && status.confirmationStatus !== 'processed';
    } catch {
      return false;
    }
  }

  private async onSendError(item: SettlementItem, err: unknown, finalized = false): Promise<void> {
    const { key } = item;
    const code = programErrorCode(err);
    const d = describeError(err);
    const label = `${d.name ?? 'error'}${code !== null ? ` ${code}` : ''}: ${firstLine(err)}`;
    const what = `settlement ${short(key)}`;
    const accountCode = code === ERR.accountNotInitialized || code === ERR.accountOwnedByWrongProgram || this.isTokenAccountFailure(err, code);
    if (accountCode && this.config && this.token()) {
      // an account error may be the fee wallet's token account: it may have been rotated (the send used
      // the old one) or closed after our check. Re-read the config first, then decide blame.
      const sentWith = feeWalletAta(this.config).toBase58();
      const fresh = await this.freshConfig();
      const config = fresh ?? this.config;
      if (fresh && this.token(fresh) && feeWalletAta(fresh).toBase58() !== sentWith) {
        this.log(`chain: ${what} — the fee wallet changed (${label}); retrying with the current one`);
        this.journal.retryLater(key, `${label} (fee wallet changed)`, this.now());
        return;
      }
      // if still the same, hold the item without counting it against the player
      const hold = await this.feeAccountHold(config, feeWalletAta(config).toBase58(), true);
      if (hold) {
        this.journal.retryLater(key, `${label} (${hold})`, this.now());
        return;
      }
    }

    if (code === ERR.sessionMismatch || code === ERR.sessionFinalized) {
      await this.dropFinished(item, label);
      return;
    }
    if (code === ERR.accountNotInitialized || code === ERR.accountOwnedByWrongProgram) {
      // I2: these also fire for the player's token account (closed after our check). Drop the
      // item only when the session itself is gone or re-opened; otherwise retry (the next
      // attempt sees the missing account and finalizes without it).
      let session: SessionView | null;
      try {
        session = await this.client!.fetchSession(item.arenaId!, item.player);
      } catch (e) {
        this.journal.retryLater(key, `${label} (session re-check failed: ${firstLine(e)})`, this.now());
        return;
      }
      if (!session || (item.sessionId !== undefined && session.id !== item.sessionId) || session.finalized) {
        await this.dropFinished(item, label);
        return;
      }
      this.journal.retryLater(key, `${label} (session still open)`, this.now(), { tokenFailure: !finalized });
      return;
    }
    if (!finalized && this.isTokenAccountFailure(err, code)) {
      // the same codes fire for the fee wallet's account (fee wallet changed since our config
      // read): re-read the config before the retry so the next attempt uses the current one
      this.configAt = 0;
      const n = (item.tokenFailures ?? 0) + 1;
      this.log(
        `chain: ${what} — the player's token account refused the payout (${label}); ` +
          (n >= TOKEN_FAILURES_BEFORE_FINALIZE ? 'settling without it next' : `attempt ${n}/${TOKEN_FAILURES_BEFORE_FINALIZE}`),
      );
      this.journal.retryLater(key, label, this.now(), { tokenFailure: true });
      return;
    }
    if (code === ERR.unauthorized) {
      // Our key may have been rotated out: re-read the config to tell.
      const config = await this.freshConfig();
      if (!config) {
        this.journal.retryLater(key, `${label} (config re-read failed)`, this.now());
        return;
      }
      if (!this.authorized) {
        this.journal.retryLater(key, label, this.now());
        return;
      }
      this.log(`!!! chain: dropping ${what} — rejected as unauthorized (${label}) ${JSON.stringify(item)}`);
      this.journal.remove(key);
      return;
    }
    if (code === ERR.constraintSeeds || code === ERR.constraintAddress) {
      this.configAt = 0; // the config probably moved (e.g. a new fee wallet): re-read before the retry
    }
    if (code === ERR.insufficientPot) {
      this.warn(`pot-${item.arenaId}`, `!!! chain: arena #${item.arenaId} pot cannot cover ${what} (${this.units(item.payout ?? 0)}) — retrying with backoff`);
    }
    if (d.name === 'InsufficientFunds') {
      this.warn('fee-payer', `!!! chain: server wallet ${this.keypair!.publicKey.toBase58()} cannot pay fees — fund it (${label})`);
    }
    if (item.attempts > 0 && item.attempts % 5 === 0) {
      this.log(`!!! chain: ${what} still failing after ${item.attempts + 1} attempts: ${label}`);
    }
    this.journal.retryLater(key, label, this.now());
  }

  /** A settle failure caused by the player's token account (not by the chain or the server). */
  private isTokenAccountFailure(err: unknown, code: number | null): boolean {
    if (code !== null && TOKEN_ACCOUNT_CODES.includes(code)) return true;
    const logs = errorLogs(err);
    return logs.some((l) => TOKEN_PROGRAM_FAILED.test(l));
  }

  private send(key: string, ixs: TransactionInstruction[], onSent?: (signature: string, lastValidBlockHeight?: number) => void): Promise<string> {
    const onSignature = (signature: string, lastValidBlockHeight?: number) => {
      this.sentSignatures.set(key, signature);
      onSent?.(signature, lastValidBlockHeight);
    };
    if (this.deps.send) return withTimeout(this.deps.send(ixs, onSignature), SEND_TIMEOUT_MS, 'send');
    return withTimeout(
      this.sdk!.sendAndConfirm(ixs, [this.keypair!], { priorityMicroLamports: this.cfg.chain.priorityFeeMicroLamports, onSignature }),
      SEND_TIMEOUT_MS,
      'send',
    );
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
   * M9: after a journal quarantine (`journal.json.corrupt-*`), sessions whose real result was
   * in the lost journal look "unplayed"; refunding them at the buy-in would be wrong. The
   * sweeper stays off until the operator reviews the quarantined file and sets
   * `STALE_SWEEP_ACK=1` (or moves the file away). Logged loudly, every 30 minutes.
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

  /**
   * Queues a refund (payout = buy-in, no fee) for every open session that is not in a room,
   * not already queued and older than `STALE_SESSION_AFTER_S` (15 minutes by default), i.e. the player paid but never played.
   * Returns the number of sessions queued.
   */
  async sweepStale(): Promise<number> {
    if (this.stopped || !this.enabled || this.authorized !== true || !this.client || !this.tokenReady) return 0;
    if (!this.staleSweepAllowed()) return 0;
    let sessions: SessionView[];
    try {
      sessions = await this.client.fetchSessions();
    } catch (err) {
      this.warn('sweep', `chain: stale-session sweep failed (${firstLine(err)})`);
      return 0;
    }
    const live = this.liveSessions();
    const pending = new Set(this.journal.pending.map((p) => p.key));
    const only = this.cfg.chain.arenaIds;
    const now = this.now();
    const staleAfterS = this.staleAfterS();
    const enqueue: SettlementItem[] = [];
    for (const s of sessions) {
      // a finalized session (R24) is settled: its owed payout is the player's to collect
      if (s.finalized) continue;
      if (live.has(s.address) || pending.has(s.address)) continue;
      if (now / 1000 - s.openedAt < staleAfterS) continue;
      if (only.length > 0 && !only.includes(s.arenaId)) continue;
      enqueue.push({
        kind: 'settle',
        key: s.address,
        player: s.player,
        arenaId: s.arenaId,
        session: s.address,
        sessionId: s.id,
        payout: toSafeAmount(s.entryFee),
        score: 0,
        kills: 0,
        xp: 0,
        reason: 'stale',
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
      });
    }
    if (enqueue.length === 0) return 0;
    this.journal.commit({ enqueue });
    this.log(`chain: ${enqueue.length} unplayed session(s) older than ${staleAfterS >= 120 ? `${Math.round(staleAfterS / 60)} min` : `${staleAfterS} s`} → refund queued`);
    this.kick();
    return enqueue.length;
  }
}
