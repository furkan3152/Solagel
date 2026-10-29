import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TICK_MS } from '@elymum/shared';
import { describe, expect, it } from 'vitest';
import type { ChainProfile } from '../src/chain/types';
import { NullChain } from '../src/chain/types';
import { loadConfig } from '../src/config';
import { RoomManager } from '../src/rooms/manager';
import type { Room } from '../src/rooms/room';
import { Journal } from '../src/stake/journal';
import { ArenaChain, arena, fakeConn, roomDeps, stakeJoin } from './helpers';

const FEE = 1_000_000;

function manager(env: Record<string, string> = {}, chain = new ArenaChain([arena(1, FEE), arena(3, 5 * FEE)]), journal = new Journal(null)) {
  const cfg = loadConfig({ DATA_DIR: mkdtempSync(join(tmpdir(), 'slana-mm-')), ...env });
  return new RoomManager(cfg, roomDeps(chain, journal), chain);
}

const practiceJoin = (n: number) => ({ name: `p${n}`, skin: 0, flags: 0 });

/** Lets a fresh staker be eaten by a zero-value eater right where it stands; returns the spilled value. */
function spillStaker(room: Room, fee: number): void {
  const conn = fakeConn(`w-${room.id}`);
  const p = room.join(conn, stakeJoin(room.opts.stake!.arenaId, fee));
  p.shieldUntil = 0;
  const c = p.center();
  room.world.addPlayer({ name: 'eater', skin: 0, isBot: true, x: c.x, y: c.y, mass: 600, spawnShield: false });
  for (let i = 0; i < 30 && p.alive; i++) room.tick(TICK_MS);
  expect(p.alive).toBe(false);
}

const lootSum = (room: Room) => room.world.loot().reduce((s, l) => s + l.value, 0);

describe('matchmaking', () => {
  it('practice picks busiest non-full room per league', () => {
    const m = manager({ PRACTICE_CAPACITY: '3' });
    const r1 = m.practiceRoom('rookie');
    expect(r1.id).toBe('practice-rookie-1');
    expect(r1.info().league).toBe('rookie');
    expect(r1.opts.maxPlayers).toBe(3);
    const c1 = [fakeConn(), fakeConn(), fakeConn()];
    for (const [i, c] of c1.entries()) r1.join(c, practiceJoin(i));
    expect(r1.isFull).toBe(true);

    const r2 = m.practiceRoom('rookie');
    expect(r2.id).toBe('practice-rookie-2');
    r2.join(fakeConn(), practiceJoin(9));
    // r1 2 humans, r2 1 human → r1 is the busiest non-full room
    r1.leave(c1[0], 'left');
    expect(m.practiceRoom('rookie')).toBe(r1);
    // r1 1 human, r2 2 humans → r2
    r1.leave(c1[1], 'left');
    r2.join(fakeConn(), practiceJoin(10));
    expect(m.practiceRoom('rookie')).toBe(r2);

    // the pro league never shares rooms with rookies
    const pro = m.practiceRoom('pro');
    expect(pro.id).toBe('practice-pro-1');
    expect(pro.info().league).toBe('pro');
    expect(m.practiceRoom('pro')).toBe(pro);
    const leagues = m
      .list()
      .filter((r) => r.mode === 'practice')
      .map((r) => r.league);
    expect(leagues).toEqual(expect.arrayContaining(['rookie', 'pro']));
  });

  it('arena opens a second instance at 50 humans', async () => {
    const chain = new ArenaChain([arena(1, FEE), arena(3, 5 * FEE)]);
    const m = manager({}, chain);
    const a1 = (await m.arenaRoom(1))!;
    expect(a1.id).toBe('arena-1-1');
    const first = stakeJoin(1, FEE);
    a1.join(fakeConn(first.stake.player), first);
    for (let i = 1; i < 49; i++) a1.join(fakeConn(`w${i}`), stakeJoin(1, FEE));
    expect(await m.arenaRoom(1)).toBe(a1);
    a1.join(fakeConn('w49'), stakeJoin(1, FEE));
    expect(a1.humans.size).toBe(50);

    const a2 = (await m.arenaRoom(1))!;
    expect(a2.id).toBe('arena-1-2');
    expect(a2).not.toBe(a1);
    const late = stakeJoin(1, FEE);
    a2.join(fakeConn(late.stake.player), late);
    expect(await m.arenaRoom(1)).toBe(a2);

    const infos = m.list().filter((r) => r.mode === 'arena' && r.arenaId === 1);
    expect(infos.map((r) => [r.id, r.instance, r.entryFee, r.loot])).toEqual([
      ['arena-1-1', 1, FEE, 0],
      ['arena-1-2', 2, FEE, 0],
    ]);
    const gold = (await m.arenaRoom(3))!;
    expect(gold.info()).toMatchObject({ id: 'arena-3-1', arenaId: 3, entryFee: 5 * FEE, instance: 1 });
    expect(await m.arenaRoom(7)).toBeNull();
    // arena data is cached for 30 s
    expect(chain.listCalls).toBe(1);
    // a wallet is found in whichever instance it plays
    expect(m.findArenaStake(1, late.stake.player)?.room).toBe(a2);
    expect(m.findArenaStake(1, first.stake.player)?.room).toBe(a1);
    expect(m.findArenaStake(1, 'nobody')).toBeNull();
  });

  it('instances share arenaId and journal arena key', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'slana-mm-')), 'journal.json');
    const j1 = new Journal(path);
    const m1 = manager({ ARENA_INSTANCE_CAP: '1' }, undefined, j1);
    const a1 = (await m1.arenaRoom(1))!;
    spillStaker(a1, FEE);
    a1.join(fakeConn('keeper'), stakeJoin(1, FEE)); // keeps instance 1 "full"
    const a2 = (await m1.arenaRoom(1))!;
    expect(a2.id).toBe('arena-1-2');
    expect(a2.info().arenaId).toBe(1);
    spillStaker(a2, 3 * FEE);
    expect(lootSum(a1)).toBe(FEE);
    expect(lootSum(a2)).toBe(3 * FEE);

    // each instance journals its own loot; one write never wipes the other
    const onDisk = JSON.parse(readFileSync(path, 'utf8')) as { loot: { roomId: string; arenaId: number; value: number }[] };
    const byRoom = (id: string) => onDisk.loot.filter((l) => l.roomId === id).reduce((s, l) => s + l.value, 0);
    expect(byRoom('arena-1-1')).toBe(FEE);
    expect(byRoom('arena-1-2')).toBe(3 * FEE);
    expect(onDisk.loot.every((l) => l.arenaId === 1)).toBe(true);
    expect(m1.list().find((r) => r.id === 'arena-1-2')?.loot).toBe(3 * FEE);

    // crash + restart: all of the arena's loot is merged into instance 1
    const j2 = new Journal(path);
    j2.recoverLive();
    expect(j2.lootTotal()).toBe(4 * FEE);
    // the vault still holds what the journal owes (loot + recovered cash-outs): attach
    const owed = j2.owedByArena(1);
    expect(owed).toBeGreaterThanOrEqual(4 * FEE);
    const m2 = manager({ ARENA_INSTANCE_CAP: '1' }, new ArenaChain([{ ...arena(1, FEE), pot: owed }, arena(3, 5 * FEE)]), j2);
    await m2.ensureArenaRooms();
    const b1 = m2.rooms.get('arena-1-1')!;
    expect(lootSum(b1)).toBe(4 * FEE);
    expect(m2.rooms.has('arena-1-2')).toBe(false);
    expect(j2.recoverLoot(1).every((l) => l.roomId === 'arena-1-1')).toBe(true);
    expect(j2.lootTotal()).toBe(4 * FEE);
    const j3 = new Journal(path);
    expect(j3.lootTotal()).toBe(4 * FEE);
    expect(j3.recoverLoot(1).every((l) => l.roomId === 'arena-1-1')).toBe(true);
  });

  it('keeps an arena disabled while its vault cannot cover the journal (sweep guard)', async () => {
    const journal = new Journal(null);
    journal.commit({ loot: { roomId: 'arena-1-1', arenaId: 1, items: [{ x: 1, y: 1, value: 3 * FEE }] } });
    journal.commit({ roomId: 'arena-1-2', live: [{ roomId: 'arena-1-2', session: 'S1', sessionId: 1, player: 'w1', arenaId: 1, value: FEE, score: 0, kills: 0 }] });
    journal.enqueue({ kind: 'settle', key: 'S2', player: 'w2', arenaId: 1, payout: 2 * FEE, score: 0, kills: 0, xp: 0, attempts: 0, nextAttemptAt: 0, createdAt: 0 });
    // another arena's debts do not count
    journal.enqueue({ kind: 'settle', key: 'S3', player: 'w3', arenaId: 3, payout: 50 * FEE, score: 0, kills: 0, xp: 0, attempts: 0, nextAttemptAt: 0, createdAt: 0 });
    expect(journal.owedByArena(1)).toBe(6 * FEE);

    const logs: string[] = [];
    const swept = new ArenaChain([{ ...arena(1, FEE), pot: 5 * FEE }, { ...arena(3, 5 * FEE), pot: 50 * FEE }]);
    const cfg = loadConfig({ DATA_DIR: mkdtempSync(join(tmpdir(), 'slana-mm-')) });
    const m = new RoomManager(cfg, { ...roomDeps(swept, journal), log: (l) => logs.push(l) }, swept);
    await m.ensureArenaRooms();
    expect(m.rooms.has('arena-1-1')).toBe(false);
    expect(m.rooms.has('arena-3-1')).toBe(true);
    expect(await m.arenaRoom(1)).toBeNull();
    expect(m.underfundedArenas().has(1)).toBe(true);
    // the lobby payload marks it so no ticket is sold
    expect(m.blockedArenas()).toEqual([{ arenaId: 1, reason: 'vault_short' }]);
    // logged loudly, once
    expect(logs.filter((l) => /arena #1 KEPT DISABLED/.test(l))).toHaveLength(1);
    expect(logs[0]).toMatch(/vault holds 5000000 .* journal owes 6000000/);
    // the loot was not adopted by a room, so it is still journaled
    expect(journal.owedByArena(1)).toBe(6 * FEE);

    // a vault that covers the journal attaches (fresh process / re-read)
    const covered = new ArenaChain([{ ...arena(1, FEE), pot: 6 * FEE }]);
    const m2 = new RoomManager(cfg, { ...roomDeps(covered, journal), log: () => {} }, covered);
    await m2.ensureArenaRooms();
    expect(m2.rooms.has('arena-1-1')).toBe(true);
    expect(m2.underfundedArenas().size).toBe(0);
    expect(m2.blockedArenas()).toEqual([]);
  });

  it('R20 while running: a swept arena with live loot stays blocked when re-enabled', async () => {
    const journal = new Journal(null);
    const logs: string[] = [];
    const chain = new ArenaChain([{ ...arena(1, FEE), pot: 0 }]);
    const cfg = loadConfig({ DATA_DIR: mkdtempSync(join(tmpdir(), 'slana-mm-')) });
    const m = new RoomManager(cfg, { ...roomDeps(chain, journal), log: (l) => logs.push(l) }, chain);
    const refresh = async () => {
      (m as unknown as { arenaCache: unknown }).arenaCache = null; // the 30 s cache expired
      await m.ensureArenaRooms();
    };
    // an instance runs and a player's value lies on its floor as loot (the vault holds it)
    const a1 = (await m.arenaRoom(1))!;
    spillStaker(a1, FEE);
    expect(journal.owedByArena(1)).toBe(FEE);
    chain.arenas[0] = { ...chain.arenas[0], pot: FEE };
    await refresh();
    expect(m.blockedArenas()).toEqual([]);

    // the admin disables the arena: still covered, no alarm
    chain.arenas[0] = { ...chain.arenas[0], enabled: false };
    await refresh();
    expect(m.blockedArenas()).toEqual([]);
    // ... and sweeps it: the vault drops to 0 while the loot is still journaled
    chain.arenas[0] = { ...chain.arenas[0], pot: 0 };
    await refresh();
    expect(m.blockedArenas()).toEqual([{ arenaId: 1, reason: 'vault_short' }]);
    // re-enabled: the instance still exists, yet the arena stays blocked and sells nothing
    chain.arenas[0] = { ...chain.arenas[0], enabled: true };
    await refresh();
    expect(m.rooms.has('arena-1-1')).toBe(true);
    expect(await m.arenaRoom(1)).toBeNull();
    expect(m.blockedArenas()).toEqual([{ arenaId: 1, reason: 'vault_short' }]);
    expect(logs.filter((l) => /arena #1 KEPT DISABLED/.test(l))).toHaveLength(1);

    // the vault is topped up: the stale entry clears on the next refresh
    chain.arenas[0] = { ...chain.arenas[0], pot: FEE };
    await refresh();
    expect(m.blockedArenas()).toEqual([]);
    expect(await m.arenaRoom(1)).toBe(a1);
    expect(logs.some((l) => /arena #1: vault .* now covers the journal/.test(l))).toBe(true);
  });

  it('R20: disable → sweep → re-enable between two refreshes is still caught (every arena, every refresh)', async () => {
    const journal = new Journal(null);
    const logs: string[] = [];
    const chain = new ArenaChain([{ ...arena(1, FEE), pot: 0 }]);
    const cfg = loadConfig({ DATA_DIR: mkdtempSync(join(tmpdir(), 'slana-mm-')) });
    const m = new RoomManager(cfg, { ...roomDeps(chain, journal), log: (l) => logs.push(l) }, chain);
    const a1 = (await m.arenaRoom(1))!;
    spillStaker(a1, FEE);
    chain.arenas[0] = { ...chain.arenas[0], pot: FEE };
    (m as unknown as { arenaCache: unknown }).arenaCache = null;
    await m.ensureArenaRooms();
    expect(m.blockedArenas()).toEqual([]);
    // the whole sequence happens inside one 30 s window: the next read sees "enabled" again,
    // only the vault (0) betrays the sweep
    chain.arenas[0] = { ...chain.arenas[0], pot: 0 };
    let freshReads = 0;
    const list = chain.listArenas.bind(chain);
    chain.listArenas = async (fresh?: boolean) => {
      if (fresh) freshReads++;
      return list();
    };
    (m as unknown as { arenaCache: unknown }).arenaCache = null;
    await m.ensureArenaRooms();
    // an enabled arena's shortfall is confirmed with a fresh read, then blocked
    expect(freshReads).toBe(1);
    expect(m.blockedArenas()).toEqual([{ arenaId: 1, reason: 'vault_short' }]);
    expect(await m.arenaRoom(1)).toBeNull();
    expect(logs.filter((l) => /arena #1 KEPT DISABLED/.test(l))).toHaveLength(1);
  });

  it('R20: a stale (cached) pot of a running arena is not blocked when the fresh read covers it', async () => {
    const journal = new Journal(null);
    const chain = new ArenaChain([{ ...arena(1, FEE), pot: 0 }]);
    const cfg = loadConfig({ DATA_DIR: mkdtempSync(join(tmpdir(), 'slana-mm-')) });
    const m = new RoomManager(cfg, { ...roomDeps(chain, journal), log: () => {} }, chain);
    const a1 = (await m.arenaRoom(1))!;
    spillStaker(a1, FEE);
    // the cached read trails a join the journal already counts; the fresh read has it
    chain.listArenas = async (fresh?: boolean) => [{ ...arena(1, FEE), pot: fresh ? FEE : 0 }];
    (m as unknown as { arenaCache: unknown }).arenaCache = null;
    await m.ensureArenaRooms();
    expect(m.blockedArenas()).toEqual([]);
    expect(await m.arenaRoom(1)).toBe(a1);
  });

  it('R20: a disabled → enabled flip is re-checked even without a sweep in between', async () => {
    const journal = new Journal(null);
    journal.commit({ loot: { roomId: 'arena-1-1', arenaId: 1, items: [{ x: 1, y: 1, value: 2 * FEE }] } });
    const chain = new ArenaChain([{ ...arena(1, FEE), enabled: false, pot: 2 * FEE }]);
    const cfg = loadConfig({ DATA_DIR: mkdtempSync(join(tmpdir(), 'slana-mm-')) });
    const m = new RoomManager(cfg, { ...roomDeps(chain, journal), log: () => {} }, chain);
    await m.ensureArenaRooms();
    expect(m.blockedArenas()).toEqual([]);
    // enabled again with a vault that was drained meanwhile (read in the same refresh)
    chain.arenas[0] = { ...chain.arenas[0], enabled: true, pot: FEE };
    (m as unknown as { arenaCache: unknown }).arenaCache = null;
    await m.ensureArenaRooms();
    expect(m.blockedArenas()).toEqual([{ arenaId: 1, reason: 'vault_short' }]);
    expect(m.rooms.has('arena-1-1')).toBe(false);
  });

  it('an instance closed during a join is replaced by a live, mapped room', async () => {
    const m = manager({ ARENA_INSTANCE_CAP: '1' });
    const a1 = (await m.arenaRoom(1))!;
    a1.join(fakeConn('keeper'), stakeJoin(1, FEE));
    const a2 = (await m.arenaRoom(1))!;
    expect(a2.id).toBe('arena-1-2');
    // picking a room counts as activity, so cleanup leaves it alone while the join awaits the chain
    a2.lastActivity = 0;
    expect(await m.arenaRoom(1)).toBe(a2);
    expect(Date.now() - a2.lastActivity).toBeLessThan(1000);
    // a still-valid pick is kept
    expect(await m.confirmArenaRoom(1, a2)).toBe(a2);

    // cleanup closed the instance during the await (e.g. chain.getSession)
    m.rooms.delete(a2.id);
    const room = (await m.confirmArenaRoom(1, a2))!;
    expect(room).not.toBe(a2);
    expect(m.rooms.get(room.id)).toBe(room);
    const join = stakeJoin(1, FEE);
    room.join(fakeConn(join.stake.player), join);
    expect(m.findArenaStake(1, join.stake.player)?.room).toBe(room);
    expect(m.liveSessions().has(join.stake.session)).toBe(true);

    // a pick that filled up meanwhile is replaced too; null when nothing live is left
    expect((await m.confirmArenaRoom(1, a1))!.isFull).toBe(false);
    expect(await m.confirmArenaRoom(7, a1)).toBeNull();
  });

  it('rookie promoted to pro after a big game', () => {
    const m = manager();
    const conn = fakeConn(null, '10.0.0.7');
    expect(m.leagueFor(conn)).toBe('rookie');

    // a modest rookie game does not promote
    const r = m.practiceRoom('rookie');
    let p = r.join(conn, practiceJoin(1));
    p.stats.maxMass = 3000;
    p.stats.playersEaten = 7;
    r.leave(conn, 'left');
    expect(m.leagueFor(conn)).toBe('rookie');

    // max mass above 3000 does
    p = r.join(conn, practiceJoin(1));
    p.stats.maxMass = 3001;
    r.leave(conn, 'left');
    expect(m.leagueFor(conn)).toBe('pro');
    expect(m.leagueFor(fakeConn(null, '10.0.0.7'))).toBe('pro');
    expect(m.leagueFor(fakeConn(null, '10.0.0.8'))).toBe('rookie');
    // the promotion lasts 24 h
    expect(m.leagueFor(conn, Date.now() + 25 * 3600_000)).toBe('rookie');

    // 8 player kills do too
    const killer = fakeConn(null, '10.0.0.9');
    p = r.join(killer, practiceJoin(2));
    p.stats.playersEaten = 8;
    r.leave(killer, 'left');
    expect(m.leagueFor(killer)).toBe('pro');

    // level 5 profiles are always pro
    const vet = fakeConn('vet', '10.0.0.10');
    vet.profile = { level: 5 } as ChainProfile;
    expect(m.leagueFor(vet)).toBe('pro');
    vet.profile = { level: 4 } as ChainProfile;
    expect(m.leagueFor(vet)).toBe('rookie');
  });

  it('works without a chain (no arenas)', async () => {
    const chain = new NullChain();
    const cfg = loadConfig({ DATA_DIR: mkdtempSync(join(tmpdir(), 'slana-mm-')) });
    const m = new RoomManager(cfg, roomDeps(chain), chain);
    expect(await m.arenaRoom(1)).toBeNull();
    expect(m.lobbyRoom().opts.mode).toBe('practice');
  });
});
