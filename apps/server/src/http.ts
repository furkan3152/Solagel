import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { PROTOCOL_VERSION, siwsChainId } from '@slana/shared';
import { isValidPubkey, type Auth, type SiwsOrigin } from './auth';
import type { DevFakeChainActions } from './chain/dev-fake';
import type { ChainGateway } from './chain/types';
import type { ServerConfig } from './config';
import type { Leaderboards } from './leaderboards';
import { clientIp } from './net/gateway';
import { Limiter } from './net/limiter';
import type { RoomManager } from './rooms/manager';
import type { SiteApi } from './site/routes';
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
  /** The slana.io site API (`/api/site/*`, `/api/admin/*`, `/api/auth/login`, `/api/auth/me`). */
  site?: SiteApi;
  /** The per-IP limiter of every `/api/*` request (default 240 a minute); tests inject a larger one. */
  apiLimiter?: Limiter;
}

const HOST_RE = /^[A-Za-z0-9.-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](:\d{1,5})?$/;

/**
 * Public base URL of this server: `PUBLIC_URL` when set, else the request's
 * host (and `X-Forwarded-Proto`/`-Host` behind a trusted proxy), else localhost.
 */
export function publicBaseUrl(cfg: ServerConfig, req: IncomingMessage, trustProxy: boolean): string {
  if (cfg.publicUrl) return cfg.publicUrl;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim();
  const host = (trustProxy ? first(req.headers['x-forwarded-host']) : undefined) ?? req.headers.host;
  const proto = trustProxy ? first(req.headers['x-forwarded-proto']) : undefined;
  if (host && HOST_RE.test(host)) return `${proto === 'https' ? 'https' : 'http'}://${host}`;
  return `http://localhost:${cfg.port}`;
}

/**
 * SIWS origin of a login (M1): the domain is the `PUBLIC_URL` host, else the request host
 * (as in `publicBaseUrl`); the URI is that base URL; the chain id names the cluster.
 */
export function siwsOrigin(cfg: ServerConfig, req: IncomingMessage, trustProxy: boolean): SiwsOrigin {
  const uri = publicBaseUrl(cfg, req, trustProxy);
  return { domain: new URL(uri).host, uri, chainId: siwsChainId(cfg.chain.cluster) };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
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
  const trustProxy = process.env.TRUST_PROXY === '1';

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
          case '/api/config':
            // `chain.tokenReady` false: practice only, arenas "opening soon" (the server picks the token up by itself)
            return json(res, 200, { protocol: PROTOCOL_VERSION, chain: ctx.chain.status() });
          case '/api/auth/nonce': {
            if (!nonceLimiter.allow(ip)) return json(res, 429, { error: 'rate_limited' });
            const pubkey = url.searchParams.get('pubkey');
            if (!isValidPubkey(pubkey)) return json(res, 400, { error: 'invalid pubkey' });
            return json(res, 200, ctx.auth.issueNonce(pubkey, siwsOrigin(cfg, req, trustProxy)));
          }
          case '/api/pending': {
            // settlements the server still has to send for a wallet. Finalized sessions (R24: settled,
            // payout waiting to be collected) live on chain; the web reads them there (SessionView.finalized/owed)
            const wallet = url.searchParams.get('wallet');
            if (!isValidPubkey(wallet)) return json(res, 400, { error: 'invalid wallet' });
            const pending = (ctx.journal?.pending ?? [])
              // loot sweeps (`kind: 'sweep'`) belong to no wallet
              .flatMap((p) => (p.kind === 'settle' && p.player === wallet ? [{ key: p.key, arenaId: p.arenaId ?? null, payout: p.payout ?? 0 }] : []));
            return json(res, 200, { pending });
          }
          case '/api/dev/token': {
            // DEV ONLY: sets the fake chain's game token, like `pnpm admin set-token` (absent unless
            // DEV_FAKE_CHAIN=1, which needs NODE_ENV=development); shows the "opening soon" → open transition
            const dev = cfg.devFakeChain ? (ctx.chain as Partial<DevFakeChainActions>) : null;
            if (!dev?.devSetToken) return json(res, 404, { error: 'not found' });
            if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
            const changed = dev.devSetToken();
            return json(res, 200, { changed, chain: ctx.chain.status() });
          }
          default:
            return json(res, 404, { error: 'not found' });
        }
      }
      if (cfg.webDist && (req.method === 'GET' || req.method === 'HEAD') && serveStatic(cfg.webDist, req, res, url.pathname)) return;
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Slana game server: connect via /ws');
        return;
      }
      json(res, 404, { error: 'not found' });
    } catch (err) {
      json(res, 500, { error: 'internal', message: (err as Error).message });
    }
  });
}
