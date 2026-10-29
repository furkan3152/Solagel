import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { CAPACITY, RULES, TOKEN_SYMBOL_DEFAULT, MINT_USD_CENTS_DEFAULT, chainByKey, isGameAccess, type GameAccess } from '@elymum/shared';
import { HYPE_PRICE_URL_DEFAULT } from '@elymum/sdk';
import { getAddress, isAddress } from 'viem';
import type { BotManagerOptions } from './bots/manager';

export interface ServerConfig {
  port: number;
  host: string;
  /** Allowed CORS origin for REST ("*" by default). */
  corsOrigin: string;
  dataDir: string;
  /**
   * Public base URL of this server (`PUBLIC_URL`, no trailing slash), the origin wallet logins
   * (SIWE) are bound to and the base of the NFT metadata links. Required unless `NODE_ENV=development`
   * (`assertPublicUrl`); null (development only): the request's Host header, else `http://localhost:<PORT>`.
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
  /**
   * Arena round clock (`ROUND_SECONDS`, `ROUND_JOIN_CLOSE_SECONDS`; defaults `RULES.roundMs` /
   * `RULES.roundJoinCloseMs`). Tests, the localnet e2e and demo recordings shorten it;
   * production uses the defaults. The closed window is at most half a round.
   */
  round: { roundMs: number; closeMs: number };
  authSecret: Buffer;
  /**
   * Admin wallets (`ADMIN_WALLETS`, comma-separated 0x addresses, EIP-55 checksummed here): a SIWE session of
   * one of them may use `/api/admin/*` and always play. No default: unset means nobody is admin (logged loudly).
   */
  adminWallets: string[];
  /**
   * `GAME_ACCESS` (`admins`, `holders` or `public`): overrides the admin's `gameAccess` setting.
   * Null: the site setting decides (default `admins`).
   */
  gameAccess: GameAccess | null;
  /** `NODE_ENV` as given (null when unset). */
  nodeEnv: string | null;
  /**
   * `DEV_FAKE_CHAIN=1`: an in-memory chain with auto-issued arena tickets and
   * simulated settlements, for local UI work and Playwright. Only allowed with
   * `NODE_ENV=development` and no real chain configured (see `createChain`).
   */
  devFakeChain: boolean;
  /**
   * `DEV_FAKE_TOKEN=1`: the fake chain starts with its game token set (arenas open at once).
   * Without it the token starts unset (practice only, "Opening soon") and the dev-only
   * `POST /api/dev/token` sets it, to show the transition.
   */
  devFakeToken: boolean;
  chain: {
    /** Server RPC (`EVM_RPC_URL`, may hold an API key). Null: chain off, practice only. */
    rpcUrl: string | null;
    /**
     * RPC handed to browsers (`PUBLIC_RPC_URL`, no secrets). Default: `EVM_RPC_URL` when it is the public
     * testnet RPC, else null (the wallet's own RPC is used).
     */
    publicRpcUrl: string | null;
    /** Display name for a chain id the table does not know (`CHAIN_NAME`, default "Elysium"). */
    chainName: string | null;
    /** Blockscout-style explorer for a chain id the table does not know (`EXPLORER_URL`). */
    explorerUrl: string | null;
    /** `ARENA_ADDRESS`: overrides the registry's arena (normally written by the admin panel after a deploy). */
    arenaAddress: string | null;
    /** `NFT_ADDRESS`: overrides the registry's NFT. */
    nftAddress: string | null;
    /** `SERVER_PRIVATE_KEY`: `auto` (generated once into `DATA_DIR/server-key.json`), a 0x hex key, or a path to a file holding one. */
    serverKey: string | null;
    stakeEnabled: boolean;
    /** Arena ids to open as stake rooms (empty = discover on-chain). */
    arenaIds: number[];
    /** Display symbol of the game token (`TOKEN_SYMBOL`, default `$ELYMUM`). */
    tokenSymbol: string;
    /**
     * Seconds after which an open session nobody plays is settled at its entry fee by the sweeper
     * (`STALE_SESSION_AFTER_S`, default 900). The sweeper runs every 5 minutes, or this often
     * when it is shorter (the localnet e2e uses 5 s to reach the refund path quickly).
     */
    staleSessionAfterS: number;
    /**
     * `STALE_SWEEP_ACK=1`: the operator reviewed a quarantined journal (`journal.json.corrupt-*`)
     * and allows the stale-session sweeper to run again (M9). Without it the sweeper stays off
     * after a quarantine, so it cannot refund sessions whose real result was in the lost journal.
     */
    staleSweepAck: boolean;
    /** `LOG_CHUNK_BLOCKS`: blocks per `eth_getLogs` request of the session and holder indexes (default 10,000). */
    logChunkBlocks: number;
  };
  /** NFT mint: the USD target (`MINT_USD_CENTS`, default 100) and the HYPE/USD feed (`HYPE_PRICE_URL`). */
  mint: { usdCents: number; hypePriceUrl: string };
}

/**
 * `ADMIN_WALLETS`: comma-separated 0x addresses (any case), returned EIP-55 checksummed and de-duplicated;
 * malformed entries are dropped. There is no default: an empty list means nobody is admin.
 */
export function parseAdminWallets(v: string | undefined): string[] {
  const out = new Set<string>();
  for (const raw of (v ?? '').split(',')) {
    const s = raw.trim();
    if (isAddress(s, { strict: false })) out.add(getAddress(s));
  }
  return [...out];
}

/** Malformed entries of `ADMIN_WALLETS` (for the startup warning). */
/**
 * Refuses to start without a usable `PUBLIC_URL` unless `NODE_ENV=development`: it is the origin SIWE
 * logins are bound to and the base of the NFT metadata links, and a request-derived one (Host /
 * X-Forwarded-Host) would let any site that proxies to this server obtain real sessions. Throws a clear message.
 */
export function assertPublicUrl(cfg: Pick<ServerConfig, 'publicUrl' | 'nodeEnv'>): void {
  if (cfg.publicUrl) {
    let ok = false;
    try {
      const u = new URL(cfg.publicUrl);
      ok = (u.protocol === 'https:' || u.protocol === 'http:') && u.host !== '' && (u.pathname === '/' || u.pathname === '') && !u.search && !u.hash && !u.username;
    } catch {
      ok = false;
    }
    if (!ok) throw new Error(`PUBLIC_URL must be the site's origin, e.g. https://elymum.io (got ${JSON.stringify(cfg.publicUrl)}); refusing to start`);
    return;
  }
  if (cfg.nodeEnv === 'development') return;
  throw new Error(
    `PUBLIC_URL is required (NODE_ENV is ${cfg.nodeEnv ?? 'unset'}): set it to the site's public origin, e.g. https://elymum.io. ` +
      'It is the domain wallet sign-ins (SIWE) are bound to and the base of the NFT metadata links; only NODE_ENV=development may derive it from the request. Refusing to start',
  );
}

export function invalidAdminWallets(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !isAddress(s, { strict: false }));
}

/** `GAME_ACCESS`: `admins`, `holders` or `public`; anything else (or unset) is null (the site setting decides). */
export function parseGameAccess(v: string | undefined): GameAccess | null {
  const s = v?.trim().toLowerCase();
  return isGameAccess(s) ? s : null;
}

/** `PUBLIC_RPC_URL`, else `EVM_RPC_URL` when it is the public testnet RPC (no secrets in it), else null. */
export function defaultPublicRpc(rpcUrl: string | null, publicRpcUrl: string | undefined): string | null {
  const explicit = publicRpcUrl?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const testnet = chainByKey('elysium-testnet').rpcUrl;
  if (rpcUrl && testnet && rpcUrl.replace(/\/+$/, '') === testnet) return testnet;
  return null;
}

const blank = (v: string | undefined): string | null => (v?.trim() ? v.trim() : null);

const int = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : d;
};

const num = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return v !== undefined && v.trim() !== '' && Number.isFinite(n) ? n : d;
};

/** `ROUND_SECONDS` / `ROUND_JOIN_CLOSE_SECONDS`: whole seconds, a round of at least 2 s, joins closed for at most half of it. */
export function parseRoundConfig(env: NodeJS.ProcessEnv): { roundMs: number; closeMs: number } {
  const roundS = Math.floor(num(env.ROUND_SECONDS, RULES.roundMs / 1000));
  const roundMs = Math.max(2, roundS) * 1000;
  const closeS = Math.floor(num(env.ROUND_JOIN_CLOSE_SECONDS, RULES.roundJoinCloseMs / 1000));
  const closeMs = Math.min(Math.max(0, closeS) * 1000, Math.floor(roundMs / 2000) * 1000);
  return { roundMs, closeMs };
}

const bool = (v: string | undefined, d: boolean): boolean => (v === undefined ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const rpcUrl = blank(env.EVM_RPC_URL)?.replace(/\/+$/, '') ?? null;
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
    round: parseRoundConfig(env),
    authSecret: secret,
    adminWallets: parseAdminWallets(env.ADMIN_WALLETS),
    gameAccess: parseGameAccess(env.GAME_ACCESS),
    nodeEnv: env.NODE_ENV?.trim() || null,
    devFakeChain: bool(env.DEV_FAKE_CHAIN, false),
    devFakeToken: bool(env.DEV_FAKE_TOKEN, false),
    chain: {
      rpcUrl,
      publicRpcUrl: defaultPublicRpc(rpcUrl, env.PUBLIC_RPC_URL),
      chainName: blank(env.CHAIN_NAME),
      explorerUrl: blank(env.EXPLORER_URL)?.replace(/\/+$/, '') ?? null,
      arenaAddress: blank(env.ARENA_ADDRESS),
      nftAddress: blank(env.NFT_ADDRESS),
      serverKey: blank(env.SERVER_PRIVATE_KEY),
      stakeEnabled: bool(env.STAKE_ENABLED, true),
      arenaIds: (env.STAKE_ARENA_IDS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 65535),
      tokenSymbol: env.TOKEN_SYMBOL?.trim() || TOKEN_SYMBOL_DEFAULT,
      staleSessionAfterS: Math.max(1, int(env.STALE_SESSION_AFTER_S, 15 * 60)),
      staleSweepAck: bool(env.STALE_SWEEP_ACK, false),
      logChunkBlocks: Math.max(100, int(env.LOG_CHUNK_BLOCKS, 10_000)),
    },
    mint: {
      usdCents: Math.max(1, int(env.MINT_USD_CENTS, MINT_USD_CENTS_DEFAULT)),
      hypePriceUrl: blank(env.HYPE_PRICE_URL) ?? HYPE_PRICE_URL_DEFAULT,
    },
  };
}
