import { ClientOp, WORLD_PRESETS, type IntegrityTransfer } from '@slana/shared';
import { describe, expect, it } from 'vitest';
import { World } from '../src/game/world';
import { IntegrityMonitor, type MonitorRoom } from '../src/integrity/telemetry';
import type { SessionSummary } from '../src/integrity/types';

const T = 1_791_000_000_000;

function setup() {
  const world = new World({ ...WORLD_PRESETS.arena, powerUps: false, coinRain: false, seed: 1 });
  const clock = { wall: T, mono: 0 };
  const done: SessionSummary[] = [];
  const transfers: IntegrityTransfer[] = [];
  const mon = new IntegrityMonitor({ mono: () => clock.mono, onSession: (s) => done.push(s), onTransfer: (t) => transfers.push(t) });
  const room: MonitorRoom = { id: 'arena-1-1', now: () => clock.wall, round: () => ({ n: 5, endsAt: 6 * 300_000, joinsCloseAt: 6 * 300_000 - 60_000 }), opts: { stake: { arenaId: 1, buyIn: 100 } } };
  const add = (name: string, x: number, y: number, mass: number, key: number) => {
    const p = world.addPlayer({ name, skin: 0, x, y, mass });
    mon.onJoin(room, p.id, { wallet: name, session: `s${key}`, sessionId: key, arenaId: 1, entryFee: 100, ipHash: 'ip', fpHash: null });
    return p;
  };
  return { world, clock, done, transfers, mon, room, add };
}

describe('integrity telemetry', () => {
  it('times moved aims only, counts whole-number aims and turns', () => {
    const { clock, mon, room, add, done } = setup();
    const p = add('a', 1000, 1000, 50, 1);
    for (let i = 0; i < 10; i++) {
      clock.mono += 40;
      mon.onInput(room.id, p, { op: ClientOp.Target, x: 1500 + i * 3.5, y: 1000.25 });
      // a keep-alive with the same aim is ignored
      clock.mono += 5;
      mon.onInput(room.id, p, { op: ClientOp.Target, x: 1500 + i * 3.5, y: 1000.25 });
    }
    mon.onInput(room.id, p, { op: ClientOp.Split });
    mon.onInput(room.id, p, { op: ClientOp.Target, x: 900, y: 900 });
    mon.onEnd(room, p.id, { reason: 'round', payout: 100, killer: null, killerIsBot: false });
    const s = done[0];
    expect(s.input.aims).toBe(11);
    expect(s.input.intAims).toBe(1);
    expect(s.input.n).toBe(10);
    expect(s.input.splits).toBe(1);
    expect(s.input.turnHist.reduce((a, b) => a + b, 0)).toBe(10);
    expect(s.key).toBe('s1#1');
    expect(s.round).toBe(5);
    expect(s.roundStartsAt).toBe(5 * 300_000);
  });

  it('measures the reaction to a new threat (moving toward it, then turning away)', () => {
    const { world, clock, mon, room, add, done } = setup();
    const me = add('me', 1000, 1000, 40, 1);
    mon.onInput(room.id, me, { op: ClientOp.Target, x: 1400, y: 1000 }); // heading east
    mon.sample(room.id, world.players.values(), clock.wall);
    const big = add('big', 1100 + 60, 1000, 400, 2); // a threat appears to the east
    clock.mono += 10;
    mon.sample(room.id, world.players.values(), clock.wall);
    clock.mono += 230;
    mon.onInput(room.id, me, { op: ClientOp.Target, x: 600, y: 1000 }); // turns west
    mon.onEnd(room, me.id, { reason: 'round', payout: 100, killer: null, killerIsBot: false });
    expect(done[0].input.reactionMs).toEqual([230]);
    void big;
  });

  it('records transfers, idle time, value received while idle, ejects eaten and the approach before a death', () => {
    const { world, clock, mon, room, add, done, transfers } = setup();
    const small = add('small', 1000, 1000, 40, 1);
    const whale = add('whale', 1300, 1000, 900, 2);
    mon.onInput(room.id, small, { op: ClientOp.Target, x: 1600, y: 1000 }); // walking into the whale
    mon.onAfk(room.id, whale.id, true, clock.wall); // the whale is idle (disconnected)
    for (let i = 0; i < 8; i++) {
      clock.wall += 200;
      mon.sample(room.id, world.players.values(), clock.wall);
    }
    mon.onEjectEaten(room.id, small.id, whale.id);
    mon.onEjectEaten(room.id, small.id, whale.id);
    mon.onEjectEaten(room.id, small.id, 9999); // a bot or anyone untracked
    mon.onTransfer(room, small.id, whale.id, 100, 1, true);
    mon.onEnd(room, small.id, { reason: 'death', payout: 0, killer: whale, killerIsBot: false });
    mon.onEnd(room, whale.id, { reason: 'round', payout: 200, killer: null, killerIsBot: false });
    const [s, w] = done;
    expect(s.death).toMatchObject({ by: 'whale', byBot: false, samples: 8 });
    expect(s.death!.approach).toBe(1);
    expect(s.ejects).toEqual({ eatenBy: { whale: 2 }, eatenOther: 1 });
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ from: 'small', to: 'whale', amount: 100, fee: 100, fromKey: 's1#1', toKey: 's2#2', afkEater: true, others: 1 });
    expect(w.receivedWhileAfk).toBe(100);
    expect(w.afkAtEnd).toBe(true);
    expect(w.afkMs).toBe(1600);
    expect(mon.size).toBe(0);
  });
});
