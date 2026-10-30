import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EntityKind,
  PROTOCOL_VERSION,
  RULES,
  decodeSnapshot,
  encodeTarget,
  type ChainStatus,
  type ServerMessage,
  type SnapshotData,
  roundAt,
  siweMessage,
} from '@elymum/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp, type App } from '../src/app';
import type { ChainArena, ChainGateway, ChainSession, ServerKeyInfo } from '../src/chain/types';
import { loadConfig } from '../src/config';
import { testSigner } from './signers';

class FakeChain implements ChainGateway {
  readonly enabled = true;
  readonly tokenReady = true;
  readonly stakeEnabled = true;
  sessions = new Map<string, ChainSession>();
  kicked = 0;
  status(): ChainStatus {
    return {
      enabled: true,
      chainId: 31337,
      chainName: 'Localnet',
      rpcUrl: null,
      explorerUrl: null,
      arenaAddress: '0x00000000000000000000000000000000000A7e4A',
      nftAddress: null,
      arenasEnabled: true,
      tokenReady: true,
      token: { address: '0x0000000000000000000000000000000000000707', symbol: '$ELYMUM', decimals: 18 },
      feeBps: 500,
      serverKey: null,
    };
  }
  serverInfo(): ServerKeyInfo {
    return { address: null, balanceWei: null, low: false };
  }
  /** The next `getSession` fails like an RPC error. */
  failNextGetSession = false;
  /** Runs inside `getSession` (lets a test act while a join awaits the chain). */
  onGetSession: (() => void) | null = null;
  async getSession(arenaId: number, player: string) {
    if (this.failNextGetSession) {
      this.failNextGetSession = false;
      throw new Error('rpc down');
    }
    const hook = this.onGetSession;
    this.onGetSession = null;
    if (hook) {
      await sleep(20);
      hook();
    }
    return this.sessions.get(`${arenaId}:${player}`) ?? null;
  }
  async listArenas(): Promise<ChainArena[]> {
    return [
      { id: 1, entryFee: 10_000_000, maxSessions: 10, enabled: true, openSessions: 0, pot: 0 },
      { id: 2, entryFee: 50_000_000, maxSessions: 10, enabled: true, openSessions: 0, pot: 0 },
    ];
  }
  kick() {
    this.kicked++;
  }
  setLiveSessionProvider() {}
  onSettled() {}
  onStatusChange() {}
  async start() {}
  async stop() {}
}

class Client {
  msgs: ServerMessage[] = [];
  snaps: SnapshotData[] = [];
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];

  constructor(readonly ws: WebSocket) {
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const buf = data as Buffer;
        this.snaps.push(decodeSnapshot(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)));
        return;
      }
      const msg = JSON.parse(data.toString()) as ServerMessage;
      this.msgs.push(msg);
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(msg)) {
          w.resolve(msg);
          return false;
        }
        return true;
      });
    });
  }

  static connect(port: number): Promise<Client> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const c = new Client(ws);
      ws.once('open', () => resolve(c));
      ws.once('error', reject);
    });
  }

  send(obj: unknown) {
    this.ws.send(JSON.stringify(obj));
  }

  wait<T extends ServerMessage['t']>(t: T, timeoutMs = 3000, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true) {
    const existing = this.msgs.find((m) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>));
    if (existing) return Promise.resolve(existing as Extract<ServerMessage, { t: T }>);
    return new Promise<Extract<ServerMessage, { t: T }>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${t}`)), timeoutMs);
      this.waiters.push({
        pred: (m) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>),
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { t: T }>);
        },
      });
    });
  }

  close() {
    this.ws.close();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let sessionSeq = 100;
function session(player: string, opts: Partial<ChainSession> = {}): ChainSession {
  const id = opts.id ?? ++sessionSeq;
  const arenaId = opts.arenaId ?? 1;
  return {
    key: `${arenaId}:${player.toLowerCase()}:${id}`,
    id,
    player,
    arenaId: 1,
    entryFee: 10_000_000,
    openedAt: Math.floor(Date.now() / 1000),
    finalized: false,
    owed: 0,
    ...opts,
  };
}

const newWallet = () => testSigner().address;

/** Connected, greeted and (with a wallet) signed-in client. */
async function signedIn(wallet: string | null): Promise<Client> {
  const c = await Client.connect(port);
  c.send({ t: 'hello', v: PROTOCOL_VERSION });
  await c.wait('welcome');
  if (wallet) {
    c.send({ t: 'auth', token: app.auth.issueToken(wallet) });
    await c.wait('authed');
  }
  return c;
}

/** The latest PlayerInfo of `pid` from the client's snapshots. */
function playerInfo(c: Client, pid: number) {
  for (let i = c.snaps.length - 1; i >= 0; i--) {
    const p = c.snaps[i].players.find((x) => x.id === pid);
    if (p) return p;
  }
  return undefined;
}

let app: App;
let port: number;
let chain: FakeChain;

/**
 * The server's round clock: real time shifted so the suite starts 2 s into a 5-minute round
 * (no round ends by accident); tests move it with `jumpTo`.
 */
const t0 = Date.now();
let clockBase = roundAt(t0).startsAt + 2_000;
const serverNow = () => clockBase + (Date.now() - t0);
const jumpTo = (at: number) => {
  clockBase = at - (Date.now() - t0);
};

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'elymum-int-'));
  const cfg = loadConfig({
    PORT: '0',
    HOST: '127.0.0.1',
    DATA_DIR: dir,
    BOT_TARGET: '6',
    BOT_MIN: '2',
    BOT_MAX: '6',
    // the game gate (site setting `gameAccess`) is covered in site.test.ts
    GAME_ACCESS: 'public',
    // no PUBLIC_URL: only development derives the SIWE origin from the request host
    NODE_ENV: 'development',
  });
  chain = new FakeChain();
  app = await createApp(cfg, { chain, log: () => {}, persist: true, now: serverNow });
  port = await app.listen();
});

afterAll(async () => {
  await app.close();
});

describe('server over websocket', () => {
  it('handshake lists rooms and chain status', async () => {
    const c = await Client.connect(port);
    c.send({ t: 'hello', v: PROTOCOL_VERSION });
    const welcome = await c.wait('welcome');
    expect(welcome.rooms.some((r) => r.id === 'practice-rookie-1')).toBe(true);
    expect(welcome.rooms.some((r) => r.mode === 'arena' && r.arenaId === 1)).toBe(true);
    expect(welcome.chain.enabled).toBe(true);
    // the round clock: every arena room carries the same round, on the server clock
    expect(Math.abs(welcome.serverNow - serverNow())).toBeLessThan(1000);
    const r = roundAt(welcome.serverNow);
    for (const room of welcome.rooms.filter((x) => x.mode === 'arena')) expect(room.round).toEqual({ n: r.n, endsAt: r.endsAt, joinsCloseAt: r.joinsCloseAt });
    expect(welcome.rooms.find((x) => x.mode === 'practice')?.round).toBeUndefined();
    c.send({ t: 'ping', ts: 7 });
    const pong = await c.wait('pong');
    expect(Math.abs(pong.serverNow - serverNow())).toBeLessThan(1000);
    // the token and fee ride along with the chain status (no Pass, no season)
    expect(welcome.chain).toMatchObject({ tokenReady: true, feeBps: 500, token: { decimals: 18 } });
    expect('pass' in welcome.chain).toBe(false);
    expect(welcome.blocked).toEqual([]);
    c.close();
  });

  it('arenas kept closed by the vault guard reach the lobby payloads', async () => {
    const underfunded = (app.rooms as unknown as { underfunded: Map<number, string> }).underfunded;
    underfunded.set(7, 'vault short');
    try {
      const res = (await (await fetch(`http://127.0.0.1:${port}/api/rooms`)).json()) as { blocked: unknown };
      expect(res.blocked).toEqual([{ arenaId: 7, reason: 'vault_short' }]);
      const c = await Client.connect(port);
      c.send({ t: 'hello', v: PROTOCOL_VERSION });
      expect((await c.wait('welcome')).blocked).toEqual([{ arenaId: 7, reason: 'vault_short' }]);
      c.close();
    } finally {
      underfunded.delete(7);
    }
  });

  it('rejects an old protocol version', async () => {
    const c = await Client.connect(port);
    c.send({ t: 'hello', v: 0 });
    const err = await c.wait('error');
    expect(err.code).toBe('version_mismatch');
    c.close();
  });

  it('joins a practice room, receives snapshots with own cell and moves toward the target', async () => {
    const c = await Client.connect(port);
    c.send({ t: 'hello', v: PROTOCOL_VERSION });
    await c.wait('welcome');
    c.send({ t: 'viewport', w: 1600, h: 900 });
    c.send({ t: 'join', room: 'practice', name: 'Tester', skin: 3 });
    const joined = await c.wait('joined');
    expect(joined.room.mode).toBe('practice');
    expect(joined.name).toBe('Tester');
    await sleep(500);
    expect(c.snaps.length).toBeGreaterThan(8);
    const mine = () => {
      for (let i = c.snaps.length - 1; i >= 0; i--) {
        const e = c.snaps[i].upserts.find((u) => u.kind === EntityKind.Cell && u.playerId === joined.playerId);
        if (e) return e;
      }
      return undefined;
    };
    const start = mine()!;
    expect(start).toBeDefined();
    const players = c.snaps.flatMap((s) => s.players);
    expect(players.find((p) => p.id === joined.playerId)?.name).toBe('Tester');
    // food arrives once and is not resent every tick
    const foodIds = c.snaps.flatMap((s) => s.upserts.filter((u) => u.kind === EntityKind.Food).map((u) => u.id));
    expect(foodIds.length).toBeGreaterThan(10);
    expect(new Set(foodIds).size).toBeGreaterThan(foodIds.length * 0.7);

    const tx = start.x + 600;
    for (let i = 0; i < 10; i++) {
      c.ws.send(encodeTarget(tx, start.y));
      await sleep(50);
    }
    const end = mine()!;
    expect(end.x).toBeGreaterThan(start.x + 50);

    const lb = await c.wait('lb', 2000, (m) => m.me !== null);
    expect(lb.me!.rank).toBeGreaterThan(0);
    expect(lb.top.length).toBeGreaterThan(0);
    c.close();
  });

  it('broadcasts chat and blocks links', async () => {
    const a = await Client.connect(port);
    const b = await Client.connect(port);
    for (const c of [a, b]) {
      c.send({ t: 'hello', v: PROTOCOL_VERSION });
      await c.wait('welcome');
    }
    a.send({ t: 'join', room: 'practice', name: 'Alice', skin: 0 });
    b.send({ t: 'join', room: 'practice', name: 'Bob', skin: 1 });
    await a.wait('joined');
    await b.wait('joined');
    a.send({ t: 'chat', text: 'gm frens' });
    const got = await b.wait('chat', 2000, (m) => m.from === 'Alice');
    expect(got.text).toBe('gm frens');
    await sleep(1300);
    a.send({ t: 'chat', text: 'free hype at https://scam.xyz' });
    const err = await a.wait('error', 2000, (m) => m.code === 'bad_request');
    expect(err.message).toMatch(/Links/);
    a.close();
    b.close();
  });

  it('authenticates a wallet signature and rejects a bad one', async () => {
    const signer = testSigner();
    const address = signer.address;
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/nonce?address=${address.toLowerCase()}`);
    const body = (await res.json()) as { message: string; address: string; domain: string; uri: string; chainId: number; nonce: string; issuedAt: string };
    const { message } = body;
    // SIWE domain = request host (no PUBLIC_URL here, NODE_ENV=development), with URI and the server's Chain ID; the client can rebuild it
    expect(body.domain).toBe(`127.0.0.1:${port}`);
    expect(body.address).toBe(address);
    expect(body.chainId).toBe(31337);
    expect(message.split('\n')[0]).toBe(`127.0.0.1:${port} wants you to sign in with your Ethereum account:`);
    expect(message).toContain(`\nURI: http://127.0.0.1:${port}\n`);
    expect(message).toContain('\nChain ID: 31337\n');
    expect(siweMessage({ domain: body.domain, address, uri: body.uri, chainId: body.chainId, nonce: body.nonce, issuedAt: body.issuedAt })).toBe(message);
    const c = await Client.connect(port);
    c.send({ t: 'hello', v: PROTOCOL_VERSION });
    await c.wait('welcome');
    // wrong signature (another wallet signed it)
    c.send({ t: 'auth', address, message, signature: await testSigner().sign(message) });
    expect((await c.wait('error')).code).toBe('auth_failed');
    const sig = await signer.sign(message);
    c.send({ t: 'auth', address: address.toLowerCase(), message, signature: sig });
    const authed = await c.wait('authed');
    expect(authed.address).toBe(address);
    // the token works on a fresh connection; a replayed signature does not
    const d = await Client.connect(port);
    d.send({ t: 'hello', v: PROTOCOL_VERSION });
    await d.wait('welcome');
    d.send({ t: 'auth', address, message, signature: sig });
    expect((await d.wait('error')).code).toBe('auth_failed');
    d.send({ t: 'auth', token: authed.token });
    expect((await d.wait('authed')).address).toBe(address);
    c.close();
    d.close();
  });

  it('rate-limits sign-ins (each one reads the chain)', async () => {
    const player = newWallet();
    const token = app.auth.issueToken(player);
    const c = await Client.connect(port);
    c.send({ t: 'hello', v: PROTOCOL_VERSION });
    await c.wait('welcome');
    for (let i = 0; i < 8; i++) c.send({ t: 'auth', token });
    expect((await c.wait('error', 2000, (m) => m.code === 'rate_limited')).code).toBe('rate_limited');
    const authed = () => c.msgs.filter((m) => m.t === 'authed').length;
    for (let i = 0; i < 40 && authed() < 6; i++) await sleep(25);
    await sleep(100);
    expect(authed()).toBe(6);
    expect(c.msgs.filter((m) => m.t === 'error' && m.code === 'rate_limited').length).toBe(2);
    c.close();
  });

  it('stake arena: join with an on-chain ticket, no cash-out, settled at value when the round ends', async () => {
    const player = newWallet();
    const ticket = session(player, { id: 1 });
    chain.sessions.set(`1:${player}`, ticket);
    const c = await Client.connect(port);
    c.send({ t: 'hello', v: PROTOCOL_VERSION });
    await c.wait('welcome');
    c.send({ t: 'join', room: 'arena:1', name: 'Whale', skin: 0 });
    expect((await c.wait('error')).code).toBe('auth_required');

    c.send({ t: 'auth', token: app.auth.issueToken(player) });
    await c.wait('authed');
    c.send({ t: 'join', room: 'arena:1', name: 'Whale', skin: 0 });
    const joined = await c.wait('joined');
    expect(joined.room.mode).toBe('arena');
    expect(joined.value).toBe(10_000_000);
    const r = roundAt(serverNow());
    expect(joined.round).toEqual({ n: r.n, endsAt: r.endsAt, joinsCloseAt: r.joinsCloseAt });
    expect(app.journal.live().map((l) => l.session)).toContain(ticket.key);

    // paid arenas have no cash-out
    c.send({ t: 'cashout' });
    expect((await c.wait('error', 2000, (m) => m.code === 'no_cashout')).code).toBe('no_cashout');
    await sleep(100);
    expect(c.msgs.some((m) => m.t === 'cashout')).toBe(false);
    expect(app.journal.pending.some((p) => p.key === ticket.key)).toBe(false);

    // the bell: settled at value (reason `round`), with the round's standings
    jumpTo(r.endsAt);
    const over = await c.wait('roundOver', 3000);
    expect(over.round).toBe(r.n);
    expect(over.payout).toBe(10_000_000);
    expect(over.stats.payout).toBe(10_000_000);
    expect(over.standings.find((s) => s.you)).toEqual({ name: 'Whale', value: 10_000_000, you: true });
    const item = app.journal.pending.find((p) => p.key === ticket.key);
    expect(item).toMatchObject({ kind: 'settle', payout: 10_000_000, reason: 'round', player: player });
    expect(chain.kicked).toBeGreaterThan(0);
    expect(app.journal.live().map((l) => l.session)).not.toContain(ticket.key);

    // the same ticket cannot be reused while its settlement is pending
    c.send({ t: 'join', room: 'arena:1', name: 'Whale', skin: 0 });
    expect((await c.wait('error', 2000, (m) => m.code === 'no_session')).code).toBe('no_session');
    app.journal.remove(ticket.key);
    chain.sessions.delete(`1:${player}`);
    c.close();
  }, 15_000);

  it('holders gate: every arena seat re-checks the gate uncached (an NFT passed on since the lobby check)', async () => {
    const player = newWallet();
    chain.sessions.set(`1:${player}`, session(player, { id: 41 }));
    const site = app.site as unknown as { gameOpenFor: (w: string | null, fresh?: boolean) => Promise<boolean> };
    const original = site.gameOpenFor;
    const asked: boolean[] = [];
    // the cached answer still says "holder"; a fresh balanceOf read says the NFT is gone
    site.gameOpenFor = async (_w, fresh = false) => {
      asked.push(fresh);
      return !fresh;
    };
    try {
      const c = await signedIn(player);
      c.send({ t: 'join', room: 'arena:1', name: 'Passer', skin: 0 });
      expect((await c.wait('error', 2000, (m) => m.code === 'game_closed')).code).toBe('game_closed');
      expect(asked).toEqual([false, true]);
      expect(app.journal.live().some((l) => l.player === player)).toBe(false);
      // practice is gated by the (cached) check only
      c.send({ t: 'join', room: 'practice', name: 'Passer', skin: 0 });
      expect((await c.wait('joined')).room.mode).toBe('practice');
      c.close();
    } finally {
      site.gameOpenFor = original;
      chain.sessions.delete(`1:${player}`);
    }
  });

  it('arena joins close in the last minute; an AFK staker may still come back; the next round opens joins', async () => {
    const afk = newWallet();
    chain.sessions.set(`1:${afk}`, session(afk));
    const a = await signedIn(afk);
    a.send({ t: 'join', room: 'arena:1', name: 'Early', skin: 0 });
    const ja = await a.wait('joined');
    a.close();
    await sleep(150);

    const r = roundAt(serverNow());
    jumpTo(r.joinsCloseAt);
    const late = newWallet();
    chain.sessions.set(`1:${late}`, session(late));
    const b = await signedIn(late);
    b.send({ t: 'join', room: 'arena:1', name: 'Late', skin: 0 });
    const err = await b.wait('error', 2000, (m) => m.code === 'round_closed');
    expect(err.opensAt).toBe(r.endsAt);
    expect(b.msgs.some((m) => m.t === 'joined')).toBe(false);
    expect(app.rooms.liveSessions().size).toBeGreaterThan(0);

    // the AFK return path is not a new join: allowed while joins are closed
    const a2 = await signedIn(afk);
    a2.send({ t: 'join', room: 'arena:1', name: 'Early', skin: 0 });
    const back = await a2.wait('joined');
    expect(back.playerId).toBe(ja.playerId);

    // the next round opens: the held ticket joins at once, before the room's next tick
    // (it plays round n+1; the join rings round n's bell first)
    jumpTo(r.endsAt);
    b.send({ t: 'join', room: 'arena:1', name: 'Late', skin: 0 });
    const jb = await b.wait('joined');
    expect(jb.round?.n).toBe(r.n + 1);
    const over = await a2.wait('roundOver', 3000);
    expect(over.round).toBe(r.n);
    await sleep(200);
    expect(b.msgs.some((m) => m.t === 'roundOver')).toBe(false);
    expect(app.journal.settlements().some((p) => p.player === late)).toBe(false);
    expect(app.rooms.findArenaStake(1, late)).not.toBeNull();
    for (const w of [afk, late]) {
      for (const p of app.journal.pending.filter((x) => x.kind === 'settle' && x.player === w)) app.journal.remove(p.key);
      chain.sessions.delete(`1:${w}`);
    }
    a2.close();
    b.close();
  }, 15_000);

  it('an AFK staker back after the bell hears round_ended (not session_busy), until a new ticket opens', async () => {
    const w = newWallet();
    const first = session(w);
    chain.sessions.set(`1:${w}`, first);
    const a = await signedIn(w);
    a.send({ t: 'join', room: 'arena:1', name: 'Away', skin: 0 });
    await a.wait('joined');
    a.close();
    await sleep(150);

    // back right at the bell, before the room's next tick: the reattach rings the bell first
    const r = roundAt(serverNow());
    jumpTo(r.endsAt);
    const b = await signedIn(w);
    b.send({ t: 'join', room: 'arena:1', name: 'Away', skin: 0 });
    const err = await b.wait('error', 2000, (m) => m.code === 'round_ended' || m.code === 'session_busy');
    expect(err.message).toMatch(/round ended while you were away/);
    expect(err.code).toBe('round_ended');
    expect(b.msgs.some((m) => m.t === 'roundOver' || m.t === 'joined')).toBe(false);
    expect(app.journal.settlements().find((p) => p.key === first.key)).toMatchObject({ reason: 'round', player: w });

    // a later return, while the settlement is pending: still round_ended (the bell's memo)
    const c = await signedIn(w);
    c.send({ t: 'join', room: 'arena:1', name: 'Away', skin: 0 });
    expect((await c.wait('error', 2000, (m) => m.code === 'round_ended' || m.code === 'no_session')).code).toBe('round_ended');
    c.close();

    // a ticket played until a bell rung by the room's own tick while its player is away
    const awayAtBell = async (sess: ChainSession) => {
      chain.sessions.set(`1:${w}`, sess);
      const d = await signedIn(w);
      d.send({ t: 'join', room: 'arena:1', name: 'Away', skin: 0 });
      await d.wait('joined');
      d.close();
      await sleep(150);
      jumpTo(roundAt(serverNow()).endsAt);
      await sleep(150);
      expect(app.journal.settlements().some((p) => p.key === sess.key)).toBe(true);
      app.journal.remove(sess.key); // the payout landed
    };

    // back after the payout landed and the session closed on chain: round_ended
    app.journal.remove(first.key);
    await awayAtBell(session(w));
    chain.sessions.delete(`1:${w}`);
    const e = await signedIn(w);
    // the chain read fails once: the usual path answers, and the bell's memo is kept
    chain.failNextGetSession = true;
    e.send({ t: 'join', room: 'arena:1', name: 'Away', skin: 0 });
    expect((await e.wait('error', 2000, (m) => m.code === 'round_ended' || m.code === 'no_session')).code).toBe('no_session');
    expect(app.rooms.bellSettled(1, w)).not.toBeNull();
    e.msgs.length = 0;
    e.send({ t: 'join', room: 'arena:1', name: 'Away', skin: 0 });
    expect((await e.wait('error', 2000, (m) => m.code === 'round_ended' || m.code === 'no_session')).code).toBe('round_ended');
    e.close();

    // a fresh ticket bought after an away bell plays normally
    await awayAtBell(session(w));
    const fresh = session(w);
    chain.sessions.set(`1:${w}`, fresh);
    const f = await signedIn(w);
    f.send({ t: 'join', room: 'arena:1', name: 'Away', skin: 0 });
    expect((await f.wait('joined', 2000)).session).toBe(fresh.key);
    expect(app.rooms.bellSettled(1, w)).toBeNull();
    f.close();
    await sleep(150);
    jumpTo(roundAt(serverNow()).endsAt);
    await sleep(150);
    for (const p of app.journal.pending.filter((x) => x.kind === 'settle' && x.player === w)) app.journal.remove(p.key);
    chain.sessions.delete(`1:${w}`);
    b.close();
  }, 15_000);

  it('stake players who disconnect stay AFK and can reconnect', async () => {
    const player = newWallet();
    chain.sessions.set(`1:${player}`, session(player, { id: 2, entryFee: 20_000_000 }));
    const token = app.auth.issueToken(player);
    const a = await Client.connect(port);
    a.send({ t: 'hello', v: PROTOCOL_VERSION });
    await a.wait('welcome');
    a.send({ t: 'auth', token });
    await a.wait('authed');
    a.send({ t: 'join', room: 'arena:1', name: 'Afk', skin: 0 });
    const j1 = await a.wait('joined');
    a.close();
    await sleep(200);
    const room = app.rooms.rooms.get('arena-1-1')!;
    expect(room.world.players.get(j1.playerId)?.afk).toBe(true);

    const b = await Client.connect(port);
    b.send({ t: 'hello', v: PROTOCOL_VERSION });
    await b.wait('welcome');
    b.send({ t: 'auth', token });
    await b.wait('authed');
    b.send({ t: 'join', room: 'arena:1', name: 'Afk', skin: 0 });
    const j2 = await b.wait('joined');
    expect(j2.playerId).toBe(j1.playerId);
    expect(j2.value).toBe(20_000_000);
    expect(room.world.players.get(j1.playerId)?.afk).toBe(false);
    b.close();
  });

  it('spectators follow the leader', async () => {
    const c = await Client.connect(port);
    c.send({ t: 'hello', v: PROTOCOL_VERSION });
    await c.wait('welcome');
    c.send({ t: 'spectate' });
    const s = await c.wait('spectating');
    expect(s.room.id).toMatch(/^practice-/);
    await sleep(300);
    expect(c.snaps.length).toBeGreaterThan(3);
    expect(c.snaps.some((sn) => sn.upserts.some((u) => u.kind === EntityKind.Cell))).toBe(true);
    c.close();
  });

  it('serves REST endpoints', async () => {
    const health = (await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()) as { ok: boolean };
    expect(health.ok).toBe(true);
    const rooms = (await (await fetch(`http://127.0.0.1:${port}/api/rooms`)).json()) as { rooms: unknown[] };
    expect(rooms.rooms.length).toBeGreaterThan(0);
    const lb = (await (await fetch(`http://127.0.0.1:${port}/api/leaderboard`)).json()) as { daily: unknown[] };
    expect(Array.isArray(lb.daily)).toBe(true);
    const bad = await fetch(`http://127.0.0.1:${port}/api/auth/nonce?address=nope`);
    expect(bad.status).toBe(400);
    const config = (await (await fetch(`http://127.0.0.1:${port}/api/config`)).json()) as { protocol: number; chain: ChainStatus };
    expect(config).toEqual({ protocol: PROTOCOL_VERSION, chain: chain.status() });
    // the Pass and season endpoints are gone
    for (const path of ['/api/season', '/api/pass/owned?wallet=x', '/pass/collection.json', '/pass/1.png', '/api/dev/token']) {
      expect((await fetch(`http://127.0.0.1:${port}${path}`)).status).toBe(404);
    }
  });

  it('a finalized session cannot be played: collect the payout first', async () => {
    const player = newWallet();
    const c = await signedIn(player);
    chain.sessions.set(`1:${player}`, session(player, { finalized: true, owed: 7_000_000 }));
    c.send({ t: 'join', room: 'arena:1', name: 'Collector', skin: 0 });
    const err = await c.wait('error', 2000, (m) => m.code === 'payout_waiting');
    expect(err.message).toMatch(/Collect your payout/);
    expect(c.msgs.some((m) => m.t === 'joined')).toBe(false);
    chain.sessions.delete(`1:${player}`);
    c.close();
  });

  it('a settlement queued while the join awaits blocks the join', async () => {
    const player = newWallet();
    const c = await signedIn(player);
    const s = session(player);
    chain.sessions.set(`1:${player}`, s);
    const now = Date.now();
    // the stale sweeper queues a refund for this session while the join awaits the session lookup
    chain.onGetSession = () =>
      app.journal.enqueue({ kind: 'settle', key: s.key, player: player, arenaId: 1, session: s.key, sessionId: s.id, payout: s.entryFee, score: 0, kills: 0, xp: 0, reason: 'stale', attempts: 0, nextAttemptAt: now + 60_000, createdAt: now });
    c.send({ t: 'join', room: 'arena:1', name: 'Racer', skin: 0 });
    const err = await c.wait('error', 2000, (m) => m.code === 'no_session');
    expect(err.message).toMatch(/still being settled/);
    expect(c.msgs.some((m) => m.t === 'joined')).toBe(false);
    app.journal.remove(s.key);
    chain.sessions.delete(`1:${player}`);
    c.close();
  });

  it('arena join requires a session; every ticket plays alike (no Pass)', async () => {
    const player = newWallet();
    const c = await signedIn(player);
    c.send({ t: 'join', room: 'arena:1', name: 'Noticket', skin: 0 });
    expect((await c.wait('error', 2000, (m) => m.code === 'no_session')).code).toBe('no_session');

    chain.sessions.set(`2:${player}`, session(player, { arenaId: 2, entryFee: 50_000_000 }));
    c.send({ t: 'join', room: 'arena:2', name: 'Gold', skin: 2 });
    const joined = await c.wait('joined');
    expect(joined.room.arenaId).toBe(2);
    expect(joined.value).toBe(50_000_000);
    expect('hasPass' in joined).toBe(false);
    const p = app.rooms.rooms.get(joined.room.id)!.world.players.get(joined.playerId)!;
    // no Pass power: everyone starts at the same mass (a Pass used to add 15 %)
    expect(p.totalMass()).toBeGreaterThan(RULES.startMass * 0.9);
    expect(p.totalMass()).toBeLessThan(RULES.startMass * 1.1);
    await sleep(200);
    expect(playerInfo(c, joined.playerId)).toMatchObject({ skin: 2, name: 'Gold' });
    expect('pass' in playerInfo(c, joined.playerId)!).toBe(false);
    c.close();
  });

  it('a join that still names a Pass is played with the basic skin (the field is ignored)', async () => {
    const c = await signedIn(newWallet());
    c.send({ t: 'join', room: 'practice', name: 'Legacy', skin: 3, pass: newWallet() });
    const joined = await c.wait('joined');
    expect(joined.skin).toBe(3);
    expect(c.msgs.some((m) => m.t === 'error')).toBe(false);
    c.close();
  });

  it('resume existing non-live session without new charge', async () => {
    const player = newWallet();
    // the ticket was bought earlier (e.g. the tab crashed before joining): it is open on-chain but in no room
    const s = session(player, { openedAt: Math.floor(Date.now() / 1000) - 120, entryFee: 30_000_000 });
    chain.sessions.set(`1:${player}`, s);
    expect(app.rooms.liveSessions().has(s.key)).toBe(false);
    const kicked = chain.kicked;
    const pendingBefore = app.journal.pending.length;
    const c = await signedIn(player);
    c.send({ t: 'join', room: 'arena:1', name: 'Back', skin: 0 });
    const joined = await c.wait('joined');
    expect(joined.value).toBe(30_000_000);
    expect(joined.entryFee).toBe(30_000_000);
    expect(app.rooms.liveSessions().has(s.key)).toBe(true);
    // nothing was settled or charged: the same on-chain ticket simply resumes
    expect(app.journal.pending.length).toBe(pendingBefore);
    expect(chain.kicked).toBe(kicked);
    expect(chain.sessions.get(`1:${player}`)).toBe(s);
    c.close();
  });

  it('practice join routes by league', async () => {
    const pro = newWallet();
    app.profiles.update(pro, { name: 'veteran', skin: 1 });
    app.profiles.recordGame(pro, { score: 9000, kills: 50, xp: 99_999 });
    const a = await signedIn(pro);
    a.send({ t: 'join', room: 'practice', name: 'x', skin: 1 });
    const ja = await a.wait('joined');
    expect(ja.room.league).toBe('pro');
    expect(ja.room.id).toMatch(/^practice-pro-\d+$/);

    const b = await signedIn(null);
    b.send({ t: 'join', room: 'practice', name: 'newbie', skin: 1 });
    const jb = await b.wait('joined');
    expect(jb.room.league).toBe('rookie');
    expect(jb.room.id).toMatch(/^practice-rookie-\d+$/);
    a.close();
    b.close();
  });

  it('lists pending settlements', async () => {
    const player = newWallet();
    const now = Date.now();
    app.journal.enqueue({ kind: 'settle', key: `Owed-${player}`, player: player, arenaId: 1, session: `Owed-${player}`, sessionId: 9, payout: 12_000_000, score: 1, kills: 0, xp: 0, attempts: 0, nextAttemptAt: now + 60_000, createdAt: now });
    const res = (await (await fetch(`http://127.0.0.1:${port}/api/pending?wallet=${player}`)).json()) as unknown;
    expect(res).toEqual({ pending: [{ key: `Owed-${player}`, arenaId: 1, payout: 12_000_000 }] });
    expect((await fetch(`http://127.0.0.1:${port}/api/pending?wallet=nope`)).status).toBe(400);
    app.journal.remove(`Owed-${player}`);
  });
});
