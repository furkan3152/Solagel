import { describe, expect, it } from 'vitest';
import {
  ClientOp,
  EntityKind,
  PowerUpType,
  decodeClientInput,
  decodeSnapshot,
  encodeEject,
  encodeSnapshot,
  encodeSplit,
  encodeTarget,
  type SnapshotData,
} from '../src';

const sample: SnapshotData = {
  tick: 123456,
  view: { x: 1500.5, y: 2200.25, h: 1150 },
  players: [
    { id: 1, skin: 0, flags: 0, name: 'gm_gummy' },
    { id: 65000, skin: 23, flags: 3, name: 'Çağrı🚀' },
  ],
  upserts: [
    { id: 1, kind: EntityKind.Cell, x: 10.5, y: 20.25, r: 44.72, playerId: 65000, flags: 5 },
    { id: 2, kind: EntityKind.Food, x: 100, y: 200, r: 10, variant: 7 },
    { id: 3, kind: EntityKind.Eject, x: 300.5, y: 400.5, r: 37.4, variant: 12 },
    { id: 4, kind: EntityKind.Virus, x: 500, y: 600, r: 100 },
    { id: 4294967295, kind: EntityKind.PowerUp, x: 700, y: 800, r: 40, variant: PowerUpType.Shield },
  ],
  removals: [
    { id: 9, eaterId: 1 },
    { id: 10, eaterId: 0 },
    { id: 11, eaterId: 4294967295 },
  ],
};

describe('snapshot codec', () => {
  it('round-trips every entity kind, unicode names and removals', () => {
    const decoded = decodeSnapshot(encodeSnapshot(sample));
    expect(decoded.tick).toBe(sample.tick);
    expect(decoded.view.x).toBeCloseTo(sample.view.x, 3);
    expect(decoded.view.y).toBeCloseTo(sample.view.y, 3);
    expect(decoded.view.h).toBeCloseTo(sample.view.h, 3);
    expect(decoded.players).toEqual(sample.players);
    expect(decoded.removals).toEqual(sample.removals);
    expect(decoded.upserts).toHaveLength(sample.upserts.length);
    decoded.upserts.forEach((e, i) => {
      const s = sample.upserts[i];
      expect(e.id).toBe(s.id);
      expect(e.kind).toBe(s.kind);
      expect(e.x).toBeCloseTo(s.x, 3);
      expect(e.y).toBeCloseTo(s.y, 3);
      expect(e.r).toBeCloseTo(s.r, 3);
      expect(e.playerId).toBe(s.playerId);
      expect(e.flags).toBe(s.flags);
      expect(e.variant).toBe(s.variant);
    });
  });

  it('handles empty snapshots', () => {
    const empty: SnapshotData = { tick: 0, view: { x: 0, y: 0, h: 0 }, players: [], upserts: [], removals: [] };
    expect(decodeSnapshot(encodeSnapshot(empty))).toEqual(empty);
  });

  it('grows the buffer for large snapshots', () => {
    const big: SnapshotData = {
      tick: 1,
      view: { x: 0, y: 0, h: 1 },
      players: [],
      upserts: Array.from({ length: 5000 }, (_, i) => ({ id: i, kind: EntityKind.Food, x: i, y: i, r: 10, variant: i % 8 })),
      removals: [],
    };
    const decoded = decodeSnapshot(encodeSnapshot(big));
    expect(decoded.upserts).toHaveLength(5000);
    expect(decoded.upserts[4999].x).toBe(4999);
  });

  it('truncates very long names on a UTF-8 boundary', () => {
    const name = '🚀'.repeat(100); // 400 bytes
    const decoded = decodeSnapshot(
      encodeSnapshot({ tick: 1, view: { x: 0, y: 0, h: 1 }, players: [{ id: 1, skin: 0, flags: 0, name }], upserts: [], removals: [] }),
    );
    expect(decoded.players[0].name).toBe('🚀'.repeat(63));
  });
});

describe('client input codec', () => {
  it('round-trips target / split / eject', () => {
    expect(decodeClientInput(encodeTarget(12.5, -3.25))).toEqual({ op: ClientOp.Target, x: 12.5, y: -3.25 });
    expect(decodeClientInput(encodeSplit())).toEqual({ op: ClientOp.Split });
    expect(decodeClientInput(encodeEject())).toEqual({ op: ClientOp.Eject });
  });

  it('rejects malformed input', () => {
    expect(decodeClientInput(new ArrayBuffer(0))).toBeNull();
    expect(decodeClientInput(new Uint8Array([ClientOp.Target, 1, 2]))).toBeNull();
    expect(decodeClientInput(new Uint8Array([99]))).toBeNull();
    expect(decodeClientInput(encodeTarget(Number.NaN, 1))).toBeNull();
    expect(decodeClientInput(encodeTarget(Number.POSITIVE_INFINITY, 1))).toBeNull();
  });
});
