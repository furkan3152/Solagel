/**
 * RPC load estimate, before vs after the 2026-11-01 rate-limit fix, under the same staked-bot load.
 *
 * A 15-minute simulation on the fake chain: 4 arenas × 6 staked-bot slots, a bot dies on average every
 * ~7 minutes of slot time (the churn seen in production: ~40 ticket purchases per 5-minute round), the
 * bell settles every live bot each round, and the real `TestnetBotSource` buys the tickets and the real
 * `EvmChain` worker settles them. Every `EvmClient` call is mapped to the JSON-RPC calls it costs:
 *
 * - before: no Multicall3 (an arena list is 1 + n calls, concurrent reads are separate), viem's
 *   `waitForTransactionReceipt` (block number + receipt per 1 s poll: ~3 calls per transaction), bots
 *   re-buy right after every death (no caps), and the background pollers at their old intervals;
 * - after: concurrent `eth_call`s issued together (a `Promise.all`) merge into one Multicall3 call, receipts are
 *   polled directly (~1.5 calls), bots buy at most their target per round and 4 per minute, and the
 *   background pollers at their new intervals.
 *
 * The test prints the per-minute numbers and checks that the new policy cuts the load several times.
 */
import { describe, expect, it } from 'vitest';
import type { ContractCall } from '@elymum/sdk';
import { BotSettingsStore, defaultBotSettings } from '../src/bots/settings';
import { BOT_TICKETS_PER_MIN, TestnetBotSource, type StakedChainView } from '../src/bots/testnet-source';
import { EvmChain } from '../src/chain/evm';
import type { EvmClient } from '../src/chain/evm-client';
import { loadConfig } from '../src/config';
import { Journal, type SettlementItem } from '../src/stake/journal';
import type { StakedBotTicket } from '../src/bots/staked';
import { generatePrivateKey } from 'viem/accounts';
import { ARENA, FakeEvm, SERVER, TOKEN } from './fake-evm';

const SERVER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const ARENAS = [1, 2, 3, 4];
const SLOTS = 6;
const SIM_MINUTES = 15;
const ROUND_MS = 5 * 60_000;
/** Death probability of a live staked bot per simulated second (mean lifetime ~7 min). */
const DEATH_PER_S = 1 / 420;

type Policy = 'before' | 'after';

/** `eth_call` methods (merged by Multicall3 after the fix when issued in the same turn). */
const ETH_CALL = new Set(['session', 'arena', 'arenaConfig', 'tokenBalance', 'allowance', 'isMinter', 'ownerOf', 'mintState', 'nftBalance', 'isArenaHolder', 'testTokenFaucet']);

/** Wraps the fake chain, counting the JSON-RPC calls each `EvmClient` call would cost under `policy`. */
function counting(evm: FakeEvm, policy: Policy) {
  const calls: Record<string, number> = {};
  const add = (k: string, n: number) => (calls[k] = (calls[k] ?? 0) + n);
  let turnMerged = false;
  const mergeable = () => {
    if (policy === 'before') return false;
    if (turnMerged) return true;
    // calls issued in one synchronous run (a `Promise.all` of reads) share one Multicall3 call
    turnMerged = true;
    queueMicrotask(() => (turnMerged = false));
    return false;
  };
  /** A transaction: simulate + nonce + fee data (block, priority fee) + estimate + sendRawTransaction. */
  const sendCost = 6;
  const receiptCost = policy === 'before' ? 3 : 1.5;
  const wrapped = new Proxy(evm, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== 'function') return v;
      const name = String(prop);
      if (name === 'signer') {
        return (key: `0x${string}`) => {
          const s = target.signer(key);
          return {
            address: s.address,
            send: (call: ContractCall) => {
              add('tx', sendCost);
              return s.send(call);
            },
          };
        };
      }
      return (...args: unknown[]) => {
        if (name === 'arenas') add('eth_call', policy === 'before' ? 1 + target.arenaMap.size : 2);
        else if (ETH_CALL.has(name)) add('eth_call', mergeable() ? 0 : 1);
        else if (name === 'send' || name === 'sendValue') add('tx', sendCost);
        else if (name === 'receipt') add('receipt', receiptCost);
        else if (name === 'balance') add('eth_getBalance', 1);
        else if (name === 'blockNumber') add('eth_blockNumber', 1);
        else if (name === 'joinedLogs' || name === 'transferLogs') add('eth_getLogs', 1);
        return (v as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as unknown as EvmClient;
  return { client: wrapped, calls };
}

/** Background pollers (calls per minute) at the old and the new intervals, with 4 arenas and ~24 open sessions. */
function background(policy: Policy): Record<string, number> {
  const arenaList = policy === 'before' ? 1 + ARENAS.length : 2;
  return policy === 'before'
    ? {
        // config re-read by the 30 s watcher
        config: 2,
        // RoomManager + EvmChain arena list (30 s), and again after every settlement (the cache was dropped): counted in the sim
        arenaList: 2 * arenaList,
        // mint page: mintState every 15 s while the page polls, holder index every 30 s (block number + one 10k-block chunk)
        mintState: 4,
        holderIndex: 4,
        // stale sweeper every 5 min: block number + logs + one read per open session (8 at a time, no multicall)
        staleSweeper: (2 + 24) / 5,
        balance: 0.2,
      }
    : {
        config: 1 / 3,
        arenaList: 1 * arenaList,
        mintState: 2,
        holderIndex: 1,
        staleSweeper: (2 + 24 / 8) / 5,
        balance: 0.2,
      };
}

async function simulate(policy: Policy) {
  const evm = new FakeEvm();
  for (const id of ARENAS) evm.addArena(id, 1000n);
  evm.minters.add(SERVER.toLowerCase());
  const { client, calls } = counting(evm, policy);
  const clock = { now: Date.now() };
  const journal = new Journal(null);
  const cfg = loadConfig({ EVM_RPC_URL: 'http://127.0.0.1:1', SERVER_PRIVATE_KEY: generatePrivateKey() } as unknown as NodeJS.ProcessEnv);
  const chain = new EvmChain(cfg, journal, () => {}, { client, contracts: () => ({ arena: ARENA, nft: null }), loops: false, now: () => clock.now, receiptTimeoutMs: 10 });
  await chain.start();
  const settings = new BotSettingsStore(null, defaultBotSettings(cfg.bots));
  settings.update({ testnet: { stakedPerArena: SLOTS } });
  const view: StakedChainView = { chainId: 31337, stakeEnabled: true, arena: ARENA, token: { address: TOKEN, decimals: 18 } };
  const source = new TestnetBotSource({
    chain: () => view,
    client: () => client,
    serverKey: SERVER_KEY,
    settings,
    journal,
    stateDir: null,
    now: () => clock.now,
    receiptTimeoutMs: 10,
    ...(policy === 'after' ? { round: () => Math.floor(clock.now / ROUND_MS), maxTicketsPerMinute: BOT_TICKETS_PER_MIN } : { maxTicketsPerMinute: Infinity }),
  });
  // a seeded random for the deaths: both policies see the same draws
  let seed = 42;
  const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
  const live = new Map<string, StakedBotTicket>();
  const lastAsk = new Map<number, number>();
  const pending = new Set<number>();
  let bought = 0;
  let arenaListReads = 0;
  const settle = (t: StakedBotTicket, reason: 'death' | 'round') => {
    const s = t.stake;
    const item: SettlementItem = {
      kind: 'settle',
      key: s.session,
      player: s.player,
      arenaId: s.arenaId,
      session: s.session,
      sessionId: s.sessionId,
      payout: reason === 'death' ? 0 : s.entryFee,
      score: 0,
      kills: 0,
      xp: 0,
      reason,
      attempts: 0,
      nextAttemptAt: clock.now,
      createdAt: Date.now() - 120_000,
    };
    journal.enqueue(item);
    source.released(t, reason, item);
    // before the fix every settlement dropped the cached arena list: the next ask re-read it
    if (policy === 'before') arenaListReads++;
  };
  const start = clock.now;
  let round = Math.floor(clock.now / ROUND_MS);
  for (let s = 0; s < SIM_MINUTES * 60; s++) {
    clock.now += 1_000;
    const r = Math.floor(clock.now / ROUND_MS);
    if (r !== round) {
      round = r;
      for (const [k, t] of live) {
        settle(t, 'round');
        live.delete(k);
      }
    }
    for (const [k, t] of live) {
      if (rand() < DEATH_PER_S) {
        settle(t, 'death');
        live.delete(k);
      }
    }
    // each arena's room asks for a missing staked bot at most every 3 s, one purchase at a time
    for (const id of ARENAS) {
      const have = [...live.values()].filter((t) => t.stake.arenaId === id).length;
      if (have >= SLOTS || pending.has(id) || clock.now - (lastAsk.get(id) ?? 0) < 3_000) continue;
      lastAsk.set(id, clock.now);
      pending.add(id);
      const t = await source.acquire(id, `arena-${id}-1`);
      pending.delete(id);
      if (t) {
        bought++;
        live.set(t.stake.session, t);
      }
    }
    // the settlement worker runs every second
    await chain.processPending();
  }
  const minutes = (clock.now - start) / 60_000;
  const simCalls = Object.values(calls).reduce((a, b) => a + b, 0) + arenaListReads * (1 + ARENAS.length);
  const bg = background(policy);
  const bgPerMin = Object.values(bg).reduce((a, b) => a + b, 0);
  return {
    policy,
    ticketsPerMin: bought / minutes,
    simPerMin: simCalls / minutes,
    backgroundPerMin: bgPerMin,
    totalPerMin: simCalls / minutes + bgPerMin,
    breakdown: Object.fromEntries(Object.entries(calls).map(([k, v]) => [k, Math.round(v / minutes)])),
  };
}

describe('RPC load estimate (fake chain, same bot load)', () => {
  it('the new budget policy cuts the calls per minute several times', async () => {
    const before = await simulate('before');
    const after = await simulate('after');
    const fmt = (r: Awaited<ReturnType<typeof simulate>>) =>
      `${r.policy.padEnd(6)} tickets ${r.ticketsPerMin.toFixed(1)}/min · bots+settlement ${r.simPerMin.toFixed(0)} calls/min · background ${r.backgroundPerMin.toFixed(0)} calls/min · total ${r.totalPerMin.toFixed(0)} calls/min · ${JSON.stringify(r.breakdown)}`;
    console.log(`rpc load estimate (${SIM_MINUTES} simulated minutes, ${ARENAS.length} arenas × ${SLOTS} staked bots):\n  ${fmt(before)}\n  ${fmt(after)}`);
    expect(after.ticketsPerMin).toBeLessThan(before.ticketsPerMin);
    expect(after.ticketsPerMin).toBeLessThanOrEqual(BOT_TICKETS_PER_MIN);
    expect(after.totalPerMin * 2.5).toBeLessThan(before.totalPerMin);
  }, 120_000);
});
