import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  MPL_CORE_ID,
  SlanaClient,
  SlanaErrorCode,
  assertSafeSupply,
  ata,
  clusterDefaultRpc,
  describeError,
  lamportsToSol,
  listOwnedPasses,
  parseCoreAsset,
  passNumberFromName,
  programErrorCode,
  splitSessionPayout,
  type ArenaView,
  type ConfigView,
  type CoreAsset,
  type LeaderEntryView,
  type OwnedPass,
  type ProfileView,
  type SeasonView as SdkSeasonView,
  type SessionView,
} from '@slana/sdk';
import { TOKEN_SYMBOL_DEFAULT, formatToken, toSafeAmount, type ChainStatus, type PassStatus } from '@slana/shared';
import { Connection, Keypair, PublicKey, type TransactionInstruction } from '@solana/web3.js';
import type { ServerConfig } from '../config';
import type { Journal, SettlementItem } from '../stake/journal';
import type {
  ChainArena,
  ChainGateway,
  ChainPass,
  ChainProfile,
  ChainSession,
  OwnedPassInfo,
  SeasonEntry,
  SeasonView,
  SettledEvent,
} from './types';

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
const PASS_TTL_MS = 60_000;
const OWNED_TTL_MS = 30_000;
const MAX_PASS_CACHE = 10_000;
const ARENA_TTL_MS = 30_000;
const SEASON_TTL_MS = 30_000;
const CONFIG_TTL_MS = 30_000;
const MAX_IN_FLIGHT = 4;
/** Upper bound for one send+confirm (a blockhash lives ~60–90 s). */
const SEND_TIMEOUT_MS = 120_000;
const RPC_TIMEOUT_MS = 20_000;
const LOW_BALANCE_LAMPORTS = 50_000_000; // 0.05 SOL
const MAX_PROFILE_CACHE = 5_000;
/** Re-check interval for a settlement waiting on the player's token account (`NO_ATA_RETRY_S` overrides it). */
export const NO_ATA_RETRY_MS = 5 * 60_000;
const STOP_GRACE_MS = 5_000;

const ERR = {
  unauthorized: SlanaErrorCode.Unauthorized,
  sessionMismatch: SlanaErrorCode.SessionMismatch,
  insufficientPot: SlanaErrorCode.InsufficientPot,
  /** Anchor: account does not exist (session already closed / profile missing). */
  accountNotInitialized: 3012,
  /** Anchor: account owned by another program (a closed PDA that received lamports). */
  accountOwnedByWrongProgram: 3007,
  /** Anchor: PDA seeds mismatch (e.g. the season changed under us). */
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
  fetchSeason(id: number): Promise<SdkSeasonView | null>;
  /** Raw supply of the game-token mint (base units). */
  fetchMintSupply(mint: string): Promise<bigint>;
  /** Whether an account exists (used for the player's token account). */
  accountExists(address: string): Promise<boolean>;
  /** A Metaplex Core asset, null when the account is missing or not an `AssetV1`. */
  fetchCoreAsset(asset: string): Promise<CoreAsset | null>;
  /** Core assets of `collection` owned by `owner` (SDK `listOwnedPasses`). */
  listOwnedPasses(owner: string, collection: string): Promise<OwnedPass[]>;
  /** Current slot ('confirmed'). */
  getSlot(): Promise<number>;
  readonly ix: Pick<SlanaClient['ix'], 'settleSession' | 'capturePassEntropy'>;
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
    fetchSeason: (id) => sdk.fetchSeason(id),
    fetchMintSupply: async (mint) => BigInt((await connection.getTokenSupply(new PublicKey(mint), 'confirmed')).value.amount),
    accountExists: async (address) => (await connection.getAccountInfo(new PublicKey(address), 'confirmed')) !== null,
    fetchCoreAsset: async (asset) => {
      const info = await connection.getAccountInfo(new PublicKey(asset), 'confirmed');
      return info && info.owner.equals(MPL_CORE_ID) ? parseCoreAsset(info.data) : null;
    },
    listOwnedPasses: (owner, collection) => listOwnedPasses(connection, owner, collection),
    getSlot: () => connection.getSlot('confirmed'),
  };
}

export interface SolanaChainDeps {
  client?: ChainClient;
  /** Server authority keypair (default: `cfg.chain.serverKeypair`). */
  keypair?: Keypair;
  /**
   * Signs `ixs` with the server key, sends and waits for 'confirmed'; returns the signature.
   * `onSignature` must be called before sending (lets the worker find a lost confirmation later).
   */
  send?: (ixs: TransactionInstruction[], onSignature: (signature: string) => void) => Promise<string>;
  /** Whether a previously sent transaction landed successfully. */
  signatureLanded?: (signature: string) => Promise<boolean>;
  /** Server wallet balance in lamports. */
  balance?: () => Promise<number>;
  now?: () => number;
  /** Start the background loops in `start()` (default true; tests drive them by hand). */
  loops?: boolean;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Reads the server keypair from a JSON file path or from the JSON array itself. */
export function loadServerKeypair(spec: string): Keypair {
  const trimmed = spec.trim();
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
  premiumSkins: 0, // v2 has no premium skins (Pass looks replace them)
  gamesPlayed: p.gamesPlayed,
  bestScore: p.bestScore,
});

const toEntry = (e: LeaderEntryView): SeasonEntry => ({ player: e.player, name: e.name, skin: e.skin, points: e.points, bestScore: e.bestScore });

/* ------------------------------------------------------------------ */
/* Gateway                                                             */
/* ------------------------------------------------------------------ */

/**
 * Solana-backed `ChainGateway`: cached reads for the rooms (profiles, arenas, sessions, seasons,
 * Slana Passes), plus the settlement worker that turns journal items into `settle_session`
 * transactions signed by the server authority, and a sweeper that refunds sessions nobody played.
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
  private seasonCache: { at: number; value: SeasonView | null } | null = null;
  private seasonFetch: Promise<SeasonView | null> | null = null;
  private readonly passes = new Map<string, { at: number; value: ChainPass | null }>();
  private readonly owned = new Map<string, { at: number; value: OwnedPassInfo[] }>();
  private probing: Promise<boolean> | null = null;
  private capturing: Promise<void> | null = null;

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
      this.keypair = this.deps.keypair ?? loadServerKeypair(this.cfg.chain.serverKeypair ?? '');
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
        `chain: ${where} · program ${client.programId.toBase58()} · season ${config.currentSeason} · ` +
          `server ${this.keypair!.publicKey.toBase58()} · stake ${this.stakeEnabled ? 'on' : 'off'}`,
      );
      void this.checkBalance();
      void this.refreshSeason();
      return true;
    } catch (err) {
      this.warn('probe', `chain: RPC ${where} unreachable (${firstLine(err)}) — free play only (re-checking every 30 s)`);
      return false;
    }
  }

  /** 30 s loop: re-probe while offline, otherwise refresh config + season caches. */
  private async refresh(): Promise<void> {
    if (this.stopped || !this.client) return;
    if (!this.enabled) {
      if (await this.probe()) this.kick();
      return;
    }
    await this.freshConfig();
    await this.checkSupply();
    await this.refreshSeason();
    await this.captureEntropyIfDue();
  }

  /**
   * Rulings R22/R23: once the seed is public (`reveal_pass`) and the entropy target slot has
   * passed, sends the permissionless `capture_pass_entropy`, which completes the reveal (the
   * server pays only the network fee). Runs on every 30 s refresh until the config shows the
   * Pass revealed, so a failure simply retries. If the target left the SlotHashes window, the
   * program re-targets and the next refresh tries the new slot. Never throws.
   */
  captureEntropyIfDue(): Promise<void> {
    this.capturing ??= this.captureEntropyNow().finally(() => (this.capturing = null));
    return this.capturing;
  }

  private async captureEntropyNow(): Promise<void> {
    if (!this.enabled || !this.client || !this.keypair) return;
    const config = this.config;
    if (!config || !config.passSeedRevealed || config.passRevealed) return;
    try {
      const slot = await this.client.getSlot();
      if (slot <= config.passEntropyTargetSlot) return;
      const ix = await this.client.ix.capturePassEntropy(this.keypair.publicKey);
      const signature = await this.send('pass-entropy', [ix]);
      this.sentSignatures.delete('pass-entropy');
      const after = await this.freshConfig();
      if (after?.passRevealed) {
        this.log(`chain: Pass entropy captured — hash of slot ${after.passEntropySlot}, final seed ${after.passFinalSeed} · ${signature}`);
      } else if (after && after.passEntropyTargetSlot !== config.passEntropyTargetSlot) {
        this.log(`chain: Pass entropy target ${config.passEntropyTargetSlot} was missed; new target slot ${after.passEntropyTargetSlot} · ${signature}`);
      }
    } catch (err) {
      const d = describeError(err);
      this.warn('pass-entropy', `chain: Pass entropy capture failed (${d.name ?? firstLine(err)}); retrying on the next refresh`);
    }
  }

  /**
   * Reads the mint supply: arenas only run while every amount fits a JS number
   * (`assertSafeSupply`). RPC errors keep the last known answer.
   */
  private async checkSupply(): Promise<void> {
    const config = this.config;
    if (!config) return;
    let safe: boolean;
    try {
      const supply = await this.client!.fetchMintSupply(config.tokenMint);
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
    this.stakeEnabled = this.authorized === true && this.cfg.chain.stakeEnabled && this.supplySafe === true;
  }

  /** Raw token units with the mint's decimals and the display symbol (for logs). */
  private units(raw: number): string {
    const decimals = this.config?.tokenDecimals;
    if (decimals === undefined) return `${raw} token units`;
    try {
      return `${formatToken(raw, decimals, 'en', { maxFrac: decimals })} ${this.cfg.chain.tokenSymbol}`;
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
      return { enabled: false, cluster, programId: null, rpcUrl: null, arenasEnabled: false, currentSeason: null, token: null, pass: null };
    }
    const config = this.config;
    return {
      enabled: true,
      cluster,
      programId: this.client.programId.toBase58(),
      rpcUrl: publicRpcUrl ?? clusterDefaultRpc(cluster),
      arenasEnabled: this.stakeEnabled,
      currentSeason: config?.currentSeason ?? null,
      token: config ? { mint: config.tokenMint, symbol: this.cfg.chain.tokenSymbol || TOKEN_SYMBOL_DEFAULT, decimals: config.tokenDecimals } : null,
      pass: this.passStatus(),
    };
  }

  /** From the cached config; null until the Pass collection is set. */
  passStatus(): PassStatus | null {
    const c = this.config;
    if (!this.enabled || !c || !c.passCollection) return null;
    return {
      collection: c.passCollection,
      supply: c.passSupply,
      minted: c.passMinted,
      perWallet: c.passPerWallet,
      mintOpen: c.passMintOpen,
      mintStartTs: c.passMintStartTs,
      revealed: c.passRevealed && !!c.passFinalSeed,
      seedRevealed: c.passSeedRevealed,
      entropyTargetSlot: c.passEntropyTargetSlot,
      // traits derive from the final seed sha256(seed || entropy), never the admin seed
      seed: c.passRevealed ? c.passFinalSeed : null,
    };
  }

  /**
   * A Core asset that is a Slana Pass of our collection (`Slana Pass #n`), with its
   * current owner. Cached 60 s; RPC errors yield the last known value or null.
   */
  async getPass(asset: string): Promise<ChainPass | null> {
    const collection = this.config?.passCollection;
    if (!this.enabled || !this.client || !collection || !isPubkey(asset)) return null;
    const cached = this.passes.get(asset);
    if (cached && this.now() - cached.at < PASS_TTL_MS) return cached.value;
    try {
      const a = await this.client.fetchCoreAsset(asset);
      const number = a && a.collection === collection ? passNumberFromName(a.name) : null;
      const value = a && number !== null ? { owner: a.owner, number } : null;
      if (this.passes.size >= MAX_PASS_CACHE) this.passes.delete(this.passes.keys().next().value!);
      this.passes.delete(asset);
      this.passes.set(asset, { at: this.now(), value });
      return value;
    } catch (err) {
      this.warn('pass', `chain: Pass lookup failed (${firstLine(err)})`);
      return cached?.value ?? null;
    }
  }

  /** Passes owned by `wallet` (DAS or getProgramAccounts via the SDK); cached 30 s. */
  async ownedPasses(wallet: string): Promise<OwnedPassInfo[]> {
    const collection = this.config?.passCollection;
    if (!this.enabled || !this.client || !collection || !isPubkey(wallet)) return [];
    const cached = this.owned.get(wallet);
    if (cached && this.now() - cached.at < OWNED_TTL_MS) return cached.value;
    try {
      const value = (await this.client.listOwnedPasses(wallet, collection)).map((p) => ({ asset: p.asset, number: p.number }));
      if (this.owned.size >= MAX_PASS_CACHE) this.owned.delete(this.owned.keys().next().value!);
      this.owned.delete(wallet);
      this.owned.set(wallet, { at: this.now(), value });
      return value;
    } catch (err) {
      this.warn('owned', `chain: owned-Pass listing failed (${firstLine(err)})`);
      return cached?.value ?? [];
    }
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
        hasPass: s.hasPass,
        passAsset: s.passAsset,
      };
    } catch (err) {
      this.warn('session', `chain: session lookup failed (${firstLine(err)})`);
      return null;
    }
  }

  /** Cached 30 s. */
  async listArenas(fresh = false): Promise<ChainArena[]> {
    if (!this.enabled || !this.client) return [];
    if (!fresh && this.arenaCache && this.now() - this.arenaCache.at < ARENA_TTL_MS) return this.arenaCache.value;
    try {
      const value = (await this.client.fetchArenas()).map(
        (a): ChainArena => ({
          id: a.id,
          address: a.address,
          entryFee: toSafeAmount(a.entryFee),
          requiresPass: a.requiresPass,
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

  /** Current season (live pool) + the previous finalized one; cached 30 s. */
  async season(): Promise<SeasonView | null> {
    if (!this.enabled || !this.client) return null;
    if (this.seasonCache && this.now() - this.seasonCache.at < SEASON_TTL_MS) return this.seasonCache.value;
    return this.refreshSeason();
  }

  private refreshSeason(): Promise<SeasonView | null> {
    this.seasonFetch ??= this.fetchSeasonView().finally(() => (this.seasonFetch = null));
    return this.seasonFetch;
  }

  private async fetchSeasonView(): Promise<SeasonView | null> {
    try {
      const config = await this.currentConfig();
      if (!config) return this.seasonCache?.value ?? null;
      const client = this.client!;
      const [current, previous] = await Promise.all([
        client.fetchSeason(config.currentSeason),
        config.currentSeason - 1 > 0 ? client.fetchSeason(config.currentSeason - 1) : Promise.resolve(null),
      ]);
      const value: SeasonView | null = current
        ? {
            id: current.id,
            startedAt: current.startedAt,
            finalized: current.finalized,
            prizePool: toSafeAmount(current.finalized ? current.prizePool : current.pool),
            entries: current.entries.map(toEntry),
            previous:
              previous && previous.finalized
                ? {
                    id: previous.id,
                    prizePool: toSafeAmount(previous.prizePool),
                    endedAt: previous.endedAt,
                    entries: previous.entries.map(toEntry),
                    claimedMask: previous.claimedMask,
                  }
                : null,
          }
        : null;
      this.seasonCache = { at: this.now(), value };
      return value;
    } catch (err) {
      this.warn('season', `chain: season refresh failed (${firstLine(err)})`);
      return this.seasonCache?.value ?? null;
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
    this.seasonCache = null;
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
      .filter((item) => item.nextAttemptAt <= now && !this.inFlight.has(item.key))
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

  private async process(item: SettlementItem): Promise<void> {
    if (item.kind === 'settle') return this.processSettle(item);
    this.log(`!!! chain: dropping journal item of unknown kind: ${JSON.stringify(item)}`);
    this.journal.remove(item.key);
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
    if (item.reason === 'stale' && this.liveSessions().has(session.address)) {
      this.log(`chain: stale refund of ${short(key)} cancelled — the player is in the arena now`);
      this.journal.remove(key);
      return;
    }

    // Settle pays into the player's token account. The server never pays its rent (a player
    // could close and re-open it to drain the server): without one the item stays owed and is
    // re-checked every 5 minutes; the player's own 24 h refund remains the fallback.
    const playerAta = ata(item.player, config.tokenMint, config.tokenProgram).toBase58();
    let ataExists: boolean;
    try {
      ataExists = await this.client!.accountExists(playerAta);
    } catch (err) {
      this.journal.retryLater(key, `token account lookup failed: ${firstLine(err)}`, this.now());
      return;
    }
    if (!ataExists) {
      if (!item.needsTokenAccount) {
        this.log(
          `chain: settlement ${short(key)} waits — ${short(item.player)} has no token account ${short(playerAta)} ` +
            `(the player must create it; re-checking every ${Math.round(this.noAtaRetryMs() / 1000)} s)`,
        );
      }
      this.journal.retryLater(key, 'player token account missing', this.now(), { delayMs: this.noAtaRetryMs(), needsTokenAccount: true });
      return;
    }
    if (item.needsTokenAccount) {
      this.log(`chain: settlement ${short(key)} — token account of ${short(item.player)} found, settling`);
      this.journal.clearNeedsTokenAccount(key);
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
      currentSeason: config.currentSeason,
      tokenMint: config.tokenMint,
      tokenProgram: config.tokenProgram,
      hasPass: session.hasPass,
      passAsset: session.passAsset,
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
      fee = toSafeAmount(splitSessionPayout(payout, session, config).fee);
    } catch {
      fee = undefined;
    }
    try {
      const signature = await this.send(key, ixs);
      this.journal.remove(key);
      this.sentSignatures.delete(key);
      this.log(
        `chain: settled ${short(key)} (${item.reason ?? 'settle'}) · ${this.units(payout)}${fee ? ` (fee ${this.units(fee)})` : ''} → ${short(item.player)} · ${signature}`,
      );
      this.emit({ key, player: item.player, arenaId: item.arenaId, signature, payout, ...(fee === undefined ? {} : { fee }) });
    } catch (err) {
      await this.onSendError(item, err);
    }
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
      const status = (await this.connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
      return !!status && !status.err && status.confirmationStatus !== 'processed';
    } catch {
      return false;
    }
  }

  private async onSendError(item: SettlementItem, err: unknown): Promise<void> {
    const { key } = item;
    const code = programErrorCode(err);
    const d = describeError(err);
    const label = `${d.name ?? 'error'}${code !== null ? ` ${code}` : ''}: ${firstLine(err)}`;
    const what = `settlement ${short(key)}`;

    if (code === ERR.sessionMismatch || code === ERR.accountNotInitialized || code === ERR.accountOwnedByWrongProgram) {
      await this.dropFinished(item, label);
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
      this.configAt = 0; // the season probably moved: re-read before the retry
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

  private send(key: string, ixs: TransactionInstruction[]): Promise<string> {
    const onSignature = (signature: string) => this.sentSignatures.set(key, signature);
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

  /** `NO_ATA_RETRY_S` in ms (default 5 min). */
  private noAtaRetryMs(): number {
    const v = this.cfg.chain.noAtaRetryS;
    return Number.isFinite(v) && v >= 1 ? Math.floor(v) * 1000 : NO_ATA_RETRY_MS;
  }

  /**
   * Queues a refund (payout = buy-in, no fee) for every open session that is not in a room,
   * not already queued and older than `STALE_SESSION_AFTER_S` (15 minutes by default), i.e. the player paid but never played.
   * Returns the number of sessions queued.
   */
  async sweepStale(): Promise<number> {
    if (this.stopped || !this.enabled || this.authorized !== true || !this.client) return 0;
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
