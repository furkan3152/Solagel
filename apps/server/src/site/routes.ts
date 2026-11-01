import type { IncomingMessage, ServerResponse } from 'node:http';
import { AVATAR_LIMITS, AVATAR_TYPES, BASIC_SKINS, EMBLEM_SKIN_ID, SITE_LIMITS, isAvatarId, type GameAccess, type ProfileResponse, type SiteError, type SiteSettings } from '@elymum/shared';
import { checksumAddress, type Auth } from '../auth';
import { AvatarError, avatarIdOf, sanitizeAvatar, type AvatarStore } from '../avatars';
import type { ChainGateway } from '../chain/types';
import { integrityRoutes } from '../integrity/routes';
import type { IntegrityService } from '../integrity/service';
import type { ServerConfig } from '../config';
import { Limiter } from '../net/limiter';
import { ProfileError, type ProfileStore } from '../profiles';
import type { Journal } from '../stake/journal';
import type { HolderReader } from '../chain/evm-client';
import { ShopFail, type ShopService } from '../shop/service';
import { ShopSettingsError, type ShopSettingsStore } from '../shop/settings';
import type { BoostInventory } from '../shop/inventory';
import { botRoutes, type BotAdmin } from './bots';
import { customRoomAdminRoutes, customRoomRoutes } from './custom-rooms';
import type { CustomRoomService } from '../rooms/custom';
import { importHolders, type HolderWlStore } from './holder-wl';
import { FaucetInfo, networkInfo } from './network';
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
  /** Public base URL (`PUBLIC_URL`; the request host only in development): NFT metadata links. */
  baseUrl?: (req: IncomingMessage) => string;
  /** `DATA_DIR` (the chain-keyed state under `chains/`); null: memory only. */
  dataDir?: string | null;
  /** Imported testnet emblem holders (`site/holder-wl.json`). */
  holderWl?: HolderWlStore;
  /** The NFT registered on a chain (its chain-keyed registry). */
  nftOf?: (chainId: number) => { address: string; txHash: string | null } | null;
  /** A holder reader on a chain (the server's client, or `TESTNET_RPC_URL`). */
  holderReaderFor?: (chainId: number) => HolderReader | null;
  /** The TestToken faucet settings (`GET /api/site/faucet`). */
  faucet?: FaucetInfo;
  /** Profile pictures (`/api/profile/avatar`, `/api/avatar/<id>`, `/api/admin/avatars`). */
  avatars?: AvatarStore;
  log?: (m: string) => void;
}

export interface SiteLimits {
  /** Writes to `/api/site/*` per IP. */
  writeIp: Limiter;
  /** Writes to `/api/site/*` per signed-in wallet. */
  writeWallet: Limiter;
  /** `POST /api/auth/login` per IP. */
  login: Limiter;
  /** Picture uploads per IP (default 20 an hour). */
  avatarIp?: Limiter;
  /** Picture uploads per signed-in wallet (default 6 an hour). */
  avatarWallet?: Limiter;
}

export const defaultSiteLimits = (): SiteLimits => ({
  writeIp: new Limiter(60, 10 * 60_000),
  writeWallet: new Limiter(20, 10 * 60_000),
  login: new Limiter(20, 60_000),
  avatarIp: new Limiter(20, 60 * 60_000),
  avatarWallet: new Limiter(6, 60 * 60_000),
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

/** Reads a raw body of at most `limit` bytes. */
export async function readRaw(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw new SiteFail(413, 'body_too_large', `The body is larger than ${limit} bytes`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new SiteFail(413, 'body_too_large', `The body is larger than ${limit} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
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
  /** Bot settings and live counts (`/api/admin/bots`); absent in bare unit tests. */
  private bots: BotAdmin | null = null;
  /** Custom rooms (`/api/rooms/custom/*`, `/api/admin/custom-rooms`); absent in bare unit tests. */
  private customRooms: CustomRoomService | null = null;
  /** The power-up shop (`/api/shop`, `/api/shop/buy`, `/api/admin/shop`); absent in bare unit tests. */
  private shop: { service: ShopService; settings: ShopSettingsStore; inventory: BoostInventory } | null = null;
  private readonly shopBuys = new Limiter(30, 60_000);
  /** Told when a wallet's picture is removed or replaced (live rooms drop it from the coin). */
  private avatarChanged: ((wallet: string) => void) | null = null;
  private readonly avatarIp: Limiter;
  private readonly avatarWallet: Limiter;

  constructor(
    private readonly cfg: ServerConfig,
    private readonly auth: Auth,
    readonly store: SiteStore,
    private readonly limits: SiteLimits = defaultSiteLimits(),
    private readonly ext: SiteExtras = {},
  ) {
    this.admins = new Set(cfg.adminWallets.map((w) => w.toLowerCase()));
    this.avatarIp = limits.avatarIp ?? new Limiter(20, 60 * 60_000);
    this.avatarWallet = limits.avatarWallet ?? new Limiter(6, 60 * 60_000);
  }

  /** `fn(wallet)`: the wallet's picture was removed or replaced (the rooms take it off live coins). */
  onAvatarChange(fn: ((wallet: string) => void) | null): void {
    this.avatarChanged = fn;
  }

  setIntegrity(svc: IntegrityService | null): void {
    this.integrity = svc;
  }

  setBots(admin: BotAdmin | null): void {
    this.bots = admin;
  }

  setCustomRooms(svc: CustomRoomService | null): void {
    this.customRooms = svc;
  }

  setShop(shop: { service: ShopService; settings: ShopSettingsStore; inventory: BoostInventory } | null): void {
    this.shop = shop;
  }

  /** Admin wallets compare case-insensitively (stored checksummed). */
  isAdmin(wallet: string | null | undefined): boolean {
    return !!wallet && this.admins.has(wallet.toLowerCase());
  }

  /** Who may play: `GAME_ACCESS` when set, else the admin's setting. */
  gameAccess(): GameAccess {
    return this.cfg.gameAccess ?? this.store.settings.gameAccess;
  }

  /** Whether `wallet` holds an Elymum NFT (cached 15 s, `fresh` re-reads; false without an NFT or a chain). */
  async isHolder(wallet: string | null | undefined, fresh = false): Promise<boolean> {
    return !!wallet && !!this.ext.mint && (await this.ext.mint.isHolder(wallet, fresh));
  }

  /**
   * Whether `wallet` may enter game rooms: admins always; NFT holders in `holders` mode; everyone in `public`.
   * `fresh`: the holder check skips its 15 s cache (the gateway asks so right before seating an arena ticket).
   */
  async gameOpenFor(wallet: string | null | undefined, fresh = false): Promise<boolean> {
    const mode = this.gameAccess();
    if (mode === 'public' || this.isAdmin(wallet)) return true;
    if (mode === 'holders') return this.isHolder(wallet, fresh);
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
      path.startsWith('/api/site/') ||
      path.startsWith('/api/admin/') ||
      path.startsWith('/api/nft/') ||
      path.startsWith('/api/avatar/') ||
      path === '/api/auth/login' ||
      path === '/api/auth/me' ||
      path === '/api/profile' ||
      path === '/api/profile/avatar' ||
      path === '/api/rooms/custom' ||
      path.startsWith('/api/rooms/custom/') ||
      path === '/api/shop' ||
      path === '/api/shop/buy';
    if (!mine) return false;
    try {
      if (path === '/api/auth/login' || path === '/api/auth/me') await this.authRoutes(req, res, path, ip);
      else if (path === '/api/profile') await this.profileRoutes(req, res, ip);
      else if (path === '/api/profile/avatar') await this.uploadRoutes(req, res, ip);
      else if (path === '/api/shop' || path === '/api/shop/buy') await this.shopRoutes(req, res, path, ip);
      else if (path.startsWith('/api/avatar/')) this.serveAvatar(req, res, path.slice('/api/avatar/'.length));
      else if (path.startsWith('/api/nft/')) await this.nftRoutes(req, res, url);
      else if (path.startsWith('/api/site/')) await this.siteRoutes(req, res, url, ip);
      else if (path.startsWith('/api/rooms/custom')) await this.customRoutes(req, res, path, ip);
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

  /**
   * `GET /api/shop` (the packs priced for the signed-in wallet, public prices without a session) and
   * `POST /api/shop/buy {kind, txHash}` (signed-in): verifies the game-token payment on chain and
   * credits the pack. Refusals answer `{ error: ShopBuyError, message }`.
   */
  private async shopRoutes(req: IncomingMessage, res: ServerResponse, path: string, ip: string): Promise<void> {
    const shop = this.shop;
    if (!shop) throw new SiteFail(404, 'not_found', 'Not found');
    if (path === '/api/shop') {
      this.method(req, 'GET');
      return send(res, 200, await shop.service.view(bearerWallet(this.auth, req)));
    }
    this.method(req, 'POST');
    const wallet = this.session(req);
    if (!this.shopBuys.allow(wallet) || !this.shopBuys.allow(`ip:${ip}`)) throw new SiteFail(429, 'rate_limited', 'Too many purchases at once. Wait a moment.');
    const body = await readJson(req);
    try {
      return send(res, 200, await shop.service.buy(wallet, body));
    } catch (err) {
      if (err instanceof ShopFail) return send(res, err.status, { error: err.code, message: err.message });
      throw err;
    }
  }

  /** Skin ids a wallet may pick: the basic skins, plus the emblem skin for holders. */
  private skinOptions(holder: boolean): number[] {
    return [...BASIC_SKINS.map((s) => s.id), ...(holder ? [EMBLEM_SKIN_ID] : [])];
  }

  /** `GET /api/profile` and `PUT /api/profile {name, skin}` (signed-in): `{ profile, skinOptions, holder }`. */
  private async profileRoutes(req: IncomingMessage, res: ServerResponse, ip: string): Promise<void> {
    const profiles = this.ext.profiles;
    if (!profiles) throw new SiteFail(404, 'not_found', 'Not found');
    if (this.method(req, 'GET', 'PUT') === 'GET') {
      const wallet = this.session(req);
      const holder = await this.isHolder(wallet);
      return send(res, 200, { profile: profiles.view(wallet), skinOptions: this.skinOptions(holder), holder } satisfies ProfileResponse);
    }
    const wallet = this.writer(req, ip);
    const body = await readJson(req);
    // the emblem skin is checked on chain right now (a sold emblem no longer unlocks it)
    const holder = await this.isHolder(wallet, body.skin === EMBLEM_SKIN_ID);
    try {
      return send(res, 200, { profile: profiles.update(wallet, body, { emblem: holder }), skinOptions: this.skinOptions(holder), holder } satisfies ProfileResponse);
    } catch (err) {
      if (err instanceof ProfileError) throw new SiteFail(400, 'bad_request', err.message, err.field);
      throw err;
    }
  }

  /**
   * `POST /api/profile/avatar` (raw `image/png` or `image/webp` body, at most `AVATAR_LIMITS.maxBytes`,
   * signed-in): stores the cleaned picture as the wallet's; `DELETE` removes it. Both answer `{ profile }`.
   */
  private async uploadRoutes(req: IncomingMessage, res: ServerResponse, ip: string): Promise<void> {
    const profiles = this.ext.profiles;
    const store = this.ext.avatars;
    if (!profiles || !store) throw new SiteFail(404, 'not_found', 'Not found');
    if (this.method(req, 'POST', 'DELETE') === 'DELETE') {
      const wallet = this.writer(req, ip);
      this.dropAvatar(wallet, false);
      return send(res, 200, { profile: profiles.view(wallet) });
    }
    if (!this.avatarIp.allow(ip)) throw new SiteFail(429, 'rate_limited', 'Too many pictures. Try again in an hour.');
    const wallet = this.session(req);
    const type = String(req.headers['content-type'] ?? '').toLowerCase().split(';')[0].trim();
    if (!(AVATAR_TYPES as readonly string[]).includes(type)) throw new SiteFail(415, 'unsupported_media_type', 'Send the picture as image/webp or image/png');
    if (!this.avatarWallet.allow(wallet)) throw new SiteFail(429, 'rate_limited', 'Too many pictures. Try again in an hour.');
    const body = await readRaw(req, AVATAR_LIMITS.maxBytes);
    let id: string;
    try {
      const clean = sanitizeAvatar(body);
      if (clean.type !== type) throw new AvatarError('bad_image', 'The picture does not match its content type');
      if (store.isBlocked(avatarIdOf(clean.bytes))) throw new SiteFail(403, 'image_blocked', 'This picture was removed by a moderator and cannot be used.');
      id = store.put(clean);
    } catch (err) {
      if (err instanceof AvatarError) throw new SiteFail(err.code === 'body_too_large' ? 413 : 400, err.code, err.message);
      throw err;
    }
    const before = profiles.setAvatar(wallet, id);
    if (before && before !== id) {
      if (profiles.avatarUsers(before) === 0) store.delete(before);
      this.avatarChanged?.(wallet);
    }
    return send(res, 201, { profile: profiles.view(wallet) });
  }

  /** Clears a wallet's picture; `block`: an admin removed it (the file goes and cannot come back). */
  private dropAvatar(wallet: string, block: boolean): string | null {
    const profiles = this.ext.profiles!;
    const store = this.ext.avatars!;
    const before = profiles.avatar(wallet);
    if (!before) return null;
    profiles.setAvatar(wallet, null);
    if (block) {
      // every profile wearing the same picture loses it too
      for (const e of profiles.avatars(Number.MAX_SAFE_INTEGER).items) {
        if (e.avatar !== before) continue;
        profiles.setAvatar(e.wallet, null);
        this.avatarChanged?.(e.wallet);
      }
      store.block(before);
    } else if (profiles.avatarUsers(before) === 0) store.delete(before);
    this.avatarChanged?.(wallet);
    return before;
  }

  /** `GET /api/avatar/<id>`: the picture file (immutable: an id is the hash of its bytes). */
  private serveAvatar(req: IncomingMessage, res: ServerResponse, id: string): void {
    this.method(req, 'GET', 'HEAD');
    const file = isAvatarId(id) ? this.ext.avatars?.get(id) : null;
    if (!file) throw new SiteFail(404, 'not_found', 'No such picture');
    res.writeHead(200, {
      'Content-Type': file.type,
      'Content-Length': file.bytes.length,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.end(req.method === 'HEAD' ? undefined : file.bytes);
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

  private async customRoutes(req: IncomingMessage, res: ServerResponse, path: string, ip: string): Promise<void> {
    const svc = this.customRooms;
    if (!svc) throw new SiteFail(404, 'not_found', 'Not found');
    const rest = path.slice('/api/rooms/custom'.length).replace(/^\//, '');
    return customRoomRoutes(
      svc,
      {
        send,
        method: (r, ...m) => this.method(r, ...m),
        readJson: (r) => readJson(r),
        wallet: (r) => bearerWallet(this.auth, r),
        writer: (r) => this.writer(r, ip),
        isAdmin: (w) => this.isAdmin(w),
        origin: (r) => this.baseUrl(r),
      },
      req,
      res,
      rest === '' ? [] : rest.split('/'),
    );
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
      case 'faucet': {
        if (seg.length !== 1) break;
        this.method(req, 'GET');
        const faucet = this.ext.faucet ?? (this.ext.chain ? new FaucetInfo({ chain: this.ext.chain, contracts: this.ext.contracts ?? null, hypeFaucetUrl: this.cfg.chain.hypeFaucetUrl }) : null);
        if (!faucet) throw new SiteFail(503, 'chain_off', 'The faucet is not available on this server.');
        return send(res, 200, await faucet.get());
      }
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
      case 'network': {
        if (seg.length !== 1 || !this.ext.chain) break;
        this.method(req, 'GET');
        return send(res, 200, await networkInfo({ chain: this.ext.chain, contracts: this.ext.contracts ?? null, dataDir: this.ext.dataDir ?? null }));
      }
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
        if (seg.length === 2 && seg[1] === 'import-holders') {
          const store = this.ext.holderWl;
          if (!store) throw new SiteFail(503, 'chain_off', 'Holder imports are not available on this server.');
          const onList = () => {
            const src = this.store.allowlistSources();
            const set = new Set([...src.wl, ...src.collab].map((w) => w.toLowerCase()));
            return (w: string) => set.has(w.toLowerCase());
          };
          if (this.method(req, 'GET', 'POST') === 'GET') return send(res, 200, store.view(onList()));
          await importHolders(
            {
              store,
              nftOf: (id) => this.ext.nftOf?.(id) ?? null,
              readerFor: (id) => this.ext.holderReaderFor?.(id) ?? null,
              chunkBlocks: this.cfg.chain.logChunkBlocks,
              now: Date.now(),
              log: this.ext.log,
            },
            await readJson(req),
            wallet,
          );
          return send(res, 201, store.view(onList()));
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
      case 'avatars': {
        // moderation of profile pictures: the list, newest first, and removal (the coin falls back to its basic skin)
        const profiles = this.ext.profiles;
        if (!profiles || !this.ext.avatars) break;
        if (seg.length === 1) {
          this.method(req, 'GET');
          return send(res, 200, profiles.avatars(Number(q.get('limit') ?? 200) || 200));
        }
        if (seg.length !== 2) break;
        this.method(req, 'DELETE');
        const target = checksumAddress(seg[1]);
        if (!target) throw new SiteFail(400, 'bad_request', 'Not a wallet address', 'wallet');
        const removed = this.dropAvatar(target, true);
        if (!removed) throw new SiteFail(404, 'not_found', 'This wallet has no picture');
        this.ext.log?.(`avatars: ${wallet} removed the picture ${removed} of ${target}`);
        return send(res, 200, { removed });
      }
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
      case 'custom-rooms':
        if (seg.length > 2 || !this.customRooms) break;
        return customRoomAdminRoutes(this.customRooms, { send, method: (r, ...m) => this.method(r, ...m), readJson: (r) => readJson(r) }, req, res, seg.slice(1), wallet);
      case 'bots':
        if (seg.length !== 1 || !this.bots) break;
        return botRoutes(this.bots, { send, method: (r, ...m) => this.method(r, ...m), readJson: (r) => readJson(r) }, req, res, wallet);
      case 'shop': {
        // power-up prices, the sink (burn or treasury), on/off per power-up and the arena limits; plus recent purchases
        const shop = this.shop;
        if (seg.length !== 1 || !shop) break;
        if (this.method(req, 'GET', 'PUT') === 'PUT') {
          try {
            shop.settings.update(await readJson(req));
          } catch (err) {
            if (err instanceof ShopSettingsError) throw new SiteFail(400, 'bad_request', err.message, err.field);
            throw err;
          }
          this.ext.log?.(`shop: settings updated by ${wallet}`);
        }
        return send(res, 200, {
          settings: shop.settings.settings,
          defaults: shop.settings.defaults,
          sink: shop.service.sink(),
          owner: this.cfg.adminWallets[0] ?? null,
          purchases: shop.inventory.recent(Number(q.get('limit') ?? 30) || 30),
          purchaseCount: shop.inventory.purchaseCount,
        });
      }
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
