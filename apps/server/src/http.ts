import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { PROTOCOL_VERSION, releaseForSettings } from '@solagel/shared';
import { isValidPubkey, type Auth } from './auth';
import type { ChainGateway } from './chain/types';
import type { ServerConfig } from './config';
import type { Leaderboards } from './leaderboards';
import { clientIp } from './net/gateway';
import type { RoomManager } from './rooms/manager';
import type { AdminService } from './admin/service';
import { AdminError, exactKeys } from './admin/store';

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
  admin: AdminService;
  startedAt: number;
}

// Fits 1,000 staged uint256 NFT mappings while bounding every admin request.
const MAX_JSON_BYTES = 128 * 1024;

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type'] ?? '') || req.headers['content-encoding']) {
    throw new AdminError(415, 'json_required');
  }
  if (Number(req.headers['content-length']) > MAX_JSON_BYTES) {
    req.resume();
    throw new AdminError(413, 'request_too_large');
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    let done = false;
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => finish(new AdminError(408, 'request_timeout')), 10_000);
    timer.unref();
    function finish(error?: Error) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) { reject(error); return; }
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
        resolve(value as Record<string, unknown>);
      } catch { reject(new AdminError(400, 'invalid_json')); }
    }
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_JSON_BYTES) { chunks.length = 0; finish(new AdminError(413, 'request_too_large')); return; }
      chunks.push(chunk);
    });
    req.once('end', () => finish());
    req.once('error', () => finish(new AdminError(400, 'invalid_body')));
    req.once('aborted', () => finish(new AdminError(400, 'invalid_body')));
  });
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
  const adminLimiter = new Limiter(60, 60_000);
  const adminAuthLimiter = new Limiter(10, 60_000);
  const trustProxy = process.env.TRUST_PROXY === '1';

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('Access-Control-Allow-Origin', cfg.corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Vary', 'Origin');
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
        if (url.pathname.startsWith('/api/admin/')) {
          if (!adminLimiter.allow(ip)) return json(res, 429, { error: 'rate_limited' });
          const methods: Record<string, string> = { '/api/admin/status': 'GET', '/api/admin/challenge': 'POST',
            '/api/admin/session': 'POST', '/api/admin/settings': 'PUT', '/api/admin/retry-settlements': 'POST', '/api/admin/inspect-token': 'POST' };
          const method = methods[url.pathname];
          if (!method) return json(res, 404, { error: 'not_found' });
          if (req.method !== method) { res.setHeader('Allow', method); return json(res, 405, { error: 'method_not_allowed' }); }
          if (url.pathname === '/api/admin/challenge' || url.pathname === '/api/admin/session') {
            if (!adminAuthLimiter.allow(ip)) return json(res, 429, { error: 'rate_limited' });
            const body = await readJson(req);
            if (url.pathname === '/api/admin/challenge') {
              exactKeys(body, ['pubkey']);
              return json(res, 200, await ctx.admin.challenge(body.pubkey));
            }
            exactKeys(body, ['pubkey', 'message', 'signature']);
            return json(res, 200, await ctx.admin.session(body.pubkey, body.message, body.signature));
          }
          const wallet = ctx.admin.wallet(req.headers.authorization);
          if (url.pathname === '/api/admin/status') return json(res, 200, await ctx.admin.status(wallet));
          const body = await readJson(req);
          if (url.pathname === '/api/admin/settings') {
            exactKeys(body, ['expectedRevision', 'settings']);
            return json(res, 200, await ctx.admin.update(wallet, body.expectedRevision, body.settings));
          }
          if (url.pathname === '/api/admin/inspect-token') {
            exactKeys(body, ['mintAddress']);
            return json(res, 200, await ctx.admin.inspectToken(wallet, body.mintAddress));
          }
          exactKeys(body, []);
          return json(res, 200, await ctx.admin.retrySettlements(wallet));
        }
        if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return json(res, 405, { error: 'method_not_allowed' }); }
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
            return json(res, 200, { protocol: PROTOCOL_VERSION, chain: { ...ctx.chain.status(), admissionsPaused: ctx.rooms.admissionsPaused }, release: releaseForSettings(ctx.admin.snapshot().settings), admissionsPaused: ctx.rooms.admissionsPaused });
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
      if (err instanceof AdminError) return json(res, err.status, { error: err.code, message: err.message,
        ...(err.code === 'revision_conflict' ? { revision: ctx.admin.snapshot().revision } : {}) });
      json(res, 500, { error: 'internal', message: 'The server could not complete this request.' });
    }
  });
}
