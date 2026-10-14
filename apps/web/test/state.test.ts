import { EntityKind, type SnapshotData } from '@slana/shared';
import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/game/state';

const snap = (partial: Partial<SnapshotData>): SnapshotData => ({
  tick: 1,
  view: { x: 0, y: 0, h: 1200 },
  players: [],
  upserts: [],
  removals: [],
  ...partial,
});

const ME = 7;

/** A world where player ME owns cell 1 at (1000, 1000). */
function worldWithMe(now = 0): ClientWorld {
  const w = new ClientWorld();
  w.myPid = ME;
  w.apply(
    snap({
      players: [{ id: ME, skin: 2, flags: 0, pass: 0, name: 'Me' }],
      upserts: [{ id: 1, kind: EntityKind.Cell, x: 1000, y: 1000, r: 60, playerId: ME }],
    }),
    now,
  );
  w.update(now, 0);
  return w;
}

describe('ClientWorld · loot', () => {
  it('loot entities are created, interpolated and removed with eater animation', () => {
    const w = worldWithMe(0);
    // a loot piece (tier 2) spills in
    w.apply(snap({ upserts: [{ id: 50, kind: EntityKind.Loot, x: 1200, y: 1000, r: 14, variant: 2 }] }), 10);
    const loot = w.entities.get(50)!;
    expect(loot.kind).toBe(EntityKind.Loot);
    expect(loot.variant).toBe(2);
    expect(loot.born).toBe(10);

    // it slides (friction) and the client eases between snapshots
    w.apply(snap({ upserts: [{ id: 50, kind: EntityKind.Loot, x: 1300, y: 1000, r: 14 }] }), 50);
    w.update(50 + 60, 0.06); // half way through the 120 ms lerp
    expect(loot.x).toBeGreaterThan(1200);
    expect(loot.x).toBeLessThan(1300);
    w.update(50 + 200, 0.14);
    expect(loot.x).toBeCloseTo(1300);
    expect(loot.variant).toBe(2); // variant kept when the upsert omits it

    // my cell eats it: it flies into the eater while shrinking, then disappears
    w.apply(snap({ removals: [{ id: 50, eaterId: 1 }] }), 300);
    expect(loot.dying).toBe(300);
    const eats = w.drainEats();
    expect(eats).toEqual([{ type: 'loot', eaterId: 1, x: 1300, y: 1000, variant: 2, mine: true }]);
    w.update(300 + 80, 0.08);
    expect(loot.x).toBeLessThan(1300);
    expect(loot.x).toBeGreaterThan(1000);
    expect(loot.r).toBeLessThan(14);
    expect(w.entities.has(50)).toBe(true);
    w.update(300 + 400, 0.3);
    expect(w.entities.has(50)).toBe(false);
  });

  it('loot that just leaves the view is removed without an eat event', () => {
    const w = worldWithMe(0);
    w.apply(snap({ upserts: [{ id: 51, kind: EntityKind.Loot, x: 1500, y: 1500, r: 14, variant: 0 }] }), 0);
    w.apply(snap({ removals: [{ id: 51, eaterId: 0 }] }), 20);
    expect(w.drainEats()).toEqual([]);
  });
});

describe('ClientWorld · value messages', () => {
  it('value message updates hud value and queues a floating number', () => {
    const w = worldWithMe(0);
    expect(w.value).toBeNull();
    w.applyValue({ t: 'value', value: 12_450_000_000, delta: 2_450_000_000, reason: 'loot' }, 100);
    expect(w.value).toBe(12_450_000_000);
    const floats = w.drainFloats();
    expect(floats).toHaveLength(1);
    expect(floats[0]).toMatchObject({ delta: 2_450_000_000, reason: 'loot', at: 100 });
    // the number rises from the top of my cell
    expect(floats[0].x).toBeCloseTo(1000);
    expect(floats[0].y).toBeLessThan(1000);
    expect(w.drainFloats()).toEqual([]);

    // a loss (a player took a share) is queued as a negative number
    w.applyValue({ t: 'value', value: 10_000_000_000, delta: -2_450_000_000, reason: 'eaten' }, 200);
    expect(w.value).toBe(10_000_000_000);
    expect(w.drainFloats()[0].delta).toBe(-2_450_000_000);

    // zero deltas update the value but float nothing
    w.applyValue({ t: 'value', value: 10_000_000_000, delta: 0, reason: 'eat' }, 300);
    expect(w.drainFloats()).toEqual([]);
  });

  it('a value message without my cells still updates the value (no float position)', () => {
    const w = new ClientWorld();
    w.applyValue({ t: 'value', value: 5, delta: 5, reason: 'eat' }, 0);
    expect(w.value).toBe(5);
    expect(w.drainFloats()).toEqual([]);
  });

  it('reset clears the value', () => {
    const w = worldWithMe(0);
    w.applyValue({ t: 'value', value: 5, delta: 5, reason: 'eat' }, 0);
    w.reset();
    expect(w.value).toBeNull();
  });
});
