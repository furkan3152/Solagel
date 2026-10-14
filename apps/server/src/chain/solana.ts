import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  SlanaClient,
  SlanaErrorCode,
  clusterDefaultRpc,
  describeError,
  lamportsToSol,
  programErrorCode,
  type ArenaView,
  type ConfigView,
  type LeaderEntryView,
  type ProfileView,
  type SeasonView as SdkSeasonView,
  type SessionView,
} from '@slana/sdk';
import type { ChainStatus } from '@slana/shared';
import { Connection, Keypair, PublicKey, type TransactionInstruction } from '@solana/web3.js';
import type { ServerConfig } from '../config';
import type { Journal, SettlementItem } from '../stake/journal';
import type { ChainArena, ChainGateway, ChainProfile, ChainSession, SeasonEntry, SeasonView } from './types';

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

const WORKER_INTERVAL_MS = 1_000;
const REFRESH_INTERVAL_MS = 30_000;
const SWEEP_INTERVAL_MS = 5 * 60_000;
/** Sessions nobody plays for this long are refunded (payout = buy-in). */
export const STALE_SESSION_AFTER_S = 15 * 60;
const PROFILE_TTL_MS = 60_000;
const ARENA_TTL_MS = 30_000;
const SEASON_TTL_MS = 30_000;
const CONFIG_TTL_MS = 30_000;
const MAX_IN_FLIGHT = 4;
/** Upper bound for one send+confirm (a blockhash lives ~60–90 s). */
const SEND_TIMEOUT_MS = 120_000;
const RPC_TIMEOUT_MS = 20_000;
const LOW_BALANCE_LAMPORTS = 50_000_000; // 0.05 SOL
const MAX_PROFILE_CACHE = 5_000;
/** Free-play records are best effort: give up after this many failed attempts. */
const MAX_RECORD_ATTEMPTS = 8;
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
  readonly ix: Pick<SlanaClient['ix'], 'settleSession' | 'recordGame'>;
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

export type SettledEvent = { key: string; player: string; signature: string; kind: 'settle' | 'record'; payout?: number };

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
  premiumSkins: p.premiumSkins,
  gamesPlayed: p.gamesPlayed,
  bestScore: p.bestScore,
});

const toEntry = (e: LeaderEntryView): SeasonEntry => ({ player: e.player, name: e.name, skin: e.skin, points: e.points, bestScore: e.bestScore });

/* ------------------------------------------------------------------ */
/* Gateway                                                             */
/* ------------------------------------------------------------------ */

/**
 * Solana-backed `ChainGateway`: cached reads for the rooms, plus the settlement worker that
 * turns journal items into `settle_session` / `record_game` transactions signed by the server
 * authority, and a sweeper that refunds sessions nobody ever played.
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
  private probing: Promise<boolean> | null = null;

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
        this.client = this.sdk;
      }
    } catch (err) {
      this.log(`chain: disabled — ${(err as Error).message}; running free play only`);
      return;
    }
    await this.probe();
    if (this.deps.loops === false) return;
    this.timers.push(
      setInterval(() => this.pump(), WORKER_INTERVAL_MS),
      setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS),
      setInterval(() => {
        void this.sweepStale();
        void this.checkBalance();
      }, SWEEP_INTERVAL_MS),
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
    await this.refreshSeason();
  }

  private applyConfig(config: ConfigView): void {
    this.config = config;
    this.configAt = this.now();
    const ours = this.keypair!.publicKey.toBase58();
    const authorized = config.serverAuthority === ours;
    if (!authorized && this.authorized !== false) {
      this.log(
        `!!! chain: SERVER_KEYPAIR ${ours} is NOT the program's server authority (${config.serverAuthority}). ` +
          'Stake arenas and on-chain records are OFF; pending settlements stay queued until this is fixed ' +
          `(e.g. \`pnpm admin update-config --server ${ours}\`).`,
      );
    } else if (authorized && this.authorized === false) {
      this.log('chain: server authority matches again — settlements resume');
    }
    this.authorized = authorized;
    this.stakeEnabled = authorized && this.cfg.chain.stakeEnabled;
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
          `chain: ⚠ server wallet ${this.keypair.publicKey.toBase58()} holds only ${sol(lamports)} — fund it, it pays every settlement fee`,
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
    return {
      enabled: true,
      cluster,
      programId: this.client.programId.toBase58(),
      rpcUrl: publicRpcUrl ?? clusterDefaultRpc(cluster),
      arenasEnabled: this.stakeEnabled,
      currentSeason: this.config?.currentSeason ?? null,
      token: null,
      pass: null,
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
      return { address: s.address, id: s.id, player: s.player, arenaId: s.arenaId, buyIn: s.buyIn, openedAt: s.openedAt };
    } catch (err) {
      this.warn('session', `chain: session lookup failed (${firstLine(err)})`);
      return null;
    }
  }

  /** Cached 30 s. */
  async listArenas(): Promise<ChainArena[]> {
    if (!this.enabled || !this.client) return [];
    if (this.arenaCache && this.now() - this.arenaCache.at < ARENA_TTL_MS) return this.arenaCache.value;
    try {
      const value = (await this.client.fetchArenas()).map((a) => ({
        id: a.id,
        address: a.address,
        buyIn: a.buyIn,
        maxPlayers: a.maxPlayers,
        enabled: a.enabled,
        openSessions: a.openSessions,
        pot: a.pot,
      }));
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
            prizePool: current.finalized ? current.prizePool : current.pool,
            entries: current.entries.map(toEntry),
            previous:
              previous && previous.finalized
                ? {
                    id: previous.id,
                    prizePool: previous.prizePool,
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
    if (e.kind === 'settle') this.arenaCache = null;
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
    if (item.kind === 'record') return this.processRecord(item);
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

    const ix = await this.client!.ix.settleSession(this.keypair!.publicKey, {
      player: item.player,
      arenaId: item.arenaId,
      sessionId: session.id,
      payout,
      score: clampInt(item.score, 0xffff_ffff),
      kills: clampInt(item.kills, 0xffff),
      xp: clampInt(item.xp, 0xffff_ffff),
      currentSeason: config.currentSeason,
      treasury: config.treasury,
    });
    // Last check right before sending: a stale session may have been picked up meanwhile.
    if (item.reason === 'stale' && this.liveSessions().has(session.address)) {
      this.log(`chain: stale refund of ${short(key)} cancelled — the player is in the arena now`);
      this.journal.remove(key);
      return;
    }
    try {
      const signature = await this.send(key, [ix]);
      this.journal.remove(key);
      this.sentSignatures.delete(key);
      this.log(`chain: settled ${short(key)} (${item.reason ?? 'settle'}) · ${sol(payout)} → ${short(item.player)} · ${signature}`);
      this.emit({ key, player: item.player, signature, kind: 'settle', payout });
    } catch (err) {
      await this.onSendError(item, err, config.treasury);
    }
  }

  private async processRecord(item: SettlementItem): Promise<void> {
    const { key } = item;
    if (!isPubkey(item.player)) {
      this.log(`chain: dropping malformed record ${JSON.stringify(item)}`);
      this.journal.remove(key);
      return;
    }
    if (this.authorized === false) {
      this.warn('record-drop', 'chain: dropping free-play records — the server key is not the program server authority');
      this.journal.remove(key);
      return;
    }
    if (item.attempts >= MAX_RECORD_ATTEMPTS) {
      this.log(`chain: giving up on free-play record ${short(key)} after ${item.attempts} attempts (${item.lastError ?? 'unknown error'})`);
      this.journal.remove(key);
      return;
    }
    const config = await this.currentConfig();
    if (!config || this.authorized !== true) {
      this.journal.retryLater(key, 'config unavailable', this.now());
      return;
    }
    let profile: ProfileView | null;
    try {
      profile = await this.client!.fetchProfile(item.player);
    } catch (err) {
      this.journal.retryLater(key, `profile lookup failed: ${firstLine(err)}`, this.now());
      return;
    }
    if (!profile) {
      this.warn('no-profile', `chain: free-play record of ${short(item.player)} dropped — no on-chain profile (logged once a minute)`);
      this.journal.remove(key);
      return;
    }
    const ix = await this.client!.ix.recordGame(this.keypair!.publicKey, {
      player: item.player,
      currentSeason: config.currentSeason,
      score: clampInt(item.score, 0xffff_ffff),
      kills: clampInt(item.kills, 0xffff),
      xp: clampInt(item.xp, 0xffff_ffff),
    });
    try {
      const signature = await this.send(key, [ix]);
      this.journal.remove(key);
      this.sentSignatures.delete(key);
      this.log(`chain: recorded free game of ${short(item.player)} (score ${item.score}) · ${signature}`);
      this.emit({ key, player: item.player, signature, kind: 'record' });
    } catch (err) {
      await this.onSendError(item, err, config.treasury);
    }
  }

  /** The session is gone (or re-opened): drop the item, reporting our own earlier send if it landed. */
  private async dropFinished(item: SettlementItem, why: string): Promise<void> {
    const signature = this.sentSignatures.get(item.key);
    this.sentSignatures.delete(item.key);
    this.journal.remove(item.key);
    if (signature && (await this.landed(signature))) {
      this.log(`chain: settled ${short(item.key)} (confirmation arrived late) · ${signature}`);
      this.emit({ key: item.key, player: item.player, signature, kind: 'settle', payout: item.payout });
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

  private async onSendError(item: SettlementItem, err: unknown, treasuryUsed: string): Promise<void> {
    const { key } = item;
    const code = programErrorCode(err);
    const d = describeError(err);
    const label = `${d.name ?? 'error'}${code !== null ? ` ${code}` : ''}: ${firstLine(err)}`;
    const what = item.kind === 'settle' ? `settlement ${short(key)}` : `record ${short(key)}`;

    if (code === ERR.sessionMismatch || code === ERR.accountNotInitialized || code === ERR.accountOwnedByWrongProgram) {
      if (item.kind === 'settle') {
        await this.dropFinished(item, label);
      } else {
        this.log(`chain: dropping ${what} — ${label}`);
        this.journal.remove(key);
      }
      return;
    }
    if (code === ERR.unauthorized) {
      // Either our key was rotated out or the treasury changed: re-read the config to tell.
      const config = await this.freshConfig();
      if (!config) {
        this.journal.retryLater(key, `${label} (config re-read failed)`, this.now());
        return;
      }
      if (!this.authorized) {
        if (item.kind === 'record') this.journal.remove(key);
        else this.journal.retryLater(key, label, this.now());
        return;
      }
      if (config.treasury !== treasuryUsed) {
        this.journal.retryLater(key, `treasury changed — retrying (${label})`, this.now());
        return;
      }
      this.log(`!!! chain: dropping ${what} — rejected as unauthorized (${label}) ${JSON.stringify(item)}`);
      this.journal.remove(key);
      return;
    }
    if (code === ERR.constraintSeeds || code === ERR.constraintAddress) {
      this.configAt = 0; // the season or treasury probably moved: re-read before the retry
    }
    if (code === ERR.insufficientPot) {
      this.warn(`pot-${item.arenaId}`, `!!! chain: arena #${item.arenaId} pot cannot cover ${what} (${sol(item.payout ?? 0)}) — retrying with backoff`);
    }
    if (d.name === 'InsufficientFunds') {
      this.warn('fee-payer', `!!! chain: server wallet ${this.keypair!.publicKey.toBase58()} cannot pay fees — fund it (${label})`);
    }
    if (item.kind === 'settle' && item.attempts > 0 && item.attempts % 5 === 0) {
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

  /**
   * Queues a refund (payout = buy-in, no fee) for every open session that is not in a room,
   * not already queued and older than 15 minutes — i.e. the player paid but never played.
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
    const enqueue: SettlementItem[] = [];
    for (const s of sessions) {
      if (live.has(s.address) || pending.has(s.address)) continue;
      if (now / 1000 - s.openedAt < STALE_SESSION_AFTER_S) continue;
      if (only.length > 0 && !only.includes(s.arenaId)) continue;
      enqueue.push({
        kind: 'settle',
        key: s.address,
        player: s.player,
        arenaId: s.arenaId,
        session: s.address,
        sessionId: s.id,
        payout: s.buyIn,
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
    this.log(`chain: ${enqueue.length} unplayed session(s) older than 15 min → refund queued`);
    this.kick();
    return enqueue.length;
  }
}
