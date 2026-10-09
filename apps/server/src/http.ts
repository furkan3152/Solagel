import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { PROTOCOL_VERSION } from '@solagel/shared';
import { isValidPubkey, type Auth } from './auth';
import type { ChainGateway } from './chain/types';
import type { ServerConfig } from './config';
import type { Leaderboards } from './leaderboards';
import { clientIp } from './net/gateway';
import type { RoomManager } from './rooms/manager';

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
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Tiny fixed-window limiter for REST endpoints (per IP). */
class Limiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  allow(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || h.reset < now) {
      if (this.hits.size > 10_000) this.hits.clear();
      this.hits.set(key, { n: 1, reset: now + this.windowMs });
      return true;
    }
    h.n++;
    return h.n <= this.max;
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
  const apiLimiter = new Limiter(240, 60_000);
  const nonceLimiter = new Limiter(20, 60_000);
  const trustProxy = process.env.TRUST_PROXY === '1';

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('Access-Control-Allow-Origin', cfg.corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
        switch (url.pathname) {
          case '/api/health':
            return json(res, 200, {
              ok: true,
              uptimeS: Math.round((Date.now() - ctx.startedAt) / 1000),
              online: ctx.rooms.online(),
              rooms: ctx.rooms.rooms.size,
            });
          case '/api/rooms':
            return json(res, 200, { rooms: ctx.rooms.list(), online: ctx.rooms.online() });
          case '/api/leaderboard':
            return json(res, 200, ctx.leaderboards.snapshot());
          case '/api/season':
            return json(res, 200, (await ctx.chain.season()) ?? { enabled: false });
          case '/api/config':
            return json(res, 200, { protocol: PROTOCOL_VERSION, chain: ctx.chain.status() });
          case '/api/auth/nonce': {
            if (!nonceLimiter.allow(ip)) return json(res, 429, { error: 'rate_limited' });
            const pubkey = url.searchParams.get('pubkey');
            if (!isValidPubkey(pubkey)) return json(res, 400, { error: 'invalid pubkey' });
            return json(res, 200, ctx.auth.issueNonce(pubkey));
          }
          default:
            return json(res, 404, { error: 'not found' });
        }
      }
      if (cfg.webDist && (req.method === 'GET' || req.method === 'HEAD') && serveStatic(cfg.webDist, req, res, url.pathname)) return;
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Solagel game server 🪙 — connect via /ws');
        return;
      }
      json(res, 404, { error: 'not found' });
    } catch (err) {
      json(res, 500, { error: 'internal', message: (err as Error).message });
    }
  });
}
