import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { CAPACITY, RULES, TOKEN_SYMBOL_DEFAULT } from '@slana/shared';
import type { BotManagerOptions } from './bots/manager';

export interface ServerConfig {
  port: number;
  host: string;
  /** Allowed CORS origin for REST ("*" by default). */
  corsOrigin: string;
  dataDir: string;
  /**
   * Public base URL of this server (`PUBLIC_URL`, no trailing slash), the origin wallet logins
   * (SIWS) are bound to. Null: derived from the request's Host header, else `http://localhost:<PORT>`.
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
   * Admin wallets (`ADMIN_WALLETS`, comma-separated base58 keys): a SIWS session of one of them may use
   * `/api/admin/*` and play while the game is not public. Defaults to `DEFAULT_ADMIN_WALLET`.
   */
  adminWallets: string[];
  /**
   * `GAME_PUBLIC=1`: the game is open to everyone whatever the admin's `gamePublic` setting says.
   * Unset: the site setting decides (default off: only admin wallets can join rooms).
   */
  gamePublic: boolean;
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
    /**
     * `STALE_SWEEP_ACK=1`: the operator reviewed a quarantined journal (`journal.json.corrupt-*`)
     * and allows the stale-session sweeper to run again (M9). Without it the sweeper stays off
     * after a quarantine, so it cannot refund sessions whose real result was in the lost journal.
     */
    staleSweepAck: boolean;
  };
}

/**
 * The admin wallet: `SLANA_ADMIN` in scripts/admin-wallet.conf (a public key; a test checks the
 * two stay equal). Used when `ADMIN_WALLETS` is unset or empty.
 */
export const DEFAULT_ADMIN_WALLET = 'D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm';

/** `ADMIN_WALLETS`: comma-separated base58 public keys; malformed entries are dropped. */
export function parseAdminWallets(v: string | undefined): string[] {
  const list = (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s));
  return list.length > 0 ? [...new Set(list)] : [DEFAULT_ADMIN_WALLET];
}

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
    gamePublic: bool(env.GAME_PUBLIC, false),
    nodeEnv: env.NODE_ENV?.trim() || null,
    devFakeChain: bool(env.DEV_FAKE_CHAIN, false),
    devFakeToken: bool(env.DEV_FAKE_TOKEN, false),
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
      staleSweepAck: bool(env.STALE_SWEEP_ACK, false),
    },
  };
}
