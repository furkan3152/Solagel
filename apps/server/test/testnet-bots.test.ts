import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { BotSettingsStore, defaultBotSettings } from '../src/bots/settings';
import { TestnetBotSource, deriveBotKey, type StakedChainView } from '../src/bots/testnet-source';
import { loadConfig } from '../src/config';
import { TICK_MS } from '@elymum/shared';
import type { Player } from '../src/game/entities';
import { Room } from '../src/rooms/room';
import { RoundClock } from '../src/rooms/round-clock';
import { Journal, type SettlementItem } from '../src/stake/journal';
import { ARENA, E18, FakeEvm, SERVER, TOKEN } from './fake-evm';
import { ArenaChain, arena as chainArena, roomDeps } from './helpers';

const SERVER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;

function setup(
  opts: {
    chainId?: number;
    minter?: boolean;
    dir?: string | null;
    view?: Partial<StakedChainView>;
    now?: () => number;
    joinsOpen?: () => boolean;
    liveSessions?: () => Set<string>;
    journal?: Journal;
  } = {},
) {
  const evm = new FakeEvm();
  evm.addArena(1, 1000n);
  evm.addArena(4, 250_000n, { holdersOnly: true });
  if (opts.minter !== false) evm.minters.add(SERVER.toLowerCase());
  const settings = new BotSettingsStore(null, defaultBotSettings(loadConfig({}).bots));
  const journal = opts.journal ?? new Journal(null);
  const logs: string[] = [];
  const view: StakedChainView = { chainId: opts.chainId ?? 31337, stakeEnabled: true, arena: ARENA, token: { address: TOKEN, decimals: 18 }, ...opts.view };
  const dir = opts.dir === undefined ? mkdtempSync(join(tmpdir(), 'elymum-tbots-')) : opts.dir;
  const make = () =>
    new TestnetBotSource({
      chain: () => view,
      client: () => evm,
      serverKey: SERVER_KEY,
      settings,
      journal,
      stateDir: dir,
      log: (m) => logs.push(m),
      receiptTimeoutMs: 1000,
      now: opts.now,
      joinsOpen: opts.joinsOpen,
      liveSessions: opts.liveSessions,
    });
  return { evm, settings, journal, logs, view, dir, source: make(), make };
}

describe('testnet staked bots: wallets', () => {
  it('derives bot keys deterministically from the server key (keccak(serverKey ‖ "elymum-bot" ‖ i))', () => {
    const a = deriveBotKey(SERVER_KEY, 0)!;
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(deriveBotKey(SERVER_KEY, 0)).toBe(a);
    expect(deriveBotKey(SERVER_KEY, 1)).not.toBe(a);
    expect(deriveBotKey(`0x${'11'.repeat(32)}`, 0)).not.toBe(a);
  });

  it('stores addresses only in chains/<id>/bots.json and re-derives the keys at boot', async () => {
    const t = setup();
    const ticket = await t.source.acquire(1, 'arena-1-1');
    expect(ticket).not.toBeNull();
    const file = readFileSync(join(t.dir!, 'bots.json'), 'utf8');
    expect(file).not.toContain(deriveBotKey(SERVER_KEY, 0)!.slice(2));
    const parsed = JSON.parse(file);
    expect(parsed).toMatchObject({ version: 1, serverKey: SERVER, wallets: [{ index: 0, address: privateKeyToAccount(deriveBotKey(SERVER_KEY, 0)!).address }] });
    const again = t.make();
    expect(again.addresses()).toEqual([ticket!.stake.player]);
  });
});

describe('testnet staked bots: funding and tickets', () => {
  it('funds a bot (HYPE for gas from the server key, tELYMUM minted to the bankroll), approves once, joins: a real ticket', async () => {
    const t = setup();
    expect(t.source.wanted(1)).toBe(6);
    const ticket = (await t.source.acquire(1, 'arena-1-1'))!;
    const bot = ticket.stake.player as Address;
    expect(ticket.stake).toMatchObject({ arenaId: 1, entryFee: 1000 * 1e6, value: 1000 * 1e6, sessionId: 1, session: `1:${bot.toLowerCase()}:1` });
    expect(t.evm.valueSent).toEqual([{ to: bot, wei: 5n * 10n ** 16n }]);
    // bankroll 1,000,000 minted, the 1,000 ticket paid out of it
    expect(t.evm.tokenOf(bot)).toBe(999_000n * E18);
    expect(t.evm.sentBy.map((s) => s.call.functionName)).toEqual(['approve', 'join']);
    expect((await t.evm.session(ARENA, 1, bot)).id).toBe(1n);
    expect(t.source.status()).toMatchObject({ active: true, wallets: 1, playing: 1, problem: null });
  });

  it('a wallet with a live ticket is not reused; a released one is, once its session is closed on chain (no new mint, no new approve)', async () => {
    const t = setup();
    const a = (await t.source.acquire(1, 'r'))!;
    const b = (await t.source.acquire(1, 'r'))!;
    expect(b.stake.player).not.toBe(a.stake.player);
    t.source.released(a, 'round', {} as never);
    // the settlement is not confirmed yet: the session is still open on chain
    const c = (await t.source.acquire(1, 'r'))!;
    expect([a.stake.player, b.stake.player]).not.toContain(c.stake.player);
    t.evm.close(1, a.stake.player);
    const before = t.evm.sent.length;
    const d = (await t.source.acquire(1, 'r'))!;
    expect(d.stake.player).toBe(a.stake.player);
    expect(t.evm.sent.length).toBe(before); // still funded: no mint
    expect(t.evm.sentBy.filter((s) => s.from === a.stake.player).map((s) => s.call.functionName)).toEqual(['approve', 'join', 'join']);
  });

  it('the server key is not a TestToken minter: no ticket, a clear log line, zero staked bots', async () => {
    const t = setup({ minter: false });
    expect(await t.source.acquire(1, 'r')).toBeNull();
    expect(await t.source.acquire(1, 'r')).toBeNull();
    const lines = t.logs.filter((l) => /not a minter/.test(l));
    expect(lines).toHaveLength(1); // rate-limited
    expect(lines[0]).toMatch(/grant it in \/admin/);
    expect(t.source.status().problem).toMatch(/not a minter/);
    expect(t.evm.sentBy).toHaveLength(0);
  });

  it('the server key is out of HYPE: no ticket and a log line that says so', async () => {
    const t = setup();
    t.evm.balanceWei = 10n ** 15n;
    expect(await t.source.acquire(1, 'r')).toBeNull();
    expect(t.logs.join('\n')).toMatch(/out of HYPE.*fund it/);
    expect(t.evm.valueSent).toHaveLength(0);
  });

  it('settings apply live: staked bots per arena, per-arena overrides, bankroll and gas', async () => {
    const t = setup();
    t.settings.update({ testnet: { stakedPerArena: 2, gasHype: '0.2', arenas: { '1': { stakedBots: 3, bankroll: '5000' } } } });
    expect(t.source.wanted(1)).toBe(3);
    expect(t.source.wanted(2)).toBe(2);
    const ticket = (await t.source.acquire(1, 'r'))!;
    expect(t.evm.tokenOf(ticket.stake.player)).toBe(4000n * E18);
    expect(t.evm.valueSent[0].wei).toBe(2n * 10n ** 17n);
    t.settings.update({ testnet: { arenas: { '1': { bankroll: '500' } } } });
    expect(await t.source.acquire(1, 'r')).toBeNull();
    expect(t.logs.join('\n')).toMatch(/bankroll of arena #1 is below its entry fee/);
  });

  it('never joins holders-only arenas without an emblem', async () => {
    const t = setup();
    await t.source.acquire(1, 'r');
    expect(await t.source.acquire(4, 'r')).toBeNull();
    expect(t.source.wanted(4)).toBe(0);
    expect(t.evm.sentBy.filter((s) => s.call.functionName === 'join').map((s) => s.call.args[0])).toEqual([1]);
    // a bot wallet that holds an emblem may go (holder checks are cached 5 min: a fresh boot sees it at once)
    t.evm.arenaHolders.add(t.source.addresses()[0].toLowerCase());
    const ticket = await t.make().acquire(4, 'r');
    expect(ticket?.stake.arenaId).toBe(4);
  });

  it('never plays on mainnet (or with the arenas off)', async () => {
    const main = setup({ chainId: 4242 });
    expect(main.source.wanted(1)).toBe(0);
    expect(main.source.active()).toBe(false);
    expect(await main.source.acquire(1, 'r')).toBeNull();
    const off = setup({ view: { stakeEnabled: false } });
    expect(off.source.wanted(1)).toBe(0);
    expect(await off.source.acquire(1, 'r')).toBeNull();
    expect(main.evm.sentBy.length + off.evm.sentBy.length).toBe(0);
  });

  it('a closed arena or a failing join leaves no ticket (the room asks again later), never a throw', async () => {
    const t = setup();
    t.evm.arenaMap.get(1)!.enabled = false;
    expect(await t.source.acquire(1, 'r')).toBeNull();
    expect(t.evm.sentBy).toHaveLength(0);
    const u = setup();
    u.evm.rpcDown = true;
    await expect(u.source.acquire(1, 'r')).resolves.toBeNull();
    expect(u.logs.join('\n')).toMatch(/ticket for arena #1 failed/);
  });
});

describe('testnet staked bots: retries, wallets in use, holders-only arenas', () => {
  it('a failed RPC call backs off (2 s, 4 s … 60 s) and is retried forever, then succeeds', async () => {
    const clock = { now: 1_800_000_000_000 };
    const t = setup({ now: () => clock.now });
    t.evm.rpcDown = true;
    for (let i = 0; i < 8; i++) {
      expect(await t.source.acquire(1, 'r')).toBeNull();
      clock.now += 1_000; // inside the backoff: no RPC call at all
      expect(await t.source.acquire(1, 'r')).toBeNull();
      clock.now += 60_000;
    }
    expect(t.logs.filter((l) => /ticket for arena #1 failed.*retrying/.test(l))).toHaveLength(1); // rate-limited
    t.evm.rpcDown = false;
    const ticket = await t.source.acquire(1, 'r');
    expect(ticket?.stake.arenaId).toBe(1);
    expect(t.source.status().problem).toBeNull();
    // a failed send (the join) is retried on the same wallet, after its backoff
    t.evm.failures.push(new Error('RPC Request failed.'));
    expect(await t.source.acquire(1, 'r')).toBeNull();
    expect(await t.source.acquire(1, 'r')).toBeNull(); // backing off
    clock.now += 2_000;
    expect((await t.source.acquire(1, 'r'))?.stake.arenaId).toBe(1);
  });

  it('skips a holders-only arena quietly: one log line, no wallet created or funded, wanted 0 until the 5-min re-check', async () => {
    const clock = { now: 1_800_000_000_000 };
    const t = setup({ now: () => clock.now });
    expect(t.source.wanted(4)).toBe(6); // not seen yet
    for (let i = 0; i < 50; i++) {
      expect(await t.source.acquire(4, 'arena-4-1')).toBeNull();
      clock.now += 3_000;
    }
    expect(t.source.addresses()).toHaveLength(0);
    expect(t.evm.valueSent).toHaveLength(0);
    expect(t.evm.sentBy).toHaveLength(0);
    expect(t.logs.filter((l) => /arena #4/.test(l))).toEqual([expect.stringMatching(/holders-only and no bot wallet holds an emblem/)]);
    // with wallets: holder checks are cached (no storm of reads), still no ticket and no new wallet
    await t.source.acquire(1, 'arena-1-1');
    clock.now += 5 * 60_000;
    expect(t.source.wanted(4)).toBe(6); // re-check due
    expect(await t.source.acquire(4, 'arena-4-1')).toBeNull();
    expect(t.source.wanted(4)).toBe(0);
    expect(t.source.addresses()).toHaveLength(1);
    expect(t.logs.filter((l) => /arena #4/.test(l))).toHaveLength(1);
  });

  it('the wallet pool grows to what the settings need (4 arenas × 6 + spare), not a fixed number', async () => {
    const t = setup();
    for (const id of [2, 3]) t.evm.addArena(id, 1000n);
    const tickets = [];
    for (const id of [1, 2, 3]) for (let i = 0; i < 6; i++) tickets.push(await t.source.acquire(id, `arena-${id}-1`));
    expect(tickets.every((x) => x !== null)).toBe(true);
    // wallets are shared across arenas (one session per arena and wallet): 6 wallets play 18 tickets
    expect(t.source.addresses()).toHaveLength(6);
    expect(t.source.walletBudget()).toBe(3 * 6 * 2 + 4);
    // every wallet busy in arena 1 (tickets live, settlements stuck): the pool grows past 10
    for (let i = 0; i < 12; i++) expect(await t.source.acquire(1, 'arena-1-1')).not.toBeNull();
    expect(t.source.addresses()).toHaveLength(18);
    t.settings.update({ testnet: { stakedPerArena: 1 } });
    expect(t.source.walletBudget()).toBe(3 * 1 * 2 + 4);
    expect(await t.source.acquire(1, 'arena-1-1')).toBeNull(); // at the budget: no new wallet
    expect(t.logs.join('\n')).toMatch(/no free bot wallet for arena #1 \(all 18 of 10 busy\)/);
  });

  it('a released ticket whose settlement is on its way waits for its wallet instead of creating a new one', async () => {
    const clock = { now: 1_800_000_000_000 };
    const journal = new Journal(null);
    const t = setup({ now: () => clock.now, journal });
    t.settings.update({ testnet: { stakedPerArena: 1 } });
    const a = (await t.source.acquire(1, 'r'))!;
    const item: SettlementItem = {
      kind: 'settle',
      key: a.stake.session,
      player: a.stake.player,
      arenaId: 1,
      session: a.stake.session,
      sessionId: a.stake.sessionId,
      payout: a.stake.value,
      score: 0,
      kills: 0,
      xp: 0,
      reason: 'round',
      attempts: 0,
      nextAttemptAt: clock.now,
      createdAt: clock.now,
    };
    journal.commit({ enqueue: [item] });
    t.source.released(a, 'round', item);
    expect(await t.source.acquire(1, 'r')).toBeNull(); // 'wait': the settlement frees it in a moment
    expect(t.source.addresses()).toHaveLength(1);
    // the chain worker confirms: the same wallet buys the next ticket
    t.evm.close(1, a.stake.player);
    journal.remove(item.key);
    clock.now += 5_000;
    expect((await t.source.acquire(1, 'r'))!.stake.player).toBe(a.stake.player);
  });

  it('reconciles in-use flags with the rooms and adopts an open session no room plays (late receipt, crash before seat)', async () => {
    const clock = { now: Date.now() };
    const live = new Set<string>();
    const t = setup({ now: () => clock.now, liveSessions: () => live });
    t.settings.update({ testnet: { stakedPerArena: 1 } });
    const a = (await t.source.acquire(1, 'r'))!;
    // the room never seated it (or lost it): after the hand-off grace the flag is dropped …
    expect(t.source.reconcile()).toBe(0);
    clock.now += 31_000;
    expect(t.source.reconcile()).toBe(1);
    expect(t.source.status().playing).toBe(0);
    // … and the next pick adopts the open session instead of buying a new ticket
    const joins = t.evm.sentBy.filter((s) => s.call.functionName === 'join').length;
    const b = (await t.source.acquire(1, 'r'))!;
    expect(b.stake).toMatchObject({ player: a.stake.player, session: a.stake.session, sessionId: a.stake.sessionId, value: a.stake.entryFee });
    expect(t.evm.sentBy.filter((s) => s.call.functionName === 'join')).toHaveLength(joins);
    expect(t.logs.join('\n')).toMatch(/adopted its open session/);
    // a ticket a room plays is never touched
    live.add(b.stake.session);
    clock.now += 60_000;
    expect(t.source.reconcile()).toBe(0);
    expect(t.source.status().playing).toBe(1);
  });
});

describe('testnet staked bots: rooms, round after round', () => {
  const ROUND = { roundMs: 60_000, closeMs: 10_000 };
  const FEE = 1000 * 1e6;

  it('every round each arena gets back up to its staked target (bell, death, RPC failure, closed joins); the holders-only arena gets zero-value bots only', async () => {
    const round0 = new RoundClock(() => 0, ROUND).window(1_800_000_000_000);
    const clock = { now: round0.startsAt + 1_000 };
    const roundClock = new RoundClock(() => clock.now, ROUND);
    let rooms: Room[] = [];
    const journal = new Journal(null);
    const t = setup({
      now: () => clock.now,
      journal,
      joinsOpen: () => clock.now < roundClock.window().joinsCloseAt,
      liveSessions: () => new Set(rooms.flatMap((r) => r.liveSessions())),
    });
    t.settings.update({ testnet: { stakedPerArena: 3 } });
    const chain = new ArenaChain([chainArena(1, FEE), chainArena(4, 250 * FEE)]);
    const deps = { ...roomDeps(chain, journal, () => clock.now), round: ROUND, clock: roundClock, stakedBots: t.source, stakedAskMs: 0 };
    const make = (id: number, buyIn: number) =>
      new Room({ id: `arena-${id}-1`, mode: 'arena', name: `A${id}`, instance: 1, maxPlayers: 50, bots: t.settings.options('arena'), stake: { arenaId: id, buyIn }, seed: 7 + id }, deps);
    const r1 = make(1, FEE);
    const r4 = make(4, 250 * FEE);
    rooms = [r1, r4];
    const cap = t.settings.kind('arena').cap;

    const flush = () => new Promise((r) => setImmediate(r));
    const pump = async (n: number) => {
      for (let i = 0; i < n; i++) {
        for (const r of rooms) r.tick(TICK_MS);
        await flush();
        await flush();
      }
    };
    const until = async (cond: () => boolean, step = 250) => {
      for (let i = 0; i < 400 && !cond(); i++) {
        clock.now += step;
        await pump(1);
      }
      expect(cond()).toBe(true);
    };
    /** The chain worker: every pending settlement is confirmed (the session closes on chain). */
    const confirmAll = () => {
      for (const p of [...journal.pending]) {
        if (p.kind === 'settle') t.evm.close(p.arenaId ?? 1, p.player);
        journal.remove(p.key);
      }
    };
    const joins = () => t.evm.sentBy.filter((s) => s.call.functionName === 'join');
    const staked = (r: Room) => [...r.bots!.bots.values()].filter((b) => b.staked).map((b) => b.player);
    const check = () => {
      for (const r of rooms) {
        expect(r.bots!.bots.size).toBeLessThanOrEqual(cap);
        expect(r.bots!.bots.size).toBeGreaterThan(0); // never empty
      }
      expect(r4.bots!.stakedCount).toBe(0);
    };

    // arenas with bots never sleep, even with nobody watching
    r1.lastActivity = 0;
    r4.lastActivity = 0;
    expect(r1.sleeping).toBe(false);

    const perRound: number[] = [];
    for (let round = 1; round <= 3; round++) {
      const w = roundClock.window();
      const before = joins().length;
      await until(() => r1.bots!.stakedCount === 3);
      check();

      if (round === 2) {
        // a bot dies mid-round: its ticket is settled, a new ticket is bought (its wallet comes back once settled)
        const victim = staked(r1)[0];
        const eater = [...r1.bots!.bots.values()].find((b) => !b.staked)!.player;
        eat(r1, eater, victim);
        expect(journal.settlements().filter((i) => i.reason === 'death')).toHaveLength(1);
        expect(r1.bots!.stakedCount).toBe(2);
        confirmAll();
        // and an injected RPC failure on the next purchase: retried after the backoff
        const session = t.evm.session.bind(t.evm);
        let fail = 1;
        t.evm.session = async (...a: Parameters<FakeEvm['session']>) => {
          if (fail-- > 0) throw new Error('RPC Request failed.');
          return session(...a);
        };
        await pump(3);
        expect(r1.bots!.stakedCount).toBe(2); // failed, backing off
        await until(() => r1.bots!.stakedCount === 3);
        expect(t.logs.join('\n')).toMatch(/ticket for arena #1 failed \(RPC Request failed\.\)/);
      }

      if (round === 3) {
        // a death after joins closed: no purchase until the next round
        clock.now = w.joinsCloseAt + 1_000;
        const victim = staked(r1)[0];
        const eater = [...r1.bots!.bots.values()].find((b) => !b.staked)!.player;
        eat(r1, eater, victim);
        confirmAll();
        const n = joins().length;
        for (let i = 0; i < 20; i++) {
          clock.now += 200;
          await pump(1);
        }
        expect(joins().length).toBe(n);
        expect(r1.bots!.stakedCount).toBe(2);
        expect(r1.bots!.bots.size).toBeGreaterThan(2); // zero-value bots hold the seats
      }

      // the bell: every staked bot is settled with everyone; zero-value bots keep the room alive
      perRound.push(joins().length - before);
      const playing = staked(r1).map((p) => p.id);
      const bellSettles = () => journal.settlements().filter((i) => i.reason === 'round' && i.arenaId === 1).length;
      clock.now = w.endsAt + 500;
      await pump(1);
      expect(bellSettles()).toBe(playing.length);
      // the settled bots left with the old round (a wallet already free may buy at once: round 3)
      for (const pid of playing) expect(r1.bots!.bots.has(pid)).toBe(false);
      expect(r1.bots!.stakedCount).toBe(round === 3 ? 1 : 0);
      // the settlements are still on their way: no new wallet is created meanwhile (it waits for them)
      const wallets = t.source.addresses().length;
      await pump(3);
      expect(t.source.addresses()).toHaveLength(wallets);
      expect(r1.bots!.bots.size).toBeGreaterThan(0);
      confirmAll();
    }
    // the 4th round buys again too
    await until(() => r1.bots!.stakedCount === 3);
    check();

    expect(perRound[0]).toBe(3);
    expect(perRound[1]).toBe(4); // 3 + the replacement of the dead bot
    expect(perRound[2]).toBe(3); // the late death was not replaced in its round
    // every ticket in arena 1, none in the holders-only arena, and no wallet churn: 3 wallets all along
    expect(joins().every((j) => j.call.args[0] === 1)).toBe(true);
    expect(t.source.addresses()).toHaveLength(3);
    expect(t.logs.filter((l) => /arena #4/.test(l))).toHaveLength(1);
  }, 60_000);
});

/** Puts `eater` on top of `victim` until the victim dies. */
function eat(room: Room, eater: Player, victim: Player): void {
  eater.shieldUntil = 0;
  victim.shieldUntil = 0;
  for (let i = 0; i < 40 && victim.alive; i++) {
    eater.cells[0].setMass(400);
    for (const c of eater.cells.slice(1)) c.setMass(1);
    victim.cells[0].setMass(20);
    for (const c of victim.cells.slice(1)) c.setMass(1);
    eater.cells[0].x = victim.cells[0].x;
    eater.cells[0].y = victim.cells[0].y;
    room.tick(TICK_MS);
  }
  expect(victim.alive).toBe(false);
}
