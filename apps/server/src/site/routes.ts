import type { IncomingMessage, ServerResponse } from 'node:http';
import { SITE_LIMITS, type SiteError, type SiteSettings } from '@slana/shared';
import type { Auth } from '../auth';
import type { ServerConfig } from '../config';
import { Limiter } from '../net/limiter';
import type { SiteStore } from './store';
import { SiteFail, obj } from './validate';

export interface SiteLimits {
  /** Writes to `/api/site/*` per IP. */
  writeIp: Limiter;
  /** Writes to `/api/site/*` per signed-in wallet. */
  writeWallet: Limiter;
  /** `POST /api/auth/login` per IP. */
  login: Limiter;
}

export const defaultSiteLimits = (): SiteLimits => ({
  writeIp: new Limiter(60, 10 * 60_000),
  writeWallet: new Limiter(20, 10 * 60_000),
  login: new Limiter(20, 60_000),
});

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

const fail = (res: ServerResponse, status: number, error: SiteError) => send(res, status, error);

const sendCsv = (res: ServerResponse, name: string, body: string) => {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${name}"`,
    'Cache-Control': 'no-store',
  });
  res.end(body);
};

/** Reads a JSON object body: `application/json`, at most `SITE_LIMITS.bodyBytes`. */
export async function readJson(req: IncomingMessage, limit: number = SITE_LIMITS.bodyBytes): Promise<Record<string, unknown>> {
  const type = String(req.headers['content-type'] ?? '').toLowerCase();
  if (!type.startsWith('application/json')) throw new SiteFail(415, 'unsupported_media_type', 'Send JSON (Content-Type: application/json)');
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw new SiteFail(413, 'body_too_large', `The body is larger than ${limit} bytes`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new SiteFail(413, 'body_too_large', `The body is larger than ${limit} bytes`);
    chunks.push(chunk);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new SiteFail(400, 'bad_request', 'The body is not valid JSON');
  }
  return obj(parsed);
}

/** `Authorization: Bearer <token>` → the session wallet (tokens come from `/api/auth/login` or the WebSocket `authed`). */
export function bearerWallet(auth: Auth, req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (typeof h !== 'string') return null;
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m ? auth.verifyToken(m[1]) : null;
}

/**
 * The slana.io site API: wallet login over HTTP, `/api/site/*` (public + the signed-in applicant)
 * and `/api/admin/*` (a session of an `ADMIN_WALLETS` wallet).
 */
export class SiteApi {
  private readonly admins: Set<string>;

  constructor(
    private readonly cfg: ServerConfig,
    private readonly auth: Auth,
    readonly store: SiteStore,
    private readonly limits: SiteLimits = defaultSiteLimits(),
  ) {
    this.admins = new Set(cfg.adminWallets);
  }

  isAdmin(wallet: string | null | undefined): boolean {
    return !!wallet && this.admins.has(wallet);
  }

  /** Whether `wallet` may enter game rooms: the game is public (env or setting), or an admin. */
  gameOpenFor(wallet: string | null | undefined): boolean {
    return this.cfg.gamePublic || this.store.settings.gamePublic || this.isAdmin(wallet);
  }

  /** The settings everyone can read; `gamePublic` is the effective value. */
  publicSettings(): SiteSettings {
    const s = this.store.settings;
    return { ...s, gamePublic: s.gamePublic || this.cfg.gamePublic };
  }

  /** Handles the request when the path is the site's; false otherwise. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL, ip: string): Promise<boolean> {
    const path = url.pathname;
    if (!(path.startsWith('/api/site/') || path.startsWith('/api/admin/') || path === '/api/auth/login' || path === '/api/auth/me')) return false;
    try {
      if (path === '/api/auth/login' || path === '/api/auth/me') await this.authRoutes(req, res, path, ip);
      else if (path.startsWith('/api/site/')) await this.siteRoutes(req, res, url, ip);
      else await this.adminRoutes(req, res, url);
    } catch (err) {
      if (err instanceof SiteFail && err.status === 413) res.setHeader('Connection', 'close');
      if (err instanceof SiteFail) fail(res, err.status, { error: err.code, message: err.message, ...(err.field ? { field: err.field } : {}) });
      else throw err;
    }
    return true;
  }

  private method(req: IncomingMessage, ...allowed: string[]): string {
    const m = req.method ?? 'GET';
    if (!allowed.includes(m)) throw new SiteFail(405, 'method_not_allowed', `Use ${allowed.join(' or ')}`);
    return m;
  }

  private session(req: IncomingMessage): string {
    const wallet = bearerWallet(this.auth, req);
    if (!wallet) throw new SiteFail(401, 'unauthorized', 'Sign in with your wallet first.');
    return wallet;
  }

  private async authRoutes(req: IncomingMessage, res: ServerResponse, path: string, ip: string): Promise<void> {
    if (path === '/api/auth/me') {
      this.method(req, 'GET');
      const wallet = this.session(req);
      return send(res, 200, { pubkey: wallet, admin: this.isAdmin(wallet) });
    }
    this.method(req, 'POST');
    if (!this.limits.login.allow(ip)) throw new SiteFail(429, 'rate_limited', 'Too many sign-ins. Wait a moment.');
    const body = await readJson(req);
    const { pubkey, message, signature } = body;
    if (typeof pubkey !== 'string' || typeof message !== 'string' || typeof signature !== 'string' || !this.auth.verifySignature(pubkey, message, signature)) {
      throw new SiteFail(401, 'auth_failed', 'Wallet sign-in failed. Please sign again.');
    }
    send(res, 200, { pubkey, token: this.auth.issueToken(pubkey), admin: this.isAdmin(pubkey) });
  }

  /** Rate limits a write: per IP before the session is known, then per wallet. */
  private writer(req: IncomingMessage, ip: string): string {
    if (!this.limits.writeIp.allow(ip)) throw new SiteFail(429, 'rate_limited', 'Too many requests. Try again in a few minutes.');
    const wallet = this.session(req);
    if (!this.limits.writeWallet.allow(wallet)) throw new SiteFail(429, 'rate_limited', 'Too many requests. Try again in a few minutes.');
    return wallet;
  }

  private async siteRoutes(req: IncomingMessage, res: ServerResponse, url: URL, ip: string): Promise<void> {
    const seg = url.pathname.slice('/api/site/'.length).split('/');
    const s = this.store;
    switch (seg[0]) {
      case 'settings':
        if (seg.length !== 1) break;
        this.method(req, 'GET');
        return send(res, 200, { settings: this.publicSettings() });
      case 'tasks':
        if (seg.length !== 1) break;
        this.method(req, 'GET');
        return send(res, 200, { tasks: s.publicTasks() });
      case 'wl': {
        if (seg.length !== 1) break;
        if (this.method(req, 'GET', 'POST') === 'GET') return send(res, 200, { entry: s.myWl(this.session(req)) });
        const wallet = this.writer(req, ip);
        return send(res, 201, { entry: s.submitWl(wallet, await readJson(req)) });
      }
      case 'collab': {
        if (seg.length === 1) {
          if (this.method(req, 'GET', 'POST') === 'GET') return send(res, 200, { collabs: s.myCollabs(this.session(req)) });
          const wallet = this.writer(req, ip);
          return send(res, 201, { collab: s.applyCollab(wallet, await readJson(req)) });
        }
        if (seg.length === 3 && seg[2] === 'wallets') {
          this.method(req, 'PUT');
          const wallet = this.writer(req, ip);
          return send(res, 200, { collab: s.saveCollabWallets(wallet, seg[1], await readJson(req)) });
        }
        if (seg.length === 3 && seg[2] === 'submit') {
          this.method(req, 'POST');
          const wallet = this.writer(req, ip);
          return send(res, 200, { collab: s.submitCollab(wallet, seg[1], await readJson(req)) });
        }
        break;
      }
    }
    throw new SiteFail(404, 'not_found', 'Not found');
  }

  private async adminRoutes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const wallet = this.session(req);
    if (!this.isAdmin(wallet)) throw new SiteFail(403, 'forbidden', 'This wallet is not an admin.');
    const seg = url.pathname.slice('/api/admin/'.length).split('/');
    const q = url.searchParams;
    const s = this.store;
    const day = new Date().toISOString().slice(0, 10);
    switch (seg[0]) {
      case 'me':
        this.method(req, 'GET');
        return send(res, 200, { pubkey: wallet, admin: true });
      case 'counts':
        this.method(req, 'GET');
        return send(res, 200, s.counts());
      case 'settings':
        if (seg.length !== 1) break;
        if (this.method(req, 'GET', 'PUT') === 'PUT') s.updateSettings(await readJson(req));
        return send(res, 200, { settings: s.settings, gamePublicEnv: this.cfg.gamePublic });
      case 'tasks': {
        if (seg.length === 1) {
          if (this.method(req, 'GET', 'POST') === 'GET') return send(res, 200, { tasks: s.tasks });
          return send(res, 201, { task: s.createTask(await readJson(req)) });
        }
        if (seg.length !== 2) break;
        if (seg[1] === 'order') {
          this.method(req, 'PUT');
          return send(res, 200, { tasks: s.reorderTasks((await readJson(req)).ids) });
        }
        if (this.method(req, 'PUT', 'DELETE') === 'PUT') return send(res, 200, { task: s.updateTask(seg[1], await readJson(req)) });
        s.deleteTask(seg[1]);
        return send(res, 200, { ok: true });
      }
      case 'wl.csv': {
        this.method(req, 'GET');
        const scope = q.get('scope') === 'all' ? 'all' : 'approved';
        return sendCsv(res, `slana-wl-${scope}-${day}.csv`, s.wlCsv(scope));
      }
      case 'wl': {
        if (seg.length === 1) {
          this.method(req, 'GET');
          const page = Number(q.get('page') ?? 1);
          const pageSize = Number(q.get('pageSize') ?? 50);
          return send(res, 200, s.listWl({ status: q.get('status'), q: q.get('q'), page, pageSize }));
        }
        if (seg.length === 2 && seg[1] === 'status') {
          this.method(req, 'POST');
          const body = await readJson(req);
          return send(res, 200, { updated: s.setWlStatus(body.ids, body.status) });
        }
        if (seg.length === 2) {
          this.method(req, 'GET');
          return send(res, 200, { entry: s.getWl(seg[1]) });
        }
        if (seg.length === 3 && seg[2] === 'status') {
          this.method(req, 'PUT');
          s.getWl(seg[1]); // 404 before validating the body
          s.setWlStatus([seg[1]], (await readJson(req)).status);
          return send(res, 200, { entry: s.getWl(seg[1]) });
        }
        if (seg.length === 3 && seg[2] === 'note') {
          this.method(req, 'PUT');
          return send(res, 200, { entry: s.setWlNote(seg[1], (await readJson(req)).note) });
        }
        break;
      }
      case 'collabs': {
        if (seg.length === 1) {
          this.method(req, 'GET');
          return send(res, 200, { items: s.listCollabs({ status: q.get('status'), q: q.get('q') }) });
        }
        if (seg.length === 2 && seg[1] === 'wallets.csv') {
          this.method(req, 'GET');
          return sendCsv(res, `slana-collab-wallets-${day}.csv`, s.allCollabsCsv());
        }
        const id = seg[1];
        if (seg.length === 2) {
          this.method(req, 'GET');
          return send(res, 200, { collab: s.getCollab(id) });
        }
        if (seg.length !== 3) break;
        switch (seg[2]) {
          case 'wallets.csv':
            this.method(req, 'GET');
            return sendCsv(res, `slana-collab-${id}-${day}.csv`, s.collabCsv(id));
          case 'approve':
            this.method(req, 'POST');
            return send(res, 200, { collab: s.approveCollab(id, await readJson(req)) });
          case 'reject':
            this.method(req, 'POST');
            return send(res, 200, { collab: s.rejectCollab(id) });
          case 'extend':
            this.method(req, 'POST');
            return send(res, 200, { collab: s.extendCollab(id, await readJson(req)) });
          case 'unlock':
            this.method(req, 'POST');
            return send(res, 200, { collab: s.unlockCollab(id) });
          case 'note':
            this.method(req, 'PUT');
            return send(res, 200, { collab: s.setCollabNote(id, (await readJson(req)).note) });
        }
        break;
      }
    }
    throw new SiteFail(404, 'not_found', 'Not found');
  }
}
