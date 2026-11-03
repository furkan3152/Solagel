import {
  CUSTOM_DEFAULTS,
  CUSTOM_MAP_WIDTH,
  EntityKind,
  MAP_GROW,
  MAP_SCALE_DEFAULT,
  MAP_SPACE,
  TICK_MS,
  WORLD_PRESETS,
  decodeSnapshot,
  encodeSnapshot,
  mapSideFor,
  roundAt,
  worldForSide,
  type CustomRoomConfig,
  type MapScaleSettings,
} from '@elymum/shared';
import { describe, expect, it } from 'vitest';
import { BotSettingsError, applyBotSettings, defaultBotSettings } from '../src/bots/settings';
import { World } from '../src/game/world';
import { customBots, customWorld } from '../src/rooms/custom';
import { Room } from '../src/rooms/room';
import { ViewState } from '../src/rooms/visibility';
import { Journal } from '../src/stake/journal';
import { ArenaChain, arena, fakeConn, roomDeps, stakeJoin } from './helpers';

const ROUND = { roundMs: 60_000, closeMs: 10_000 };
const scale = (p: Partial<MapScaleSettings> = {}): MapScaleSettings => ({ ...MAP_SCALE_DEFAULT, ...p });

function resizable(side: number, seed = 3): World {
  return new World({ ...worldForSide(side), powerUps: true, coinRain: false, seed, space: MAP_SPACE });
}

function foodOutside(w: World): number {
  let n = 0;
  for (const e of w.entities.values()) if (e.kind === EntityKind.Food && (e.x < w.x0 || e.x > w.x1 || e.y < w.y0 || e.y > w.y1)) n++;
  return n;
}

describe('World.resize', () => {
  it('sits centred in its space and grows outward on every side without moving anything or rebuilding the grids', () => {
    const w = resizable(3000);
    expect([w.x0, w.y0, w.x1, w.y1]).toEqual([4500, 4500, 7500, 7500]);
    const p = w.addPlayer({ name: 'a', skin: 1 });
    const before = { x: p.cells[0].x, y: p.cells[0].y, cols: w.staticGrid.cols, buckets: w.dynGrid.cols * w.dynGrid.rows, food: w.foodCount };
    const v0 = w.boundsVersion;
    expect(w.resize(4200, 4200, worldForSide(4200))).toBe(true);
    expect([w.x0, w.y0, w.x1, w.y1]).toEqual([3900, 3900, 8100, 8100]);
    expect(w.boundsVersion).toBe(v0 + 1);
    expect(p.cells[0].x).toBe(before.x);
    expect(p.cells[0].y).toBe(before.y);
    expect(w.staticGrid.cols).toBe(before.cols);
    expect(w.dynGrid.cols * w.dynGrid.rows).toBe(before.buckets);
    // growing removes nothing; the refill brings the food up to the new target over the next seconds
    expect(w.foodCount).toBe(before.food);
    expect(w.cfg.foodTarget).toBe(worldForSide(4200).foodTarget);
    for (let i = 0; i < 30 * 20; i++) w.tick(TICK_MS);
    expect(w.foodCount).toBeGreaterThan(w.cfg.foodTarget * 0.9);
    // new food lands on the new floor too
    let outer = 0;
    for (const e of w.entities.values()) if (e.kind === EntityKind.Food && (e.x < 4500 || e.x > 7500)) outer++;
    expect(outer).toBeGreaterThan(50);
    // the same size again: no change, no version bump
    expect(w.resize(4200, 4200, worldForSide(4200))).toBe(false);
    expect(w.boundsVersion).toBe(v0 + 1);
  });

  it('shrinking drops the food and power-ups outside, brings cacti, loot and cells inside, and trims cacti to the target', () => {
    const w = resizable(9000);
    for (let i = 0; i < 3; i++) w.spawnPowerUp();
    w.restoreLoot([{ x: w.x0 + 30, y: w.y0 + 30, value: 777 }]);
    const p = w.addPlayer({ name: 'edge', skin: 1, x: w.x0 + 50, y: w.y0 + 50, mass: 200 });
    const small = worldForSide(4000);
    w.resize(4000, 4000, small);
    expect(foodOutside(w)).toBe(0);
    for (const e of w.entities.values()) {
      if (e.kind === EntityKind.Cell || e.kind === EntityKind.Eject) continue;
      expect(e.x - e.r).toBeGreaterThanOrEqual(w.x0 - 1e-6);
      expect(e.x + e.r).toBeLessThanOrEqual(w.x1 + 1e-6);
      expect(e.y - e.r).toBeGreaterThanOrEqual(w.y0 - 1e-6);
      expect(e.y + e.r).toBeLessThanOrEqual(w.y1 + 1e-6);
    }
    // loot is value: it moved inside, never dropped
    expect(w.loot().reduce((s, l) => s + l.value, 0)).toBe(777);
    expect(w.viruses.length).toBeLessThanOrEqual(small.virusTarget);
    expect(p.cells[0].x).toBeGreaterThanOrEqual(w.x0);
    expect(p.cells[0].y).toBeGreaterThanOrEqual(w.y0);
    // the count matches what is really left
    let food = 0;
    for (const e of w.entities.values()) if (e.kind === EntityKind.Food) food++;
    expect(w.foodCount).toBe(food);
  });

  it('a fixed world (no space) keeps its origin at 0', () => {
    const w = new World({ ...WORLD_PRESETS.practice, powerUps: false, coinRain: false, seed: 1 });
    expect([w.x0, w.y0, w.x1, w.y1]).toEqual([0, 0, 6800, 6800]);
  });
});

describe('snapshots carry the bounds when they change', () => {
  it('sends them on the first snapshot of a view and after each resize, not in between', () => {
    const w = resizable(3000);
    const view = new ViewState();
    const rect = { x0: 4000, y0: 4000, x1: 8000, y1: 8000 };
    const v = { x: 6000, y: 6000, h: 1000 };
    expect(view.build(w, rect, v)!.bounds).toEqual({ x0: 4500, y0: 4500, x1: 7500, y1: 7500 });
    expect(view.build(w, rect, v)!.bounds).toBeUndefined();
    w.resize(3600, 3600, worldForSide(3600));
    const snap = view.build(w, rect, v)!;
    expect(decodeSnapshot(encodeSnapshot(snap)).bounds).toEqual({ x0: 4200, y0: 4200, x1: 7800, y1: 7800 });
    expect(view.build(w, rect, v)!.bounds).toBeUndefined();
    view.reset();
    expect(view.build(w, rect, v)!.bounds).toBeDefined();
  });
});

/** An arena room (no bots) with adaptive map on a hand-driven wall clock, 1 s into a round. */
function arenaRoom(map: MapScaleSettings) {
  const clock = { now: roundAt(1_791_000_000_000, ROUND.roundMs, ROUND.closeMs).startsAt + 1_000 };
  const room = new Room(
    { id: 'arena-1-1', mode: 'arena', name: 'Arena', instance: 1, maxPlayers: 200, bots: null, stake: { arenaId: 1, buyIn: 1000 }, seed: 5, map: { scale: map } },
    { ...roomDeps(new ArenaChain([arena(1, 1000)]), new Journal(null), () => clock.now), round: ROUND },
  );
  return { room, clock, round: roundAt(clock.now, ROUND.roundMs, ROUND.closeMs) };
}

/** Coarse steps (250 ms) keep these long runs quick; the map logic runs on the world clock. */
const STEP = 250;
const ticks = (room: Room, ms: number) => {
  for (let t = 0; t < ms; t += STEP) room.tick(STEP);
};

describe('room map sizing', () => {
  it('opens at the size its bots call for and reports the origin in room info', () => {
    const room = new Room({ id: 'p', mode: 'practice', name: 'Pond', maxPlayers: 40, bots: { target: 12, min: 4, max: 12 }, seed: 1, map: { scale: scale() } }, roomDeps(new ArenaChain([])));
    expect(room.world.cfg.width).toBe(mapSideFor(12, MAP_SCALE_DEFAULT));
    const info = room.info();
    expect(info.width).toBe(room.world.cfg.width);
    expect(info.x0).toBe((MAP_SPACE - info.width) / 2);
    expect(room.world.cfg.foodTarget).toBe(worldForSide(info.width).foodTarget);
  });

  it('auto off keeps the mode preset exactly (centred in the space)', () => {
    const room = new Room({ id: 'p', mode: 'practice', name: 'Pond', maxPlayers: 40, bots: null, seed: 1, map: { scale: scale({ auto: false }) } }, roomDeps(new ArenaChain([])));
    expect(room.world.cfg).toMatchObject(WORLD_PRESETS.practice);
    expect(room.world.x0).toBe((MAP_SPACE - 6800) / 2);
  });

  it('during a round only grows, in steps of at most maxStep every stepMs; it shrinks at the next round start', { timeout: 60_000 }, () => {
    const { room, clock, round } = arenaRoom(scale());
    expect(room.world.cfg.width).toBe(3000);
    const conns = [];
    for (let i = 0; i < 100; i++) {
      const c = fakeConn(`w${i}`);
      room.join(c, stakeJoin(1, 1000));
      conns.push(c);
    }
    const sides: number[] = [];
    let lastChangeAt = -Infinity;
    let prev = room.world.cfg.width;
    for (let t = 0; t < 60_000; t += STEP) {
      room.tick(STEP);
      const s = room.world.cfg.width;
      if (s !== prev) {
        expect(s).toBeGreaterThan(prev);
        expect(s - prev).toBeLessThanOrEqual(MAP_GROW.maxStep);
        expect(room.world.now - lastChangeAt).toBeGreaterThanOrEqual(MAP_GROW.stepMs);
        lastChangeAt = room.world.now;
        sides.push(s);
        prev = s;
      }
    }
    expect(prev).toBe(9000);
    expect(sides.length).toBe(10);
    // people die or leave mid-round: the map stays (nobody is trapped against a closing wall)
    for (const c of conns.slice(0, 90)) room.leave(c, 'disconnect');
    ticks(room, 10_000);
    expect(room.world.cfg.width).toBe(9000);
    // the bell: the next round is sized for the people at the bell (100, still here as AFK)… then fewer
    clock.now = round.endsAt;
    room.tick(TICK_MS);
    expect(room.world.cfg.width).toBe(9000);
    const next = roundAt(clock.now, ROUND.roundMs, ROUND.closeMs);
    // 6 people come back for the second round, then the third round opens small
    for (let i = 0; i < 6; i++) room.join(fakeConn(`x${i}`), stakeJoin(1, 1000));
    clock.now = next.endsAt;
    room.tick(TICK_MS);
    expect(room.world.cfg.width).toBe(mapSideFor(6, MAP_SCALE_DEFAULT));
    expect(room.world.cfg.foodTarget).toBe(worldForSide(3000).foodTarget);
  });

  it('a free room shrinks only over empty floor, and only well below its size', { timeout: 60_000 }, () => {
    const room = new Room({ id: 'p', mode: 'private', name: 'Priv', maxPlayers: 60, bots: null, seed: 2, map: { scale: scale() } }, roomDeps(new ArenaChain([])));
    const conns = Array.from({ length: 50 }, (_, i) => fakeConn(`z${i}`));
    for (const c of conns) room.join(c, { name: 'p', skin: 1, flags: 0 });
    ticks(room, 30_000);
    expect(room.world.cfg.width).toBe(mapSideFor(50, MAP_SCALE_DEFAULT));
    // one leaves: within the hysteresis, nothing moves
    room.leave(conns.pop()!, 'left');
    ticks(room, 10_000);
    expect(room.world.cfg.width).toBe(mapSideFor(50, MAP_SCALE_DEFAULT));
    // all but one leave; the last one sits right at the edge: the floor never closes in on them
    for (const c of conns.splice(1)) room.leave(c, 'left');
    const last = conns[0].player!;
    const w = room.world;
    for (const cell of last.cells) {
      cell.x = w.x0 + 60;
      cell.y = w.y0 + 60;
    }
    w.setTarget(last.id, w.x0 + 60, w.y0 + 60);
    ticks(room, 10_000);
    expect(room.world.cfg.width).toBe(mapSideFor(50, MAP_SCALE_DEFAULT));
    // they walk to the middle: now it shrinks, step by step, down to the 1-player size
    const c = w.center();
    w.setTarget(last.id, c.x, c.y);
    ticks(room, 60_000);
    expect(room.world.cfg.width).toBe(MAP_SCALE_DEFAULT.min);
  });

  it('admin changes reach a live room: auto off returns to the preset (growing now, shrinking when allowed)', () => {
    const room = new Room({ id: 'p', mode: 'practice', name: 'Pond', maxPlayers: 40, bots: null, seed: 4, map: { scale: scale() } }, roomDeps(new ArenaChain([])));
    expect(room.world.cfg.width).toBe(3000);
    room.setMapScale(scale({ auto: false }));
    ticks(room, 30_000);
    expect(room.world.cfg.width).toBe(6800);
    expect(room.world.cfg.foodTarget).toBe(WORLD_PRESETS.practice.foodTarget);
    // nobody inside: a free room may close in at once, step by step, to the new curve's size
    room.setMapScale(scale({ perPlayer: 2000, min: 2000, max: 4000 }));
    ticks(room, 60_000);
    expect(room.world.cfg.width).toBe(2000);
  });

  it('a fixed room (no map option) never resizes', () => {
    const room = new Room({ id: 'c', mode: 'private', name: 'Fixed', maxPlayers: 20, bots: null, seed: 4, world: { ...WORLD_PRESETS.private } }, roomDeps(new ArenaChain([])));
    for (let i = 0; i < 20; i++) room.join(fakeConn(`f${i}`), { name: 'p', skin: 1, flags: 0 });
    ticks(room, 10_000);
    expect(room.world.cfg.width).toBe(WORLD_PRESETS.private.width);
    expect(room.world.x0).toBe(0);
    expect(room.mapScale()).toBeNull();
  });
});

describe('custom rooms: "Auto" or a chosen size', () => {
  const cfg = (p: Partial<CustomRoomConfig>): CustomRoomConfig => ({ ...CUSTOM_DEFAULTS, name: 'Pond', ...p });

  it('an auto room follows its own food and traps choices at any side', () => {
    const c = cfg({ mapSize: 'auto', food: 'high', traps: 'many', bots: 6 });
    const s = customWorld(c, 3000);
    const l = customWorld(c, 7000);
    expect(s.width).toBe(3000);
    expect(l.foodTarget).toBeGreaterThan(s.foodTarget * 4);
    expect(l.foodTarget).toBe(customWorld(cfg({ mapSize: 'L', food: 'high', traps: 'many' })).foodTarget);
    expect(l.virusTarget).toBe(customWorld(cfg({ mapSize: 'L', food: 'high', traps: 'many' })).virusTarget);
    expect(customWorld(cfg({ mapSize: 'auto', traps: 'none' }), 9000).virusTarget).toBe(0);
    // without a side an auto room opens at M
    expect(customWorld(cfg({ mapSize: 'auto' })).width).toBe(CUSTOM_MAP_WIDTH.M);
  });

  it('an auto custom room is sized for its bots plus its people and grows; a chosen size never moves', { timeout: 60_000 }, () => {
    const c = cfg({ mapSize: 'auto', bots: 12 });
    const auto = new Room(
      { id: 'priv-AUTOS', mode: 'private', code: 'AUTOS', name: 'Auto', maxPlayers: 20, bots: customBots(c), seed: 3, world: customWorld(c), map: { scale: scale(), shape: (side) => customWorld(c, side) } },
      roomDeps(new ArenaChain([])),
    );
    expect(auto.world.cfg.width).toBe(mapSideFor(12, MAP_SCALE_DEFAULT));
    for (let i = 0; i < 20; i++) auto.join(fakeConn(`c${i}`), { name: 'p', skin: 1, flags: 0 });
    ticks(auto, 30_000);
    // 12 bots + 20 people (a few may be eaten meanwhile: the map never shrinks back while people play)
    expect(auto.world.cfg.width).toBeGreaterThan(mapSideFor(24, MAP_SCALE_DEFAULT));
    expect(auto.world.cfg.width).toBeLessThanOrEqual(mapSideFor(32, MAP_SCALE_DEFAULT));
    expect(auto.world.cfg.foodTarget).toBe(customWorld(c, auto.world.cfg.width).foodTarget);
    const fixed = cfg({ mapSize: 'S', bots: 12 });
    const room = new Room({ id: 'priv-FIXED', mode: 'private', code: 'FIXED', name: 'Fixed', maxPlayers: 20, bots: customBots(fixed), seed: 3, world: customWorld(fixed) }, roomDeps(new ArenaChain([])));
    for (let i = 0; i < 20; i++) room.join(fakeConn(`d${i}`), { name: 'p', skin: 1, flags: 0 });
    ticks(room, 30_000);
    expect(room.world.cfg.width).toBe(CUSTOM_MAP_WIDTH.S);
  });
});

describe('map settings with the bot settings', () => {
  const base = defaultBotSettings({
    practiceRookie: { target: 12, min: 4, max: 12 },
    practicePro: { target: 12, min: 4, max: 12 },
    arena: { target: 12, min: 2, max: 12 },
    private: { target: 8, min: 2, max: 8 },
  });

  it('defaults every kind to the default curve and validates a patch', () => {
    expect(base.maps.arena).toEqual(MAP_SCALE_DEFAULT);
    const next = applyBotSettings(base, { maps: { arena: { perPlayer: 1000, max: 10_000 }, private: { auto: false } } });
    expect(next.maps.arena).toEqual({ ...MAP_SCALE_DEFAULT, perPlayer: 1000, max: 10_000 });
    expect(next.maps.private.auto).toBe(false);
    expect(next.maps.practicePro).toEqual(MAP_SCALE_DEFAULT);
    // min above max is pulled down to it
    expect(applyBotSettings(base, { maps: { arena: { min: 9000, max: 5000 } } }).maps.arena).toMatchObject({ min: 5000, max: 5000 });
  });

  it('refuses bad fields and unknown keys, and loads files from before the curve', () => {
    const bad = (body: Record<string, unknown>) => {
      try {
        applyBotSettings(base, body);
      } catch (e) {
        return (e as BotSettingsError).field;
      }
      return null;
    };
    expect(bad({ maps: { arena: { perPlayer: 100 } } })).toBe('maps.arena.perPlayer');
    expect(bad({ maps: { arena: { max: 50_000 } } })).toBe('maps.arena.max');
    expect(bad({ maps: { arena: { auto: 1 } } })).toBe('maps.arena.auto');
    expect(bad({ maps: { arena: { speed: 1 } } })).toBe('maps.arena.speed');
    expect(bad({ maps: { lobby: {} } })).toBe('maps.lobby');
    const { maps: _m, ...old } = structuredClone(base);
    const loaded = applyBotSettings(old as typeof base, { kinds: { arena: { cap: 4 } } }, { strict: false });
    expect(loaded.maps.arena).toEqual(MAP_SCALE_DEFAULT);
  });
});
