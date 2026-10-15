import type { Server } from 'node:http';
import { join } from 'node:path';
import { Auth } from './auth';
import { assertDevFakeChainAllowed, createChain, dataFileNames } from './chain';
import type { ChainGateway } from './chain/types';
import type { ServerConfig } from './config';
import { createHttpServer } from './http';
import { Leaderboards } from './leaderboards';
import { Gateway } from './net/gateway';
import { RoomManager } from './rooms/manager';
import { Journal } from './stake/journal';

export interface App {
  server: Server;
  rooms: RoomManager;
  chain: ChainGateway;
  journal: Journal;
  auth: Auth;
  leaderboards: Leaderboards;
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
  } = {},
): Promise<App> {
  const log = opts.log ?? ((m: string) => console.log(`[${new Date().toISOString()}] ${m}`));
  const persist = opts.persist ?? true;
  // refuse a misconfigured DEV_FAKE_CHAIN before any file is opened
  assertDevFakeChainAllowed(cfg);
  const files = dataFileNames(cfg);
  const journal = new Journal(persist ? join(cfg.dataDir, files.journal) : null, log);
  const recovered = journal.recoverLive();
  if (recovered > 0) log(`journal: ${recovered} stake player(s) were alive at last shutdown → queued auto cash-out`);
  if (journal.pending.length > 0) log(`journal: ${journal.pending.length} settlement(s) pending`);

  const leaderboards = new Leaderboards(persist ? join(cfg.dataDir, files.leaderboards) : null);
  const chain = opts.chain ?? (await createChain(cfg, journal, log));
  const auth = new Auth(cfg.authSecret);

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
  await chain.start();
  await rooms.ensureArenaRooms();

  if (chain.passStatus() && !cfg.publicUrl) {
    log('pass: PUBLIC_URL is not set — Pass metadata image links come from the request host (set PUBLIC_URL in production)');
  }
  const server = createHttpServer(cfg, { rooms, leaderboards, chain, auth, journal, startedAt: Date.now() });
  const gateway = new Gateway(cfg, rooms, auth, chain, journal, log);
  gateway.attach(server);
  const flushTimer = setInterval(() => leaderboards.flush(), 30_000);
  flushTimer.unref();
  // arenas created (or a chain that came online) after startup show up in the lobby without a restart
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
