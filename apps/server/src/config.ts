import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { CAPACITY, RULES, TOKEN_SYMBOL_DEFAULT, type ChainStatus, type MarketUrls } from '@slana/shared';
import type { BotManagerOptions } from './bots/manager';

export interface ServerConfig {
  port: number;
  host: string;
  /** Allowed CORS origin for REST ("*" by default). */
  corsOrigin: string;
  dataDir: string;
  /**
   * Public base URL of this server (`PUBLIC_URL`, no trailing slash), used in Pass metadata
   * image links. Null: derived from the request's Host header, else `http://localhost:<PORT>`.
   */
  publicUrl: string | null;
  /** Optional path to the built web app (apps/web/dist) to serve statically. */
  webDist: string | null;
  maxConnectionsPerIp: number;
  maxConnections: number;
  /** Humans per practice room (`PRACTICE_CAPACITY`). */
  practiceCapacity: number;
  privateRoomCapacity: number;
  /** Humans per arena instance before another instance opens (`ARENA_INSTANCE_CAP`). */
  arenaInstanceCap: number;
  /** Bot population per room kind. */
  bots: { practiceRookie: BotManagerOptions; practicePro: BotManagerOptions; arena: BotManagerOptions; private: BotManagerOptions };
  /** Slana Pass power (`PASS_START_MASS_MUL`, `PASS_CASHOUT_MS`). */
  pass: { startMassMul: number; cashoutMs: number };
  authSecret: Buffer;
  /** `NODE_ENV` as given (null when unset). */
  nodeEnv: string | null;
  /**
   * `DEV_FAKE_CHAIN=1`: an in-memory chain with auto-issued arena tickets and
   * simulated settlements, for local UI work and Playwright. Only allowed with
   * `NODE_ENV=development` and no real chain configured (see `createChain`).
   */
  devFakeChain: boolean;
  /**
   * Slana Pass collection pages on the marketplaces, shown on the Pass page
   * (`MARKET_URLS` JSON and/or `MARKET_URL_MAGICEDEN` / `_TENSOR` / `_OPENSEA`).
   * Only https URLs are kept; an empty object hides every link.
   */
  markets: MarketUrls;
  chain: {
    cluster: string;
    /** RPC used by the server (may contain a private API key). */
    rpcUrl: string | null;
    /** RPC advertised to browsers (no secrets). Defaults to the public endpoint of the cluster. */
    publicRpcUrl: string | null;
    wsUrl: string | null;
    programId: string | null;
    /** Path to a keypair JSON file, or the JSON array itself. */
    serverKeypair: string | null;
    stakeEnabled: boolean;
    /** Arena ids to open as stake rooms (empty = discover on-chain). */
    arenaIds: number[];
    priorityFeeMicroLamports: number;
    /** Display symbol of the game token (`TOKEN_SYMBOL`, default `$SLANA`). */
    tokenSymbol: string;
    /**
     * Seconds after which an open session nobody plays is refunded by the sweeper
     * (`STALE_SESSION_AFTER_S`, default 900). The sweeper runs every 5 minutes, or this often
     * when it is shorter (the localnet e2e uses 5 s to reach the refund path quickly).
     */
    staleSessionAfterS: number;
    /** Re-check interval of a payout waiting for the player's token account (`NO_ATA_RETRY_S`, default 300). */
    noAtaRetryS: number;
  };
}

const int = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : d;
};

const num = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return v !== undefined && v.trim() !== '' && Number.isFinite(n) ? n : d;
};

const MARKET_KEYS: Record<string, keyof MarketUrls> = { magiceden: 'magicEden', tensor: 'tensor', opensea: 'opensea' };

/** An absolute https URL, else null (never `http:`, `javascript:` or a relative link on the page). */
function httpsUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Marketplace links: `MARKET_URLS` (JSON object, keys `magicEden` / `tensor` /
 * `opensea`, case and `_` insensitive) overridden by `MARKET_URL_MAGICEDEN`,
 * `MARKET_URL_TENSOR` and `MARKET_URL_OPENSEA`. Anything but an https URL is dropped.
 */
export function parseMarketUrls(env: NodeJS.ProcessEnv): MarketUrls {
  const out: MarketUrls = {};
  const raw = env.MARKET_URLS?.trim();
  if (raw) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const key = MARKET_KEYS[k.toLowerCase().replace(/[^a-z]/g, '')];
        const url = httpsUrl(v);
        if (key && url) out[key] = url;
      }
    }
  }
  for (const [suffix, key] of Object.entries({ MAGICEDEN: 'magicEden', TENSOR: 'tensor', OPENSEA: 'opensea' } as const)) {
    const url = httpsUrl(env[`MARKET_URL_${suffix}`]);
    if (url) out[key] = url;
  }
  return out;
}

const bool = (v: string | undefined, d: boolean): boolean => (v === undefined ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const secret = env.AUTH_SECRET ? Buffer.from(env.AUTH_SECRET, 'utf8') : randomBytes(32);
  return {
    port: int(env.PORT, 8787),
    host: env.HOST ?? '0.0.0.0',
    corsOrigin: env.CORS_ORIGIN ?? '*',
    dataDir: resolve(env.DATA_DIR ?? 'data'),
    publicUrl: env.PUBLIC_URL?.trim() ? env.PUBLIC_URL.trim().replace(/\/+$/, '') : null,
    webDist: env.WEB_DIST ? resolve(env.WEB_DIST) : null,
    maxConnectionsPerIp: int(env.MAX_CONNECTIONS_PER_IP, 8),
    maxConnections: int(env.MAX_CONNECTIONS, 600),
    practiceCapacity: Math.max(1, int(env.PRACTICE_CAPACITY ?? env.FREE_ROOM_CAPACITY, CAPACITY.practice)),
    privateRoomCapacity: int(env.PRIVATE_ROOM_CAPACITY, CAPACITY.private),
    arenaInstanceCap: Math.max(1, int(env.ARENA_INSTANCE_CAP, CAPACITY.arena)),
    bots: {
      practiceRookie: {
        target: int(env.BOT_TARGET, 20),
        min: int(env.BOT_MIN, 4),
        max: int(env.BOT_MAX, 20),
        mix: 'rookie',
      },
      practicePro: {
        target: int(env.BOT_TARGET, 20),
        min: int(env.BOT_MIN, 4),
        max: int(env.BOT_MAX, 20),
        mix: 'standard',
      },
      arena: {
        target: int(env.ARENA_BOT_TARGET, 24),
        min: int(env.ARENA_BOT_MIN, 2),
        max: int(env.ARENA_BOT_MAX, 16),
        mix: 'standard',
      },
      private: {
        target: int(env.PRIVATE_BOT_TARGET, 8),
        min: Math.min(2, int(env.PRIVATE_BOT_TARGET, 8)),
        max: int(env.PRIVATE_BOT_TARGET, 8),
        mix: 'standard',
      },
    },
    pass: {
      startMassMul: Math.max(1, num(env.PASS_START_MASS_MUL, RULES.passStartMassMul)),
      cashoutMs: Math.max(0, int(env.PASS_CASHOUT_MS, RULES.passCashoutMs)),
    },
    authSecret: secret,
    nodeEnv: env.NODE_ENV?.trim() || null,
    devFakeChain: bool(env.DEV_FAKE_CHAIN, false),
    markets: parseMarketUrls(env),
    chain: {
      cluster: env.SOLANA_CLUSTER ?? 'localnet',
      rpcUrl: env.SOLANA_RPC_URL ?? null,
      publicRpcUrl: env.PUBLIC_RPC_URL ?? null,
      wsUrl: env.SOLANA_WS_URL ?? null,
      programId: env.PROGRAM_ID ?? null,
      serverKeypair: env.SERVER_KEYPAIR ?? null,
      stakeEnabled: bool(env.STAKE_ENABLED, true),
      arenaIds: (env.STAKE_ARENA_IDS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 65535),
      priorityFeeMicroLamports: int(env.PRIORITY_FEE_MICROLAMPORTS, 5000),
      tokenSymbol: env.TOKEN_SYMBOL?.trim() || TOKEN_SYMBOL_DEFAULT,
      staleSessionAfterS: Math.max(1, int(env.STALE_SESSION_AFTER_S, 15 * 60)),
      noAtaRetryS: Math.max(1, int(env.NO_ATA_RETRY_S, 5 * 60)),
    },
  };
}

/** The chain status sent to browsers (`welcome`, `/api/config`): the gateway's view plus the marketplace links. */
export function publicChainStatus(status: ChainStatus, cfg: Pick<ServerConfig, 'markets'>): ChainStatus {
  return Object.keys(cfg.markets).length > 0 ? { ...status, markets: { ...cfg.markets } } : status;
}
