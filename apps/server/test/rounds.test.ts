import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RULES, TICK_MS, roundAt, type ServerMessage } from '@elymum/shared';
import { describe, expect, it } from 'vitest';
import { Room } from '../src/rooms/room';
import { Journal, itemAmount, type JournalItem } from '../src/stake/journal';
import { ArenaChain, arena, fakeConn, roomDeps, stakeJoin, type TestConn } from './helpers';

const FEE = 1_000_000;
const ROUND = { roundMs: 60_000, closeMs: 10_000 };

/** An arena room on a hand-driven wall clock, 1 s into a round. */
function setup(opts: { bots?: number; journal?: Journal } = {}) {
  const clock = { now: roundAt(1_791_000_000_000, ROUND.roundMs, ROUND.closeMs).startsAt + 1_000 };
  const journal = opts.journal ?? new Journal(null);
  const commits: Parameters<Journal['commit']>[0][] = [];
  const commit = journal.commit.bind(journal);
  journal.commit = (o) => {
    commits.push(o);
    commit(o);
  };
  const chain = new ArenaChain([arena(1, FEE)]);
  let kicks = 0;
  chain.kick = () => {
    kicks++;
  };
  const logs: string[] = [];
  const bots = opts.bots ?? 0;
  const room = new Room(
    {
      id: 'arena-1-1',
      mode: 'arena',
      name: 'Arena',
      instance: 1,
      maxPlayers: 50,
      bots: bots > 0 ? { target: bots, min: bots, max: bots } : null,
      stake: { arenaId: 1, buyIn: FEE },
      seed: 11,
    },
    { ...roomDeps(chain, journal, () => clock.now), round: ROUND, log: (l: string) => logs.push(l) },
  );
  const round = roundAt(clock.now, ROUND.roundMs, ROUND.closeMs);
  return { room, journal, clock, commits, round, logs, kicks: () => kicks };
}

const tick = (room: Room, n = 1) => {
  for (let i = 0; i < n; i++) room.tick(TICK_MS);
};
const of = <T extends ServerMessage['t']>(c: TestConn, t: T) => c.msgs.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);

describe('arena rounds (room)', () => {
  it('room info and joined carry the shared round', () => {
    const { room, round } = setup();
    const conn = fakeConn('w1');
    room.join(conn, stakeJoin(1, FEE));
    const want = { n: round.n, endsAt: round.endsAt, joinsCloseAt: round.joinsCloseAt };
    expect(room.info().round).toEqual(want);
    expect(of(conn, 'joined')[0].round).toEqual(want);
    expect(of(conn, 'joined')[0].room.round).toEqual(want);
  });

  it('a join at the bell, before the next tick, plays the new round (the bell rings first)', () => {
    const { room, journal, clock, round } = setup();
    const early = fakeConn('w-early');
    const je = stakeJoin(1, FEE);
    room.join(early, je);
    clock.now = round.endsAt; // the round is over; the room has not ticked since
    const conn = fakeConn('w-held');
    const j = stakeJoin(1, FEE);
    const p = room.join(conn, j);
    // the old round's staker was settled at its bell, before the new player was added
    expect(journal.settlements().map((i) => [i.key, i.reason])).toEqual([[je.stake.session, 'round']]);
    expect(of(early, 'roundOver')).toHaveLength(1);
    expect(of(conn, 'joined')[0].round?.n).toBe(round.n + 1);
    tick(room, 3);
    expect(p.alive).toBe(true);
    expect(room.ledger!.has(p.id)).toBe(true);
    expect(journal.settlements().some((i) => i.key === j.stake.session)).toBe(false);
    expect(of(conn, 'roundOver')).toEqual([]);
  });

  it('an AFK reconnect at the bell, before the next tick, finds the round already settled', () => {
    const { room, journal, clock, round } = setup();
    const conn = fakeConn('w-afk');
    const j = stakeJoin(1, FEE);
    const p = room.join(conn, j);
    room.leave(conn, 'disconnect');
    clock.now = round.endsAt + 1;
    expect(room.reattach(fakeConn('w-afk'), p.id)).toBe(false);
    expect(journal.settlements()).toEqual([expect.objectContaining({ key: j.stake.session, reason: 'round', payout: FEE })]);
  });

  it('a sweep key already pending (clock stepped back) never drops loot: a distinct key, logged', () => {
    const { room, journal, clock, round, logs } = setup();
    journal.enqueue({ kind: 'sweep', key: `sweep:arena-1-1:${round.n}`, arenaId: 1, roomId: 'arena-1-1', round: round.n, amount: 500, attempts: 0, nextAttemptAt: 0, createdAt: 0 });
    room.world.restoreLoot([{ x: 10, y: 10, value: 1234 }]);
    clock.now = round.endsAt;
    tick(room);
    expect(journal.pending.map((i) => [i.key, itemAmount(i)])).toEqual([
      [`sweep:arena-1-1:${round.n}`, 500],
      [`sweep:arena-1-1:${round.n}:2`, 1234],
    ]);
    expect(journal.owedByArena(1)).toBe(500 + 1234);
    expect(logs.some((l) => l.startsWith('!!!') && /already pending/.test(l))).toBe(true);
  });

  it('refuses cash-out in arenas', () => {
    const { room, journal } = setup();
    const conn = fakeConn('w1');
    const p = room.join(conn, stakeJoin(1, FEE));
    room.cashout(conn);
    expect(of(conn, 'error')).toEqual([expect.objectContaining({ code: 'no_cashout' })]);
    tick(room, Math.ceil(5000 / TICK_MS));
    expect(p.alive).toBe(true);
    expect(journal.pending).toHaveLength(0);
  });

  it('an AFK staker stays past afkGraceMs and is settled at the bell', () => {
    const { room, journal, clock, round } = setup();
    const conn = fakeConn('w-afk');
    const join = stakeJoin(1, FEE);
    const p = room.join(conn, join);
    room.leave(conn, 'disconnect');
    expect(p.afk).toBe(true);
    // well past the old AFK grace (world time and wall time both move)
    for (let t = 0; t < RULES.afkGraceMs + 5000; t += TICK_MS) {
      clock.now += TICK_MS;
      room.tick(TICK_MS);
    }
    expect(clock.now).toBeLessThan(round.endsAt);
    expect(p.alive).toBe(true);
    expect(room.ledger!.has(p.id)).toBe(true);
    expect(journal.pending).toHaveLength(0);

    clock.now = round.endsAt;
    tick(room);
    expect(p.alive).toBe(false);
    expect(room.ledger!.size).toBe(0);
    expect(journal.settlements()).toEqual([
      expect.objectContaining({ kind: 'settle', key: join.stake.session, player: join.stake.player, payout: FEE, reason: 'round' }),
    ]);
    // nobody was connected: no message went anywhere
    expect(of(conn, 'roundOver')).toEqual([]);
  });

  it('the bell settles everyone at value and sweeps the floor loot in one journal write', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'slana-round-')), 'journal.json');
    const { room, journal, clock, commits, round, kicks } = setup({ journal: new Journal(path) });
    const a = fakeConn('wa');
    const b = fakeConn('wb');
    const ja = stakeJoin(1, FEE);
    const jb = stakeJoin(1, FEE);
    const pa = room.join(a, { ...ja, name: 'Alice' });
    const pb = room.join(b, { ...jb, name: 'Bob' });
    // value moved around this round: Bob won some, some spilled as loot
    room.ledger!.get(pa.id)!.value = 400_000;
    room.ledger!.get(pb.id)!.value = 1_350_000;
    room.world.restoreLoot([
      { x: 100, y: 100, value: 150_000 },
      { x: 900, y: 900, value: 100_000 },
    ]);
    pa.cells[0].setMass(300);
    room.leave(b, 'disconnect'); // Bob is AFK at the bell
    expect(room.ledger!.total() + room.lootValue()).toBe(2 * FEE);
    tick(room);
    commits.length = 0;

    clock.now = round.endsAt + 3; // the first tick at or after the bell
    tick(room);

    const bell = commits.filter((c) => c.enqueue && c.enqueue.length > 0);
    expect(bell).toHaveLength(1);
    const enqueued = bell[0].enqueue as JournalItem[];
    expect(enqueued.map((i) => [i.kind, i.key, itemAmount(i)])).toEqual([
      ['settle', ja.stake.session, 400_000],
      ['settle', jb.stake.session, 1_350_000],
      ['sweep', `sweep:arena-1-1:${round.n}`, 250_000],
    ]);
    expect(enqueued[2]).toMatchObject({ kind: 'sweep', arenaId: 1, roomId: 'arena-1-1', round: round.n, amount: 250_000 });
    expect(enqueued.filter((i) => i.kind === 'settle').every((i) => i.kind === 'settle' && i.reason === 'round')).toBe(true);
    // the same write cleared the live tickets and the floor loot
    expect(bell[0].live).toEqual([]);
    expect(bell[0].loot?.items).toEqual([]);
    expect(kicks()).toBeGreaterThan(0);

    // conserved on disk: what the vault owes is unchanged
    const disk = new Journal(path);
    expect(disk.owedByArena(1)).toBe(2 * FEE);
    expect(disk.live()).toEqual([]);
    expect(disk.recoverLoot(1)).toEqual([]);
    expect(room.world.loot()).toEqual([]);

    // the connected player gets the receipt; standings are by value at the bell
    const [over] = of(a, 'roundOver');
    expect(over).toMatchObject({ t: 'roundOver', round: round.n, payout: 400_000 });
    expect(over.stats.payout).toBe(400_000);
    expect(over.stats.finalMass).toBeGreaterThan(0);
    expect(over.standings).toEqual([
      { name: 'Bob', value: 1_350_000 },
      { name: 'Alice', value: 400_000, you: true },
    ]);
    expect(of(a, 'cashout')).toEqual([]);
    expect(of(a, 'death')).toEqual([]);
    expect(of(b, 'roundOver')).toEqual([]);

    // the next round is in play; nothing ends twice
    expect(room.info().round?.n).toBe(round.n + 1);
    commits.length = 0;
    tick(room, 3);
    expect(commits.some((c) => c.enqueue && c.enqueue.length > 0)).toBe(false);
  });

  it('no loot on the floor → no sweep item; bots keep playing into the next round', () => {
    const { room, journal, clock, round } = setup({ bots: 6 });
    const conn = fakeConn('w1');
    room.join(conn, stakeJoin(1, FEE));
    tick(room, 5);
    expect(room.bots!.bots.size).toBe(6);
    expect(room.world.loot()).toEqual([]);

    clock.now = round.endsAt;
    tick(room);
    expect(journal.pending.map((i) => i.kind)).toEqual(['settle']);
    expect(of(conn, 'roundOver')).toHaveLength(1);
    tick(room, 2);
    expect(room.bots!.bots.size).toBe(6);
    for (const b of room.bots!.bots.values()) expect(b.player.alive).toBe(true);
  });

  it('a sleeping room still ends its round and sweeps its loot', () => {
    const { room, journal, clock, round } = setup();
    room.world.restoreLoot([{ x: 10, y: 10, value: 777 }]);
    room.lastActivity = 0; // asleep: no conns, no humans
    expect(room.sleeping).toBe(true);
    clock.now = round.endsAt + 10_000;
    tick(room);
    expect(journal.pending).toEqual([expect.objectContaining({ kind: 'sweep', key: `sweep:arena-1-1:${round.n}`, amount: 777 })]);
    expect(room.world.loot()).toEqual([]);
  });

  it('an eaten staker is settled at 0, buys back in and is settled again at the bell', () => {
    const { room, journal, clock, round } = setup();
    const conn = fakeConn('w1');
    const j1 = stakeJoin(1, FEE);
    const first = room.join(conn, j1);
    const hunter = room.join(fakeConn('w2'), stakeJoin(1, FEE));
    first.shieldUntil = hunter.shieldUntil = 0;
    hunter.cells[0].setMass(200);
    first.cells[0].setMass(20);
    hunter.cells[0].x = first.cells[0].x = 3000;
    hunter.cells[0].y = first.cells[0].y = 3000;
    for (let i = 0; i < 30 && first.alive; i++) tick(room);
    expect(first.alive).toBe(false);
    expect(journal.settlements()).toEqual([expect.objectContaining({ key: j1.stake.session, reason: 'death', payout: 0 })]);

    // a new ticket (new session) while joins are open
    const j2 = stakeJoin(1, FEE);
    const again = room.join(conn, j2);
    expect(again.alive).toBe(true);
    clock.now = round.endsAt;
    tick(room);
    const byKey = new Map(journal.settlements().map((i) => [i.key, i]));
    expect(byKey.get(j2.stake.session)).toMatchObject({ reason: 'round', payout: FEE });
    expect(byKey.get(j1.stake.session)).toMatchObject({ reason: 'death', payout: 0 });
  });
});
