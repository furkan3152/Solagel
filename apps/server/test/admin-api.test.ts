import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigView } from '@solagel/sdk';
import { DEFAULT_ADMIN_SETTINGS, type AdminSettings } from '@solagel/shared';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type App } from '../src/app';
import { NullChain } from '../src/chain/types';
import { loadConfig } from '../src/config';

function wallet() {
  const pair = nacl.sign.keyPair();
  return { pubkey: bs58.encode(pair.publicKey), sign: (message: string) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), pair.secretKey)) };
}

function chainConfig(admin: string): ConfigView {
  return { admin, serverAuthority: wallet().pubkey, treasury: wallet().pubkey, feeBps: 500, seasonShareBps: 5_000,
    skinPrice: 0, currentSeason: 1, paused: false, totalPlayers: 0, totalGames: 0, totalSessions: 0, totalStaked: 0, totalPaidOut: 0 };
}

class FreshAdminChain extends NullChain {
  config: ConfigView | null = null;
  fail = false;
  reads = 0;
  async readAdminConfig(): Promise<ConfigView | null> {
    this.reads += 1;
    if (this.fail) throw new Error('RPC temporarily unavailable');
    return this.config ? structuredClone(this.config) : null;
  }
}

const apps: App[] = [];
const dirs = new Set<string>();
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.clear();
});

async function fixture(options: { owner?: ReturnType<typeof wallet>; allowed?: string[]; chain?: FreshAdminChain; dir?: string } = {}) {
  const owner = options.owner ?? wallet();
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), 'solagel-admin-api-'));
  dirs.add(dir);
  const chain = options.chain ?? new FreshAdminChain();
  const cfg = loadConfig({ PORT: '0', HOST: '127.0.0.1', DATA_DIR: dir, AUTH_SECRET: 'admin-api-test-secret-shared-across-restarts',
    ADMIN_WALLETS: (options.allowed ?? [owner.pubkey]).join(','), BOT_TARGET: '0', BOT_MIN: '0', BOT_MAX: '0', PRIVATE_BOT_TARGET: '0' });
  const app = await createApp(cfg, { chain, persist: true, log: () => {} });
  apps.push(app);
  const base = `http://127.0.0.1:${await app.listen()}`;
  return { app, owner, dir, chain, base };
}

async function request(base: string, path: string, method = 'GET', body?: unknown, token?: string) {
  const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { response, body: await response.json() };
}

async function login(f: Awaited<ReturnType<typeof fixture>>) {
  const challenge = await request(f.base, '/api/admin/challenge', 'POST', { pubkey: f.owner.pubkey });
  expect(challenge.response.status).toBe(200);
  expect(challenge.body.message).toContain('Solagel Admin');
  const session = await request(f.base, '/api/admin/session', 'POST', { pubkey: f.owner.pubkey,
    message: challenge.body.message, signature: f.owner.sign(challenge.body.message) });
  expect(session.response.status).toBe(200);
  expect(session.body.token).toMatch(/^admin\./);
  expect(session.body.expiresAt).toBeGreaterThan(Date.now());
  return session.body.token as string;
}

function pausedSettings(): AdminSettings {
  return { ...structuredClone(DEFAULT_ADMIN_SETTINGS), admissionsPaused: true, bots: { target: 7, min: 1, max: 4, privateTarget: 3 } };
}

describe('admin HTTP authentication and request boundaries', () => {
  it('accepts the advertised maximum of 1,000 full-width NFT token IDs', async () => {
    const f = await fixture();
    const token = await login(f);
    const settings = pausedSettings();
    const max = (1n << 256n) - 1n;
    settings.nft = { status: 'configured', chain: 'base', standard: 'erc721',
      collectionAddress: '0x1111111111111111111111111111111111111111', openSeaUrl: null,
      skinMappings: Array.from({ length: 1000 }, (_, i) => ({ skinId: 16, assetId: (max - BigInt(i)).toString() })) };
    const payload = { expectedRevision: 0, settings };
    expect(JSON.stringify(payload).length).toBeGreaterThan(65_536);
    const saved = await request(f.base, '/api/admin/settings', 'PUT', payload, token);
    expect(saved.response.status).toBe(200);
    expect(saved.body.settings.nft.skinMappings).toHaveLength(1000);
  });

  it('accepts signed dedicated admin sessions and rejects game credentials and other wallets', async () => {
    const f = await fixture();
    const token = await login(f);
    const status = await request(f.base, '/api/admin/status', 'GET', undefined, token);
    expect(status.response.status).toBe(200);
    expect(status.response.headers.get('cache-control')).toBe('no-store');
    expect(status.body.authority).toEqual({ wallet: f.owner.pubkey, offchainAdmin: true, onChainAdmin: false });
    expect(status.body.capabilities).toEqual({ tokenGameplay: false, nftOwnership: false });
    expect(status.body.audit.map((entry: { action: string }) => entry.action)).toEqual(['session.open']);

    expect((await request(f.base, '/api/admin/status')).response.status).toBe(401);
    const gameToken = f.app.auth.issueToken(f.owner.pubkey);
    expect((await request(f.base, '/api/admin/status', 'GET', undefined, gameToken)).response.status).toBe(401);
    const gameChallenge = f.app.auth.issueNonce(f.owner.pubkey);
    expect((await request(f.base, '/api/admin/session', 'POST', { pubkey: f.owner.pubkey, message: gameChallenge.message,
      signature: f.owner.sign(gameChallenge.message) })).response.status).toBe(401);

    const outsider = wallet();
    expect((await request(f.base, '/api/admin/challenge', 'POST', { pubkey: outsider.pubkey })).response.status).toBe(403);
    const unauthorizedToken = f.app.admin.auth.issueToken(outsider.pubkey).token;
    expect((await request(f.base, '/api/admin/status', 'GET', undefined, unauthorizedToken)).response.status).toBe(403);
    expect(f.app.admin.snapshot().revision).toBe(0);
    expect(f.app.admin.snapshot().audit).toHaveLength(1);
  });

  it('enforces the exact HTTP method for every admin route before dispatch', async () => {
    const f = await fixture();
    for (const [path, wrong, correct] of [
      ['status', 'POST', 'GET'], ['challenge', 'GET', 'POST'], ['session', 'GET', 'POST'],
      ['settings', 'POST', 'PUT'], ['retry-settlements', 'GET', 'POST'], ['inspect-token', 'GET', 'POST'],
    ]) {
      const result = await request(f.base, `/api/admin/${path}`, wrong);
      expect(result.response.status).toBe(405);
      expect(result.response.headers.get('allow')).toBe(correct);
      expect(result.body.error).toBe('method_not_allowed');
    }
    expect((await request(f.base, '/api/admin/not-a-route')).response.status).toBe(404);
    expect(f.app.admin.snapshot().audit).toHaveLength(0);
  });

  it('rejects non-JSON, encoded, malformed, oversized, and unknown-key requests without changing settings', async () => {
    const f = await fixture();
    const token = await login(f);
    const before = f.app.admin.snapshot();
    const payload = JSON.stringify({ expectedRevision: 0, settings: pausedSettings() });
    const invalidMediaHeaders: Record<string, string>[] = [{ 'Content-Type': 'text/plain' }, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }];
    for (const headers of invalidMediaHeaders) {
      const response = await fetch(`${f.base}/api/admin/settings`, { method: 'PUT', headers: { ...headers, Authorization: `Bearer ${token}` }, body: payload });
      expect(response.status).toBe(415);
      expect((await response.json()).error).toBe('json_required');
    }
    for (const body of ['{broken', '[]', 'null']) {
      const response = await fetch(`${f.base}/api/admin/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('invalid_json');
    }
    const large = await request(f.base, '/api/admin/settings', 'PUT', { padding: 'x'.repeat(131_072) }, token);
    expect(large.response.status).toBe(413);
    expect(large.body.error).toBe('request_too_large');
    const unknown = await request(f.base, '/api/admin/settings', 'PUT', { expectedRevision: 0, settings: pausedSettings(), force: true }, token);
    expect(unknown.response.status).toBe(400);
    const extraBot = { ...pausedSettings(), bots: { ...pausedSettings().bots, unlimited: true } };
    expect((await request(f.base, '/api/admin/settings', 'PUT', { expectedRevision: 0, settings: extraBot }, token)).response.status).toBe(400);
    expect((await request(f.base, '/api/admin/challenge', 'POST', { pubkey: f.owner.pubkey, role: 'admin' })).response.status).toBe(400);
    expect(f.app.admin.snapshot()).toEqual(before);
    expect(f.app.rooms.admissionsPaused).toBe(false);
  });

  it('enforces the body limit for chunked requests without Content-Length', async () => {
    const f = await fixture();
    const token = await login(f);
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(`${f.base}/api/admin/settings`, { method: 'PUT', headers: {
        'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Transfer-Encoding': 'chunked',
      } }, (res) => { res.resume(); res.once('end', () => resolve(res.statusCode)); });
      req.once('error', reject);
      req.write('{"padding":"');
      req.write('x'.repeat(80_000));
      req.end(`${'x'.repeat(80_000)}"}`);
    });
    expect(status).toBe(413);
    expect(f.app.admin.snapshot().revision).toBe(0);
  });
});

describe('admin HTTP runtime updates and fresh authorization', () => {
  it('applies a valid revision atomically and keeps pause and live bot settings after stale or invalid writes', async () => {
    const f = await fixture();
    const token = await login(f);
    const free = f.app.rooms.lobbyRoom();
    const privateRoom = f.app.rooms.privateRoom(null)!;
    const updated = await request(f.base, '/api/admin/settings', 'PUT', { expectedRevision: 0, settings: pausedSettings() }, token);
    expect(updated.response.status).toBe(200);
    expect(updated.body.revision).toBe(1);
    expect(f.app.rooms.admissionsPaused).toBe(true);
    expect(free.opts.bots).toEqual({ target: 7, min: 0, max: 4 });
    expect(privateRoom.opts.bots).toEqual({ target: 3, min: 1, max: 3 });
    const before = f.app.admin.snapshot();

    const stale = await request(f.base, '/api/admin/settings', 'PUT', { expectedRevision: 0, settings: structuredClone(DEFAULT_ADMIN_SETTINGS) }, token);
    expect(stale.response.status).toBe(409);
    expect(stale.body).toMatchObject({ error: 'revision_conflict', revision: 1 });
    const invalid = { ...pausedSettings(), admissionsPaused: false, bots: { target: 2, min: 3, max: 2, privateTarget: 0 } };
    expect((await request(f.base, '/api/admin/settings', 'PUT', { expectedRevision: 1, settings: invalid }, token)).response.status).toBe(400);
    expect(f.app.admin.snapshot()).toEqual(before);
    expect(f.app.rooms.admissionsPaused).toBe(true);
    expect(free.opts.bots).toEqual({ target: 7, min: 0, max: 4 });
    expect(privateRoom.opts.bots).toEqual({ target: 3, min: 1, max: 3 });
    expect((await request(f.base, '/api/config')).body.admissionsPaused).toBe(true);
  });

  it('restores saved settings, revision, and audit on restart and reapplies runtime controls', async () => {
    const f = await fixture();
    const token = await login(f);
    expect((await request(f.base, '/api/admin/settings', 'PUT', { expectedRevision: 0, settings: pausedSettings() }, token)).response.status).toBe(200);
    const before = f.app.admin.snapshot();
    await f.app.close();
    const restarted = await fixture({ owner: f.owner, dir: f.dir });
    const status = await request(restarted.base, '/api/admin/status', 'GET', undefined, token);
    expect(status.response.status).toBe(200);
    expect(restarted.app.admin.snapshot()).toEqual(before);
    expect(status.body.settings).toEqual(pausedSettings());
    expect(status.body.audit.map((entry: { action: string }) => entry.action)).toEqual(['session.open', 'settings.update']);
    expect(restarted.app.rooms.admissionsPaused).toBe(true);
    expect(restarted.app.rooms.lobbyRoom().opts.bots).toEqual({ target: 7, min: 0, max: 4 });
    expect(restarted.app.rooms.privateRoom(null)!.opts.bots).toEqual({ target: 3, min: 1, max: 3 });
  });

  it('rechecks the current on-chain administrator on every request and fails closed on rotation or RPC failure', async () => {
    const owner = wallet();
    const chain = new FreshAdminChain();
    chain.config = chainConfig(owner.pubkey);
    const f = await fixture({ owner, chain, allowed: [] });
    const token = await login(f);
    const initial = await request(f.base, '/api/admin/status', 'GET', undefined, token);
    expect(initial.response.status).toBe(200);
    expect(initial.body.authority).toEqual({ wallet: owner.pubkey, offchainAdmin: false, onChainAdmin: true });
    const reads = chain.reads;
    const before = f.app.admin.snapshot();

    chain.config.admin = wallet().pubkey;
    expect((await request(f.base, '/api/admin/status', 'GET', undefined, token)).response.status).toBe(403);
    expect((await request(f.base, '/api/admin/settings', 'PUT', { expectedRevision: 0, settings: pausedSettings() }, token)).response.status).toBe(403);
    expect(chain.reads).toBe(reads + 2);
    chain.config.admin = owner.pubkey;
    chain.fail = true;
    expect((await request(f.base, '/api/admin/status', 'GET', undefined, token)).response.status).toBe(403);
    chain.fail = false;
    chain.config = null;
    expect((await request(f.base, '/api/admin/status', 'GET', undefined, token)).response.status).toBe(403);
    expect(f.app.admin.snapshot()).toEqual(before);
    expect(f.app.rooms.admissionsPaused).toBe(false);
  });

  it('rejects a valid signature if on-chain authority rotated after its challenge', async () => {
    const owner = wallet();
    const chain = new FreshAdminChain();
    chain.config = chainConfig(owner.pubkey);
    const f = await fixture({ owner, chain, allowed: [] });
    const challenge = await request(f.base, '/api/admin/challenge', 'POST', { pubkey: owner.pubkey });
    expect(challenge.response.status).toBe(200);
    const body = { pubkey: owner.pubkey, message: challenge.body.message, signature: owner.sign(challenge.body.message) };
    chain.config.admin = wallet().pubkey;
    expect((await request(f.base, '/api/admin/session', 'POST', body)).response.status).toBe(403);
    chain.config.admin = owner.pubkey;
    expect((await request(f.base, '/api/admin/session', 'POST', body)).response.status).toBe(401);
    expect(f.app.admin.snapshot().audit).toHaveLength(0);
  });

  it('keeps explicitly configured off-chain administration available during an RPC outage', async () => {
    const chain = new FreshAdminChain();
    chain.fail = true;
    const f = await fixture({ chain });
    const token = await login(f);
    const status = await request(f.base, '/api/admin/status', 'GET', undefined, token);
    expect(status.response.status).toBe(200);
    expect(status.body.authority).toEqual({ wallet: f.owner.pubkey, offchainAdmin: true, onChainAdmin: false });
    expect(status.body.config).toBeNull();
  });
});
