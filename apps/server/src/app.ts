import type { Server } from 'node:http';
import { join } from 'node:path';
import { Auth } from './auth';
import { assertDevFakeChainAllowed, createChain, dataFileNames } from './chain';
import type { ChainGateway } from './chain/types';
import type { ServerConfig } from './config';
import { createHttpServer } from './http';
import { Leaderboards } from './leaderboards';
import type { Limiter } from './net/limiter';
import { Gateway } from './net/gateway';
import { RoomManager } from './rooms/manager';
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
  /** The slana.io site: settings, WL tasks and entries, collabs, admin API, game gate. */
  site: SiteApi;
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
  const chain = opts.chain ?? (await createChain(cfg, journal, log));
  const auth = new Auth(cfg.authSecret);
  const siteStore = new SiteStore(persist ? cfg.dataDir : null, { now: opts.siteNow, log });
  const site = new SiteApi(cfg, auth, siteStore, opts.siteLimits);

  const rooms = new RoomManager(
    cfg,
    {
      chain,
      journal,
      leaderboards,
      log,
      now: opts.now,
    },
    chain,
  );
  chain.setLiveSessionProvider(() => rooms.liveSessions());
  // the game token was set on chain (picked up by the 30 s config watcher, no restart): attach the
  // arenas now (a fresh read of the arena list) instead of waiting for the next arena timer
  chain.onStatusChange(() => {
    if (chain.tokenReady) void rooms.refreshArenas();
  });
  await chain.start();
  await rooms.ensureArenaRooms();

  const server = createHttpServer(cfg, { rooms, leaderboards, chain, auth, journal, site, apiLimiter: opts.apiLimiter, startedAt: Date.now() });
  const gateway = new Gateway(cfg, rooms, auth, chain, journal, log);
  // the game is admin-only until `gamePublic` (setting) or `GAME_PUBLIC=1`: every room entry asks
  gateway.setGameGate((wallet) => site.gameOpenFor(wallet));
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
      leaderboards.flush();
      gateway.close();
      await chain.stop().catch(() => {});
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
