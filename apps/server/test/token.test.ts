import { PROTOCOL_VERSION, type RoomInfo, type ServerMessage } from '@elymum/shared';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp, type App } from '../src/app';
import { DevFakeChain } from '../src/chain/dev-fake';
import { loadConfig } from '../src/config';

/**
 * Slana Simple: the program is initialized without a mint; `set-token` comes later. The server
 * runs practice only until it sees the mint, answers arena joins with `token_not_set`, then
 * attaches the arenas and pushes the new chain status, all without a restart. Driven through the
 * fake chain's dev route (`POST /api/dev/token`), which stands in for `pnpm admin set-token`.
 */

class Client {
  msgs: ServerMessage[] = [];
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  constructor(readonly ws: WebSocket) {
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const msg = JSON.parse(data.toString()) as ServerMessage;
      this.msgs.push(msg);
      this.waiters = this.waiters.filter((w) => (w.pred(msg) ? (w.resolve(msg), false) : true));
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
  wait<T extends ServerMessage['t']>(t: T, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true, timeoutMs = 3000) {
    const hit = this.msgs.find((m) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>));
    if (hit) return Promise.resolve(hit as Extract<ServerMessage, { t: T }>);
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
const newWallet = () => bs58.encode(nacl.sign.keyPair().publicKey);

let app: App;
let port: number;
const base = () => `http://127.0.0.1:${port}`;

async function signedIn(wallet: string): Promise<Client> {
  const c = await Client.connect(port);
  c.send({ t: 'hello', v: PROTOCOL_VERSION });
  await c.wait('welcome');
  c.send({ t: 'auth', token: app.auth.issueToken(wallet) });
  await c.wait('authed');
  return c;
}

beforeAll(async () => {
  const cfg = loadConfig({
    PORT: '0',
    HOST: '127.0.0.1',
    NODE_ENV: 'development',
    DEV_FAKE_CHAIN: '1',
    // joins stay open the whole round (the suite runs on the real clock)
    ROUND_JOIN_CLOSE_SECONDS: '0',
    BOT_TARGET: '4',
    BOT_MIN: '2',
    BOT_MAX: '4',
    ARENA_BOT_TARGET: '2',
    ARENA_BOT_MIN: '0',
    ARENA_BOT_MAX: '2',
    // the game gate (site setting `gamePublic`) is covered in site.test.ts
    GAME_PUBLIC: '1',
  });
  app = await createApp(cfg, { log: () => {}, persist: false });
  port = await app.listen();
});

afterAll(async () => {
  await app.close();
});

describe('token set after deploy', () => {
  it('starts practice only, refuses arena joins with token_not_set, then opens arenas without a restart', async () => {
    expect(app.chain).toBeInstanceOf(DevFakeChain);

    // before set-token: tokenReady false everywhere, no arena room
    const config = async () => ((await (await fetch(`${base()}/api/config`)).json()) as { chain: { tokenReady: boolean; arenasEnabled: boolean; feeBps: number | null } }).chain;
    expect(await config()).toMatchObject({ tokenReady: false, arenasEnabled: false, feeBps: 500 });
    const wallet = newWallet();
    const c = await signedIn(wallet);
    const welcome = await c.wait('welcome');
    expect(welcome.chain).toMatchObject({ enabled: true, tokenReady: false, token: null, feeBps: 500 });
    expect(welcome.rooms.filter((r) => r.mode === 'arena')).toEqual([]);

    c.send({ t: 'join', room: 'arena:1', name: 'Early', skin: 0 });
    const err = await c.wait('error', (m) => m.code === 'token_not_set');
    expect(err.message).toMatch(/opening soon/i);
    expect(c.msgs.some((m) => m.t === 'joined')).toBe(false);

    // practice works meanwhile
    c.send({ t: 'join', room: 'practice', name: 'Early', skin: 0 });
    const practice = await c.wait('joined');
    expect(practice.room.mode).toBe('practice');
    c.send({ t: 'leave' });
    await c.wait('left');

    // set-token lands (dev route): every connection hears the new status at once
    const other = await Client.connect(port);
    other.send({ t: 'hello', v: PROTOCOL_VERSION });
    await other.wait('welcome');
    const res = await fetch(`${base()}/api/dev/token`, { method: 'POST' });
    expect(res.status).toBe(200);
    for (const client of [c, other]) {
      const pushed = await client.wait('chain', (m) => m.chain.tokenReady);
      expect(pushed.chain).toMatchObject({ tokenReady: true, arenasEnabled: true, token: { decimals: 6 } });
    }
    expect(await config()).toMatchObject({ tokenReady: true, arenasEnabled: true });

    // the arenas attach right away (no restart, no 30 s wait)
    let arenas: RoomInfo[] = [];
    for (let i = 0; i < 50 && arenas.length === 0; i++) {
      arenas = ((await (await fetch(`${base()}/api/rooms`)).json()) as { rooms: RoomInfo[] }).rooms.filter((r) => r.mode === 'arena');
      if (arenas.length === 0) await sleep(20);
    }
    expect(arenas.map((r) => r.arenaId).sort()).toEqual([1, 2, 3, 4]);

    // and the same connection can now play an arena
    c.send({ t: 'join', room: 'arena:1', name: 'Early', skin: 0 });
    const joined = await c.wait('joined', (m) => m.room.mode === 'arena');
    expect(joined.room.arenaId).toBe(1);
    expect(joined.value).toBeGreaterThan(0);
    c.close();
    other.close();
  });

  it('a fresh connection after the switch is welcomed with tokenReady and the arenas', async () => {
    const c = await Client.connect(port);
    c.send({ t: 'hello', v: PROTOCOL_VERSION });
    const welcome = await c.wait('welcome');
    expect(welcome.chain.tokenReady).toBe(true);
    expect(welcome.rooms.some((r) => r.mode === 'arena' && r.arenaId === 4)).toBe(true);
    c.close();
  });
});
