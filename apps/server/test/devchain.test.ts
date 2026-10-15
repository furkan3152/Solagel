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

  it('creates the fake chain outside production', async () => {
    const cfg = loadConfig(env({ DEV_FAKE_CHAIN: '1', NODE_ENV: 'development' }));
    const chain = await createChain(cfg, new Journal(null), () => {});
    expect(chain).toBeInstanceOf(DevFakeChain);
    const status = chain.status();
    expect(status.arenasEnabled).toBe(true);
    expect(status.token?.decimals).toBe(6);
    // the default collection: mint open, unrevealed, no seed yet
    expect(status.pass).toMatchObject({ mintOpen: true, revealed: false, seed: null });
    await chain.stop();
  });

  it('DEV_FAKE_PASS=revealed keeps one revealed Pass per wallet', async () => {
    const cfg = loadConfig(env({ DEV_FAKE_CHAIN: '1', NODE_ENV: 'development', DEV_FAKE_PASS: 'revealed' }));
    expect(cfg.devFakePass).toBe('revealed');
    expect(loadConfig(env({})).devFakePass).toBe('mint');
    const chain = await createChain(cfg, new Journal(null), () => {});
    const status = chain.status();
    expect(status.pass?.revealed).toBe(true);
    expect(status.pass?.seed).toMatch(/^[0-9a-f]{64}$/);
    expect(await chain.ownedPasses(wallet())).toHaveLength(1);
    await chain.stop();
  });

  it('mint mode: a fresh wallet has no Pass, mints one sealed Pass, then a dev reveal publishes the seed', async () => {
    const chain = new DevFakeChain(new Journal(null), () => {});
    const w = wallet();
    expect(await chain.ownedPasses(w)).toEqual([]);
    // no Pass: no ticket for a Pass arena (free arenas still sell)
    expect(await chain.getSession(3, w)).toBeNull();
    expect(await chain.getSession(1, w)).not.toBeNull();
    const before = chain.passStatus().minted;
    const res = chain.devMintPass(w);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.pass.number).toBe(before + 1);
    expect(chain.passStatus()).toMatchObject({ minted: before + 1, mintOpen: true, revealed: false, seed: null });
    expect(await chain.ownedPasses(w)).toEqual([res.pass]);
    expect(await chain.getPass(res.pass.asset)).toEqual({ number: res.pass.number, owner: w });
    // one per wallet
    expect(chain.devMintPass(w)).toEqual({ ok: false, error: 'MintLimit' });
    // made-up assets are not Passes of the collection
    expect(await chain.getPass(`DevPass7x${w}`)).toBeNull();
    const revealed = chain.devRevealPasses();
    expect(revealed).toMatchObject({ mintOpen: false, revealed: true });
    expect(revealed.seed).toMatch(/^[0-9a-f]{64}$/);
    expect(chain.devMintPass(wallet())).toEqual({ ok: false, error: 'MintClosed' });
  });

  it('issues a ticket per wallet and arena, Pass arenas with the wallet Pass', async () => {
    const chain = new DevFakeChain(new Journal(null), () => {}, undefined, 'revealed');
    const w = wallet();
    const a = await chain.getSession(1, w);
    expect(a).not.toBeNull();
    expect(await chain.getSession(1, w)).toBe(a);
    expect(a!.hasPass).toBe(false);
    const b = await chain.getSession(3, w);
    expect(b!.hasPass).toBe(true);
    const pass = await chain.getPass(b!.passAsset!);
    expect(pass?.owner).toBe(w);
    expect((await chain.ownedPasses(w))[0].number).toBe(pass?.number);
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

  it('a loot sweep adds its amount to the running season pool', async () => {
    const journal = new Journal(null);
    const chain = new DevFakeChain(journal, () => {}, 10);
    const pool = (await chain.season())!.prizePool;
    expect(chain.seasonPool).toBe(pool);
    journal.enqueue({ kind: 'sweep', key: 'sweep:arena-1-1:7', arenaId: 1, roomId: 'arena-1-1', round: 7, amount: 4_321_000, attempts: 0, nextAttemptAt: 0, createdAt: Date.now() });
    chain.kick();
    chain.kick();
    await sleep(60);
    expect(journal.pending).toHaveLength(0);
    expect((await chain.season())!.prizePool).toBe(pool + 4_321_000);
    expect(chain.seasonPool).toBe(pool + 4_321_000);
    await chain.stop();
  });

  it('serves a sample season with a finalized previous season for the leaderboard', async () => {
    const chain = new DevFakeChain(new Journal(null), () => {});
    const season = await chain.season();
    expect(season?.finalized).toBe(false);
    expect(season?.entries.length).toBeGreaterThanOrEqual(10);
    const points = season!.entries.map((e) => e.points);
    expect([...points].sort((a, b) => b - a)).toEqual(points);
    expect(season?.previous?.entries.length).toBeGreaterThanOrEqual(10);
    expect(season?.previous?.prizePool).toBeGreaterThan(0);
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
    const chain = new DevFakeChain(journal, () => {}, 20);
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

describe('dev-only Pass routes', () => {
  const start = async (devFakeChain: boolean): Promise<{ url: string; close: () => Promise<void> }> => {
    const cfg = loadConfig((devFakeChain ? { DEV_FAKE_CHAIN: '1', NODE_ENV: 'development' } : {}) as unknown as NodeJS.ProcessEnv);
    const chain = devFakeChain ? new DevFakeChain(new Journal(null), () => {}) : new NullChain();
    const server = createHttpServer(cfg, { chain, rooms: {} as never, leaderboards: {} as never, auth: {} as never, startedAt: Date.now() });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;
    return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
  };

  it('do not exist without the fake chain', async () => {
    const s = await start(false);
    try {
      expect((await fetch(`${s.url}/api/dev/pass/reveal`, { method: 'POST' })).status).toBe(404);
      expect((await fetch(`${s.url}/api/dev/pass/mint?wallet=${wallet()}`, { method: 'POST' })).status).toBe(404);
    } finally {
      await s.close();
    }
  });

  it('mint into a wallet and reveal the fake collection', async () => {
    const s = await start(true);
    try {
      const w = wallet();
      expect((await fetch(`${s.url}/api/dev/pass/mint?wallet=${w}`)).status).toBe(405);
      const mint = await fetch(`${s.url}/api/dev/pass/mint?wallet=${w}`, { method: 'POST' });
      expect(mint.status).toBe(200);
      const body = (await mint.json()) as { ok: boolean; pass: { asset: string; number: number } };
      expect(body.ok).toBe(true);
      const owned = (await (await fetch(`${s.url}/api/pass/owned?wallet=${w}`)).json()) as { passes: unknown[] };
      expect(owned.passes).toEqual([body.pass]);
      expect((await fetch(`${s.url}/api/dev/pass/mint?wallet=${w}`, { method: 'POST' })).status).toBe(409);
      const reveal = (await (await fetch(`${s.url}/api/dev/pass/reveal`, { method: 'POST' })).json()) as { pass: { revealed: boolean } };
      expect(reveal.pass.revealed).toBe(true);
    } finally {
      await s.close();
    }
  });
});
