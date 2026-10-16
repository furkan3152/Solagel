import { PlayerFlag, TICK_MS, type ServerMessage } from '@slana/shared';
import { describe, expect, it } from 'vitest';
import { NullChain } from '../src/chain/types';
import type { Player } from '../src/game/entities';
import { Leaderboards } from '../src/leaderboards';
import { Conn } from '../src/net/conn';
import { Room } from '../src/rooms/room';
import { Journal } from '../src/stake/journal';

const FEE = 50_000_000_000;

function fakeConn(wallet: string): Conn & { msgs: ServerMessage[] } {
  const msgs: ServerMessage[] = [];
  const ws = {
    readyState: 1,
    bufferedAmount: 0,
    send(data: unknown) {
      if (typeof data === 'string') msgs.push(JSON.parse(data) as ServerMessage);
    },
  };
  const conn = new Conn(ws as never, '127.0.0.1') as Conn & { msgs: ServerMessage[] };
  conn.msgs = msgs;
  conn.wallet = wallet;
  return conn;
}

function arena(bots: number): Room {
  return new Room(
    { id: 'stake-1', mode: 'arena', name: 'Arena', maxPlayers: 50, bots: { target: bots, min: bots, max: bots }, stake: { arenaId: 3, buyIn: FEE }, seed: 7 },
    // a fixed wall clock mid-round: no round end during the test
    { chain: new NullChain(), journal: new Journal(null), leaderboards: new Leaderboards(null), log: () => {}, now: () => 1_791_000_060_000 },
  );
}

function staker(room: Room, n: number): { conn: ReturnType<typeof fakeConn>; p: Player } {
  const conn = fakeConn(`wallet${n}`);
  const p = room.join(conn, {
    name: `staker${n}`,
    skin: 1,
    flags: PlayerFlag.Staker,
    stake: { player: `wallet${n}`, session: `session${n}`, sessionId: n, arenaId: 3, entryFee: FEE, value: FEE, openedAt: Math.floor(Date.now() / 1000) },
  });
  p.shieldUntil = 0;
  return { conn, p };
}

/** Puts `eater` (mass 200) on top of `victim` (mass 20) and ticks until the victim dies. */
function feed(room: Room, eater: Player, victim: Player): void {
  const [e] = eater.cells;
  const [v] = victim.cells;
  e.setMass(200);
  v.setMass(20);
  for (const c of [...eater.cells.slice(1), ...victim.cells.slice(1)]) c.setMass(1);
  e.x = v.x = 3000;
  e.y = v.y = 3000;
  room.world.setTarget(eater.id, 3000, 3000);
  room.world.setTarget(victim.id, 3000, 3000);
  for (let i = 0; i < 30 && victim.alive; i++) room.tick(TICK_MS);
  expect(victim.alive).toBe(false);
}

describe('arena death stats (the death sheet)', () => {
  it('a staker eaten by a staker reports the value lost (it went to the eater, nothing spilled)', () => {
    const room = arena(0);
    const a = staker(room, 1);
    const b = staker(room, 2);
    feed(room, a.p, b.p);
    const death = b.conn.msgs.find((m) => m.t === 'death');
    expect(death?.t).toBe('death');
    if (death?.t !== 'death') return;
    expect(death.stats).toMatchObject({ payout: 0, valueLost: FEE, lootSpilled: 0, byBot: false });
    expect(death.killer).toBe('staker1');
    expect(room.ledger!.value(a.p.id)).toBe(2 * FEE);
  });

  it('a staker eaten by a bot reports the value spilled as loot', () => {
    const room = arena(1);
    const b = staker(room, 2);
    for (let i = 0; i < 60 && room.world.players.size < 2; i++) room.tick(TICK_MS); // the bot manager fills the room
    const bot = [...room.world.players.values()].find((p) => room.bots!.isBot(p.id))!;
    expect(bot).toBeDefined();
    bot.shieldUntil = 0;
    feed(room, bot, b.p);
    const death = b.conn.msgs.find((m) => m.t === 'death');
    if (death?.t !== 'death') throw new Error('no death message');
    expect(death.stats).toMatchObject({ payout: 0, valueLost: FEE, lootSpilled: FEE, byBot: true });
    expect(room.world.loot().reduce((s, l) => s + l.value, 0)).toBe(FEE);
  });
});
