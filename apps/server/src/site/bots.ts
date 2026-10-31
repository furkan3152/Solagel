import type { IncomingMessage, ServerResponse } from 'node:http';
import { ELYSIUM_TESTNET_CHAIN_ID } from '@elymum/shared';
import { BOT_ROOM_KINDS, BotSettingsError, type BotRoomKind, type BotSettings, type BotSettingsStore } from '../bots/settings';
import { SiteFail } from './validate';

/** One room's live bot numbers. */
export interface BotRoomCount {
  id: string;
  kind: BotRoomKind;
  name: string;
  arenaId?: number;
  humans: number;
  bots: number;
  stakedBots: number;
}

/** What `/api/admin/bots` needs: the settings and the rooms' live counts. */
export interface BotAdmin {
  store: BotSettingsStore;
  live: () => BotRoomCount[];
  /** The server chain's id (null while off): staked bots play on Elysium Testnet only. */
  chainId: () => number | null;
  /** A staked-bot source is plugged in (the testnet bot wallets run). */
  stakedSource?: () => boolean;
  log?: (m: string) => void;
}

interface KindTotals {
  rooms: number;
  humans: number;
  bots: number;
  stakedBots: number;
}

/** The body of `GET` and `PUT /api/admin/bots`. */
export interface BotAdminView {
  settings: BotSettings;
  /** The env defaults (`BOT_*` env vars) the settings started from. */
  defaults: BotSettings;
  /** The chain is Elysium Testnet: arenas may field staked bots. */
  testnet: boolean;
  /** Staked bots really run (testnet and a staked-bot source is plugged in). */
  stakedActive: boolean;
  live: {
    rooms: BotRoomCount[];
    byKind: Record<BotRoomKind, KindTotals>;
    totals: KindTotals;
  };
}

export function botAdminView(a: BotAdmin): BotAdminView {
  const rooms = a.live();
  const zero = (): KindTotals => ({ rooms: 0, humans: 0, bots: 0, stakedBots: 0 });
  const byKind = Object.fromEntries(BOT_ROOM_KINDS.map((k) => [k, zero()])) as Record<BotRoomKind, KindTotals>;
  const totals = zero();
  for (const r of rooms) {
    for (const t of [byKind[r.kind], totals]) {
      t.rooms++;
      t.humans += r.humans;
      t.bots += r.bots;
      t.stakedBots += r.stakedBots;
    }
  }
  const testnet = a.chainId() === ELYSIUM_TESTNET_CHAIN_ID;
  return {
    settings: a.store.settings,
    defaults: structuredClone(a.store.defaults),
    testnet,
    stakedActive: testnet && (a.stakedSource?.() ?? false),
    live: { rooms, byKind, totals },
  };
}

/**
 * `GET /api/admin/bots` (settings + live counts) and `PUT /api/admin/bots` (a partial update,
 * stored in `DATA_DIR/site/bots.json` and applied to every room at once). The caller checked
 * that the session is an admin.
 */
export async function botRoutes(
  a: BotAdmin,
  h: {
    send: (res: ServerResponse, status: number, body: unknown) => void;
    method: (req: IncomingMessage, ...allowed: string[]) => string;
    readJson: (req: IncomingMessage) => Promise<Record<string, unknown>>;
  },
  req: IncomingMessage,
  res: ServerResponse,
  wallet: string,
): Promise<void> {
  if (h.method(req, 'GET', 'PUT') === 'PUT') {
    const body = await h.readJson(req);
    try {
      a.store.update(body);
    } catch (err) {
      if (err instanceof BotSettingsError) throw new SiteFail(400, 'bad_request', err.message, err.field);
      throw err;
    }
    a.log?.(`bots: settings updated by ${wallet}`);
  }
  h.send(res, 200, botAdminView(a));
}
