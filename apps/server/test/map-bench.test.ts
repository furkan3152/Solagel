import { MAP_SCALE_DEFAULT, MAP_SPACE, TICK_MS, worldForSide } from '@elymum/shared';
import { describe, expect, it } from 'vitest';
import { World } from '../src/game/world';
import { runMapRoom } from './map-room';

/**
 * CPU budget of a full room on the adaptive map. A tick has 33 ms; production runs on half a CPU,
 * so the room must stay well under half of that here. Generous bounds (CI machines vary): the
 * point is to catch an O(n^2) or a per-tick rebuild, not to time the machine.
 */
describe('100-player room on the auto-sized map (bench)', () => {
  it('grows to the 100-player size and ticks well inside the budget', { timeout: 120_000 }, () => {
    const r = runMapRoom({ players: 100, humans: 40, seconds: 5, map: { ...MAP_SCALE_DEFAULT } });
    console.log(`100-player room: side ${r.side}, ${r.players} players, ${r.food} food, ${r.cacti} cacti; tick mean ${r.mean.toFixed(2)} ms, p95 ${r.p95.toFixed(2)} ms, max ${r.max.toFixed(2)} ms`);
    expect(r.side).toBe(9000);
    expect(r.players).toBeGreaterThanOrEqual(90);
    expect(r.mean).toBeLessThan(20);
  });

  it('a resize costs no more than one pass over the entities (and growing next to nothing)', () => {
    const w = new World({ ...worldForSide(9000), powerUps: true, coinRain: false, seed: 9, space: MAP_SPACE });
    for (let i = 0; i < 100; i++) w.addPlayer({ name: `p${i}`, skin: 1 });
    for (let i = 0; i < 60; i++) w.tick(TICK_MS);
    const grids = [w.staticGrid, w.dynGrid];
    let t = performance.now();
    for (let s = 9000; s >= 3000; s -= 600) w.resize(s, s, worldForSide(s));
    const shrink = performance.now() - t;
    t = performance.now();
    for (let s = 3000; s <= 9000; s += 600) w.resize(s, s, worldForSide(s));
    const grow = performance.now() - t;
    // the grids are the ones built at the start (sized for the whole space)
    expect([w.staticGrid, w.dynGrid]).toEqual(grids);
    expect(w.staticGrid.cols).toBe(Math.ceil(MAP_SPACE / 256));
    expect(shrink).toBeLessThan(50);
    expect(grow).toBeLessThan(5);
  });
});
