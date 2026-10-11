import type { Server } from 'node:http';
import { join } from 'node:path';
import { Auth } from './auth';
import { createChain } from './chain';
import type { ChainGateway } from './chain/types';
import type { ServerConfig } from './config';
import { createHttpServer } from './http';
import { Leaderboards } from './leaderboards';
import { Gateway } from './net/gateway';
import { RoomManager } from './rooms/manager';
import { Journal } from './stake/journal';
import { AdminService } from './admin/service';
import { AdminStore, defaultSettings } from './admin/store';

export interface App {
  server: Server;
  rooms: RoomManager;
  chain: ChainGateway;
  journal: Journal;
  auth: Auth;
  leaderboards: Leaderboards;
  admin: AdminService;
  /** Resolves once the HTTP server is listening; returns the bound port. */
  listen(): Promise<number>;
  close(): Promise<void>;
}

export async function createApp(
  cfg: ServerConfig,
  opts: { chain?: ChainGateway; log?: (m: string) => void; persist?: boolean } = {},
): Promise<App> {
  const log = opts.log ?? ((m: string) => console.log(`[${new Date().toISOString()}] ${m}`));
  const persist = opts.persist ?? true;
  const journal = new Journal(persist ? join(cfg.dataDir, 'journal.json') : null, log);
  const recovered = journal.recoverLive();
  if (recovered > 0) log(`journal: ${recovered} stake player(s) were alive at last shutdown → queued auto cash-out`);
  if (journal.pending.length > 0) log(`journal: ${journal.pending.length} settlement(s) pending`);

  const leaderboards = new Leaderboards(persist ? join(cfg.dataDir, 'leaderboards.json') : null);
  const chain = opts.chain ?? (await createChain(cfg, journal, log));
  const auth = new Auth(cfg.authSecret);

  const lastRecord = new Map<string, number>();
  const rooms = new RoomManager(
    cfg,
    {
      chain,
      journal,
      leaderboards,
      recordMinScore: cfg.chain.recordMinScore,
      log,
      canRecord: (wallet) => {
        const now = Date.now();
        if (now - (lastRecord.get(wallet) ?? 0) < 30_000) return false;
        lastRecord.set(wallet, now);
        return true;
      },
    },
    chain,
  );
  chain.setLiveSessionProvider(() => rooms.liveSessions());
  await chain.start();
  await rooms.ensureStakeRooms();

  const adminStore = new AdminStore(persist ? join(cfg.dataDir, 'admin.json') : null, defaultSettings(cfg.bots),
    { cluster: cfg.chain.cluster, programId: cfg.chain.programId });
  const admin = new AdminService(cfg, { rooms, chain, journal, store: adminStore });

  const server = createHttpServer(cfg, { rooms, leaderboards, chain, auth, admin, startedAt: Date.now() });
  const gateway = new Gateway(cfg, rooms, auth, chain, journal, log);
  gateway.attach(server);
  const flushTimer = setInterval(() => leaderboards.flush(), 30_000);
  flushTimer.unref();
  // arenas created (or a chain that came online) after startup show up in the lobby without a restart
  const arenaTimer = setInterval(() => void rooms.ensureStakeRooms(), 30_000);
  arenaTimer.unref();

  let closed = false;
  return {
    server,
    rooms,
    chain,
    journal,
    auth,
    leaderboards,
    admin,
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
