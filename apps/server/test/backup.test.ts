import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type App } from '../src/app';
import { loadConfig } from '../src/config';
import { Limiter } from '../src/net/limiter';
import { backupFileName } from '../src/site/backup';
import { ArenaChain, arena } from './helpers';
import { testSigner } from './signers';

describe('GET /api/admin/backup', () => {
  let app: App;
  let port: number;
  let dir: string;
  const admin = testSigner().address;
  const logs: string[] = [];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'elymum-backup-'));
    writeFileSync(join(dir, 'marker.txt'), 'known contents 42\n');
    const cfg = loadConfig({ PORT: '0', HOST: '127.0.0.1', DATA_DIR: dir, BOT_TARGET: '0', BOT_MIN: '0', BOT_MAX: '0', ADMIN_WALLETS: admin, TRUST_PROXY: '0', CORS_ORIGIN: 'https://elymum.io' } as NodeJS.ProcessEnv);
    app = await createApp(cfg, {
      chain: new ArenaChain([arena(1, 1000)]),
      log: (m) => logs.push(m),
      persist: true,
      siteLimits: { writeIp: new Limiter(10_000, 60_000), writeWallet: new Limiter(10_000, 60_000), login: new Limiter(10_000, 60_000) },
      apiLimiter: new Limiter(10_000, 60_000),
    });
    port = await app.listen();
  });
  afterAll(async () => {
    await app.close();
  });

  const get = (token?: string) => fetch(`http://127.0.0.1:${port}/api/admin/backup`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

  it('refuses without a session (401) and for a non-admin wallet (403)', async () => {
    expect((await get()).status).toBe(401);
    expect((await get(app.auth.issueToken(testSigner().address))).status).toBe(403);
    expect((await get('not-a-token')).status).toBe(401);
  });

  it('streams a valid tar.gz of DATA_DIR to the admin, logs the wallet but not the contents', async () => {
    // an unsaved profile change is flushed into the snapshot
    app.profiles.recordGame(admin, { score: 10, kills: 1, xp: 5 });
    const res = await get(app.auth.issueToken(admin));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/gzip');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="elymum-data-31337-\d{8}-\d{6}\.tar\.gz"$/);
    const gz = Buffer.from(await res.arrayBuffer());
    const tarBytes = gunzipSync(gz); // throws on a corrupt or truncated gzip
    expect(tarBytes.length).toBeGreaterThan(512);
    const out = mkdtempSync(join(tmpdir(), 'elymum-backup-out-'));
    const file = join(out, 'b.tar.gz');
    writeFileSync(file, gz);
    const list = spawnSync('tar', ['tzf', file], { encoding: 'utf8' });
    expect(list.status).toBe(0);
    const names = list.stdout.split('\n');
    expect(names).toContain('./marker.txt');
    expect(names.some((n) => n.startsWith('./profiles'))).toBe(true);
    const cat = spawnSync('tar', ['xzOf', file, './marker.txt'], { encoding: 'utf8' });
    expect(cat.stdout).toBe('known contents 42\n');
    const lines = logs.filter((l) => l.startsWith('backup:'));
    expect(lines.some((l) => l.includes(admin) && l.includes('sent to'))).toBe(true);
    expect(lines.join('\n')).not.toContain('known contents');
  });

  it('answers the CORS preflight of the web origin with the Authorization header allowed', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/backup`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://elymum.io', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://elymum.io');
    expect(res.headers.get('access-control-allow-headers')).toMatch(/Authorization/);
  });

  it('is rate-limited per admin wallet', async () => {
    const token = app.auth.issueToken(admin);
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await get(token);
      await r.arrayBuffer();
      statuses.push(r.status);
    }
    expect(statuses).toContain(429);
  });

  it('names the file after the chain and the UTC time', () => {
    expect(backupFileName(99801, Date.UTC(2026, 10, 4, 3, 5, 9))).toBe('elymum-data-99801-20261104-030509.tar.gz');
    expect(backupFileName(null, Date.UTC(2026, 0, 1))).toBe('elymum-data-nochain-20260101-000000.tar.gz');
  });
});

describe('migrationEnv', () => {
  it('keeps the settings a moved server needs and drops the host-specific ones', async () => {
    const { migrationEnv } = await import('../src/site/backup');
    const out = migrationEnv({
      ADMIN_WALLETS: '0xabc',
      AUTH_SECRET: 's3cret',
      SERVER_PRIVATE_KEY: 'auto',
      EVM_RPC_URL: 'https://rpc.example',
      ARENA_BOT_TARGET: '12',
      PORT: '10000',
      DATA_DIR: '/data',
      TRUST_PROXY_HOPS: '1',
      CORS_ORIGIN: '*',
      PATH: '/usr/bin',
      RENDER_SERVICE_ID: 'srv-x',
      PUBLIC_URL: 'https://elymum.io',
      CHAIN_NAME: 'bad\nINJECT=1',
      GAME_ACCESS: 'admins',
      STAKE_ENABLED: 'false',
    });
    expect(out).toEqual({
      ADMIN_WALLETS: '0xabc',
      AUTH_SECRET: 's3cret',
      SERVER_PRIVATE_KEY: 'auto',
      EVM_RPC_URL: 'https://rpc.example',
      ARENA_BOT_TARGET: '12',
      PUBLIC_URL: 'https://elymum.io',
    });
  });
});
