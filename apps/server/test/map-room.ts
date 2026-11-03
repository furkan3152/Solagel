import { TICK_MS, type MapScaleSettings, type WorldShape } from '@elymum/shared';
import { mulberry32 } from '../src/game/rng';
import { Room } from '../src/rooms/room';
import { ArenaChain, fakeConn, roomDeps } from './helpers';

export interface MapRoomRun {
  /** Map side once warmed up. */
  side: number;
  food: number;
  cacti: number;
  /** Tick cost (ms): the whole room tick, simulation, bots, snapshots for every connection. */
  mean: number;
  p95: number;
  max: number;
  /** Players in the world at the end (humans + bots). */
  players: number;
}

/**
 * A free room with `humans` connected people wandering about (a new aim every second) and bots
 * filling it to `players`, warmed up until the map has grown (coarse ticks), then `seconds` of
 * real 30 Hz ticks timed one by one. Shared by the map benchmark script and its test.
 */
export function runMapRoom(o: { players: number; humans: number; seconds: number; map: MapScaleSettings | null; world?: WorldShape; seed?: number }): MapRoomRun {
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
  // warm up: the map grows to its size (a step every 4 s), bots spawn, food refills
  for (let t = 0; t < 60_000; t += 200) {
    if (t % 1000 === 0) steer();
    room.tick(200);
  }
  const times: number[] = [];
  const n = Math.round((o.seconds * 1000) / TICK_MS);
  for (let i = 0; i < n; i++) {
    if (i % 30 === 0) steer();
    const t0 = performance.now();
    room.tick(TICK_MS);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
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
