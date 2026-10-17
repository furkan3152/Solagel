import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadServerKeypair } from '../src/chain/solana';

describe('SERVER_KEYPAIR=auto', () => {
  it('creates the key once in DATA_DIR (0600) and reuses it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'slana-key-'));
    const a = loadServerKeypair('auto', dir);
    const b = loadServerKeypair(' auto ', dir);
    expect(b.publicKey.toBase58()).toBe(a.publicKey.toBase58());
    const file = join(dir, 'server-keypair.json');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(64);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('needs a data dir', () => {
    expect(() => loadServerKeypair('auto')).toThrow(/DATA_DIR/);
  });
});
