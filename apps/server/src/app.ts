import type { Server } from 'node:http';
import { join } from 'node:path';
import { Auth } from './auth';
import { assertDevFakeChainAllowed, createChain, dataFileNames } from './chain';
import { PriceKeeper } from './chain/price-keeper';
import type { ChainGateway } from './chain/types';
import type { ServerConfig } from './config';
import { createHttpServer, publicBaseUrl } from './http';
import { IntegrityService } from './integrity/service';
import { IntegrityStore } from './integrity/store';
import { Leaderboards } from './leaderboards';
import type { Limiter } from './net/limiter';
import { Gateway } from './net/gateway';
import { BotSettingsStore, defaultBotSettings } from './bots/settings';
import { RoomManager } from './rooms/manager';
import { ProfileStore } from './profiles';
import { ContractsStore } from './site/contracts';
import { MintService, hyperliquidPrice, type PriceFetcher } from './site/mint';
import { SiteApi, type SiteLimits } from './site/routes';
import { SiteStore } from './site/store';
import { Journal } from './stake/journal';

export interface App {
  server: Server;
  rooms: RoomManager;
  chain: ChainGateway;
  journal: Journal;
  auth: Auth;
  leaderboards: Leaderboards;
  /** The site: settings, WL tasks and entries, collabs, mint, contracts registry, admin API, game gate. */
  site: SiteApi;
  /** Player profiles (names, skins, stats): `DATA_DIR/profiles.json`. */
  profiles: ProfileStore;
  /** The contracts registry: `DATA_DIR/contracts.json` (plus `ARENA_ADDRESS` / `NFT_ADDRESS`). */
  contracts: ContractsStore;
  /** The NFT mint: state, HYPE/USD, holders, allowlist, metadata. */
  mint: MintService;
  /** Keeps the mint price at $1 in HYPE when the server key is the NFT's price keeper; null without a chain. */
  priceKeeper: PriceKeeper | null;
  /** Cheat and collusion detection: telemetry, flags, bans, auto-hold (`/api/admin/integrity/*`). */
  integrity: IntegrityService;
  /** Resolves once the HTTP server is listening; returns the bound port. */
  listen(): Promise<number>;
  close(): Promise<void>;
}

export async function createApp(
  cfg: ServerConfig,
  opts: {
    chain?: ChainGateway;
    log?: (m: string) => void;
    persist?: boolean;
    /** Wall clock for the arena rounds (Unix ms); tests inject one. Defaults to `Date.now`. */
    now?: () => number;
    /** Wall clock of the site store (collab deadlines); tests inject one. Defaults to `Date.now`. */
    siteNow?: () => number;
    /** Rate limiters of the site API; tests inject small ones. */
    siteLimits?: SiteLimits;
    /** The per-IP limiter of every `/api/*` request; tests inject a larger one. */
    apiLimiter?: Limiter;
    /** HYPE/USD feed (default: Hyperliquid at `HYPE_PRICE_URL`); tests inject one. */
    fetchPrice?: PriceFetcher;
  } = {},
): Promise<App> {
  const log = opts.log ?? ((m: string) => console.log(`[${new Date().toISOString()}] ${m}`));
  const persist = opts.persist ?? true;
  // refuse a misconfigured DEV_FAKE_CHAIN before any file is opened
  assertDevFakeChainAllowed(cfg);
  const files = dataFileNames(cfg);
  const journal = new Journal(persist ? join(cfg.dataDir, files.journal) : null, log);
  const recovered = journal.recoverLive();
  if (recovered > 0) log(`journal: ${recovered} stake player(s) were alive at last shutdown → queued automatic payout`);
  if (journal.pending.length > 0) log(`journal: ${journal.pending.length} settlement(s) pending`);

  const leaderboards = new Leaderboards(persist ? join(cfg.dataDir, files.leaderboards) : null);
  if (cfg.adminWallets.length === 0) {
    log('!!! ADMIN_WALLETS is not set: NOBODY is admin (/admin and /api/admin/* refuse everyone). Set it to the owner\'s 0x address.');
  }
  const contracts = new ContractsStore(persist ? cfg.dataDir : null, { arena: cfg.chain.arenaAddress, nft: cfg.chain.nftAddress }, log);
  const chain = opts.chain ?? (await createChain(cfg, journal, log, { contracts: () => contracts.view() }));
  // a newly registered (or cleared) contract is picked up at once, without a restart
  contracts.onChange(() => void chain.refresh?.());
  const auth = new Auth(cfg.authSecret, { onChain: chain.verifyMessage ? (a, m, sig) => chain.verifyMessage!(a, m, sig) : null });
  const profiles = new ProfileStore(persist ? join(cfg.dataDir, files.profiles) : null, log);
  const siteStore = new SiteStore(persist ? cfg.dataDir : null, { now: opts.siteNow, log });
  const fetchPrice = opts.fetchPrice ?? hyperliquidPrice(cfg.mint.hypePriceUrl);
  const nftRecord = () => {
    const r = contracts.effective(null).nft;
    return r ? { address: r.address, txHash: r.txHash } : null;
  };
  const mint = new MintService({
    store: siteStore,
    client: () => chain.evm?.() ?? null,
    nft: nftRecord,
    chainId: () => chain.status().chainId,
    dataDir: persist ? cfg.dataDir : null,
    usdCents: cfg.mint.usdCents,
    fetchPrice,
    logChunkBlocks: cfg.chain.logChunkBlocks,
    log,
  });
  const site = new SiteApi(cfg, auth, siteStore, opts.siteLimits, {
    chain,
    contracts,
    mint,
    profiles,
    journal,
    baseUrl: (req) => publicBaseUrl(cfg, req),
  });
  const priceKeeper = chain.evm
    ? new PriceKeeper({ client: () => chain.evm?.() ?? null, nft: () => nftRecord()?.address ?? null, usdCents: cfg.mint.usdCents, fetchPrice, log })
    : null;
  // integrity data lives next to the journal; the fake chain keeps its own directory
  const integrityDir = persist ? join(cfg.dataDir, cfg.devFakeChain ? 'integrity.dev-fake' : 'integrity') : null;
  const integrity = new IntegrityService({
    store: new IntegrityStore(integrityDir, { log }),
    journal,
    kick: () => chain.kick(),
    log,
  });
  site.setIntegrity(integrity);
  const held = journal.held().length;
  if (held > 0) log(`integrity: ${held} settlement(s) held for admin review (/admin → Integrity)`);

  const rooms = new RoomManager(
    cfg,
    {
      chain,
      journal,
      leaderboards,
      log,
      now: opts.now,
      integrity,
      // the server's own records: every finished game of a signed-in wallet counts in its profile
      onGameOver: (e) => {
        const wallet = e.conn?.wallet;
        if (!wallet) return;
        const xp = profiles.recordGame(wallet, { score: e.stats.maxMass, kills: e.stats.playersEaten, xp: e.stats.xp ?? 0 });
        const level = profiles.level(wallet);
        if (e.conn!.profile) e.conn!.profile = { ...e.conn!.profile, xp, level };
        e.conn!.send({ t: 'xp', xp, level });
      },
    },
    chain,
    // the admin's bot settings (DATA_DIR/site/bots.json; the BOT_* env vars are the defaults), applied live
    new BotSettingsStore(persist ? cfg.dataDir : null, defaultBotSettings(cfg.bots), log),
  );
  site.setBots({ store: rooms.botSettings, live: () => rooms.botCounts(), chainId: () => chain.status().chainId, log });
  chain.setLiveSessionProvider(() => rooms.liveSessions());
  // the game token was set on chain (picked up by the 30 s config watcher, no restart): attach the
  // arenas now (a fresh read of the arena list) instead of waiting for the next arena timer
  chain.onStatusChange(() => {
    if (chain.tokenReady) void rooms.refreshArenas();
  });
  await chain.start();
  await rooms.ensureArenaRooms();

  const server = createHttpServer(cfg, { rooms, leaderboards, chain, auth, journal, site, priceKeeper, apiLimiter: opts.apiLimiter, startedAt: Date.now(), log });
  const gateway = new Gateway(cfg, rooms, auth, chain, journal, log);
  gateway.setProfiles(profiles);
  // who may play: `gameAccess` (setting) or `GAME_ACCESS`: admins, NFT holders + admins, or everyone
  gateway.setGameGate((wallet, fresh) => site.gameOpenFor(wallet, fresh));
  // wallets the admin banned after an integrity review cannot start arena games (practice still works)
  gateway.setBanGate((wallet) => integrity.isBanned(wallet));
  integrity.start();
  priceKeeper?.start();
  gateway.attach(server);
  const flushTimer = setInterval(() => leaderboards.flush(), 30_000);
  flushTimer.unref();
  // arenas created (or a chain / token that came online) after startup show up in the lobby without a restart
  const arenaTimer = setInterval(() => void rooms.ensureArenaRooms(), 30_000);
  arenaTimer.unref();

  let closed = false;
  return {
    server,
    rooms,
    chain,
    journal,
    auth,
    leaderboards,
    site,
    profiles,
    contracts,
    mint,
    priceKeeper,
    integrity,
    listen: () =>
      new Promise((resolve) => {
        server.listen(cfg.port, cfg.host, () => {
          rooms.start();
          const addr = server.address();
          resolve(typeof addr === 'object' && addr ? addr.port : cfg.port);
        });
      }),
    close: async () => {
      if (closed) return;
      closed = true;
      clearInterval(flushTimer);
      clearInterval(arenaTimer);
      rooms.shutdown();
      integrity.close();
      priceKeeper?.stop();
      leaderboards.flush();
      profiles.flush();
      gateway.close();
      await chain.stop().catch(() => {});
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
