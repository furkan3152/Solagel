import { Keypair } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { createChain, dataFileNames } from '../src/chain';
import { DevFakeChain } from '../src/chain/dev-fake';
import type { SettledEvent } from '../src/chain/types';
import { loadConfig } from '../src/config';
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
    expect(status.pass?.revealed).toBe(true);
    expect(status.pass?.seed).toMatch(/^[0-9a-f]{64}$/);
    await chain.stop();
  });

  it('issues a ticket per wallet and arena, Pass arenas with the wallet Pass', async () => {
    const chain = new DevFakeChain(new Journal(null), () => {});
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
      kind: 'cashout',
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
