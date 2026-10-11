import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

/** Public operator wallet for off-chain controls only; ADMIN_WALLETS replaces this default. */
export const DEFAULT_ADMIN_WALLET = 'D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm';

export interface ServerConfig {
  port: number;
  host: string;
  /** Allowed CORS origin for REST ("*" by default). */
  corsOrigin: string;
  dataDir: string;
  /** Optional path to the built web app (apps/web/dist) to serve statically. */
  webDist: string | null;
  maxConnectionsPerIp: number;
  maxConnections: number;
  freeRoomCapacity: number;
  privateRoomCapacity: number;
  bots: { target: number; min: number; max: number; privateTarget: number };
  authSecret: Buffer;
  /** Explicit wallets allowed to administer off-chain runtime controls. */
  adminWallets: string[];
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
    /** Minimum score for a free game to be written on-chain. */
    recordMinScore: number;
    priorityFeeMicroLamports: number;
  };
}

const int = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : d;
};

const bool = (v: string | undefined, d: boolean): boolean => (v === undefined ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const secret = env.AUTH_SECRET ? Buffer.from(env.AUTH_SECRET, 'utf8') : randomBytes(32);
  return {
    port: int(env.PORT, 8787),
    host: env.HOST ?? '0.0.0.0',
    corsOrigin: env.CORS_ORIGIN ?? '*',
    dataDir: resolve(env.DATA_DIR ?? 'data'),
    webDist: env.WEB_DIST ? resolve(env.WEB_DIST) : null,
    maxConnectionsPerIp: int(env.MAX_CONNECTIONS_PER_IP, 8),
    maxConnections: int(env.MAX_CONNECTIONS, 600),
    freeRoomCapacity: int(env.FREE_ROOM_CAPACITY, 40),
    privateRoomCapacity: int(env.PRIVATE_ROOM_CAPACITY, 20),
    bots: {
      target: int(env.BOT_TARGET, 18),
      min: int(env.BOT_MIN, 3),
      max: int(env.BOT_MAX, 18),
      privateTarget: int(env.PRIVATE_BOT_TARGET, 8),
    },
    authSecret: secret,
    // An explicitly empty override disables the repository's default operator.
    adminWallets: (env.ADMIN_WALLETS ?? DEFAULT_ADMIN_WALLET).split(',').map((s) => s.trim()).filter(Boolean),
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
      recordMinScore: int(env.RECORD_MIN_SCORE, 40),
      priorityFeeMicroLamports: int(env.PRIORITY_FEE_MICROLAMPORTS, 5000),
    },
  };
}
