import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlayerFlag, RULES, TICK_MS, type ServerMessage } from '@slana/shared';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { Room } from '../src/rooms/room';
import { RoomManager } from '../src/rooms/manager';
import { ArenaChain, arena, fakeConn, roomDeps, stakeJoin, type TestConn } from './helpers';

const FEE = 1_000_000;

function arenaRoom(): Room {
  return new Room(
    { id: 'arena-1-1', mode: 'arena', name: 'Arena', maxPlayers: 50, bots: null, stake: { arenaId: 1, buyIn: FEE }, seed: 5 },
    roomDeps(new ArenaChain([arena(1, FEE)])),
  );
}

const cashoutMsgs = (c: TestConn) => c.msgs.filter((m): m is Extract<ServerMessage, { t: 'cashout' }> => m.t === 'cashout');

function runMs(room: Room, ms: number) {
  for (let t = 0; t < ms; t += TICK_MS) room.tick(TICK_MS);
}

describe('pass power', () => {
  it('pass session starts 15% heavier and cashes out in 2s', () => {
    const room = arenaRoom();
    const conn = fakeConn('w-pass');
    const p = room.join(conn, stakeJoin(1, FEE, true));
    expect(p.totalMass()).toBeCloseTo(RULES.startMass * 1.15, 6);
    expect(p.flags & PlayerFlag.Pass).toBe(PlayerFlag.Pass);
    expect(conn.msgs.find((m) => m.t === 'joined')).toMatchObject({ hasPass: true, entryFee: FEE, value: FEE });

    room.cashout(conn);
    expect(cashoutMsgs(conn)[0]).toEqual({ t: 'cashout', state: 'started', ms: 2000 });
    runMs(room, 1900);
    expect(p.alive).toBe(true);
    runMs(room, 200);
    expect(cashoutMsgs(conn).at(-1)).toMatchObject({ state: 'done', value: FEE });
  });

  it('non-pass session 3s', () => {
    const room = arenaRoom();
    const conn = fakeConn('w-plain');
    const p = room.join(conn, stakeJoin(1, FEE, false));
    expect(p.totalMass()).toBeCloseTo(RULES.startMass, 6);
    expect(p.flags & PlayerFlag.Pass).toBe(0);
    room.cashout(conn);
    expect(cashoutMsgs(conn)[0]).toEqual({ t: 'cashout', state: 'started', ms: 3000 });
    runMs(room, 2900);
    expect(p.alive).toBe(true);
    expect(cashoutMsgs(conn).some((m) => m.state === 'done')).toBe(false);
    runMs(room, 200);
    expect(cashoutMsgs(conn).at(-1)).toMatchObject({ state: 'done', value: FEE });
  });

  it('a verified Pass in practice: heavier start, Pass flag and number in snapshots', () => {
    const room = new Room({ id: 'practice-rookie-1', mode: 'practice', name: 'P', maxPlayers: 40, bots: null, seed: 3 }, roomDeps(new ArenaChain([])));
    const conn = fakeConn();
    const p = room.join(conn, { name: 'holder', skin: 2, flags: 0, pass: 42 });
    expect(p.totalMass()).toBeCloseTo(RULES.startMass * 1.15, 6);
    expect(p.flags & PlayerFlag.Pass).toBe(PlayerFlag.Pass);
    const plain = room.join(fakeConn(), { name: 'plain', skin: 2, flags: 0 });
    expect(plain.totalMass()).toBeCloseTo(RULES.startMass, 6);
    const c = p.center();
    const snap = conn.view.build(room.world, { x0: 0, y0: 0, x1: room.world.cfg.width, y1: room.world.cfg.height }, { x: c.x, y: c.y, h: 1000 })!;
    expect(snap.players.find((i) => i.id === p.id)).toMatchObject({ pass: 42, flags: PlayerFlag.Pass });
    expect(snap.players.find((i) => i.id === plain.id)).toMatchObject({ pass: 0, flags: 0 });
  });

  it('private rooms ignore the Pass', () => {
    const room = new Room({ id: 'priv-ABCDE', mode: 'private', name: 'P', code: 'ABCDE', maxPlayers: 20, bots: null, seed: 4 }, roomDeps(new ArenaChain([])));
    const conn = fakeConn();
    const p = room.join(conn, { name: 'holder', skin: 2, flags: 0, pass: 42, hasPass: true });
    expect(p.totalMass()).toBeCloseTo(RULES.startMass, 6);
    expect(p.flags & PlayerFlag.Pass).toBe(0);
    expect(p.pass).toBe(0);
    expect(p.hasPass).toBe(false);
    expect(conn.msgs.find((m) => m.t === 'joined')).not.toHaveProperty('hasPass', true);
  });

  it('pass tuning comes from the environment', async () => {
    const cfg = loadConfig({ DATA_DIR: mkdtempSync(join(tmpdir(), 'slana-pp-')) });
    expect(cfg.pass).toEqual({ startMassMul: 1.15, cashoutMs: 2000 });
    expect(cfg.arenaInstanceCap).toBe(50);
    expect(cfg.practiceCapacity).toBe(40);
    const tuned = loadConfig({
      DATA_DIR: mkdtempSync(join(tmpdir(), 'slana-pp-')),
      PASS_START_MASS_MUL: '1.3',
      PASS_CASHOUT_MS: '1500',
      ARENA_INSTANCE_CAP: '30',
      PRACTICE_CAPACITY: '25',
    });
    expect(tuned.pass).toEqual({ startMassMul: 1.3, cashoutMs: 1500 });
    expect(tuned.arenaInstanceCap).toBe(30);
    expect(tuned.practiceCapacity).toBe(25);

    const chain = new ArenaChain([arena(1, FEE)]);
    const m = new RoomManager(tuned, roomDeps(chain), chain);
    const room = (await m.arenaRoom(1))!;
    expect(room.opts.maxPlayers).toBe(30);
    const conn = fakeConn('w-tuned');
    const p = room.join(conn, stakeJoin(1, FEE, true));
    expect(p.totalMass()).toBeCloseTo(RULES.startMass * 1.3, 6);
    room.cashout(conn);
    expect(cashoutMsgs(conn)[0]).toMatchObject({ ms: 1500 });
  });
});
