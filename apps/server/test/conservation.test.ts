import { PlayerFlag, TICK_MS, roundAt, type ServerMessage } from '@elymum/shared';
import { describe, expect, it } from 'vitest';
import { NullChain } from '../src/chain/types';
import { Leaderboards } from '../src/leaderboards';
import { mulberry32 } from '../src/game/rng';
import { Conn } from '../src/net/conn';
import { Room } from '../src/rooms/room';
import { Journal, itemAmount } from '../src/stake/journal';

const FEE = 1_000_000_007; // odd on purpose: proportional shares never divide evenly
/** Short rounds so the 3 simulated minutes cross several round ends. */
const ROUND = { roundMs: 40_000, closeMs: 10_000 };

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

describe('arena money conservation', () => {
  it('ledger + loot + pending == entry fees − settled, every tick, across round ends with loot (seeded)', () => {
    const rng = mulberry32(20261014);
    const journal = new Journal(null);
    // the wall clock advances with the simulation; it starts 5 s into a round
    let clock = roundAt(1_791_000_000_000, ROUND.roundMs, ROUND.closeMs).startsAt + 5_000;
    const room = new Room(
      {
        id: 'stake-1',
        mode: 'arena',
        name: 'Arena',
        maxPlayers: 50,
        bots: { target: 8, min: 8, max: 8 },
        stake: { arenaId: 1, buyIn: FEE },
        seed: 4242,
      },
      {
        chain: new NullChain(),
        journal,
        leaderboards: new Leaderboards(null),
        log: () => {},
        now: () => clock,
        round: ROUND,
      },
    );
    const world = room.world;
    const ledger = room.ledger!;

    let fees = 0;
    let settled = 0;
    let joins = 0;
    const conns: ReturnType<typeof fakeConn>[] = [];
    const join = () => {
      const n = ++joins;
      const conn = fakeConn(`wallet${n}`);
      const p = room.join(conn, {
        name: `staker${n}`,
        skin: 1,
        flags: PlayerFlag.Staker,
        stake: {
          player: `wallet${n}`,
          session: `session${n}`,
          sessionId: n,
          arenaId: 1,
          entryFee: FEE,
          value: FEE,
          openedAt: Math.floor(Date.now() / 1000),
        },
      });
      fees += FEE;
      p.cells[0].setMass(20 + rng() * 300);
      p.shieldUntil = 0;
      conns.push(conn);
    };
    for (let i = 0; i < 6; i++) join();

    const pendingTotal = () => journal.pending.reduce((s, p) => s + itemAmount(p), 0);
    const lootTotal = () => world.loot().reduce((s, l) => s + l.value, 0);
    let spills = 0;
    let picks = 0;
    let transfers = 0;
    let roundEnds = 0;
    let roundSettles = 0;
    let afkAtBell = 0;
    let swept = 0;
    let lastRound = roundAt(clock, ROUND.roundMs, ROUND.closeMs).n;

    const ticks = Math.ceil(180_000 / TICK_MS);
    for (let t = 0; t < ticks; t++) {
      for (const conn of conns) {
        const p = conn.player;
        if (!p || !p.alive) continue;
        if (rng() < 0.05) {
          const c = p.center();
          const roll = rng();
          const loot = world.loot();
          if (roll < 0.5 && loot.length > 0) {
            let best = loot[0];
            for (const l of loot) if (Math.hypot(l.x - c.x, l.y - c.y) < Math.hypot(best.x - c.x, best.y - c.y)) best = l;
            world.setTarget(p.id, best.x, best.y);
          } else if (roll < 0.8) {
            // hunt the nearest other player (bots and stakers alike)
            let best: { x: number; y: number } | null = null;
            let bd = Infinity;
            for (const o of world.players.values()) {
              if (o === p || !o.alive) continue;
              const oc = o.center();
              const d = Math.hypot(oc.x - c.x, oc.y - c.y);
              if (d < bd) {
                bd = d;
                best = oc;
              }
            }
            if (best) world.setTarget(p.id, best.x, best.y);
          } else {
            world.setTarget(p.id, c.x + (rng() - 0.5) * 1600, c.y + (rng() - 0.5) * 1600);
          }
        }
        // a staker disconnects: their cells stay in the arena (AFK) until eaten or the bell
        if (rng() < 0.0003) room.leave(conn, 'disconnect');
      }
      // dead stakers buy back in while the round's joins are open (the gateway's rule)
      const alive = conns.filter((c) => c.player?.alive).length;
      const r = roundAt(clock, ROUND.roundMs, ROUND.closeMs);
      if (alive < 6 && clock < r.joinsCloseAt && rng() < 0.01) join();

      const afk = [...room.humans.values()].filter((c) => c === null).length;
      clock += TICK_MS;
      room.tick(TICK_MS);
      const n = roundAt(clock, ROUND.roundMs, ROUND.closeMs).n;
      if (n !== lastRound) {
        roundEnds++;
        lastRound = n;
        afkAtBell += afk;
        // the bell settled every staker, connected or AFK, and cleared the floor
        expect(ledger.size).toBe(0);
        expect(world.loot()).toHaveLength(0);
        expect(journal.live()).toHaveLength(0);
        expect(journal.recoverLoot(1)).toEqual([]);
        const sweep = journal.pending.find((p) => p.kind === 'sweep' && p.round === n - 1);
        if (sweep) swept += itemAmount(sweep);
      }

      // the chain settles pending payouts and sweeps in the background
      if (journal.pending.length > 0 && rng() < 0.03) {
        const item = journal.pending[0];
        settled += itemAmount(item);
        if (item.kind === 'settle' && item.reason === 'round') roundSettles++;
        journal.remove(item.key);
      }

      for (const conn of conns) {
        for (const m of conn.msgs.splice(0)) {
          if (m.t !== 'value') continue;
          if (m.reason === 'spill') spills++;
          else if (m.reason === 'loot') picks++;
          else if (m.reason === 'eat') transfers++;
        }
      }

      const lhs = ledger.total() + lootTotal() + pendingTotal();
      if (lhs !== fees - settled) {
        throw new Error(`tick ${t}: ledger ${ledger.total()} + loot ${lootTotal()} + pending ${pendingTotal()} != ${fees} - ${settled}`);
      }
      for (const e of ledger.all()) expect(Number.isSafeInteger(e.value) && e.value >= 0).toBe(true);
      for (const l of world.loot()) expect(Number.isSafeInteger(l.value) && l.value > 0).toBe(true);
    }

    // the scenario actually exercised every money path
    expect(spills).toBeGreaterThan(0);
    expect(picks).toBeGreaterThan(0);
    expect(transfers).toBeGreaterThan(0);
    expect(roundEnds).toBeGreaterThanOrEqual(3);
    expect(roundSettles).toBeGreaterThan(0);
    expect(swept).toBeGreaterThan(0);
    expect(joins).toBeGreaterThan(6);
    expect(afkAtBell).toBeGreaterThan(0);
  }, 120_000);
});
