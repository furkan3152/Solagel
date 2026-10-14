import { Keypair } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { createChain } from '../src/chain';
import { DevFakeChain } from '../src/chain/dev-fake';
import type { SettledEvent } from '../src/chain/types';
import { loadConfig } from '../src/config';
import { Journal } from '../src/stake/journal';

const wallet = () => Keypair.generate().publicKey.toBase58();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('DEV_FAKE_CHAIN', () => {
  it('is off by default and refused in production', async () => {
    expect(loadConfig({} as NodeJS.ProcessEnv).devFakeChain).toBe(false);
    const cfg = loadConfig({ DEV_FAKE_CHAIN: '1', NODE_ENV: 'production' } as NodeJS.ProcessEnv);
    await expect(createChain(cfg, new Journal(null), () => {})).rejects.toThrow(/production/);
  });

  it('creates the fake chain outside production', async () => {
    const cfg = loadConfig({ DEV_FAKE_CHAIN: '1', NODE_ENV: 'development' } as NodeJS.ProcessEnv);
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
