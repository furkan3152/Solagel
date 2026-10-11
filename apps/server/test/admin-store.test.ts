import { chmodSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_ADMIN_SETTINGS, type AdminSettings } from '@solagel/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminError, AdminStore, defaultSettings, validateSettings } from '../src/admin/store';

// Keep real disk writes and recovery while observing that durability flushes happen.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, fsyncSync: vi.fn(actual.fsyncSync) };
});

const NOW = 1_760_000_000_000;
const directories: string[] = [];
const defaults = (): AdminSettings => structuredClone(DEFAULT_ADMIN_SETTINGS);

function snapshotPath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'solagel-admin-store-'));
  directories.push(directory);
  return join(directory, 'state', 'admin.json');
}

function expectError(action: () => unknown, status: number, code: string): void {
  let error: unknown;
  try { action(); } catch (cause) { error = cause; }
  expect(error).toBeInstanceOf(AdminError);
  expect(error).toMatchObject({ status, code });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('deployment binding', () => {
  it('recovers only for the same network and program, preserving the source on mismatch', () => {
    const path = snapshotPath();
    const binding = { cluster: 'devnet', programId: 'program-one' };
    const store = new AdminStore(path, defaults(), binding);
    store.update(0, defaults(), 'admin-wallet', NOW);
    const original = readFileSync(path, 'utf8');
    expect(new AdminStore(path, defaults(), binding).snapshot().revision).toBe(1);
    expect(() => new AdminStore(path, defaults(), { ...binding, cluster: 'mainnet-beta' })).toThrow(/another network\/program/);
    expect(() => new AdminStore(path, defaults(), { ...binding, programId: 'program-two' })).toThrow(/another network\/program/);
    expect(readFileSync(path, 'utf8')).toBe(original);
  });

  it('requires an explicit migration for an unbound snapshot instead of assuming a network', () => {
    const path = snapshotPath();
    new AdminStore(path, defaults()).update(0, defaults(), 'admin-wallet', NOW);
    const original = readFileSync(path, 'utf8');
    expect(() => new AdminStore(path, defaults(), { cluster: 'devnet', programId: null })).toThrow(/explicit settings migration/);
    expect(readFileSync(path, 'utf8')).toBe(original);
  });
});

describe('admin settings validation', () => {
  it('normalizes bot defaults without sharing nested release settings', () => {
    const initial = defaultSettings({ target: 42.9, min: 99, max: 12.8, privateTarget: 101 });
    expect(initial.bots).toEqual({ target: 42, min: 99, max: 12, privateTarget: 100 });
    expect(validateSettings(initial)).toEqual(initial);
    expect(defaultSettings({ target: -1, min: 9, max: Number.NaN, privateTarget: Number.POSITIVE_INFINITY }).bots)
      .toEqual({ target: 0, min: 0, max: 0, privateTarget: 0 });

    initial.token.symbol = 'MUTATED';
    initial.nft.skinMappings.push({ skinId: 16, assetId: 'mutated' });
    expect(DEFAULT_ADMIN_SETTINGS.token.symbol).toBe('');
    expect(DEFAULT_ADMIN_SETTINGS.nft.skinMappings).toEqual([]);
  });

  it.each([
    { target: -1 }, { target: 101 }, { target: 1.5 }, { min: 19 }, { max: -1 }, { privateTarget: 2 },
    { min: Number.NaN }, { max: Number.POSITIVE_INFINITY }, { privateTarget: -1 }, { privateTarget: 101 },
  ])('rejects invalid bot bounds %j', (override) => {
    const settings = defaults();
    settings.bots = { ...settings.bots, ...override };
    expectError(() => validateSettings(settings), 400, 'invalid_bot_limits');
  });

  it('allows public bots to be disabled while keeping a private-room minimum', () => {
    const settings = defaults();
    settings.bots = { target: 0, min: 3, max: 0, privateTarget: 8 };
    expect(validateSettings(settings)).toEqual(settings);
    expect(defaultSettings(settings.bots).bots).toEqual(settings.bots);
  });

  it('rejects unknown root or bot keys and invalid admission switches', () => {
    expectError(() => validateSettings({ ...defaults(), unexpected: true }), 400, 'invalid_settings');
    expectError(() => validateSettings({ ...defaults(), bots: { ...defaults().bots, unexpected: true } }), 400, 'invalid_settings');
    expectError(() => validateSettings({ ...defaults(), admissionsPaused: 'false' }), 400, 'invalid_pause');
    expectError(() => validateSettings([]), 400, 'invalid_settings');
  });
});

describe('admin snapshot store', () => {
  it('publishes defaults at revision zero and returns detached input and snapshot references', () => {
    const initial = defaults();
    const store = new AdminStore(null, initial);
    expect(store.snapshot()).toEqual({ revision: 0, updatedAt: 0, settings: defaults(), audit: [] });

    initial.bots.target = 99;
    initial.token.symbol = 'OUTSIDE';
    initial.nft.skinMappings.push({ skinId: 16, assetId: 'outside' });
    const detached = store.snapshot();
    detached.settings.bots.min = 0;
    detached.settings.nft.skinMappings.push({ skinId: 17, assetId: 'outside' });
    detached.audit.push({ at: NOW, wallet: 'forged', action: 'forged', revision: 0, summary: 'forged' });
    expect(store.snapshot()).toEqual({ revision: 0, updatedAt: 0, settings: defaults(), audit: [] });

    const changed = defaults();
    changed.admissionsPaused = true;
    const returned = store.update(0, changed, 'admin-wallet', NOW);
    changed.admissionsPaused = false;
    returned.settings.admissionsPaused = false;
    returned.audit[0].summary = 'outside';
    expect(store.snapshot().settings.admissionsPaused).toBe(true);
    expect(store.snapshot().audit[0].summary).not.toBe('outside');
  });

  it('rejects stale compare-and-swap updates without changing settings, audit, or disk', () => {
    const path = snapshotPath();
    const store = new AdminStore(path, defaults());
    const changed = defaults();
    changed.admissionsPaused = true;
    const committed = store.update(0, changed, 'first-admin', NOW);
    const persisted = readFileSync(path, 'utf8');

    expectError(() => store.update(0, defaults(), 'stale-admin', NOW + 1), 409, 'revision_conflict');
    for (const revision of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expectError(() => store.update(revision, defaults(), 'invalid-admin', NOW + 1), 400, 'invalid_revision');
    }
    expect(store.snapshot()).toEqual(committed);
    expect(readFileSync(path, 'utf8')).toBe(persisted);
  });

  it('flushes and recovers a versioned snapshot with private file permissions', () => {
    const path = snapshotPath();
    const store = new AdminStore(path, defaults());
    const changed = defaults();
    changed.admissionsPaused = true;
    const committed = store.update(0, changed, 'admin-wallet', NOW);

    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ version: 1, binding: null, ...committed });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(existsSync(`${path}.tmp`)).toBe(false);
    expect(vi.mocked(fsyncSync).mock.calls.length).toBeGreaterThanOrEqual(2);
    const recovered = new AdminStore(path, defaults());
    expect(recovered.snapshot()).toEqual(committed);
    expect(recovered.update(1, defaults(), 'next-admin', NOW + 1).revision).toBe(2);
  });

  it('rejects invalid timestamps instead of writing an unrecoverable snapshot', () => {
    const path = snapshotPath();
    const store = new AdminStore(path, defaults());
    const committed = store.update(0, defaults(), 'admin-wallet', NOW);
    const original = readFileSync(path, 'utf8');
    for (const invalidTime of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expectError(() => store.update(1, defaults(), 'admin-wallet', invalidTime), 400, 'invalid_time');
      expectError(() => store.record('admin-wallet', 'inspect', 'checked', invalidTime), 400, 'invalid_time');
    }
    expect(store.snapshot()).toEqual(committed);
    expect(readFileSync(path, 'utf8')).toBe(original);
    expect(new AdminStore(path, defaults()).snapshot()).toEqual(committed);
  });

  it('restores private permissions when replacing a leftover broadly readable temporary file', () => {
    const path = snapshotPath();
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(`${path}.tmp`, 'abandoned', { mode: 0o644 });
    chmodSync(`${path}.tmp`, 0o644);
    expect(statSync(`${path}.tmp`).mode & 0o777).toBe(0o644);

    const store = new AdminStore(path, defaults());
    store.update(0, defaults(), 'admin-wallet', NOW);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(new AdminStore(path, defaults()).snapshot()).toEqual(store.snapshot());
  });

  it.each([
    '{malformed json',
    JSON.stringify({ version: 2, revision: 0, updatedAt: 0, settings: DEFAULT_ADMIN_SETTINGS, audit: [] }),
    JSON.stringify({ version: 1, revision: -1, updatedAt: 0, settings: DEFAULT_ADMIN_SETTINGS, audit: [] }),
    JSON.stringify({ version: 1, revision: 1, updatedAt: -1, settings: DEFAULT_ADMIN_SETTINGS, audit: [] }),
    JSON.stringify({ version: 1, revision: 1, updatedAt: NOW, settings: {}, audit: [] }),
    JSON.stringify({ version: 1, revision: 1, updatedAt: NOW, settings: DEFAULT_ADMIN_SETTINGS, audit: [null] }),
  ])('fails startup without replacing a corrupt source snapshot (%#)', (corrupt) => {
    const path = snapshotPath();
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, corrupt);
    expect(() => new AdminStore(path, defaults())).toThrow(/original file preserved/i);
    expect(readFileSync(path, 'utf8')).toBe(corrupt);
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it('retains only the latest 200 audit entries with bounded summaries', () => {
    const store = new AdminStore(null, defaults());
    for (let i = 0; i < 250; i += 1) store.record(`wallet-${i}`, 'runtime.inspect', `${i}:${'x'.repeat(400)}`, NOW + i);
    const snapshot = store.snapshot();
    expect(snapshot.revision).toBe(0);
    expect(snapshot.audit).toHaveLength(200);
    expect(snapshot.audit[0]).toMatchObject({ wallet: 'wallet-50', at: NOW + 50, revision: 0 });
    expect(snapshot.audit.at(-1)).toMatchObject({ wallet: 'wallet-249', at: NOW + 249 });
    expect(snapshot.audit.every((entry) => entry.summary.length <= 300)).toBe(true);
    const next = store.update(0, defaults(), 'editor', NOW + 250);
    expect(next.audit).toHaveLength(200);
    expect(next.audit[0].wallet).toBe('wallet-51');
    expect(next.audit.at(-1)).toMatchObject({ wallet: 'editor', action: 'settings.update', revision: 1 });
  });

  it('bounds audit history when restoring a valid older snapshot', () => {
    const path = snapshotPath();
    mkdirSync(join(path, '..'), { recursive: true });
    const audit = Array.from({ length: 205 }, (_, i) => ({ at: NOW + i, wallet: `wallet-${i}`, action: 'inspect', revision: 0, summary: 'checked' }));
    writeFileSync(path, JSON.stringify({ version: 1, revision: 0, updatedAt: NOW, settings: defaults(), audit }));
    const restored = new AdminStore(path, defaults()).snapshot();
    expect(restored.audit).toEqual(audit.slice(-200));
  });

  it('publishes no state on persistence failure and requires recovery before further writes', () => {
    const path = snapshotPath();
    const store = new AdminStore(path, defaults());
    const committed = store.update(0, defaults(), 'admin-wallet', NOW);
    const original = readFileSync(path, 'utf8');
    mkdirSync(`${path}.tmp`);
    const changed = defaults();
    changed.admissionsPaused = true;

    expectError(() => store.update(1, changed, 'admin-wallet', NOW + 1), 503, 'admin_storage_unavailable');
    expect(store.snapshot()).toEqual(committed);
    expect(readFileSync(path, 'utf8')).toBe(original);
    rmSync(`${path}.tmp`, { recursive: true });
    expectError(() => store.update(1, changed, 'admin-wallet', NOW + 2), 503, 'admin_storage_unavailable');
    expectError(() => store.record('admin-wallet', 'retry', 'failed', NOW + 3), 503, 'admin_storage_unavailable');
    expect(store.snapshot()).toEqual(committed);
    expect(readFileSync(path, 'utf8')).toBe(original);

    const recovered = new AdminStore(path, defaults());
    expect(recovered.update(1, changed, 'admin-wallet', NOW + 4).settings.admissionsPaused).toBe(true);
  });
});
