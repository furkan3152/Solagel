import type { IncomingMessage, ServerResponse } from 'node:http';
import { SITE_LIMITS, type GameAccess, type SiteError, type SiteSettings } from '@elymum/shared';
import type { Auth } from '../auth';
import type { ChainGateway } from '../chain/types';
import { integrityRoutes } from '../integrity/routes';
import type { IntegrityService } from '../integrity/service';
import type { ServerConfig } from '../config';
import { Limiter } from '../net/limiter';
import { ProfileError, type ProfileStore } from '../profiles';
import type { Journal } from '../stake/journal';
import { clearContract, registerContract, type ContractsStore } from './contracts';
import { emblemSvg } from './emblem';
import { parseNftPath, type MintService } from './mint';
import type { SiteStore } from './store';
import { SiteFail, obj } from './validate';

/** What the site needs besides its own store; every part is optional (bare unit tests). */
export interface SiteExtras {
  chain?: ChainGateway;
  contracts?: ContractsStore;
  mint?: MintService;
  profiles?: ProfileStore;
  journal?: Journal;
  /** Public base URL of a request (`PUBLIC_URL`, else the request host): NFT metadata links. */
  baseUrl?: (req: IncomingMessage) => string;
}

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
 * The Elymum site API: wallet sign-in over HTTP (SIWE), `/api/site/*` (public + the signed-in
 * applicant), `/api/profile`, the NFT metadata (`/api/nft/*`) and `/api/admin/*` (a session of an
 * `ADMIN_WALLETS` wallet).
 */
export class SiteApi {
  /** Admin wallets, lower-case. */
  private readonly admins: Set<string>;
  /** Cheat and collusion detection (`/api/admin/integrity/*`); absent in bare unit tests. */
  private integrity: IntegrityService | null = null;

  constructor(
    private readonly cfg: ServerConfig,
    private readonly auth: Auth,
    readonly store: SiteStore,
    private readonly limits: SiteLimits = defaultSiteLimits(),
    private readonly ext: SiteExtras = {},
  ) {
    this.admins = new Set(cfg.adminWallets.map((w) => w.toLowerCase()));
  }

  setIntegrity(svc: IntegrityService | null): void {
    this.integrity = svc;
  }

  /** Admin wallets compare case-insensitively (stored checksummed). */
  isAdmin(wallet: string | null | undefined): boolean {
    return !!wallet && this.admins.has(wallet.toLowerCase());
  }

  /** Who may play: `GAME_ACCESS` when set, else the admin's setting. */
  gameAccess(): GameAccess {
    return this.cfg.gameAccess ?? this.store.settings.gameAccess;
  }

  /** Whether `wallet` holds an Elymum NFT (cached 60 s; false without an NFT or a chain). */
  async isHolder(wallet: string | null | undefined): Promise<boolean> {
    return !!wallet && !!this.ext.mint && (await this.ext.mint.isHolder(wallet));
  }

  /** Whether `wallet` may enter game rooms: admins always; NFT holders in `holders` mode; everyone in `public`. */
  async gameOpenFor(wallet: string | null | undefined): Promise<boolean> {
    const mode = this.gameAccess();
    if (mode === 'public' || this.isAdmin(wallet)) return true;
    if (mode === 'holders') return this.isHolder(wallet);
    return false;
  }

  /** The settings everyone can read; `gameAccess` is the effective value. */
  publicSettings(): SiteSettings {
    return { ...this.store.settings, gameAccess: this.gameAccess() };
  }

  private baseUrl(req: IncomingMessage): string {
    return this.ext.baseUrl?.(req) ?? this.cfg.publicUrl ?? `http://localhost:${this.cfg.port}`;
  }

  private chainId(): number | null {
    return this.ext.chain?.status().chainId ?? null;
  }

  /** Handles the request when the path is the site's; false otherwise. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL, ip: string): Promise<boolean> {
    const path = url.pathname;
    const mine =
      path.startsWith('/api/site/') || path.startsWith('/api/admin/') || path.startsWith('/api/nft/') || path === '/api/auth/login' || path === '/api/auth/me' || path === '/api/profile';
    if (!mine) return false;
    try {
      if (path === '/api/auth/login' || path === '/api/auth/me') await this.authRoutes(req, res, path, ip);
      else if (path === '/api/profile') await this.profileRoutes(req, res, ip);
      else if (path.startsWith('/api/nft/')) await this.nftRoutes(req, res, url);
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
      const [holder, canPlay] = await Promise.all([this.isHolder(wallet), this.gameOpenFor(wallet)]);
      return send(res, 200, { address: wallet, admin: this.isAdmin(wallet), holder, canPlay });
    }
    this.method(req, 'POST');
    if (!this.limits.login.allow(ip)) throw new SiteFail(429, 'rate_limited', 'Too many sign-ins. Wait a moment.');
    const body = await readJson(req);
    const { address, message, signature } = body;
    const wallet =
      typeof address === 'string' && typeof message === 'string' && typeof signature === 'string' ? await this.auth.verifySignature(address, message, signature) : null;
    if (!wallet) throw new SiteFail(401, 'auth_failed', 'Wallet sign-in failed. Please sign again.');
    send(res, 200, { address: wallet, token: this.auth.issueToken(wallet), admin: this.isAdmin(wallet) });
  }

  /** `GET /api/profile` and `PUT /api/profile {name, skin}` (signed-in). */
  private async profileRoutes(req: IncomingMessage, res: ServerResponse, ip: string): Promise<void> {
    const profiles = this.ext.profiles;
    if (!profiles) throw new SiteFail(404, 'not_found', 'Not found');
    if (this.method(req, 'GET', 'PUT') === 'GET') return send(res, 200, { profile: profiles.view(this.session(req)) });
    const wallet = this.writer(req, ip);
    try {
      return send(res, 200, { profile: profiles.update(wallet, await readJson(req)) });
    } catch (err) {
      if (err instanceof ProfileError) throw new SiteFail(400, 'bad_request', err.message, err.field);
      throw err;
    }
  }

  /** `GET /api/nft/contract`, `/api/nft/<id>` (JSON) and `/api/nft/<id>.svg`: minted ids only. */
  private async nftRoutes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    this.method(req, 'GET');
    const mint = this.ext.mint;
    const rest = url.pathname.slice('/api/nft/'.length);
    if (!mint) throw new SiteFail(404, 'not_found', 'Not found');
    const base = this.baseUrl(req);
    if (rest === 'contract') return send(res, 200, await mint.contractMetadata(base));
    const parsed = parseNftPath(rest);
    if (!parsed || !(await mint.minted(parsed.id))) throw new SiteFail(404, 'not_found', 'No such token');
    if (parsed.svg) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
      res.end(emblemSvg(parsed.id));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
    res.end(JSON.stringify(mint.metadata(parsed.id, base)));
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
      case 'contracts':
        if (seg.length !== 1) break;
        this.method(req, 'GET');
        return send(res, 200, this.ext.contracts?.effective(this.chainId()) ?? { arena: null, nft: null, token: null });
      case 'mint': {
        const mint = this.ext.mint;
        if (seg.length === 1) {
          this.method(req, 'GET');
          if (!mint) throw new SiteFail(503, 'chain_off', 'The mint is not available on this server.');
          return send(res, 200, await mint.publicState(this.gameAccess()));
        }
        if (seg.length === 2 && seg[1] === 'proof') {
          this.method(req, 'GET');
          if (!mint) throw new SiteFail(503, 'chain_off', 'The mint is not available on this server.');
          return send(res, 200, await mint.proof(url.searchParams.get('wallet')));
        }
        break;
      }
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
        return send(res, 200, { address: wallet, admin: true });
      case 'contracts': {
        if (seg.length !== 1) break;
        const contracts = this.ext.contracts;
        if (!contracts) throw new SiteFail(503, 'chain_off', 'The contracts registry is not available on this server.');
        const m = this.method(req, 'GET', 'POST', 'DELETE');
        if (m === 'GET') return send(res, 200, { registry: contracts.effective(this.chainId()), stored: contracts.stored() });
        if (m === 'DELETE') {
          const cleared = clearContract({ journal: this.ext.journal ?? null, store: contracts }, q.get('kind'));
          return send(res, 200, { cleared, registry: contracts.effective(this.chainId()) });
        }
        const chain = this.ext.chain;
        const record = await registerContract(
          {
            client: chain?.evm?.() ?? null,
            chainId: this.chainId(),
            serverKey: chain?.serverInfo().address ?? null,
            journal: this.ext.journal ?? null,
            store: contracts,
            now: Date.now(),
          },
          await readJson(req),
          wallet,
        );
        return send(res, 201, { record, registry: contracts.effective(this.chainId()) });
      }
      case 'mint': {
        const mint = this.ext.mint;
        if (!mint) throw new SiteFail(503, 'chain_off', 'The mint is not available on this server.');
        if (seg.length === 2 && seg[1] === 'allowlist') {
          if (this.method(req, 'GET', 'POST') === 'GET') return send(res, 200, await mint.allowlistStatus());
          return send(res, 201, mint.buildAllowlist(wallet));
        }
        if (seg.length === 2 && seg[1] === 'price') {
          this.method(req, 'GET');
          const quote = await mint.priceQuote();
          if (quote.hypeUsd === null) throw new SiteFail(502, 'price_unavailable', 'The HYPE/USD price feed is unavailable right now.');
          return send(res, 200, quote);
        }
        break;
      }
      case 'counts':
        this.method(req, 'GET');
        return send(res, 200, s.counts());
      case 'integrity':
        if (!this.integrity) break;
        return integrityRoutes(
          this.integrity,
          { send, sendCsv, method: (r, ...m) => this.method(r, ...m), readJson: (r) => readJson(r) },
          req,
          res,
          seg.slice(1),
          q,
          wallet,
        );
      case 'settings':
        if (seg.length !== 1) break;
        if (this.method(req, 'GET', 'PUT') === 'PUT') s.updateSettings(await readJson(req));
        return send(res, 200, { settings: s.settings, gameAccessEnv: this.cfg.gameAccess });
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
        return sendCsv(res, `elymum-wl-${scope}-${day}.csv`, s.wlCsv(scope));
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
          return sendCsv(res, `elymum-collab-wallets-${day}.csv`, s.allCollabsCsv());
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
            return sendCsv(res, `elymum-collab-${id}-${day}.csv`, s.collabCsv(id));
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
