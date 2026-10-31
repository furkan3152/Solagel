/**
 * The EVM gateway against a real chain: spawns `hardhat node` (from @elymum/contracts) on a free port,
 * deploys the TestToken and the arena with the SDK, then runs `EvmChain` through the money paths:
 * waiting for contracts → token set → join (real tickets) → one settle batch (fees checked) → loot
 * burn with a sweep id → the stale-session sweeper settling unplayed tickets at their entry fee.
 *
 * Skips itself when the node does not start within 40 s (e.g. Hardhat is not installed). The child process
 * group is killed when the suite ends or the process exits.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BURN_ADDRESS,
  createDefaultArenaCalls,
  createElymumPublicClient,
  createElymumWalletClient,
  deployArena,
  deployTestToken,
  deployedAddress,
  elysiumChain,
  faucetCall,
  getArena,
  getSession,
  getTokenBalance,
  planJoin,
  sendCall,
  setTokenCall,
  testTokenSetMinterCall,
  type ContractCall,
} from '@elymum/sdk';
import { PlayerFlag, TICK_MS, roundAt } from '@elymum/shared';
import type { Address, PublicClient, WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EvmChain, type ContractsView } from '../src/chain/evm';
import { sessionKey, type SettledEvent } from '../src/chain/types';
import { loadConfig } from '../src/config';
import { Journal, sweepKey, type SettlementItem } from '../src/stake/journal';
import { BotSettingsStore, defaultBotSettings } from '../src/bots/settings';
import { TestnetBotSource } from '../src/bots/testnet-source';
import type { Player } from '../src/game/entities';
import { Room } from '../src/rooms/room';
import { fakeConn, roomDeps } from './helpers';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // admin
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // server
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', // player 1
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', // player 2
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a', // fee wallet
] as const;
const [admin, server, p1, p2, feeWallet] = KEYS.map((k) => privateKeyToAccount(k));
const T = 10n ** 18n;
/** 1,000 tokens in ledger units. */
const K = 1_000 * 1e6;

let child: ChildProcess | null = null;
let up = false;
let url = '';
let client: PublicClient;
const wallets = new Map<Address, WalletClient>();

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.unref();
    s.on('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      s.close(() => (typeof a === 'object' && a ? ok(a.port) : fail(new Error('no port'))));
    });
  });
}

function killChild(): void {
  if (!child || child.exitCode !== null || child.pid === undefined) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      /* gone */
    }
  }
}
process.on('exit', killChild);

async function rpcUp(u: string): Promise<boolean> {
  try {
    const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' });
    return r.ok && /"result"/.test(await r.text());
  } catch {
    return false;
  }
}

async function send(from: Address, call: ContractCall): Promise<void> {
  const hash = await sendCall(wallets.get(from)!, call);
  const r = await client.waitForTransactionReceipt({ hash });
  expect(r.status).toBe('success');
}

beforeAll(async () => {
  const port = await freePort();
  url = `http://127.0.0.1:${port}`;
  child = spawn('pnpm', ['-F', '@elymum/contracts', 'exec', 'hardhat', 'node', '--port', String(port)], {
    cwd: repoRoot,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  child.on('error', () => undefined);
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline && child.exitCode === null) {
    if (await rpcUp(url)) {
      up = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!up) {
    killChild();
    console.warn('evm.test: hardhat node did not start within 40 s; skipping');
    return;
  }
  const chain = elysiumChain(31337, { rpcUrl: url });
  client = createElymumPublicClient(url, chain, { pollingInterval: 50 });
  for (const a of [admin, server, p1, p2, feeWallet]) wallets.set(a.address, createElymumWalletClient(url, { account: a, chain, pollingInterval: 50 }));
}, 60_000);

afterAll(() => killChild());

describe('EvmChain on a hardhat node', () => {
  let token: Address;
  let arena: Address;
  let chain: EvmChain;
  const journal = new Journal(null);
  const view: ContractsView = { arena: null, nft: null };
  const settled: SettledEvent[] = [];
  const logs: string[] = [];
  /** The gateway's clock (moved forward to make tickets stale). */
  let skewMs = 0;

  it('starts waiting for contracts, then picks up the deployed arena and its token without a restart', async (ctx) => {
    if (!up) return ctx.skip();
    const cfg = loadConfig({
      EVM_RPC_URL: url,
      SERVER_PRIVATE_KEY: KEYS[1],
      DATA_DIR: mkdtempSync(join(tmpdir(), 'elymum-evm-')),
      STALE_SESSION_AFTER_S: '60',
      LOG_CHUNK_BLOCKS: '5',
    } as unknown as NodeJS.ProcessEnv);
    chain = new EvmChain(cfg, journal, (m) => logs.push(m), { contracts: () => view, loops: false, now: () => Date.now() + skewMs, receiptTimeoutMs: 20_000 });
    chain.onSettled((e) => settled.push(e));
    await chain.start();
    expect(chain.status()).toMatchObject({ enabled: true, chainId: 31337, chainName: 'Localnet', arenaAddress: null, tokenReady: false, serverKey: server.address });

    token = await deployedAddress(client, await deployTestToken(wallets.get(admin.address)!, { owner: admin.address }));
    arena = await deployedAddress(
      client,
      await deployArena(wallets.get(admin.address)!, { admin: admin.address, serverAuthority: server.address, feeWallet: feeWallet.address }),
    );
    view.arena = arena;
    await chain.refresh();
    expect(chain.status()).toMatchObject({ arenaAddress: arena, tokenReady: false });

    await send(admin.address, setTokenCall(arena, token));
    for (const call of createDefaultArenaCalls(arena, 18)) await send(admin.address, call);
    let changes = 0;
    chain.onStatusChange(() => changes++);
    await chain.refresh();
    expect(changes).toBe(1);
    expect(chain.status()).toMatchObject({ tokenReady: true, arenasEnabled: true, token: { address: token, decimals: 18 }, feeBps: 500 });
    expect((await chain.listArenas(true)).map((a) => [a.id, a.entryFee])).toEqual([
      [1, K],
      [2, 10 * K],
      [3, 50 * K],
      [4, 250 * K],
    ]);
    await chain.checkBalance();
    expect(chain.serverInfo()).toMatchObject({ address: server.address, low: false });
  }, 60_000);

  it('real tickets: join, then one settle batch pays both players and the fee wallet', async (ctx) => {
    if (!up) return ctx.skip();
    for (const p of [p1, p2]) {
      await send(p.address, faucetCall(token));
      for (const call of (await planJoin(client, { arena, arenaId: 1, player: p.address, token })).calls) await send(p.address, call);
    }
    const s1 = (await chain.getSession(1, p1.address))!;
    const s2 = (await chain.getSession(1, p2.address.toLowerCase()))!;
    expect(s1).toMatchObject({ key: sessionKey(1, p1.address, s1.id), player: p1.address, entryFee: K, finalized: false });
    expect(s2.id).toBe(s1.id + 1);
    const before1 = await getTokenBalance(client, token, p1.address);
    const item = (s: typeof s1, payout: number, createdAt: number): SettlementItem => ({
      kind: 'settle',
      key: s.key,
      player: s.player,
      arenaId: 1,
      session: s.key,
      sessionId: s.id,
      payout,
      score: 1,
      kills: 1,
      xp: 1,
      reason: 'round',
      attempts: 0,
      nextAttemptAt: 0,
      createdAt,
    });
    // p1 ate half of p2: 1,500 / 500 tokens
    journal.commit({ enqueue: [item(s1, 1.5 * K, 1), item(s2, 0.5 * K, 2)] });
    await chain.processPending();
    expect(journal.pending).toHaveLength(0);
    expect(settled.map((e) => [e.player, e.payout, e.fee])).toEqual([
      [p1.address, 1.5 * K, 25 * 1e6],
      [p2.address, 0.5 * K, 0],
    ]);
    expect(settled[0].txHash).toBe(settled[1].txHash); // one batch
    expect(await getTokenBalance(client, token, p1.address)).toBe(before1 + 1_475n * T);
    expect(await getTokenBalance(client, token, feeWallet.address)).toBe(25n * T);
    expect((await getSession(client, arena, 1, p1.address)).id).toBe(0n);
    expect((await getArena(client, arena, 1)).vault).toBe(0n);
  }, 60_000);

  it('burns floor loot with a sweep id the journal assigned', async (ctx) => {
    if (!up) return ctx.skip();
    for (const call of (await planJoin(client, { arena, arenaId: 1, player: p1.address, token })).calls) await send(p1.address, call);
    const s = (await chain.getSession(1, p1.address))!;
    // p1 lost 100 tokens to a bot (spilled as loot nobody picked up): paid 900, the loot is burned
    journal.commit({
      enqueue: [
        { kind: 'settle', key: s.key, player: s.player, arenaId: 1, session: s.key, sessionId: s.id, payout: 0.9 * K, score: 1, kills: 0, xp: 1, reason: 'round', attempts: 0, nextAttemptAt: 0, createdAt: 3 },
        { kind: 'sweep', key: sweepKey('arena-1-1', 9), arenaId: 1, roomId: 'arena-1-1', round: 9, amount: 100 * 1e6, attempts: 0, nextAttemptAt: 0, createdAt: 4 },
      ],
    });
    await chain.processPending();
    expect(journal.pending).toHaveLength(0);
    expect(journal.lastSweepId(1)).toBe(1);
    const a = await getArena(client, arena, 1);
    expect(a).toMatchObject({ lastSweepId: 1n, totalBurned: 100n * T, vault: 0n, openSessions: 0 });
    expect(await getTokenBalance(client, token, BURN_ADDRESS)).toBe(100n * T);
    expect(logs.join('\n')).toMatch(/burned 100 \$ELYMUM loot of arena-1-1 \(round 9\) · sweep #1/);
  }, 60_000);

  it('the stale sweeper finds unplayed tickets in the Joined logs and settles them at the entry fee', async (ctx) => {
    if (!up) return ctx.skip();
    for (const call of (await planJoin(client, { arena, arenaId: 2, player: p2.address, token })).calls) await send(p2.address, call);
    expect(await chain.sweepStale()).toBe(0); // fresh tickets are not stale
    skewMs = 3_600_000;
    const before2 = await getTokenBalance(client, token, p2.address);
    expect(await chain.sweepStale()).toBe(1); // every arena-1 ticket was settled: only p2's in arena 2
    expect(journal.settlements().map((s) => [s.player, s.arenaId, s.payout, s.reason])).toEqual([[p2.address, 2, 10 * K, 'stale']]);
    await chain.processPending();
    expect(journal.pending).toHaveLength(0);
    expect(await getTokenBalance(client, token, p2.address)).toBe(before2 + 10_000n * T);
    expect((await getSession(client, arena, 2, p2.address)).id).toBe(0n);
    expect(settled.at(-1)).toMatchObject({ player: p2.address, arenaId: 2, payout: 10 * K, fee: 0 });
    expect((await getArena(client, arena, 2)).vault).toBe(0n);
    expect(await chain.sweepStale()).toBe(0);
    await chain.stop();
  }, 60_000);
});

/** Puts `eater` on top of `victim` until the victim dies. */
function eat(room: Room, eater: Player, victim: Player): void {
  eater.shieldUntil = 0;
  victim.shieldUntil = 0;
  eater.cells[0].setMass(400);
  for (const c of eater.cells.slice(1)) c.setMass(1);
  victim.cells[0].setMass(20);
  for (const c of victim.cells.slice(1)) c.setMass(1);
  eater.cells[0].x = victim.cells[0].x;
  eater.cells[0].y = victim.cells[0].y;
  room.world.setTarget(eater.id, victim.cells[0].x, victim.cells[0].y);
  room.world.setTarget(victim.id, victim.cells[0].x, victim.cells[0].y);
  for (let i = 0; i < 40 && victim.alive; i++) room.tick(TICK_MS);
  expect(victim.alive).toBe(false);
}

describe('testnet staked bots on a hardhat node', () => {
  it('bots are funded (minter + gas from the server key), buy real tickets, their value moves when eaten, and they settle at the bell', async (ctx) => {
    if (!up) return ctx.skip();
    const token = await deployedAddress(client, await deployTestToken(wallets.get(admin.address)!, { owner: admin.address }));
    const arena = await deployedAddress(
      client,
      await deployArena(wallets.get(admin.address)!, { admin: admin.address, serverAuthority: server.address, feeWallet: feeWallet.address }),
    );
    await send(admin.address, setTokenCall(arena, token));
    for (const call of createDefaultArenaCalls(arena, 18)) await send(admin.address, call);
    const journal = new Journal(null);
    const logs: string[] = [];
    const cfg = loadConfig({ EVM_RPC_URL: url, SERVER_PRIVATE_KEY: KEYS[1], DATA_DIR: mkdtempSync(join(tmpdir(), 'elymum-bots-evm-')) } as unknown as NodeJS.ProcessEnv);
    const chain = new EvmChain(cfg, journal, (m) => logs.push(m), { contracts: () => ({ arena, nft: null }), loops: false, receiptTimeoutMs: 20_000, stateChainId: 31337 });
    await chain.start();
    expect(chain.stakeEnabled).toBe(true);

    // the one admin step: the server key becomes a TestToken minter (it funds the bot wallets)
    await send(admin.address, testTokenSetMinterCall(token, server.address, true));
    const settings = new BotSettingsStore(null, defaultBotSettings(cfg.bots));
    settings.update({ testnet: { stakedPerArena: 2, bankroll: '5000', gasHype: '0.05' } });
    const source = new TestnetBotSource({
      chain: () => {
        const st = chain.status();
        return { chainId: st.chainId, stakeEnabled: chain.stakeEnabled, arena: st.arenaAddress, token: st.token };
      },
      client: () => chain.evm(),
      serverKey: KEYS[1],
      settings,
      journal,
      stateDir: mkdtempSync(join(tmpdir(), 'elymum-bots-state-')),
      log: (m) => logs.push(m),
      receiptTimeoutMs: 20_000,
    });
    const clock = { now: roundAt(1_791_000_000_000).startsAt + 60_000 };
    const room = new Room(
      { id: 'arena-1-1', mode: 'arena', name: 'Arena', instance: 1, maxPlayers: 50, bots: { target: 4, min: 0, max: 4 }, stake: { arenaId: 1, buyIn: K }, seed: 11 },
      { ...roomDeps(chain, journal, () => clock.now), stakedBots: source },
    );

    // the room buys two tickets through the source (it asks at most every 3 s)
    const deadline = Date.now() + 40_000;
    while (room.bots!.stakedCount < 2 && Date.now() < deadline) {
      room.tick(TICK_MS);
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(room.bots!.stakedCount).toBe(2);
    const staked = [...room.bots!.bots.values()].filter((b) => b.staked);
    const [bot1, bot2] = staked.map((b) => b.staked!.stake.player as Address);
    for (const b of [bot1, bot2]) {
      expect((await getSession(client, arena, 1, b)).id).toBeGreaterThan(0n);
      // bankroll 5,000 minted, one 1,000 ticket paid
      expect(await getTokenBalance(client, token, b)).toBe(4_000n * T);
      expect(await client.getBalance({ address: b })).toBeGreaterThan(0n);
    }
    expect(staked[0].player.flags).toBe(PlayerFlag.Bot | PlayerFlag.Staker);

    // a human with a real ticket eats bot 1: its value moves to the human
    await send(p1.address, faucetCall(token)).catch(() => undefined);
    for (const call of (await planJoin(client, { arena, arenaId: 1, player: p1.address, token })).calls) await send(p1.address, call);
    const s = (await chain.getSession(1, p1.address))!;
    const human = room.join(fakeConn(p1.address), {
      name: 'human',
      skin: 1,
      flags: PlayerFlag.Staker,
      stake: { player: p1.address, session: s.key, sessionId: s.id, arenaId: 1, entryFee: s.entryFee, value: s.entryFee, openedAt: s.openedAt },
    });
    eat(room, human, staked[0].player);
    expect(room.ledger!.value(human.id)).toBe(2 * K);
    expect(journal.settlements().find((i) => i.player === bot1)).toMatchObject({ reason: 'death', payout: 0 });

    // the bell settles the human and bot 2 with everyone; the chain worker pays out in one pass
    const before1 = await getTokenBalance(client, token, p1.address);
    clock.now += 5 * 60_000;
    room.tick(TICK_MS);
    expect(journal.settlements().filter((i) => i.reason === 'round').map((i) => [i.player, i.payout]).sort()).toEqual(
      [
        [p1.address, 2 * K],
        [bot2, K],
      ].sort(),
    );
    await chain.processPending();
    expect(journal.pending).toHaveLength(0);
    expect(await getTokenBalance(client, token, p1.address)).toBe(before1 + 1_950n * T);
    expect(await getTokenBalance(client, token, bot1)).toBe(4_000n * T);
    expect(await getTokenBalance(client, token, bot2)).toBe(5_000n * T);
    for (const b of [bot1, bot2, p1.address]) expect((await getSession(client, arena, 1, b)).id).toBe(0n);
    expect((await getArena(client, arena, 1)).vault).toBe(0n);
    await chain.stop();
  }, 120_000);
});
