import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SiteFail } from './validate';

export interface BackupDeps {
  /** `DATA_DIR`; null (memory only) refuses the backup. */
  dataDir: string | null;
  /** The chain id the state is keyed on (in the file name); null: `nochain`. */
  chainId: number | null;
  /** Writes every store's unsaved state to disk first (a consistent snapshot). */
  flush?: () => void;
  log?: (m: string) => void;
  /** Wall clock (file name); tests inject one. */
  now?: () => number;
  /** The tar binary (tests). */
  tar?: string;
}

/** `elymum-data-<chainId>-<YYYYmmdd-HHMMSS>.tar.gz` (UTC). */
export function backupFileName(chainId: number | null, now: number): string {
  const iso = new Date(now).toISOString(); // 2026-11-04T12:34:56.789Z
  const stamp = `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`;
  return `elymum-data-${chainId ?? 'nochain'}-${stamp}.tar.gz`;
}

let running = false;

/**
 * `GET /api/admin/backup`: streams a gzip tar of `DATA_DIR` (journal, registries, server key, site data,
 * profiles, pictures) to an admin, to move the server or keep an offsite copy. The stores are flushed
 * first; one backup runs at a time. Only the wallet and the outcome are logged, never the contents.
 * The response headers wait for tar's first bytes, so a tar that cannot start still answers a JSON 500.
 */
export function streamBackup(_req: IncomingMessage, res: ServerResponse, wallet: string, deps: BackupDeps): Promise<void> {
  const log = deps.log ?? (() => {});
  const dir = deps.dataDir;
  if (!dir || !existsSync(dir)) throw new SiteFail(404, 'not_found', 'This server keeps no data directory (DATA_DIR) to back up.');
  if (running) throw new SiteFail(429, 'rate_limited', 'A backup is already being downloaded. Try again when it finishes.');
  running = true;
  try {
    deps.flush?.();
  } catch (err) {
    log(`backup: flush before the backup failed (${(err as Error).message}); the files on disk are used as they are`);
  }
  const name = backupFileName(deps.chainId, (deps.now ?? Date.now)());
  const started = Date.now();
  log(`backup: ${name} requested by ${wallet}`);
  // --ignore-failed-read / no-file-changed: a store renaming its temp file mid-run is not an error
  const child = spawn(deps.tar ?? 'tar', ['czf', '-', '--warning=no-file-changed', '--warning=no-file-removed', '--ignore-failed-read', '-C', dir, '.'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let bytes = 0;
  let stderr = '';
  let aborted = false;
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      running = false;
      resolve();
    };
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (s: string) => {
      if (stderr.length < 2000) stderr += s;
    });
    child.stdout.on('data', (c: Buffer) => {
      bytes += c.length;
    });
    child.stdout.once('data', (first: Buffer) => {
      res.writeHead(200, {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.write(first);
      // ended in the close handler: a tar that fails mid-way must not look like a complete download
      child.stdout.pipe(res, { end: false });
    });
    // the client went away (closed tab, curl ^C): stop tar
    res.on('close', () => {
      if (!res.writableFinished && child.exitCode === null) {
        aborted = true;
        child.kill('SIGTERM');
      }
    });
    child.on('error', (err) => {
      log(`backup: tar could not start (${err.message})`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'internal', message: 'The backup could not be made (tar is missing on the server).' }));
      } else res.destroy();
      finish();
    });
    child.on('close', (code, signal) => {
      if (done) return; // already answered by the 'error' handler (tar could not start)
      const first = stderr.split('\n').find((l) => l.trim()) ?? '';
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      if (aborted) log(`backup: ${name} for ${wallet} cancelled by the client after ${bytes} bytes`);
      else if (code === 0 || (code === 1 && res.headersSent)) {
        // exit 1: a file changed while it was read (warning only; the archive is complete)
        log(`backup: ${name} sent to ${wallet} (${bytes} bytes, ${secs} s${code === 1 ? ', a file changed during the read' : ''})`);
        res.end();
      } else {
        log(`backup: ${name} for ${wallet} failed (tar exit ${code ?? signal}${first ? `: ${first.slice(0, 200)}` : ''})`);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'internal', message: 'The backup could not be made. See the server log.' }));
        } else res.destroy(); // a truncated download must fail on the client (curl -f / the browser), not look complete
      }
      finish();
    });
  });
}

/**
 * Settings a moved server needs (`GET /api/admin/migration-env`): every variable the server reads, minus
 * the ones that describe this host (port, paths, proxy hops, Node mode), which the new host sets itself.
 */
// STAKE_ENABLED / GAME_ACCESS: the old server is switched off with these during a move; the new one must not inherit that
const HOST_ONLY = new Set(['STAKE_ENABLED', 'GAME_ACCESS', 'HOST', 'PORT', 'DATA_DIR', 'WEB_DIST', 'NODE_ENV', 'TRUST_PROXY', 'TRUST_PROXY_HOPS', 'CORS_ORIGIN', 'GAME_DOMAIN']);
const MIGRATED =
  /^(ADMIN_WALLETS|AUTH_SECRET|SERVER_PRIVATE_KEY|EVM_RPC_URL|PUBLIC_RPC_URL|TESTNET_RPC_URL|PUBLIC_URL|CHAIN_NAME|EXPLORER_URL|ARENA_ADDRESS|NFT_ADDRESS|TOKEN_ADDRESS|TOKEN_SYMBOL|JOURNAL_ABANDON_CONTRACT|GAME_ACCESS|STAKE_ENABLED|STAKE_ARENA_IDS|STALE_SWEEP_ACK|STALE_SESSION_AFTER_S|HYPE_FAUCET_URL|HYPE_PRICE_URL|MINT_USD_CENTS|LOG_CHUNK_BLOCKS|RPC_MAX_RPS|RPC_BURST|ROUND_SECONDS|ROUND_JOIN_CLOSE_SECONDS|MAX_CONNECTIONS|MAX_CONNECTIONS_PER_IP|FREE_ROOM_CAPACITY|PRACTICE_CAPACITY|PRIVATE_ROOM_CAPACITY|ARENA_INSTANCE_CAP|(ARENA_|PRIVATE_)?BOT_[A-Z_]+|BOT_TICKETS_PER_MIN)$/;
export function migrationEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || v === '' || HOST_ONLY.has(k) || !MIGRATED.test(k)) continue;
    // one line per value in the .env file: refuse anything that could break out of it
    if (/[\r\n]/.test(v)) continue;
    out[k] = v;
  }
  return out;
}
