import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';

/** File `SERVER_PRIVATE_KEY=auto` keeps the key in, under `DATA_DIR`. */
export const SERVER_KEY_FILE = 'server-key.json';

const HEX_KEY = /^0x[0-9a-fA-F]{64}$/;

/** A 32-byte private key as 0x hex (with or without the prefix); null when it is not one. */
function asHexKey(s: string): Hex | null {
  const t = s.trim();
  const k = t.startsWith('0x') || t.startsWith('0X') ? `0x${t.slice(2)}` : `0x${t}`;
  return HEX_KEY.test(k) ? (k.toLowerCase() as Hex) : null;
}

/** The key inside a key file: a bare hex key, or JSON `{ "privateKey": "0x…" }` (what `auto` writes). */
function keyFromFile(raw: string): Hex | null {
  const t = raw.trim();
  if (t.startsWith('{')) {
    try {
      const v = JSON.parse(t) as { privateKey?: unknown };
      return typeof v.privateKey === 'string' ? asHexKey(v.privateKey) : null;
    } catch {
      return null;
    }
  }
  return asHexKey(t);
}

/**
 * The server's signing key (`SERVER_PRIVATE_KEY`):
 * - `auto`: kept in `<dataDir>/server-key.json` (mode 0600), generated with viem's `generatePrivateKey` on the
 *   first start, so a host never has to be given a secret: the operator reads the address from the log or
 *   `/api/config` (`serverKey`) and sets it as the arena's server authority;
 * - a 0x hex private key;
 * - a path to a file holding one (bare hex, or the JSON `auto` writes).
 * Throws with a message that never contains the key.
 */
export function loadServerKey(spec: string, dataDir?: string): PrivateKeyAccount {
  const trimmed = spec.trim();
  if (trimmed === '') throw new Error('SERVER_PRIVATE_KEY is not set');
  if (trimmed === 'auto') {
    if (!dataDir) throw new Error('SERVER_PRIVATE_KEY=auto needs DATA_DIR');
    const path = join(dataDir, SERVER_KEY_FILE);
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true });
      const privateKey = generatePrivateKey();
      const address = privateKeyToAccount(privateKey).address;
      writeFileSync(path, JSON.stringify({ address, privateKey }, null, 2), { mode: 0o600, flag: 'wx' });
    }
    return loadServerKey(path);
  }
  const direct = /^(0x)?[0-9a-fA-F]{64}$/.test(trimmed) ? asHexKey(trimmed) : null;
  if (direct) return privateKeyToAccount(direct);
  const path = trimmed === '~' || trimmed.startsWith('~/') ? resolve(homedir(), trimmed.slice(2)) : resolve(trimmed);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`SERVER_PRIVATE_KEY: cannot read ${path}`);
  }
  const key = keyFromFile(raw);
  if (!key) throw new Error(`SERVER_PRIVATE_KEY: ${path} does not hold a private key (0x + 64 hex digits)`);
  return privateKeyToAccount(key);
}
