import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { SERVER_KEY_FILE, loadServerKey } from '../src/chain/server-key';

const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

describe('SERVER_PRIVATE_KEY', () => {
  it('auto: creates the key once in DATA_DIR (0600) and reuses it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-key-'));
    const a = loadServerKey('auto', dir);
    const b = loadServerKey(' auto ', dir);
    expect(b.address).toBe(a.address);
    expect(a.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    const file = join(dir, SERVER_KEY_FILE);
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { address: string; privateKey: string };
    expect(saved.address).toBe(a.address);
    expect(saved.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(privateKeyToAccount(saved.privateKey as `0x${string}`).address).toBe(a.address);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('auto needs a data dir', () => {
    expect(() => loadServerKey('auto')).toThrow(/DATA_DIR/);
  });

  it('takes a 0x hex key (with or without 0x) or a file holding one', () => {
    const expected = privateKeyToAccount(KEY).address;
    expect(loadServerKey(KEY).address).toBe(expected);
    expect(loadServerKey(KEY.slice(2)).address).toBe(expected);
    const dir = mkdtempSync(join(tmpdir(), 'elymum-key-'));
    writeFileSync(join(dir, 'bare.txt'), `${KEY}\n`);
    expect(loadServerKey(join(dir, 'bare.txt')).address).toBe(expected);
    writeFileSync(join(dir, 'json.json'), JSON.stringify({ privateKey: KEY }));
    expect(loadServerKey(join(dir, 'json.json')).address).toBe(expected);
  });

  it('refuses a missing file or a file without a key, never echoing the secret', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-key-'));
    expect(() => loadServerKey(join(dir, 'nope.txt'))).toThrow(/cannot read/);
    writeFileSync(join(dir, 'bad.txt'), 'hello');
    expect(() => loadServerKey(join(dir, 'bad.txt'))).toThrow(/does not hold a private key/);
    expect(() => loadServerKey('')).toThrow(/not set/);
  });
});
