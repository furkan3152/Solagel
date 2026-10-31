import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
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

/** Strips one pair of surrounding quotes (Docker `--env-file` keeps them literally). */
function unquote(s: string): string {
  const t = s.trim();
  return t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0] ? t.slice(1, -1).trim() : t;
}

/** A run of hex digits long enough to be (part of) a key. */
const HEXISH = /0x[0-9a-fA-F]{8,}|[0-9a-fA-F]{24,}/;

/**
 * Whether a `SERVER_PRIVATE_KEY` value that is not a valid key looks like an attempt at one (a 0x prefix or
 * a long hex run, quoted or not): it is then refused as malformed and never echoed (it is likely a secret).
 */
export function looksLikeKey(spec: string): boolean {
  const t = spec.trim().replace(/^["']+/, '').trim();
  return /^0x/i.test(t) || /^[0-9a-fA-F]{24,}/.test(t) || (HEXISH.test(t) && !/[/\\]/.test(t));
}

/** A path as it may appear in an error: withheld when its file name looks like key material. */
function shownPath(path: string): string {
  return HEXISH.test(basename(path)) ? '<path withheld: its name looks like a key>' : path;
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
  return loadServerKeySecret(spec, dataDir).account;
}

/**
 * `loadServerKey` with the private key itself: the testnet bot wallets are derived from it
 * (`deriveBotKey`). Never log or send it anywhere.
 */
export function loadServerKeySecret(spec: string, dataDir?: string): { account: PrivateKeyAccount; privateKey: Hex } {
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
    return loadServerKeySecret(path);
  }
  const direct = /^(0x)?[0-9a-fA-F]{64}$/.test(trimmed) ? asHexKey(trimmed) : null;
  if (direct) return { account: privateKeyToAccount(direct), privateKey: direct };
  // anything key-like that is not exactly a key (quoted, truncated, a stray character): never read as a path
  if (looksLikeKey(trimmed) || looksLikeKey(unquote(trimmed))) {
    throw new Error(
      'SERVER_PRIVATE_KEY: malformed key (expected 0x + 64 hex digits, no quotes or extra characters; the value is not printed)',
    );
  }
  const path = trimmed === '~' || trimmed.startsWith('~/') ? resolve(homedir(), trimmed.slice(2)) : resolve(trimmed);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`SERVER_PRIVATE_KEY: cannot read ${shownPath(path)}`);
  }
  const key = keyFromFile(raw);
  if (!key) throw new Error(`SERVER_PRIVATE_KEY: ${shownPath(path)} does not hold a private key (0x + 64 hex digits)`);
  return { account: privateKeyToAccount(key), privateKey: key };
}
