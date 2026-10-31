// Shared helpers for the demo / recording scripts (plain Node, no dependencies of its own).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The mnemonic of Hardhat's built-in dev accounts (each funded with 10,000 HYPE on `hardhat node`). Public; local only. */
export const HARDHAT_MNEMONIC = 'test test test test test test test test test test test junk';

/** Local chain defaults (`hardhat node`). */
export const LOCALNET_RPC_PORT = 8545;
export const LOCALNET_CHAIN_ID = 31337;

/** viem, resolved from the SDK package (scripts have no dependencies of their own). */
export function viem(sub = '') {
  return requireFrom('packages/sdk')(`viem${sub}`);
}

/** Hardhat dev account `index` as a viem local account (`{ address, signMessage, ... }`). */
export function hardhatAccount(index) {
  return viem('/accounts').mnemonicToAccount(HARDHAT_MNEMONIC, { addressIndex: index });
}

/** The private key (0x hex) of Hardhat dev account `index`. */
export function hardhatKey(index) {
  const { mnemonicToAccount } = viem('/accounts');
  const { toHex } = viem();
  return toHex(mnemonicToAccount(HARDHAT_MNEMONIC, { addressIndex: index }).getHdKey().privateKey);
}

let sdkPromise = null;
/** `@elymum/sdk` (TypeScript source) loaded through tsx, so plain .mjs scripts can call it. */
export function importSdk() {
  if (!sdkPromise) {
    const req = requireFrom('packages/sdk');
    const api = req.resolve('tsx/esm/api').replace(/index\.cjs$/, 'index.mjs');
    sdkPromise = import(pathToFileURL(api).href).then(({ tsImport }) => tsImport(join(ROOT, 'packages/sdk/src/index.ts'), import.meta.url));
  }
  return sdkPromise;
}

/** True when a JSON-RPC node answers `eth_chainId` at `url`. */
export async function rpcUp(url) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}',
      signal: AbortSignal.timeout(2000),
    });
    return r.ok && /"result"/.test(await r.text());
  } catch {
    return false;
  }
}

/** `require` rooted at a workspace package, so scripts reuse that package's installed deps. */
export function requireFrom(pkgDir) {
  return createRequire(join(ROOT, pkgDir, 'package.json'));
}

export function hasCommand(cmd, env = process.env) {
  return spawnSync('sh', ['-c', `command -v ${cmd}`], { env, stdio: 'ignore' }).status === 0;
}

/** True when nothing accepts connections on 127.0.0.1:port or [::1]:port. */
export async function portFree(port) {
  const tryBind = (host) =>
    new Promise((res) => {
      const srv = net.createServer();
      srv.once('error', (e) => res(e.code === 'EADDRNOTAVAIL' || e.code === 'EAFNOSUPPORT'));
      srv.once('listening', () => srv.close(() => res(true)));
      srv.listen({ port, host, exclusive: true });
    });
  return (await tryBind('0.0.0.0')) && (await tryBind('::'));
}

/** Waits until `url` answers with any HTTP status below 500. */
export async function waitForHttp(url, timeoutMs, isAborted = () => false) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end && !isAborted()) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/**
 * Chromium for Playwright. Order: CHROME_PATH, then Playwright's own browser cache (its normal
 * resolution, `pnpm -F @elymum/web exec playwright install chromium`).
 * Returns { executablePath } (undefined = let Playwright pick) or throws.
 */
export function resolveChromium(chromium) {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv) {
    if (!existsSync(fromEnv)) throw new Error(`CHROME_PATH is set but does not exist: ${fromEnv}`);
    return { executablePath: fromEnv };
  }
  let own = '';
  try {
    own = chromium.executablePath();
  } catch {
    /* no browser registered for this Playwright version */
  }
  if (own && existsSync(own)) return { executablePath: undefined };
  throw new Error(
    'No Chromium found. Install one with `pnpm -F @elymum/web exec playwright install chromium`, ' +
      'or point CHROME_PATH at a Chrome/Chromium binary.',
  );
}
