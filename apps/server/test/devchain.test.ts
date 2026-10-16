import type { AddressInfo } from 'node:net';
import { Keypair } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { createChain, dataFileNames } from '../src/chain';
import { DevFakeChain } from '../src/chain/dev-fake';
import { NullChain, type SettledEvent } from '../src/chain/types';
import { loadConfig } from '../src/config';
import { createHttpServer } from '../src/http';
import { settledMessage } from '../src/net/gateway';
import { Journal, type SettlementItem } from '../src/stake/journal';

const wallet = () => Keypair.generate().publicKey.toBase58();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('DEV_FAKE_CHAIN', () => {
  const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;
  const refused = (e: Record<string, string>) => createChain(loadConfig(env(e)), new Journal(null), () => {});

  it('is off by default', () => {
    expect(loadConfig(env({})).devFakeChain).toBe(false);
  });

  it('refuses unless NODE_ENV=development', async () => {
    await expect(refused({ DEV_FAKE_CHAIN: '1', NODE_ENV: 'production' })).rejects.toThrow(/NODE_ENV=development/);
    // unset NODE_ENV is refused too (an explicit opt-in is required)
    await expect(refused({ DEV_FAKE_CHAIN: '1' })).rejects.toThrow(/NODE_ENV is unset/);
    await expect(refused({ DEV_FAKE_CHAIN: '1', NODE_ENV: 'test' })).rejects.toThrow(/NODE_ENV=development/);
  });

  it('refuses next to a real chain configuration', async () => {
    await expect(refused({ DEV_FAKE_CHAIN: '1', NODE_ENV: 'development', PROGRAM_ID: 'Prog1111' })).rejects.toThrow(/PROGRAM_ID/);
    await expect(refused({ DEV_FAKE_CHAIN: '1', NODE_ENV: 'development', SERVER_KEYPAIR: '/k.json' })).rejects.toThrow(/SERVER_KEYPAIR/);
  });

  it('keeps its own journal and leaderboard files', () => {
    expect(dataFileNames(loadConfig(env({ DEV_FAKE_CHAIN: '1', NODE_ENV: 'development' })))).toEqual({
      journal: 'journal.dev-fake.json',
      leaderboards: 'leaderboards.dev-fake.json',
    });
    expect(dataFileNames(loadConfig(env({})))).toEqual({ journal: 'journal.json', leaderboards: 'leaderboards.json' });
  });

  it('creates the fake chain outside production, with the token unset unless DEV_FAKE_TOKEN=1', async () => {
    const cfg = loadConfig(env({ DEV_FAKE_CHAIN: '1', NODE_ENV: 'development' }));
    const chain = await createChain(cfg, new Journal(null), () => {});
    expect(chain).toBeInstanceOf(DevFakeChain);
    expect(chain.status()).toMatchObject({ enabled: true, tokenReady: false, arenasEnabled: false, token: null, feeBps: 500 });
    expect(chain.tokenReady).toBe(false);
    expect(chain.stakeEnabled).toBe(false);
    expect(await chain.listArenas()).toEqual([]);
    await chain.stop();

    const ready = await createChain(loadConfig(env({ DEV_FAKE_CHAIN: '1', NODE_ENV: 'development', DEV_FAKE_TOKEN: '1' })), new Journal(null), () => {});
    expect(ready.status()).toMatchObject({ tokenReady: true, arenasEnabled: true, token: { decimals: 6 }, feeBps: 500 });
    expect((await ready.listArenas()).map((a) => a.id)).toEqual([1, 2, 3, 4]);
    await ready.stop();
  });

  it('devSetToken sets the token once and tells the status listeners', async () => {
    const chain = new DevFakeChain(new Journal(null), () => {});
    let changes = 0;
    chain.onStatusChange(() => changes++);
    // no ticket can exist before the token
    expect(await chain.getSession(1, wallet())).toBeNull();
    expect(chain.devSetToken()).toBe(true);
    expect(changes).toBe(1);
    expect(chain.status()).toMatchObject({ tokenReady: true, arenasEnabled: true });
    expect(chain.devSetToken()).toBe(false);
    expect(changes).toBe(1);
  });

  it('issues a ticket per wallet and arena once the token is set', async () => {
    const chain = new DevFakeChain(new Journal(null), () => {}, undefined, { tokenSet: true });
    const w = wallet();
    const a = await chain.getSession(1, w);
    expect(a).not.toBeNull();
    expect(await chain.getSession(1, w)).toBe(a);
    expect('hasPass' in a!).toBe(false);
    // every arena is open to everyone
    expect(await chain.getSession(3, w)).not.toBeNull();
    expect(await chain.getSession(4, w)).not.toBeNull();
    expect(await chain.getSession(99, w)).toBeNull();
  });

  const item = (key: string, player: string, payout: number, sessionId = 1): SettlementItem => ({
    kind: 'settle',
    key,
    player,
    arenaId: 1,
    session: key,
    sessionId,
    payout,
    score: 10,
    kills: 0,
    xp: 0,
    reason: 'cashout',
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: Date.now(),
  });

  it('a loot sweep burns its amount', async () => {
    const journal = new Journal(null);
    const chain = new DevFakeChain(journal, () => {}, 10, { tokenSet: true });
    journal.enqueue({ kind: 'sweep', key: 'sweep:arena-1-1:7', arenaId: 1, roomId: 'arena-1-1', round: 7, amount: 4_321_000, attempts: 0, nextAttemptAt: 0, createdAt: Date.now() });
    chain.kick();
    chain.kick();
    await sleep(60);
    expect(journal.pending).toHaveLength(0);
    expect(chain.burned).toBe(4_321_000);
    await chain.stop();
  });

  it('never touches journal items it did not issue (real money stays owed)', async () => {
    const journal = new Journal(null);
    const chain = new DevFakeChain(journal, () => {}, 10);
    const events: SettledEvent[] = [];
    chain.onSettled((e) => events.push(e));
    const real = item('RealSessionPda1111', wallet(), 5_000_000);
    journal.commit({ enqueue: [real] });
    await chain.start();
    chain.kick();
    await sleep(60);
    expect(journal.pending.map((p) => p.key)).toEqual([real.key]);
    expect(events).toHaveLength(0);
    await chain.stop();
  });

  it('settles journal items after a delay with the fee on profit', async () => {
    const journal = new Journal(null);
    const chain = new DevFakeChain(journal, () => {}, 20, { tokenSet: true });
    const events: SettledEvent[] = [];
    chain.onSettled((e) => events.push(e));
    const w = wallet();
    const s = (await chain.getSession(1, w))!;
    const payout = s.entryFee * 3;
    journal.commit({
      enqueue: [
        {
          kind: 'settle',
          key: s.address,
          player: w,
          arenaId: 1,
          session: s.address,
          sessionId: s.id,
          payout,
          score: 10,
          kills: 0,
          xp: 0,
          reason: 'cashout',
          attempts: 0,
          nextAttemptAt: 0,
          createdAt: Date.now(),
        },
      ],
    });
    chain.kick();
    chain.kick(); // idempotent
    await sleep(80);
    expect(events).toHaveLength(1);
    expect(events[0].payout).toBe(payout);
    expect(events[0].fee).toBe(Math.floor((s.entryFee * 2 * 500) / 10_000));
    expect(journal.pending).toHaveLength(0);
    // the ticket closed: a new one is issued next time
    expect((await chain.getSession(1, w))!.id).not.toBe(s.id);
    await chain.stop();
  });
});

describe('settled message (R16)', () => {
  it('names the session and arena so the client can match its receipt', () => {
    expect(settledMessage({ key: 'Sess1', player: 'P', arenaId: 2, signature: 'sig', payout: 300, fee: 10 })).toEqual({
      t: 'settled',
      kind: 'payout',
      session: 'Sess1',
      arenaId: 2,
      signature: 'sig',
      payout: 300,
      fee: 10,
      net: 290,
    });
    // late confirmations without fee / arena stay well-formed
    expect(settledMessage({ key: 'Sess2', player: 'P', signature: 's', payout: 0 })).toEqual({ t: 'settled', kind: 'death', session: 'Sess2', signature: 's', payout: 0 });
  });
});

describe('dev-only token route', () => {
  const start = async (devFakeChain: boolean): Promise<{ url: string; chain: DevFakeChain | NullChain; close: () => Promise<void> }> => {
    const cfg = loadConfig((devFakeChain ? { DEV_FAKE_CHAIN: '1', NODE_ENV: 'development' } : {}) as unknown as NodeJS.ProcessEnv);
    const chain = devFakeChain ? new DevFakeChain(new Journal(null), () => {}) : new NullChain();
    const server = createHttpServer(cfg, { chain, rooms: {} as never, leaderboards: {} as never, auth: {} as never, startedAt: Date.now() });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;
    return { url: `http://127.0.0.1:${port}`, chain, close: () => new Promise<void>((r) => server.close(() => r())) };
  };

  it('does not exist without the fake chain', async () => {
    const s = await start(false);
    try {
      expect((await fetch(`${s.url}/api/dev/token`, { method: 'POST' })).status).toBe(404);
      // nor do the old Pass routes
      expect((await fetch(`${s.url}/api/dev/pass/reveal`, { method: 'POST' })).status).toBe(404);
    } finally {
      await s.close();
    }
  });

  it('sets the fake token (POST only, once) and /api/config follows', async () => {
    const s = await start(true);
    try {
      const config = async () => ((await (await fetch(`${s.url}/api/config`)).json()) as { chain: { tokenReady: boolean } }).chain;
      expect((await config()).tokenReady).toBe(false);
      expect((await fetch(`${s.url}/api/dev/token`)).status).toBe(405);
      const res = await fetch(`${s.url}/api/dev/token`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ changed: true, chain: { tokenReady: true, arenasEnabled: true } });
      expect((await config()).tokenReady).toBe(true);
      expect(await (await fetch(`${s.url}/api/dev/token`, { method: 'POST' })).json()).toMatchObject({ changed: false });
      for (const gone of ['/api/dev/pass/mint', '/api/dev/pass/reveal']) expect((await fetch(`${s.url}${gone}`, { method: 'POST' })).status).toBe(404);
    } finally {
      await s.close();
    }
  });
});
