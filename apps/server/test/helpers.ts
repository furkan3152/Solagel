import { roundAt, type ChainStatus, type ServerMessage } from '@elymum/shared';
import type { ChainArena, ChainGateway, ChainProfile, ChainSession } from '../src/chain/types';
import { Leaderboards } from '../src/leaderboards';
import { Conn } from '../src/net/conn';
import type { RoomDeps } from '../src/rooms/room';
import { Journal } from '../src/stake/journal';

export type TestConn = Conn & { msgs: ServerMessage[] };

export function fakeConn(wallet: string | null = null, ip = '127.0.0.1'): TestConn {
  const msgs: ServerMessage[] = [];
  const ws = {
    readyState: 1,
    bufferedAmount: 0,
    send(data: unknown) {
      if (typeof data === 'string') msgs.push(JSON.parse(data) as ServerMessage);
    },
  };
  const conn = new Conn(ws as never, ip) as TestConn;
  conn.msgs = msgs;
  conn.wallet = wallet;
  return conn;
}

/** A chain with stake arenas and nothing else. */
export class ArenaChain implements ChainGateway {
  readonly enabled = true;
  readonly tokenReady = true;
  readonly stakeEnabled = true;
  listCalls = 0;
  constructor(readonly arenas: ChainArena[]) {}
  status(): ChainStatus {
    return {
      enabled: true,
      cluster: 'test',
      programId: 'Fake111',
      rpcUrl: null,
      arenasEnabled: true,
      tokenReady: true,
      token: { mint: 'Mint111', symbol: '$SLANA', decimals: 6 },
      feeBps: 500,
    };
  }
  async getProfile(): Promise<ChainProfile | null> {
    return null;
  }
  async getSession(): Promise<ChainSession | null> {
    return null;
  }
  async listArenas(): Promise<ChainArena[]> {
    this.listCalls++;
    return this.arenas;
  }
  kick(): void {}
  setLiveSessionProvider(): void {}
  onSettled(): void {}
  onStatusChange(): void {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

export const arena = (id: number, entryFee: number): ChainArena => ({
  id,
  address: `Arena${id}`,
  entryFee,
  maxSessions: 300,
  enabled: true,
  openSessions: 0,
  // no vault tracking unless a test sets it (the vault-vs-journal guard is skipped)
  pot: null,
});

/** A fixed wall-clock instant one minute into a 5-minute round: room tests never hit a round end by accident. */
export const MID_ROUND = roundAt(1_791_000_000_000).startsAt + 60_000;

export function roomDeps(chain: ChainGateway, journal = new Journal(null), now: () => number = () => MID_ROUND): RoomDeps {
  return {
    chain,
    journal,
    leaderboards: new Leaderboards(null),
    log: () => {},
    now,
  };
}

let stakeSeq = 0;
/** Join options for an arena ticket worth `fee`. */
export function stakeJoin(arenaId: number, fee: number) {
  const n = ++stakeSeq;
  return {
    name: `staker${n}`,
    skin: 1,
    flags: 4,
    stake: {
      player: `wallet${n}`,
      session: `session${n}`,
      sessionId: n,
      arenaId,
      entryFee: fee,
      value: fee,
      openedAt: Math.floor(Date.now() / 1000),
    },
  };
}
