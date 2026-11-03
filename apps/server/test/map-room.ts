import { TICK_MS, type MapScaleSettings, type WorldShape } from '@elymum/shared';
import { mulberry32 } from '../src/game/rng';
import { Room } from '../src/rooms/room';
import { ArenaChain, fakeConn, roomDeps } from './helpers';

export interface MapRoomRun {
  /** Map side once warmed up. */
  side: number;
  food: number;
  cacti: number;
  /** Tick cost (ms): the whole room tick, simulation, bots, snapshots for every connection (all `rooms` summed). */
  mean: number;
  p95: number;
  max: number;
  /** Players in the world at the end (humans + bots). */
  players: number;
}

/**
 * A free room with `humans` connected people wandering about (a new aim every second) and bots
 * filling it to `players`, warmed up until the map has grown (coarse ticks), then `seconds` of
 * real 30 Hz ticks timed one by one. `rooms` (default 1) runs that many such rooms side by side
 * (one server process) and times all of them per tick. Shared by the map benchmark script and its test.
 */
export function runMapRoom(o: { players: number; humans: number; seconds: number; map: MapScaleSettings | null; world?: WorldShape; seed?: number; rooms?: number }): MapRoomRun {
  const n = Math.max(1, o.rooms ?? 1);
  const runs = Array.from({ length: n }, (_, i) => mapRoom({ ...o, seed: (o.seed ?? 7) + i * 101 }));
  // warm up: the map grows to its size (a step every 4 s), bots spawn, food refills
  for (let t = 0; t < 60_000; t += 200) for (const r of runs) r.step(t % 1000 === 0, 200);
  const times: number[] = [];
  const ticks = Math.round((o.seconds * 1000) / TICK_MS);
  for (let i = 0; i < ticks; i++) {
    let sum = 0;
    for (const r of runs) {
      const t0 = performance.now();
      r.step(i % 30 === 0, TICK_MS);
      sum += performance.now() - t0;
    }
    times.push(sum);
  }
  times.sort((a, b) => a - b);
  const room = runs[0].room;
  return {
    side: room.world.cfg.width,
    food: room.world.foodCount,
    cacti: room.world.viruses.length,
    mean: times.reduce((a, b) => a + b, 0) / times.length,
    p95: times[Math.floor(times.length * 0.95)],
    max: times[times.length - 1],
    players: room.world.players.size,
  };
}

function mapRoom(o: { players: number; humans: number; map: MapScaleSettings | null; world?: WorldShape; seed?: number }) {
  const bots = Math.max(0, o.players - o.humans);
  const room = new Room(
    {
      id: 'bench',
      mode: 'private',
      name: 'Bench',
      maxPlayers: o.humans + 1,
      bots: bots > 0 ? { target: o.players, min: bots, max: bots, mix: 'standard' } : null,
      seed: o.seed ?? 7,
      ...(o.world ? { world: o.world } : {}),
      ...(o.map ? { map: { scale: o.map } } : {}),
    },
    roomDeps(new ArenaChain([])),
  );
  const rng = mulberry32(o.seed ?? 7);
  const conns = Array.from({ length: o.humans }, (_, i) => fakeConn(`bench${i}`));
  for (const c of conns) room.join(c, { name: 'p', skin: 1, flags: 0 });
  const steer = () => {
    const w = room.world;
    for (const c of conns) {
      // the dead come back (a human room stays full)
      if (!c.player?.alive) room.join(c, { name: 'p', skin: 1, flags: 0 });
      w.setTarget(c.player!.id, w.x0 + rng() * w.cfg.width, w.y0 + rng() * w.cfg.height);
    }
  };
  return {
    room,
    step(aim: boolean, ms: number) {
      if (aim) steer();
      room.tick(ms);
    },
  };
}
