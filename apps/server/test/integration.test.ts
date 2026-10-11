import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EntityKind,
  PROTOCOL_VERSION,
  decodeSnapshot,
  encodeTarget,
  type ChainStatus,
  type ServerMessage,
  type SnapshotData,
} from '@solagel/shared';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp, type App } from '../src/app';
import type { ChainArena, ChainGateway, ChainProfile, ChainSession, SeasonView } from '../src/chain/types';
import { loadConfig } from '../src/config';

class FakeChain implements ChainGateway {
  readonly enabled = true;
  readonly stakeEnabled = true;
  sessions = new Map<string, ChainSession>();
  profiles = new Map<string, ChainProfile>();
  kicked = 0;
  status(): ChainStatus {
    return { enabled: true, cluster: 'test', programId: 'Fake111', rpcUrl: null, stakeEnabled: true, currentSeason: 1 };
  }
  async getProfile(owner: string) {
    return this.profiles.get(owner) ?? null;
  }
  async getSession(arenaId: number, player: string) {
    return this.sessions.get(`${arenaId}:${player}`) ?? null;
  }
  async activateSession() {
    return true;
  }
  async listArenas(): Promise<ChainArena[]> {
    return [{ id: 1, address: 'Arena1', buyIn: 10_000_000, maxPlayers: 10, enabled: true, openSessions: 0, pot: 0 }];
  }
  async season(): Promise<SeasonView | null> {
    return null;
  }
  kick() {
    this.kicked++;
  }
  setLiveSessionProvider() {}
  onSettled() {}
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

let app: App;
let port: number;
let chain: FakeChain;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'solagel-int-'));
  const cfg = loadConfig({ PORT: '0', HOST: '127.0.0.1', DATA_DIR: dir, BOT_TARGET: '6', BOT_MIN: '2', BOT_MAX: '6' });
  chain = new FakeChain();
  app = await createApp(cfg, { chain, log: () => {}, persist: true });
  port = await app.listen();
});

afterAll(async () => {
  await app.close();
});

describe('server over websocket', () => {
  it('handshake lists rooms and chain status', async () => {
    const c = await Client.connect(port);
    c.send({ t: 'hello', v: PROTOCOL_VERSION, lang: 'tr' });
    const welcome = await c.wait('welcome');
    expect(welcome.rooms.some((r) => r.id === 'free-1')).toBe(true);
    expect(welcome.rooms.some((r) => r.mode === 'stake' && r.arenaId === 1)).toBe(true);
    expect(welcome.chain.enabled).toBe(true);
    c.close();
  });

  it('rejects an old protocol version', async () => {
    const c = await Client.connect(port);
    c.send({ t: 'hello', v: 0 });
    const err = await c.wait('error');
    expect(err.code).toBe('version_mismatch');
    c.close();
  });

  it('joins a free room, receives snapshots with own cell and moves toward the target', async () => {
    const c = await Client.connect(port);
    c.send({ t: 'hello', v: PROTOCOL_VERSION });
    await c.wait('welcome');
    c.send({ t: 'viewport', w: 1600, h: 900 });
    c.send({ t: 'join', room: 'free', name: 'Tester', skin: 3 });
    const joined = await c.wait('joined');
    expect(joined.room.mode).toBe('free');
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
    a.send({ t: 'join', room: 'free', name: 'Alice', skin: 0 });
    b.send({ t: 'join', room: 'free', name: 'Bob', skin: 1 });
    await a.wait('joined');
    await b.wait('joined');
    a.send({ t: 'chat', text: 'gm frens' });
    const got = await b.wait('chat', 2000, (m) => m.from === 'Alice');
    expect(got.text).toBe('gm frens');
    await sleep(1300);
    a.send({ t: 'chat', text: 'free sol at https://scam.xyz' });
    const err = await a.wait('error', 2000, (m) => m.code === 'bad_request');
    expect(err.message).toMatch(/Links/);
    a.close();
    b.close();
  });

  it('authenticates a wallet signature and rejects a bad one', async () => {
    const kp = nacl.sign.keyPair();
    const pubkey = bs58.encode(kp.publicKey);
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/nonce?pubkey=${pubkey}`);
    const { message } = (await res.json()) as { message: string };
    const c = await Client.connect(port);
    c.send({ t: 'hello', v: PROTOCOL_VERSION });
    await c.wait('welcome');
    // wrong signature
    c.send({ t: 'auth', pubkey, message, signature: bs58.encode(new Uint8Array(64)) });
    expect((await c.wait('error')).code).toBe('auth_failed');
    const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
    c.send({ t: 'auth', pubkey, message, signature: bs58.encode(sig) });
    const authed = await c.wait('authed');
    expect(authed.pubkey).toBe(pubkey);
    // the token works on a fresh connection; a replayed signature does not
    const d = await Client.connect(port);
    d.send({ t: 'hello', v: PROTOCOL_VERSION });
    await d.wait('welcome');
    d.send({ t: 'auth', pubkey, message, signature: bs58.encode(sig) });
    expect((await d.wait('error')).code).toBe('auth_failed');
    d.send({ t: 'auth', token: authed.token });
    expect((await d.wait('authed')).pubkey).toBe(pubkey);
    c.close();
    d.close();
  });

  it('rate-limits sign-ins (each one reads the chain)', async () => {
    const pubkey = bs58.encode(nacl.sign.keyPair().publicKey);
    const token = app.auth.issueToken(pubkey);
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

  it('stake arena: join with an on-chain ticket, cash out, queue settlement', async () => {
    const kp = nacl.sign.keyPair();
    const pubkey = bs58.encode(kp.publicKey);
    chain.sessions.set(`1:${pubkey}`, { address: `Session-${pubkey}`, id: 1, player: pubkey, arenaId: 1, buyIn: 10_000_000, openedAt: Math.floor(Date.now() / 1000) });
    const c = await Client.connect(port);
    c.send({ t: 'hello', v: PROTOCOL_VERSION });
    await c.wait('welcome');
    c.send({ t: 'join', room: 'stake:1', name: 'Whale', skin: 0 });
    expect((await c.wait('error')).code).toBe('auth_required');

    c.send({ t: 'auth', token: app.auth.issueToken(pubkey) });
    await c.wait('authed');
    c.send({ t: 'join', room: 'stake:1', name: 'Whale', skin: 0 });
    const joined = await c.wait('joined');
    expect(joined.room.mode).toBe('stake');
    expect(joined.value).toBe(10_000_000);
    expect(app.journal.live().map((l) => l.session)).toContain(`Session-${pubkey}`);

    c.send({ t: 'cashout' });
    expect((await c.wait('cashout', 2000, (m) => m.state === 'started')).ms).toBe(3000);
    const done = await c.wait('cashout', 5000, (m) => m.state === 'done');
    expect(done.value).toBe(10_000_000);
    const item = app.journal.pending.find((p) => p.key === `Session-${pubkey}`);
    expect(item).toMatchObject({ kind: 'settle', payout: 10_000_000, reason: 'cashout', player: pubkey });
    expect(chain.kicked).toBeGreaterThan(0);
    expect(app.journal.live().map((l) => l.session)).not.toContain(`Session-${pubkey}`);

    // the same ticket cannot be reused while its settlement is pending
    c.send({ t: 'join', room: 'stake:1', name: 'Whale', skin: 0 });
    expect((await c.wait('error', 2000, (m) => m.code === 'no_session')).code).toBe('no_session');
    c.close();
  }, 15_000);

  it('stake players who disconnect stay AFK and can reconnect', async () => {
    const kp = nacl.sign.keyPair();
    const pubkey = bs58.encode(kp.publicKey);
    chain.sessions.set(`1:${pubkey}`, { address: `S2-${pubkey}`, id: 2, player: pubkey, arenaId: 1, buyIn: 20_000_000, openedAt: Math.floor(Date.now() / 1000) });
    const token = app.auth.issueToken(pubkey);
    const a = await Client.connect(port);
    a.send({ t: 'hello', v: PROTOCOL_VERSION });
    await a.wait('welcome');
    a.send({ t: 'auth', token });
    await a.wait('authed');
    a.send({ t: 'join', room: 'stake:1', name: 'Afk', skin: 0 });
    const j1 = await a.wait('joined');
    a.close();
    await sleep(200);
    const room = app.rooms.rooms.get('stake-1')!;
    expect(room.world.players.get(j1.playerId)?.afk).toBe(true);

    const b = await Client.connect(port);
    b.send({ t: 'hello', v: PROTOCOL_VERSION });
    await b.wait('welcome');
    b.send({ t: 'auth', token });
    await b.wait('authed');
    b.send({ t: 'join', room: 'stake:1', name: 'Afk', skin: 0 });
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
    expect(s.room.id).toMatch(/^free-/);
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
    const bad = await fetch(`http://127.0.0.1:${port}/api/auth/nonce?pubkey=nope`);
    expect(bad.status).toBe(400);
  });
});
