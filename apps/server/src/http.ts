import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { PROTOCOL_VERSION } from '@slana/shared';
import { isValidPubkey, type Auth } from './auth';
import type { ChainGateway } from './chain/types';
import type { ServerConfig } from './config';
import type { Leaderboards } from './leaderboards';
import { clientIp } from './net/gateway';
import { PassImages } from './pass/images';
import { collectionMetadata, passMetadata } from './pass/metadata';
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
  /** Pass image renderer/cache (default: `DATA_DIR/pass`). */
  passImages?: PassImages;
}

/** Requests per minute and IP on `/pass/*` and `/api/pass/*`. */
export const PASS_RATE_PER_MIN = 60;
const HOST_RE = /^[A-Za-z0-9.-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](:\d{1,5})?$/;
const PASS_PATH = /^\/pass\/(\d{1,6})\.(json|png)$/;

/**
 * Base URL for links in Pass metadata: `PUBLIC_URL` when set, else the request's
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
  const passLimiter = new Limiter(PASS_RATE_PER_MIN, 60_000);
  const trustProxy = process.env.TRUST_PROXY === '1';
  const passImages = ctx.passImages ?? new PassImages(join(cfg.dataDir, 'pass'));

  /** `/pass/collection.json|png`, `/pass/<n>.json|png`; every other `/pass/*` path is a 404. */
  async function servePass(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    const pass = ctx.chain.passStatus();
    if (!pass) return json(res, 404, { error: 'pass collection not configured' });
    const base = publicBaseUrl(cfg, req, trustProxy);
    const sealed = !(pass.revealed && pass.seed);
    const cache = sealed ? 'public, max-age=60' : 'public, max-age=3600';
    const sendJson = (body: unknown) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(body));
    };
    const sendPng = (buf: Buffer) => {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': buf.length, 'Cache-Control': sealed ? 'public, max-age=300' : 'public, max-age=86400' });
      res.end(req.method === 'HEAD' ? undefined : buf);
    };
    if (pathname === '/pass/collection.json') return sendJson(collectionMetadata(pass, base));
    if (pathname === '/pass/collection.png') return sendPng((await passImages.png('collection', pass))!);
    const m = PASS_PATH.exec(pathname);
    if (!m) return json(res, 404, { error: 'not found' });
    const n = Number(m[1]);
    if (m[2] === 'json') {
      const meta = passMetadata(n, pass, base);
      return meta ? sendJson(meta) : json(res, 404, { error: 'no such pass' });
    }
    const png = await passImages.png(n, pass);
    return png ? sendPng(png) : json(res, 404, { error: 'no such pass' });
  }

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
      if (url.pathname.startsWith('/pass/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
        if (!passLimiter.allow(ip)) return json(res, 429, { error: 'rate_limited' });
        return await servePass(req, res, url.pathname);
      }
      if (url.pathname.startsWith('/api/')) {
        if (!apiLimiter.allow(ip)) return json(res, 429, { error: 'rate_limited' });
        if (url.pathname.startsWith('/api/pass/') && !passLimiter.allow(ip)) return json(res, 429, { error: 'rate_limited' });
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
          case '/api/pass/owned': {
            const wallet = url.searchParams.get('wallet');
            if (!isValidPubkey(wallet)) return json(res, 400, { error: 'invalid wallet' });
            return json(res, 200, { passes: await ctx.chain.ownedPasses(wallet) });
          }
          default:
            return json(res, 404, { error: 'not found' });
        }
      }
      if (cfg.webDist && (req.method === 'GET' || req.method === 'HEAD') && serveStatic(cfg.webDist, req, res, url.pathname)) return;
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Slana game server 🪙 — connect via /ws');
        return;
      }
      json(res, 404, { error: 'not found' });
    } catch (err) {
      json(res, 500, { error: 'internal', message: (err as Error).message });
    }
  });
}
