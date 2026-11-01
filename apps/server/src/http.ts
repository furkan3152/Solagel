import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { ELYSIUM_TESTNET_CHAIN_ID, PROTOCOL_VERSION } from '@elymum/shared';
import { checksumAddress, type Auth, type SiweOrigin } from './auth';
import type { DevFakeChainActions } from './chain/dev-fake';
import type { ChainGateway } from './chain/types';
import type { ServerConfig } from './config';
import type { Leaderboards } from './leaderboards';
import { clientIp, trustProxyHops } from './net/gateway';
import { Limiter } from './net/limiter';
import type { PriceKeeper } from './chain/price-keeper';
import type { RoomManager } from './rooms/manager';
import { bearerWallet, type SiteApi } from './site/routes';
import type { Journal } from './stake/journal';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

interface Ctx {
  rooms: RoomManager;
  leaderboards: Leaderboards;
  chain: ChainGateway;
  auth: Auth;
  startedAt: number;
  /** Settlements owed (for `/api/pending`). */
  journal?: Journal;
  /** The site API (`/api/site/*`, `/api/admin/*`, `/api/auth/login`, `/api/auth/me`, `/api/profile`, `/api/nft/*`). */
  site?: SiteApi;
  /** The NFT price keeper (its last outcome is shown to admins in `/api/config`). */
  priceKeeper?: PriceKeeper | null;
  /** The per-IP limiter of every `/api/*` request (default 240 a minute); tests inject a larger one. */
  apiLimiter?: Limiter;
  /** Server log (unexpected errors of a request go here, never to the client). Default: console.error. */
  log?: (m: string) => void;
}

/** Strips URLs (an RPC URL can carry an API key in its path or query) from a message before it is logged. */
export function redactUrls(s: string): string {
  return s.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, (u) => {
    try {
      return `${new URL(u).protocol}//${new URL(u).host}/<redacted>`;
    } catch {
      return '<redacted-url>';
    }
  });
}

const HOST_RE = /^[A-Za-z0-9.-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](:\d{1,5})?$/;

/**
 * Public base URL of this server: `PUBLIC_URL` when set. Without it (only allowed with
 * `NODE_ENV=development`, see `assertPublicUrl`) the request's own `Host` header in development, else
 * `http://localhost:<PORT>`. Client-supplied `X-Forwarded-Host`/`-Proto` are never used: this URL is the
 * SIWE origin of a login and the base of the NFT metadata links, so it must not be chosen by a caller
 * (`_trustProxy` is accepted for compatibility and ignored).
 */
export function publicBaseUrl(cfg: ServerConfig, req: IncomingMessage, _trustProxy?: boolean | number): string {
  if (cfg.publicUrl) return cfg.publicUrl;
  const host = req.headers.host;
  if (cfg.nodeEnv === 'development' && host && HOST_RE.test(host)) return `http://${host}`;
  return `http://localhost:${cfg.port}`;
}

/**
 * SIWE origin of a login: the domain is the `PUBLIC_URL` host (the request host only in
 * development, as in `publicBaseUrl`); the URI is that base URL; the chain id is the server's
 * (`eth_chainId` of its RPC), or the Elysium testnet's while the chain is off.
 */
export function siweOrigin(cfg: ServerConfig, req: IncomingMessage, _trustProxy: boolean | number, chainId: number | null): SiweOrigin {
  const uri = publicBaseUrl(cfg, req);
  return { domain: new URL(uri).host, uri, chainId: chainId ?? ELYSIUM_TESTNET_CHAIN_ID };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** A small JSON body (dev routes); null when it is not JSON or larger than 4 KiB. */
async function readSmallJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 4096) return null;
    chunks.push(c as Buffer);
  }
  try {
    const v: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function serveStatic(root: string, req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  const base = resolve(root);
  let file = normalize(join(base, rel));
  if (file !== base && !file.startsWith(base + sep)) return false;
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (extname(rel)) return false;
    file = join(base, 'index.html'); // SPA fallback
    if (!existsSync(file)) return false;
  }
  const ext = extname(file);
  const immutable = rel.startsWith('/assets/');
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
  return true;
}

export function createHttpServer(cfg: ServerConfig, ctx: Ctx): Server {
  const apiLimiter = ctx.apiLimiter ?? new Limiter(240, 60_000);
  const nonceLimiter = new Limiter(20, 60_000);
  const trustProxy = trustProxyHops();

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('Access-Control-Allow-Origin', cfg.corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const ip = clientIp(req, trustProxy);
    try {
      if (url.pathname.startsWith('/api/')) {
        if (!apiLimiter.allow(ip)) return json(res, 429, { error: 'rate_limited' });
        if (ctx.site && (await ctx.site.handle(req, res, url, ip))) return;
        switch (url.pathname) {
          case '/api/health':
            return json(res, 200, {
              ok: true,
              uptimeS: Math.round((Date.now() - ctx.startedAt) / 1000),
              online: ctx.rooms.online(),
              rooms: ctx.rooms.rooms.size,
            });
          case '/api/rooms':
            return json(res, 200, { rooms: ctx.rooms.list(), online: ctx.rooms.online(), blocked: ctx.rooms.blockedArenas() });
          case '/api/leaderboard':
            // the standings: off-chain daily / all-time best scores, no prizes
            return json(res, 200, ctx.leaderboards.snapshot());
          case '/api/config': {
            // `chain.tokenReady` false: practice only, arenas "opening soon" (the server picks the token up by itself)
            const body: Record<string, unknown> = { protocol: PROTOCOL_VERSION, chain: ctx.chain.status() };
            // admins also see the server key's gas balance (and the price keeper)
            const wallet = bearerWallet(ctx.auth, req);
            if (wallet && ctx.site?.isAdmin(wallet)) {
              const info = ctx.chain.serverInfo();
              body.server = { address: info.address, balanceWei: info.balanceWei, low: info.low, priceKeeper: ctx.priceKeeper?.last ?? null };
            }
            return json(res, 200, body);
          }
          case '/api/auth/nonce': {
            if (!nonceLimiter.allow(ip)) return json(res, 429, { error: 'rate_limited' });
            const address = checksumAddress(url.searchParams.get('address'));
            if (!address) return json(res, 400, { error: 'bad_request', message: 'address must be an EVM address (0x…)' });
            return json(res, 200, ctx.auth.issueNonce(address, siweOrigin(cfg, req, trustProxy, ctx.chain.status().chainId)));
          }
          case '/api/pending': {
            // settlements the server still has to send for a wallet (payouts in ledger units). Finalized sessions
            // (settled, payout waiting to be collected) live on chain; the web reads them there (getSession)
            const wallet = checksumAddress(url.searchParams.get('wallet'));
            if (!wallet) return json(res, 400, { error: 'bad_request', message: 'wallet must be an EVM address (0x…)' });
            const pending = (ctx.journal?.pending ?? [])
              // loot sweeps (`kind: 'sweep'`) belong to no wallet
              .flatMap((p) =>
                p.kind === 'settle' && p.player.toLowerCase() === wallet.toLowerCase() ? [{ key: p.key, arenaId: p.arenaId ?? null, payout: p.payout ?? 0 }] : [],
              );
            return json(res, 200, { pending });
          }
          case '/api/dev/token': {
            // DEV ONLY: sets the fake chain's game token, like `setToken` from /admin (absent unless
            // DEV_FAKE_CHAIN=1, which needs NODE_ENV=development); shows the "opening soon" → open transition
            const dev = cfg.devFakeChain ? (ctx.chain as Partial<DevFakeChainActions>) : null;
            if (!dev?.devSetToken) return json(res, 404, { error: 'not found' });
            if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
            const changed = dev.devSetToken();
            return json(res, 200, { changed, chain: ctx.chain.status() });
          }
          case '/api/dev/transfer': {
            // DEV ONLY: the web's fake wallet "sends" a game-token transfer (a power-up purchase); answers its fake hash
            const dev = cfg.devFakeChain ? (ctx.chain as Partial<DevFakeChainActions>) : null;
            if (!dev?.devTransfer) return json(res, 404, { error: 'not found' });
            if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
            const body = await readSmallJson(req);
            const value = typeof body?.value === 'string' && /^\d{1,40}$/.test(body.value) ? BigInt(body.value) : 0n;
            const hash = dev.devTransfer(String(body?.from ?? ''), String(body?.to ?? ''), value);
            return hash ? json(res, 200, { hash }) : json(res, 400, { error: 'bad_request' });
          }
          default:
            return json(res, 404, { error: 'not found' });
        }
      }
      if (cfg.webDist && (req.method === 'GET' || req.method === 'HEAD') && serveStatic(cfg.webDist, req, res, url.pathname)) return;
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Elymum game server: connect via /ws');
        return;
      }
      json(res, 404, { error: 'not found' });
    } catch (err) {
      // details stay server-side (with URLs redacted): an RPC error can name the RPC URL and its key
      (ctx.log ?? ((m: string) => console.error(m)))(`http: ${req.method} ${url.pathname} failed: ${redactUrls(String((err as Error)?.stack ?? err))}`);
      if (!res.headersSent) json(res, 500, { error: 'internal', message: 'internal server error' });
      else res.end();
    }
  });
}
