// Shared helpers for the demo / recording scripts (plain Node, no dependencies of its own).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The Agave tools are often installed outside PATH (same list as scripts/localnet.sh). */
export function withSolanaPath(env = process.env) {
  const extra = ['/opt/solana/bin', join(env.HOME ?? '', '.local/share/solana/install/active_release/bin')].filter(existsSync);
  const have = (env.PATH ?? '').split(':');
  return { ...env, PATH: [...extra.filter((d) => !have.includes(d)), env.PATH ?? ''].join(':') };
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
 * resolution, `pnpm -F @slana/web exec playwright install chromium`).
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
    'No Chromium found. Install one with `pnpm -F @slana/web exec playwright install chromium`, ' +
      'or point CHROME_PATH at a Chrome/Chromium binary.',
  );
}
